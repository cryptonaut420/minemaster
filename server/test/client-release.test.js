const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  state,
  version,
  latest,
  compare,
} = require("../src/services/clientRelease");
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
  assert.equal(
    state(
      { ...rig, activeUpdate: { status: "running", targetVersion: "1.4.7" } },
      "1.4.7",
    ).status,
    "reconnecting",
  );
  rig.freshness.connected = true;
  rig.version = "1.4.6";
  rig.appUpdate.supported = false;
  assert.equal(state(rig, "1.4.7").status, "manual");
  assert.equal(version("1.4.7-beta.1"), null);
  assert.equal(state({ ...rig, version: "1.4.10" }, "1.4.7").status, "newer");
  assert.equal(state({ ...rig, version: "1.4.10" }, "1.4.7").canCheck, false);
  assert.equal(compare("1.4.10", "1.4.9"), 1);
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

test("update controls block overlapping commands and fresh downloads while retaining actual installed version", () => {
  const rig = {
    id: "one",
    version: "1.4.17",
    freshness: { connected: true, telemetryFresh: true },
    capabilities: { appUpdates: true },
    appUpdate: { supported: true, state: "downloaded", version: "1.4.18" },
  };
  assert.equal(state(rig, "1.4.18").canInstall, true);
  assert.equal(state(rig, "1.4.18").canCheck, false);
  const command = { id: "check", action: "app-update-check", status: "sent" };
  let result = state({ ...rig, pendingCommand: command }, "1.4.18");
  assert.equal(result.status, "checking");
  assert.equal(result.canCheck, false);
  assert.equal(result.canInstall, false);
  result = state(
    { ...rig, pendingCommand: { ...command, action: "start" } },
    "1.4.18",
  );
  assert.equal(result.status, "ready");
  assert.equal(result.canInstall, false);
  result = state(
    { ...rig, activeUpdate: { ...command, action: "app-update-install" } },
    "1.4.18",
  );
  assert.equal(result.status, "installing");
  assert.equal(result.canInstall, false);
  assert.equal(result.canCheck, false);
  rig.appUpdate.state = "downloading";
  assert.equal(state(rig, "1.4.18").canCheck, false);
  rig.freshness.telemetryFresh = false;
  assert.equal(state(rig, "1.4.18").status, "outdated");
  assert.equal(state(rig, "1.4.18").canCheck, true);
  rig.version = "1.4.18";
  result = state(
    {
      ...rig,
      lastUpdate: {
        ...command,
        status: "timed_out",
        error: "Reconnect not confirmed",
      },
    },
    "1.4.18",
  );
  assert.equal(result.status, "current");
  assert.equal(result.lastUpdate.status, "timed_out");
  rig.freshness.connected = false;
  result = state({ ...rig, pendingCommand: command }, "1.4.18");
  assert.equal(
    result.status,
    "offline",
    "a check is not an installation/reconnect",
  );
  assert.equal(result.canCheck, false);
});

test("a current client keeps its accurate version badge but can explicitly retry a failed release check", () => {
  const rig = {
    id: "current",
    version: "1.4.18",
    capabilities: { appUpdates: true },
    freshness: { connected: true, telemetryFresh: true },
    appUpdate: { supported: true, state: "error", message: "GitHub HTTP 500" },
  };
  assert.equal(state(rig, "1.4.18").status, "current");
  assert.equal(state(rig, "1.4.18").canCheck, true);
  assert.equal(state(rig, "1.4.18").canInstall, false);
  assert.equal(
    state({ ...rig, pendingCommand: { action: "stop" } }, "1.4.18").canCheck,
    false,
  );
  assert.equal(state({ ...rig, version: "1.4.19" }, "1.4.18").canCheck, false);
});
