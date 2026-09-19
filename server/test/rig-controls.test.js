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

const connectedRig = () => ({
  freshness: { connected: true, telemetryFresh: true },
  protocolVersion: 2,
  capabilities: { commandResults: true },
  hardware: { gpus: [{ deviceId: "gpu-a" }] },
  processes: [
    { deviceType: "CPU", enabled: true, running: true },
    { deviceType: "GPU", enabled: true, running: true },
  ],
});
test("action toasts wait for terminal receipts and distinguish success, failure and partial batches", async () => {
  const { controlOutcome } = await helpers;
  const row = { name: "Workshop", command: { status: "running" } };
  assert.equal(controlOutcome("start", [row]), null);
  assert.equal(controlOutcome("start", [{ sending: true }]), null);
  row.command.status = "succeeded";
  assert.deepEqual(controlOutcome("stop", [row]), {
    type: "success",
    message: "Workshop: mining paused.",
  });
  const failed = {
    name: "Garage",
    command: { status: "failed", error: "Engine could not start" },
  };
  assert.equal(controlOutcome("start", [failed]).type, "error");
  const mixed = controlOutcome("start", [row, failed], 2);
  assert.equal(mixed.type, "error");
  assert.match(mixed.message, /1 rigs started.*1 need attention.*2 unchanged/);
});
test("one primary control follows observed mining, not old successful receipts", async () => {
  const { primaryControl, quickScope } = await helpers;
  const rig = connectedRig();
  assert.equal(primaryControl(rig).label, "Pause");
  assert.equal(primaryControl(rig).action, "stop");
  assert.equal(quickScope(rig, "start"), null);
  rig.processes[0].running = false;
  assert.equal(primaryControl(rig).label, "Pause");
  assert.equal(quickScope(rig, "start"), "CPU");
  rig.processes[1].running = false;
  const oldPlay = { action: "start", command: { status: "succeeded" } };
  assert.equal(primaryControl(rig, oldPlay).label, "Play");
  assert.equal(primaryControl(rig, oldPlay).disabled, false);
  rig.processes[1].running = true;
  const oldPause = { action: "stop", command: { status: "succeeded" } };
  assert.equal(primaryControl(rig, oldPause).label, "Pause");
});
test("preparation and recovery keep cancellation available; a pending Stop prevents duplicate clicks", async () => {
  const { primaryControl, quickScope } = await helpers;
  const rig = connectedRig();
  rig.processes.forEach((p) => (p.running = false));
  let result = primaryControl(rig, { action: "start", sending: true });
  assert.equal(result.label, "Cancel start");
  assert.equal(result.action, "stop");
  assert.equal(result.disabled, false);
  rig.pendingCommands = [{ action: "restart", status: "running" }];
  assert.equal(primaryControl(rig).label, "Cancel start");
  rig.pendingCommands = [{ action: "stop", status: "running" }];
  result = primaryControl(rig);
  assert.equal(result.label, "Pausing…");
  assert.equal(result.disabled, true);
  rig.pendingCommands = [];
  rig.hardware.gpus = [];
  rig.processes[0].enabled = false;
  rig.processes[1].restartPendingAt = new Date().toISOString();
  assert.equal(primaryControl(rig).label, "Pause");
  assert.equal(primaryControl(rig).disabled, false);
  assert.equal(quickScope(rig, "start"), null);
  assert.equal(quickScope(rig, "stop"), "ALL");
});
test("offline and unsupported controls are disabled; stale connected agents retain Stop", async () => {
  const { primaryControl } = await helpers;
  const rig = connectedRig();
  rig.freshness.connected = false;
  assert.equal(primaryControl(rig).label, "Offline");
  assert.equal(primaryControl(rig).disabled, true);
  rig.freshness.connected = true;
  rig.freshness.telemetryFresh = false;
  rig.processes = [];
  assert.equal(primaryControl(rig).label, "Pause");
  assert.equal(primaryControl(rig).disabled, false);
  rig.protocolVersion = 1;
  assert.equal(primaryControl(rig).disabled, true);
});
test("rig rows summarize full startup logs and keep sensor identities and missing values honest", async () => {
  const { compactIssue, rigSensors } = await helpers;
  assert.equal(
    compactIssue({
      reason: "Process exited with code 1\n * " + "startup log ".repeat(100),
    }),
    "Miner stopped unexpectedly · View details",
  );
  assert.equal(compactIssue({ reason: "Long error ".repeat(100) }).length, 78);
  assert.equal(
    compactIssue({ status: "offline", reason: "Agent disconnected" }),
    "",
  );
  const rig = connectedRig();
  rig.hardware.gpus = [{ deviceId: "gpu-a" }, { deviceId: "gpu-b" }, {}];
  rig.stats = {
    quality: "valid",
    cpu: { usage: 0, temperature: null },
    memory: { usage: 42 },
    gpus: [
      { deviceId: "gpu-b", temperature: 71 },
      { deviceId: "gpu-a", temperature: 65 },
      { temperature: 99 },
    ],
  };
  let sensors = rigSensors(rig);
  assert.equal(sensors.cpu.usage, 0);
  assert.equal(sensors.cpu.temperature, null);
  assert.deepEqual(
    sensors.gpus.map((g) => g.sensor.temperature),
    [65, 71, undefined],
  );
  rig.stats.quality = "stale";
  sensors = rigSensors(rig);
  assert.deepEqual(sensors.cpu, {});
  assert.deepEqual(sensors.memory, {});
  assert.equal(sensors.gpus.length, 3);
  assert.deepEqual(
    sensors.gpus.map((g) => g.sensor),
    [{}, {}, {}],
  );
  rig.stats.quality = "valid";
  rig.freshness.connected = false;
  assert.deepEqual(rigSensors(rig).cpu, {});
});
