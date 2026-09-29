const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { stageMiners } = require("../scripts/stage-miners.cjs");
const { checkMinerReleases } = require("../scripts/check-miner-releases.cjs");
const {
  verifyPackagedMiners,
} = require("../scripts/verify-packaged-miners.cjs");

test("packaging only stages verified current runtime files and preserves a good bundle on failure", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mm-package-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourceRoot = path.join(root, "cache"),
    bundleRoot = path.join(root, "bundle");
  const content = {
    "miner.exe": "inert fixture, never executed",
    "ReadMe.txt": "license fixture",
  };
  const pin = {
    platform: "win32",
    version: "1.0.0",
    binary: "miner.exe",
    sha256: "archive",
    files: Object.fromEntries(
      Object.entries(content).map(([name, data]) => [
        name,
        crypto.createHash("sha256").update(data).digest("hex"),
      ]),
    ),
  };
  const manifest = { fake: { "win32-x64": pin } };
  const current = path.join(sourceRoot, "win-x64/fake/1.0.0");
  await fs.mkdir(current, { recursive: true });
  for (const [name, data] of Object.entries({
    ...content,
    "WinRing0.sys": "excluded",
    "extra.txt": "excluded",
  }))
    await fs.writeFile(path.join(current, name), data);
  await fs.mkdir(path.join(sourceRoot, "win-x64/fake/0.9.0"));
  await fs.writeFile(
    path.join(sourceRoot, "win-x64/fake/0.9.0/old.exe"),
    "excluded",
  );
  const options = { sourceRoot, bundleRoot, manifest };
  const staged = await stageMiners("win32", "x64", options);
  await verifyPackagedMiners(staged, "win32", "x64", manifest);
  const unwanted = path.join(staged, "fake/1.0.0/unexpected.sys");
  await fs.writeFile(unwanted, "excluded");
  await assert.rejects(
    verifyPackagedMiners(staged, "win32", "x64", manifest),
    /Unexpected or missing/,
  );
  await fs.unlink(unwanted);
  assert.deepEqual(await fs.readdir(path.join(staged, "fake")), ["1.0.0"]);
  assert.deepEqual((await fs.readdir(path.join(staged, "fake/1.0.0"))).sort(), [
    "ReadMe.txt",
    "miner.exe",
    "release.json",
  ]);
  assert.equal(
    await fs.readFile(path.join(staged, "fake/1.0.0/miner.exe"), "utf8"),
    content["miner.exe"],
  );
  await fs.writeFile(path.join(current, "miner.exe"), "corrupt");
  await assert.rejects(
    stageMiners("win32", "x64", options),
    /Verification failed/,
  );
  assert.equal(
    await fs.readFile(path.join(staged, "fake/1.0.0/miner.exe"), "utf8"),
    content["miner.exe"],
  );
  assert.deepEqual(await fs.readdir(bundleRoot), ["win-x64"]);
  await assert.rejects(
    stageMiners("linux", "arm64", options),
    /No pinned miners/,
  );
});

test("release freshness gate rejects outdated, changed or unverifiable official assets", async () => {
  const manifest = {},
    upstream = {};
  for (const engine of ["srbminer", "nanominer", "xmrig"]) {
    const pin = {
      version: "1.0.0",
      archive: "fixture.zip",
      url: `https://example.test/${engine}.zip`,
      sha256: "abc",
    };
    manifest[engine] = { "win32-x64": pin };
    upstream[engine] = {
      tag_name: "v1.0.0",
      draft: false,
      prerelease: false,
      assets: [
        {
          name: pin.archive,
          browser_download_url: pin.url,
          digest: "sha256:abc",
        },
      ],
    };
  }
  const load = async (repo) =>
    structuredClone(
      upstream[repo.startsWith("doktor83/") ? "srbminer" : repo.split("/")[1]],
    );
  assert.equal((await checkMinerReleases({ manifest, load })).length, 3);
  const baseline = structuredClone(upstream.srbminer);
  for (const patch of [
    { tag_name: "3.7.0" },
    { draft: true },
    { prerelease: true },
    { assets: [] },
    { assets: [{ ...baseline.assets[0], digest: "sha256:changed" }] },
    {
      assets: [
        {
          ...baseline.assets[0],
          browser_download_url: "https://example.test/replaced",
        },
      ],
    },
  ]) {
    upstream.srbminer = { ...baseline, ...patch };
    await assert.rejects(checkMinerReleases({ manifest, load }));
  }
  await assert.rejects(
    checkMinerReleases({
      manifest,
      load: async () => {
        throw Error("service unavailable");
      },
    }),
    /service unavailable/,
  );
});
