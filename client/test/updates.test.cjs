const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("events");
const { createUpdateController } = require("../electron/updateController");
test("downloaded app updates wait for explicit installation and retain their metadata", async () => {
  const updater = new EventEmitter();
  let installed = 0,
    stopped = 0;
  updater.quitAndInstall = () => installed++;
  const controller = createUpdateController({
    updater,
    stopMiners: async () => {
      stopped++;
    },
  });
  updater.emit("update-downloaded", { version: "2.0.0" });
  assert.equal(installed, 0);
  assert.equal(controller.getState().version, "2.0.0");
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal((await controller.install()).success, true);
  assert.equal(stopped, 1);
  assert.equal(installed, 1);
  controller.cleanup();
  assert.equal(updater.listenerCount("update-downloaded"), 0);
});
test("failed stop prevents installing and keeps a downloaded update available for retry", async () => {
  const updater = new EventEmitter();
  let installed = false,
    released = false;
  updater.quitAndInstall = () => (installed = true);
  const c = createUpdateController({
    updater,
    stopMiners: async () => {
      throw Error("PID remains alive");
    },
    releaseStarts: () => (released = true),
  });
  updater.emit("update-downloaded", { version: "2.0.0" });
  assert.equal((await c.install()).success, false);
  assert.equal(installed, false);
  assert.equal(released, true);
  assert.equal(c.getState().state, "downloaded");
});
test("asynchronous update failures are handled and concurrent checks share a single request", async () => {
  const updater = new EventEmitter();
  let calls = 0,
    reject;
  updater.checkForUpdates = () => {
    calls++;
    return new Promise((_, r) => (reject = r));
  };
  const c = createUpdateController({ updater });
  const a = c.checkForUpdates(),
    b = c.checkForUpdates();
  await Promise.resolve();
  reject(Error("network down"));
  assert.equal((await a).success, false);
  assert.equal((await b).success, false);
  assert.equal(calls, 1);
});
test("an installer error event releases mining controls and retains the downloaded update", async () => {
  const updater = new EventEmitter();
  let released = 0;
  updater.quitAndInstall = () => {};
  const c = createUpdateController({
    updater,
    stopMiners: async () => {},
    releaseStarts: () => released++,
  });
  updater.emit("update-downloaded", { version: "2.0.0" });
  await c.install();
  updater.emit("error", Error("Installer access denied"));
  assert.equal(c.getState().state, "downloaded");
  assert.match(c.getState().message, /Installer access denied/);
  assert.equal(released, 1);
  updater.quitAndInstall = () =>
    updater.emit("error", Error("Immediate failure"));
  assert.equal((await c.install()).success, false);
});

test("an updater error during stop preparation cannot continue into installer handoff", async () => {
  const updater = new EventEmitter();
  let finish,
    installed = 0,
    released = 0;
  updater.quitAndInstall = () => installed++;
  const c = createUpdateController({
    updater,
    stopMiners: () => new Promise((r) => (finish = r)),
    releaseStarts: () => released++,
  });
  updater.emit("update-downloaded", { version: "2.0.0" });
  const pending = c.install();
  updater.emit("error", Error("download became unavailable"));
  assert.equal(released, 0);
  assert.equal((await c.install()).success, false);
  finish();
  assert.equal((await pending).success, false);
  assert.equal(installed, 0);
  assert.equal(released, 1);
});
test("background download rejection is observed and a synchronous check failure can be retried", async () => {
  const updater = new EventEmitter();
  let tries = 0;
  updater.checkForUpdates = () => {
    if (++tries === 1) throw Error("offline");
    return { downloadPromise: Promise.reject(Error("download lost")) };
  };
  const c = createUpdateController({ updater });
  assert.equal((await c.checkForUpdates()).success, false);
  await c.checkForUpdates();
  await Promise.resolve();
  assert.equal(tries, 2);
  assert.equal(c.getState().state, "error");
  assert.match(c.getState().message, /download lost/);
});
test("only the intended updated version can consume resume state", async (t) => {
  const fs = require("fs"),
    os = require("os"),
    path = require("path");
  const { createResumeStore } = require("../electron/updateResume");
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "minemaster-resume-"));
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  const old = createResumeStore({ userData, version: "1.3.0" }),
    updated = createResumeStore({ userData, version: "1.3.1" });
  old.save(["xmrig-1"], "1.3.1");
  assert.equal(old.take(), null);
  assert.deepEqual(updated.take().minerIds, ["xmrig-1"]);
  assert.equal(updated.take(), null);
  old.save(["xmrig-1"], "1.3.1");
  old.clear();
  assert.equal(updated.take(), null);
  fs.writeFileSync(
    path.join(userData, "update-resume-state.json"),
    JSON.stringify({
      minerIds: ["xmrig-1"],
      savedAt: Date.now() + 999999,
      targetVersion: "1.3.1",
    }),
  );
  assert.equal(updated.take(), null);
});

test("Linux update keeps a recoverable AppImage when upstream replacement loses the original", async (t) => {
  const fs = require("fs/promises"),
    os = require("os"),
    path = require("path"),
    { createAppImageBackup } = require("../electron/appImageBackup");
  const userData = await fs.mkdtemp(
    path.join(os.tmpdir(), "minemaster-appimage-"),
  );
  t.after(() => fs.rm(userData, { recursive: true, force: true }));
  const appImage = path.join(userData, "MineMaster.AppImage");
  await fs.writeFile(appImage, "fake old app, never executed");
  const guard = createAppImageBackup({ userData, appImage, version: "1.3.0" });
  await guard.prepare("1.3.1");
  await fs.unlink(appImage);
  await guard.restore();
  assert.equal(
    await fs.readFile(appImage, "utf8"),
    "fake old app, never executed",
  );
  await createAppImageBackup({
    userData,
    appImage,
    version: "1.3.1",
  }).complete();
  await assert.rejects(fs.stat(appImage + ".minemaster-backup"), {
    code: "ENOENT",
  });
  assert.ok(await fs.stat(appImage));
});
