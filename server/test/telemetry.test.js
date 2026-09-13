const { test } = require("node:test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("url");
const fs = require("fs");
const path = require("path");
const t = require("../src/services/telemetry");
const { intervalParts, queryWindow } = require("../src/models/HashRate");
const Config = require("../src/models/Config");
const commands = require("../src/services/commands");
const monitoring = require("../src/services/monitoring");
const hardware = require("../../client/electron/hardware");
const esm = async (name) =>
  import(
    `data:text/javascript;base64,${fs.readFileSync(path.join(__dirname, "../../client/src/utils/", name)).toString("base64")}`
  );
const now = Date.now(),
  timestamp = new Date(now).toISOString();
const p = {
  id: "cpu",
  deviceType: "CPU",
  running: true,
  hashrate: 100,
  algorithm: "rx/0",
  hashrateObservedAt: timestamp,
  quality: "valid",
  startedAt: new Date(now - 300000).toISOString(),
};
const rig = {
  id: "r",
  connectionId: "c",
  connectionLastSeen: timestamp,
  telemetryReceivedAt: timestamp,
  processes: [p],
};
test("freshness distinguishes heartbeat from telemetry and zero from missing", () => {
  assert.equal(t.viewRig(rig, now).status, "mining");
  assert.equal(
    t.viewRig(
      { ...rig, telemetryReceivedAt: new Date(now - 61000).toISOString() },
      now,
    ).status,
    "stale",
  );
  assert.equal(
    t.viewRig({ ...rig, connectionId: null }, now).status,
    "offline",
  );
  const out = t.normalizeProcesses(
    {
      protocolVersion: 2,
      processes: [
        { ...p, hashrate: 0 },
        { ...p, id: "missing", hashrate: null },
        { ...p, id: "time", hashrateObservedAt: null },
      ],
    },
    now,
  );
  assert.deepEqual(
    out.map((p) => p.quality),
    ["zero", "unavailable", "unavailable"],
  );
});
test("CPU/GPU and unlike algorithms remain separate, stale rigs contribute nothing", () => {
  const result = t.summary(
    [
      rig,
      { ...rig, id: "b", processes: [{ ...p, hashrate: 200 }] },
      {
        ...rig,
        id: "c",
        processes: [
          { ...p, deviceType: "GPU", algorithm: "kawpow", hashrate: 50e6 },
        ],
      },
      { ...rig, id: "old", connectionId: null },
    ],
    now,
  );
  assert.deepEqual(
    result.algorithms.map((g) => [g.key, g.hashrate]),
    [
      ["CPU:rx/0", 300],
      ["GPU:kawpow", 50e6],
    ],
  );
  assert.equal(result.counts.offline, 1);
});
test("missing current rates stay null, offline uptime is unknown, and power totals state coverage", () => {
  const offline = t.summary([{ ...rig, connectionId: null }], now);
  assert.equal(offline.algorithms[0].hashrate, null);
  assert.equal(offline.algorithms[0].quality, "unavailable");
  assert.equal(
    t.viewRig({ ...rig, connectionId: null }, now).processes[0].uptime,
    null,
  );
  const missing = t.viewRig(
    { ...rig, processes: [{ ...p, hashrate: null, hashrateObservedAt: null }] },
    now,
  );
  assert.equal(missing.processes[0].quality, "unavailable");
  const current = t.summary(
    [
      {
        ...rig,
        hardware: { gpus: [{ deviceId: "a" }, { deviceId: "b" }] },
        stats: {
          observedAt: timestamp,
          quality: "observed",
          cpu: { temperature: 55 },
          gpus: [
            { deviceId: "a", powerWatts: 0, temperature: 60 },
            { deviceId: "b", powerWatts: null },
          ],
        },
      },
    ],
    now,
  );
  assert.equal(current.hardware.gpuPowerWatts, 0);
  assert.equal(current.hardware.gpuPowerReportingDevices, 1);
  assert.equal(current.hardware.gpus, 2);
  assert.equal(current.hardware.maxTemperatureC, 60);
  assert.equal(
    t.summary(
      [
        {
          ...rig,
          maintenanceUntil: new Date(now + 10000).toISOString(),
          processes: [{ ...p, quality: "zero", hashrate: 0 }],
        },
      ],
      now,
    ).counts.attention,
    0,
  );
});
test("duplicate or malformed process snapshots cannot inflate statistics", () => {
  assert.throws(
    () => t.normalizeProcesses({ protocolVersion: 2, processes: [p, p] }),
    /unique/,
  );
  assert.throws(
    () => t.normalizeProcesses({ processes: [null] }),
    /process objects/,
  );
  assert.throws(
    () => t.normalizeProcesses({ processes: [{ ...p, deviceType: "bogus" }] }),
    /deviceType/,
  );
});
test("historical to-only chart ranges anchor to the requested end", () => {
  const end = Math.floor((now - 7 * 86400000) / 60000) * 60000;
  const window = queryWindow(
    { to: new Date(end).toISOString(), timeframe: "1h" },
    now,
  );
  assert.equal(window.from, end - 3600000);
  assert.equal(window.to, end);
});
test("monitoring thresholds use meaningful bounds and stopped shares do not trigger rejects", () => {
  for (const input of [
    { temperatureC: 999 },
    { rejectPercent: 101 },
    { restartCount: 1.5 },
    { restartWindowMinutes: 0 },
  ])
    assert.throws(() => monitoring.validateRules(input));
  assert.equal(
    monitoring.validateRules({ rejectPercent: 0.5 }).rejectPercent,
    0.5,
  );
  assert.equal(
    monitoring
      .evaluate({
        ...rig,
        processes: [
          { ...p, running: false, shares: { accepted: 1, rejected: 99 } },
        ],
      })
      .some((i) => i.rule === "rejects"),
    false,
  );
  assert.equal(
    monitoring
      .evaluate({
        ...rig,
        expectedDeviceIds: ["missing"],
        hardware: { gpus: [] },
        stats: null,
      })
      .some((i) => i.rule === "missing_gpu"),
    true,
  );
  assert.throws(
    () =>
      commands.normalize({
        action: "stop",
        deviceType: "CPU",
        configType: "xmrig",
      }),
    /configType/,
  );
});
test("identical GPU cards survive, Vega discrete cards survive, bus IDs stable across reorder", () => {
  const gpus = [
    { vendor: "AMD", model: "Radeon RX Vega 64", busAddress: "01:00.0" },
    { vendor: "AMD", model: "Radeon RX Vega 64", busAddress: "02:00.0" },
  ];
  assert.equal(hardware.inventory(gpus).length, 2);
  assert.deepEqual(
    hardware.inventory(gpus).map((g) => g.deviceId),
    ["pci:0000:01:00.0", "pci:0000:02:00.0"],
  );
  assert.equal(
    hardware.inventory(gpus.toReversed())[1].deviceId,
    hardware.inventory(gpus)[0].deviceId,
  );
  assert.equal(t.normalizeGpus(gpus).length, 2);
});
test("time integration splits boundaries, caps freshness, ignores duplicates and stopped processes", () => {
  const base = Date.parse("2026-09-01T12:00:50Z");
  const pieces = intervalParts(
    { ...p, hashrateObservedAt: base },
    base + 90000,
  );
  assert.equal(
    pieces.reduce((n, x) => n + x.end - x.start, 0),
    60000,
  );
  assert.equal(pieces.length, 2);
  assert.equal(
    intervalParts({ ...p, hashrateObservedAt: base }, base).length,
    0,
  );
  assert.equal(intervalParts({ ...p, running: false }, now).length, 0);
  assert.throws(() => queryWindow({ timeframe: "bogus" }));
  assert.throws(() => queryWindow({ timeframe: "90d", resolution: 60 }));
});
test("commands reject invalid actions, scopes, individual GPU and implicit config", () => {
  assert.equal(commands.normalize({ action: "stop-cpu" }).deviceType, "CPU");
  for (const command of [
    { action: "wat" },
    { action: "stop", deviceType: "??" },
    { action: "stop", gpuId: 99 },
    { action: "start", config: {} },
    { action: "start", timeoutSeconds: -1 },
  ])
    assert.throws(() => commands.normalize(command));
});
test("configuration validation is typed and field-specific", () => {
  assert.throws(
    () => Config.validate("xmrig", { threadPercentage: "50" }),
    (e) => !!e.fields.threadPercentage,
  );
  assert.throws(() => Config.validate("nanominer", { algorithm: "invalid" }));
  assert.throws(() =>
    Config.validate("xmrig", { algorithm: "rx/0" }, { partial: false }),
  );
  assert.deepEqual(Config.validate("xmrig", { threadPercentage: 50 }), {
    threadPercentage: 50,
  });
});
test("monitoring respects warmup and detects zero, overheating, and missing inventory", () => {
  const r = {
    ...rig,
    processes: [{ ...p, hashrate: 0, quality: "zero" }],
    stats: { observedAt: timestamp, cpu: { temperature: 90 } },
    expectedDeviceIds: ["missing"],
    hardware: { gpus: [] },
  };
  assert.deepEqual(
    monitoring.evaluate(r).map((i) => i.rule),
    ["zero", "missing_gpu", "temperature"],
  );
  assert.equal(monitoring.evaluate({ ...r, archivedAt: timestamp }).length, 0);
});
test("client parses aggregate zero, ignores individual device rates, preserves split frames", async () => {
  const { parseAggregate, createLineBuffer, processSnapshot } =
    await esm("telemetry.js");
  assert.equal(parseAggregate("cpu speed 10s/60s/15m 0.00 n/a n/a H/s"), 0);
  assert.equal(parseAggregate("Total: 25.5 Mh/s"), 25500000);
  assert.equal(parseAggregate("GPU 0: 12.3 MH/s"), null);
  const read = createLineBuffer();
  assert.deepEqual(read("Total: 1."), []);
  assert.deepEqual(read("5 Mh/s\n"), ["Total: 1.5 Mh/s"]);
  const snapshot = processSnapshot(
    {
      ...p,
      hashrateObservedAt: new Date(now - 61000).toISOString(),
      activeConfig: { algorithm: "old", version: "old" },
      config: { algorithm: "new", version: "new" },
    },
    now,
  );
  assert.equal(snapshot.quality, "stale");
  assert.equal(snapshot.algorithm, "old");
  assert.equal(snapshot.appliedConfigVersion, "old");
});
test("a newer stop cancels a delayed restart and duplicate IDs never execute twice", async () => {
  const { createCommandRunner } = await esm("commandRunner.js");
  const state = [
      { id: "cpu", deviceType: "CPU", running: true, enabled: true },
    ],
    reports = [],
    calls = [];
  const runner = createCommandRunner({
    getMiners: () => state,
    start: async () => {
      calls.push("start");
      state[0].running = true;
      return { success: true };
    },
    stop: async () => {
      calls.push("stop");
      state[0].running = false;
      return { success: true };
    },
    enable: () => {},
    applyConfigs: () => {},
    report: (x) => reports.push(x),
    delayMs: 40,
  });
  const deadline = new Date(Date.now() + 5000).toISOString();
  const restart = runner.execute({
    id: "restart",
    action: "restart",
    deviceType: "CPU",
    deadline,
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  await runner.execute({
    id: "stop",
    action: "stop",
    deviceType: "CPU",
    deadline,
  });
  await restart;
  assert.deepEqual(calls, ["stop", "stop"]); // Each distinct stop confirms native state; duplicate command IDs still do not repeat it.
  assert.equal(state[0].running, false);
  assert.equal(reports.findLast((r) => r.id === "restart").status, "canceled");
  await runner.execute({
    id: "stop",
    action: "stop",
    deviceType: "CPU",
    deadline,
  });
  assert.deepEqual(calls, ["stop", "stop"]); // Each distinct stop confirms native state; duplicate command IDs still do not repeat it.
});
test("failed stop fails restart, retains running state, and never starts again", async () => {
  const { createCommandRunner } = await esm("commandRunner.js");
  const reports = [],
    calls = [];
  const runner = createCommandRunner({
    getMiners: () => [{ id: "cpu", deviceType: "CPU", running: true }],
    start: async () => calls.push("start"),
    stop: async () => ({ success: false, error: "PID still alive" }),
    applyConfigs: () => {},
    report: (x) => reports.push(x),
    delayMs: 1,
  });
  await runner.execute({
    id: "fail",
    action: "restart",
    deadline: new Date(Date.now() + 5000).toISOString(),
  });
  assert.equal(reports.at(-1).status, "failed");
  assert.match(reports.at(-1).error, /PID still alive/);
  assert.equal(calls.length, 0);
});
test("automatic recovery is opt-in, sustained, bounded by maintenance and operator state", () => {
  const { candidates } = require("../src/services/recovery");
  const raw = {
    ...rig,
    protocolVersion: 2,
    recovery: { enabled: true, zeroSeconds: 300 },
    processes: [
      {
        ...p,
        enabled: true,
        quality: "zero",
        zeroSince: new Date(now - 301000).toISOString(),
      },
    ],
  };
  assert.equal(candidates(raw, now).length, 1);
  assert.equal(
    candidates({ ...raw, recovery: { enabled: false } }, now).length,
    0,
  );
  assert.equal(
    candidates(
      { ...raw, maintenanceUntil: new Date(now + 10000).toISOString() },
      now,
    ).length,
    0,
  );
  assert.equal(
    candidates(
      {
        ...raw,
        desiredState: { CPU: { state: "stopped", updatedAt: timestamp } },
      },
      now,
    ).length,
    0,
  );
  assert.equal(
    candidates(
      { ...raw, processes: [{ ...raw.processes[0], zeroSince: timestamp }] },
      now,
    ).length,
    0,
  );
  assert.equal(
    candidates({ ...raw, stats: { cpu: { temperature: 90 } } }, now).length,
    0,
  );
});
test("broadcast cost depends on observers, not fleet size squared", () => {
  const ws = require("../src/websocket/server");
  let observerMessages = 0,
    agentMessages = 0;
  for (let i = 0; i < 1000; i++)
    ws.connections.set(`load-${i}`, {
      minerId: `rig-${i}`,
      observer: false,
      ws: { readyState: 1, bufferedAmount: 0, send: () => agentMessages++ },
    });
  for (let i = 0; i < 3; i++)
    ws.connections.set(`observer-${i}`, {
      observer: true,
      ws: { readyState: 1, bufferedAmount: 0, send: () => observerMessages++ },
    });
  for (let i = 0; i < 1000; i++)
    ws.broadcast({ type: "miner_updated", miner: { id: `rig-${i}` } });
  assert.equal(observerMessages, 3000);
  assert.equal(agentMessages, 0);
  ws.connections.clear();
});

test("intentional CPU pauses preserve diagnostics but do not inflate totals, trigger zero alerts or automatic recovery", () => {
  const paused = t.normalizeProcesses(
    {
      protocolVersion: 2,
      processes: [
        {
          ...p,
          paused: true,
          pauseReason: "battery",
          diagnostic: {
            status: "ready",
            version: "6.26.0",
            path: "C:\\Miner\\xmrig.exe",
            observedAt: timestamp,
          },
        },
      ],
    },
    now,
  )[0];
  assert.equal(paused.hashrate, null);
  assert.equal(paused.diagnostic.version, "6.26.0");
  const r = {
    ...rig,
    protocolVersion: 2,
    processes: [
      {
        ...paused,
        hashrate: 0,
        quality: "zero",
        zeroSince: new Date(now - 600000).toISOString(),
      },
    ],
    recovery: { enabled: true },
  };
  assert.equal(t.summary([r], now).algorithms[0].pausedProcesses, 1);
  assert.equal(t.viewRig(r, now).attention, false);
  assert.equal(
    monitoring.evaluate(r, undefined, now).some((i) => i.rule === "zero"),
    false,
  );
  assert.equal(
    require("../src/services/recovery").candidates(r, now).length,
    0,
  );
});
test("new admin CPU controls and backup pools validate consistently", () => {
  assert.doesNotThrow(() =>
    Config.validate("xmrig", {
      pauseOnBattery: true,
      cpuPriority: 0,
      threads: 0,
      backupPools: ["stratum+ssl://[::1]:443"],
      restartOnCrash: true,
    }),
  );
  for (const patch of [
    { cpuPriority: 6 },
    { pauseOnBattery: "true" },
    { backupPools: ["pool:0"] },
    { crashRestartDelaySeconds: 0 },
  ])
    assert.throws(() => Config.validate("xmrig", patch));
  assert.throws(() => Config.validate("nanominer", { algorithm: "alephium" }));
});
test("maintenance command results include diagnostics and duplicate IDs do not repeat repair", async () => {
  const { createCommandRunner } = await esm("commandRunner.js");
  let calls = 0;
  const reports = [];
  const runner = createCommandRunner({
    getMiners: () => [{ id: "cpu", deviceType: "CPU" }],
    maintenance: async () => {
      calls++;
      return { success: true, diagnostic: { status: "ready" } };
    },
    report: (r) => reports.push(r),
  });
  const command = {
    id: "repair",
    action: "miner-repair",
    deviceType: "CPU",
    deadline: new Date(Date.now() + 60000).toISOString(),
  };
  await runner.execute(command);
  await runner.execute(command);
  assert.equal(calls, 1);
  assert.equal(reports.at(-1).status, "succeeded");
  assert.equal(reports.at(-1).result.processes[0].diagnostic.status, "ready");
});
test("explicit start confirms native state even if the renderer still thinks a process is running", async () => {
  const { createCommandRunner } = await esm("commandRunner.js");
  let starts = 0;
  const runner = createCommandRunner({
    getMiners: () => [{ id: "cpu", deviceType: "CPU", running: true }],
    start: async () => {
      starts++;
      return { success: true };
    },
    report: () => {},
  });
  await runner.execute({
    id: "confirm-start",
    action: "start",
    deviceType: "CPU",
    deadline: new Date(Date.now() + 60000).toISOString(),
  });
  assert.equal(starts, 1);
});
test("a reconnect resends completed command receipts without re-executing a mining action", async () => {
  const { createCommandRunner } = await esm("commandRunner.js");
  let starts = 0;
  const reports = [];
  const runner = createCommandRunner({
    getMiners: () => [{ id: "cpu", deviceType: "CPU", running: false }],
    start: async () => {
      starts++;
      return { success: true };
    },
    report: (r) => reports.push(r),
  });
  await runner.execute({
    id: "lost-receipt",
    action: "start",
    deviceType: "CPU",
    deadline: new Date(Date.now() + 60000).toISOString(),
  });
  const before = reports.length;
  runner.replayResults();
  assert.equal(reports.length, before + 1);
  assert.equal(reports.at(-1).status, "succeeded");
  assert.equal(starts, 1);
});
test("damaged saved command history cannot break later remote commands", async () => {
  const { createCommandRunner } = await esm("commandRunner.js");
  for (const saved of ["null", "42", "[]", "broken json", '{"bad":null}']) {
    const reports = [];
    let starts = 0;
    const runner = createCommandRunner({
      getMiners: () => [{ id: "cpu", deviceType: "CPU", running: false }],
      start: async () => {
        starts++;
        return { success: true };
      },
      report: (result) => reports.push(result),
      storage: { getItem: () => saved, setItem: () => {} },
    });
    runner.replayResults();
    await runner.execute({
      id: "after-corruption",
      action: "start",
      deviceType: "CPU",
      deadline: new Date(Date.now() + 60000).toISOString(),
    });
    assert.equal(starts, 1);
    assert.equal(reports.at(-1).status, "succeeded");
  }
});
