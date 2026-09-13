const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const {
  releaseFor,
  targetName,
  verifyDirectory,
  installRelease,
  replaceDirectory,
} = require("../electron/mining/install");
test("pins separate architecture releases and excludes optional kernel drivers from runtime bundles", () => {
  assert.notEqual(
    releaseFor("xmrig", "darwin", "arm64").sha256,
    releaseFor("xmrig", "darwin", "x64").sha256,
  );
  assert.equal(releaseFor("nanominer", "win32", "x64").version, "3.10.0");
  assert.equal(
    Object.keys(releaseFor("xmrig", "win32", "x64").files).length,
    1,
  );
  assert.equal(targetName("win32", "x64"), "win-x64");
  assert.throws(() => releaseFor("nanominer", "darwin", "arm64"));
});
test("archive mismatch leaves the previous installation intact and never extracts", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "minemaster-install-test-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dest = path.join(root, "installed");
  await fs.mkdir(dest);
  await fs.writeFile(path.join(dest, "old"), "previous");
  let extracted = false;
  await assert.rejects(
    installRelease("xmrig", dest, {
      platform: "linux",
      arch: "x64",
      fetch: async (_, file) => fs.writeFile(file, "corrupt download"),
      unpack: async () => (extracted = true),
    }),
    /checksum/,
  );
  assert.equal(extracted, false);
  assert.equal(await fs.readFile(path.join(dest, "old"), "utf8"), "previous");
  assert.deepEqual(await fs.readdir(root), ["installed"]);
});
test("partial executable and missing files fail verification", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "minemaster-verify-test-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await assert.rejects(
    verifyDirectory(root, releaseFor("xmrig", "linux", "x64")),
    { code: "ENOENT" },
  );
  await fs.writeFile(path.join(root, "xmrig"), "incomplete");
  await assert.rejects(
    verifyDirectory(root, releaseFor("xmrig", "linux", "x64")),
    { code: "CHECKSUM_MISMATCH" },
  );
});
test("failed directory replacement restores the previous files", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "minemaster-rename-test-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dest = path.join(root, "installed");
  await fs.mkdir(dest);
  await fs.writeFile(path.join(dest, "old"), "good");
  await assert.rejects(replaceDirectory(path.join(root, "missing"), dest));
  assert.equal(await fs.readFile(path.join(dest, "old"), "utf8"), "good");
});
test("setup requires explicit valid target arguments and does not silently use the host for malformed flags", () => {
  const { parseTargets } = require("../scripts/download-miners");
  for (const args of [
    ["--platform"],
    ["--arch"],
    ["--all", "--platform", "linux"],
    ["--platform", "windows"],
    ["--all", "--arch", "arm64"],
  ])
    assert.throws(() => parseTargets(args));
  assert.deepEqual(parseTargets(["--platform", "darwin", "--arch", "arm64"]), [
    { platform: "darwin", arch: "arm64" },
  ]);
});
