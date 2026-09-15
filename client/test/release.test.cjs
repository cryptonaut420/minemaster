const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const yaml = require("js-yaml");
const {
  verifyRelease,
  writeChecksums,
} = require("../scripts/verify-release.cjs");
const { publish } = require("../scripts/publish-release.cjs");
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "minemaster-release-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const content = Buffer.from("Synthetic package bytes; never executed");
  const sha512 = crypto.createHash("sha512").update(content).digest("base64");
  for (const suffix of [
    "Windows-Setup.exe",
    "Windows-Setup.exe.blockmap",
    "Windows-Portable.exe",
    "Linux.AppImage",
  ])
    await fs.writeFile(path.join(dir, `MineMaster-1.4.5-${suffix}`), content);
  for (const [feed, target] of [
    ["latest.yml", "Windows-Setup.exe"],
    ["latest-linux.yml", "Linux.AppImage"],
  ]) {
    const name = `MineMaster-1.4.5-${target}`;
    await fs.writeFile(
      path.join(dir, feed),
      yaml.dump({
        version: "1.4.5",
        path: name,
        sha512,
        files: [{ url: name, sha512, size: content.length }],
      }),
    );
  }
  return dir;
}
test("release verification rejects missing platform assets, wrong versions and changed installer bytes", async (t) => {
  const dir = await fixture(t);
  assert.equal((await verifyRelease(dir, "1.4.5")).length, 6);
  const feed = path.join(dir, "latest.yml"),
    original = await fs.readFile(feed, "utf8");
  await fs.writeFile(
    feed,
    original.replace("version: 1.4.5", "version: 1.4.4"),
  );
  await assert.rejects(verifyRelease(dir, "1.4.5"), /feed/);
  await fs.writeFile(feed, original);
  await fs.appendFile(
    path.join(dir, "MineMaster-1.4.5-Windows-Setup.exe"),
    "corrupt",
  );
  await assert.rejects(verifyRelease(dir, "1.4.5"), /feed/);
  await fs.unlink(path.join(dir, "MineMaster-1.4.5-Linux.AppImage"));
  await assert.rejects(verifyRelease(dir, "1.4.5"), { code: "ENOENT" });
});
test("publishing remains a draft unless every uploaded digest matches", async (t) => {
  const dir = await fixture(t),
    calls = [];
  const assets = (await writeChecksums(dir, "1.4.5")).map((a) => ({
    ...a,
    state: "uploaded",
    digest: `sha256:${a.sha256}`,
  }));
  const run = (...args) => {
    calls.push(args);
    if (args[0] === "api")
      return JSON.stringify([{ tag_name: "v1.4.5", draft: true, assets }]);
    return "";
  };
  assets[0].digest = "sha256:wrong";
  await assert.rejects(
    publish(dir, "1.4.5", "fixture-notes", run),
    /remains a draft/,
  );
  assert.equal(
    calls.some((args) => args.includes("--draft=false")),
    false,
  );
  assets[0].digest = `sha256:${assets[0].sha256}`;
  await publish(dir, "1.4.5", "fixture-notes", run);
  assert.ok(calls.at(-1).includes("--draft=false"));
});
