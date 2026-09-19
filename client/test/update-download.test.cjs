const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const http = require("http");
const crypto = require("crypto");
const yaml = require("js-yaml");
const { NsisUpdater, AppImageUpdater } = require("electron-updater");
const {
  ElectronHttpExecutor,
} = require("electron-updater/out/electronHttpExecutor");
const { NodeHttpExecutor } = require("builder-util/out/nodeHttpExecutor");
const { createUpdateController } = require("../electron/updateController");
const { createResumeStore } = require("../electron/updateResume");

test("installed updater downloads and verifies both platform feeds, refreshes a ready release, and rejects corrupt bytes", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "minemaster-updater-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let version = "1.4.5",
    corrupt = false;
  const bytes = () =>
    Buffer.from(`Synthetic ${version} installer; never executed`);
  const server = http.createServer((req, res) => {
    res.setHeader("Connection", "close");
    const name = new URL(req.url, "http://localhost").pathname.slice(1);
    if (name.endsWith(".yml")) {
      const target = `MineMaster-${version}-${name === "latest.yml" ? "Windows-Setup.exe" : "Linux.AppImage"}`;
      const sha512 = crypto
        .createHash("sha512")
        .update(bytes())
        .digest("base64");
      res.end(
        yaml.dump({
          version,
          path: target,
          sha512,
          files: [{ url: target, size: bytes().length, sha512 }],
        }),
      );
    } else {
      res.setHeader("Content-Length", bytes().length);
      res.end(corrupt ? Buffer.alloc(bytes().length, 120) : bytes());
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  for (const [platform, Updater] of [
    ["win32", NsisUpdater],
    ["linux", AppImageUpdater],
  ]) {
    version = "1.4.5";
    corrupt = false;
    const dir = path.join(root, platform);
    await fs.mkdir(dir);
    const config = path.join(dir, "app-update.yml");
    await fs.writeFile(
      config,
      yaml.dump({ updaterCacheDirName: "fixture-cache" }),
    );
    const updater = new Updater(null, {
      version: "1.4.4",
      name: "MineMaster Fixture",
      isPackaged: true,
      userDataPath: dir,
      baseCachePath: dir,
      appUpdateConfigPath: config,
      whenReady: async () => {},
    });
    updater.logger = { info() {}, warn() {}, error() {}, debug() {} };
    const executor = new ElectronHttpExecutor();
    executor.createRequest = NodeHttpExecutor.prototype.createRequest;
    executor.addRedirectHandlers =
      NodeHttpExecutor.prototype.addRedirectHandlers;
    updater.httpExecutor = executor;
    updater._testOnlyOptions = { platform };
    // Only bypass AppImage's host environment check; native installer execution stays forbidden.
    updater.isUpdaterActive = () => true;
    updater.disableDifferentialDownload = true;
    updater.disableWebInstaller = true;
    updater.setFeedURL({
      provider: "generic",
      url: `http://127.0.0.1:${server.address().port}/`,
    });
    let download;
    const check = updater.checkForUpdates.bind(updater);
    updater.checkForUpdates = async () => {
      const result = await check();
      download = result?.downloadPromise;
      return result;
    };
    const controller = createUpdateController({ updater });
    t.after(() => controller.cleanup());
    const oldAppImage = process.env.APPIMAGE;
    if (platform === "linux")
      process.env.APPIMAGE = path.join(dir, "old.AppImage");
    try {
      for (const next of ["1.4.5", "1.4.6"]) {
        version = next;
        await controller.checkForUpdates();
        await download;
        assert.equal(controller.getState().state, "downloaded");
        assert.equal(controller.getState().version, next);
        assert.deepEqual(await fs.readFile(updater.installerPath), bytes());
      }
      // Exercise the previously published resume format against the destination reader.
      createResumeStore({ userData: dir, version: "1.4.5" }).save(
        ["nanominer-1"],
        "1.4.6",
      );
      assert.deepEqual(
        createResumeStore({ userData: dir, version: "1.4.6" }).take().minerIds,
        ["nanominer-1"],
      );
      version = "1.4.7";
      corrupt = true;
      await controller.checkForUpdates();
      await assert.rejects(download, /sha512 checksum mismatch/i);
      assert.equal(controller.getState().state, "error");
    } finally {
      if (oldAppImage === undefined) delete process.env.APPIMAGE;
      else process.env.APPIMAGE = oldAppImage;
    }
  }
});
