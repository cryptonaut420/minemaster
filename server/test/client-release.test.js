const { test } = require("node:test");
const assert = require("node:assert/strict");
const { state, version, latest } = require("../src/services/clientRelease");
test("release status separates reported version, connectivity, unsupported packages and staged downloads", () => {
  const rig = {
    id: "one",
    version: "1.4.6+93.hash",
    freshness: { connected: true, telemetryFresh: true },
    capabilities: { appUpdates: true },
    appUpdate: { supported: true, state: "downloaded", version: "1.4.6" },
  };
  assert.equal(state(rig, "1.4.7").canInstall, false);
  assert.equal(state(rig, "1.4.7").status, "outdated");
  rig.appUpdate.version = "1.4.7";
  assert.equal(state(rig, "1.4.7").status, "ready");
  rig.freshness.telemetryFresh = false;
  assert.equal(state(rig, "1.4.7").canInstall, false);
  rig.version = "1.4.7+95.build";
  assert.equal(state(rig, "1.4.7").status, "current");
  rig.freshness.connected = false;
  assert.equal(state(rig, "1.4.7").status, "offline");
  rig.freshness.connected = true;
  rig.version = "1.4.6";
  rig.appUpdate.supported = false;
  assert.equal(state(rig, "1.4.7").status, "manual");
  assert.equal(version("1.4.7-beta.1"), null);
});
test("latest release rejects incomplete assets and caches a verified complete release", async () => {
  const release = { tag_name: "v1.4.7", assets: [] };
  let calls = 0;
  const f = async () => {
    calls++;
    return { ok: true, json: async () => release };
  };
  await assert.rejects(latest(f), /incomplete/);
  release.assets = [
    "latest.yml",
    "latest-linux.yml",
    "MineMaster-1.4.7-Windows-Setup.exe",
    "MineMaster-1.4.7-Linux.AppImage",
  ].map((name) => ({ name }));
  assert.equal((await latest(f)).version, "1.4.7");
  await latest(f);
  assert.equal(calls, 2);
});
