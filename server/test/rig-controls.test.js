const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const helpers = import(
  "data:text/javascript;base64," +
    Buffer.from(
      fs.readFileSync(
        path.join(__dirname, "../public/src/utils/rigControls.js"),
        "utf8",
      ),
    ).toString("base64")
);
test("quick Play respects disabled mining and missing GPUs; Pause always covers pending processes", async () => {
  const { quickScope, controlUnavailable } = await helpers;
  const rig = {
    freshness: { connected: true },
    protocolVersion: 2,
    capabilities: { commandResults: true },
    processes: [
      { deviceType: "CPU", enabled: true },
      { deviceType: "GPU", enabled: true },
    ],
    hardware: { gpus: [] },
  };
  assert.equal(controlUnavailable(rig), "");
  assert.equal(quickScope(rig, "start"), "CPU");
  assert.equal(quickScope(rig, "stop"), "ALL");
  rig.hardware.gpus = [{}];
  assert.equal(quickScope(rig, "start"), "ALL");
  rig.processes[0].enabled = false;
  assert.equal(quickScope(rig, "start"), "GPU");
  rig.processes[1].enabled = false;
  assert.equal(quickScope(rig, "start"), null);
  assert.match(
    controlUnavailable({ ...rig, freshness: { connected: false } }),
    /offline/,
  );
});
test("offline and stale process states never claim currently stopped or mining, while zero remains a real reading", async () => {
  const { processRateLabel } = await helpers;
  const p = { running: true, hashrate: 0, quality: "zero" };
  assert.equal(
    processRateLabel(
      { freshness: { connected: true, telemetryFresh: true } },
      p,
      (n) => `${n} H/s`,
    ),
    "0 H/s",
  );
  assert.equal(
    processRateLabel(
      { freshness: { connected: false } },
      { running: false },
      String,
    ),
    "Offline",
  );
  assert.equal(
    processRateLabel(
      { freshness: { connected: true, telemetryFresh: false } },
      p,
      String,
    ),
    "Last report stale",
  );
});
