const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const uri = (source) =>
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
async function esm(name) {
  let source = fs.readFileSync(
    path.join(__dirname, "../src/utils", name),
    "utf8",
  );
  source = source.replace(
    /['"]\.\/telemetry['"]/,
    JSON.stringify(
      uri(
        fs.readFileSync(
          path.join(__dirname, "../src/utils/telemetry.js"),
          "utf8",
        ),
      ),
    ),
  );
  return import(uri(source));
}
test("zero, missing, stale, paused, stopped and live rates stay distinguishable in the desktop UI", async () => {
  const { formatMinerRate } = await esm("formatters.js");
  const now = Date.now(),
    p = {
      running: true,
      hashrate: 0,
      hashrateObservedAt: new Date(now).toISOString(),
    };
  assert.equal(formatMinerRate(p, now), "0.00 H/s");
  assert.equal(
    formatMinerRate({ ...p, hashrate: null }, now),
    "Waiting for first sample",
  );
  assert.equal(formatMinerRate(p, now + 61000), "Stale sample");
  assert.equal(
    formatMinerRate({ ...p, hashrateObservedAt: "broken" }, now),
    "Stale sample",
  );
  assert.equal(
    formatMinerRate(
      { ...p, hashrateObservedAt: new Date(now + 3600000).toISOString() },
      now,
    ),
    "Stale sample",
  );
  assert.match(formatMinerRate({ ...p, paused: true }, now), /Paused/);
  assert.equal(formatMinerRate({ ...p, running: false }, now), "Stopped");
});
test("console is bounded by both characters and lines, retaining the latest output", async () => {
  const { addConsoleOutput } = await esm("consoleManager.js");
  const lines = addConsoleOutput([], "a".repeat(1000000) + "\nlatest\n");
  assert.ok(lines.join("").length <= 256 * 1024);
  assert.ok(lines.join("").endsWith("latest\n"));
  assert.ok(addConsoleOutput([], "x\n".repeat(2000)).length <= 1000);
});
test("actual miner logs retain units, split observations, shares, versions and pause state", async () => {
  const { createLineBuffer, parseAggregate, parseShares, parseProcessDetails } =
    await esm("telemetry.js");
  const read = createLineBuffer();
  assert.deepEqual(read("cpu speed 10s/60s/15m 12."), []);
  assert.equal(parseAggregate(read("50 n/a n/a H/s\n")[0]), 12.5);
  assert.equal(parseAggregate("Total: 108.3 Mh/s"), 108300000);
  assert.equal(parseAggregate("GPU 0: 18.0 Mh/s"), null);
  assert.equal(parseAggregate("Total: 65.00 TH/s"), 65e12);
  assert.equal(parseAggregate("Total: 0.00 H/s"), 0);
  assert.equal(
    parseProcessDetails("SRBMiner-MULTI 3.6.7").minerVersion,
    "3.6.7",
  );
  assert.equal(parseProcessDetails("nanominer v3.10.0").minerVersion, "3.10.0");
  assert.equal(parseShares("accepted (10/2)").accepted, 10);
  assert.equal(
    parseProcessDetails("paused, on battery").pauseReason,
    "battery",
  );
  assert.equal(parseProcessDetails("resumed").paused, false);
  assert.equal(
    parseProcessDetails("use pool pool:3333").pool.status,
    "connecting",
  );
  assert.equal(
    parseProcessDetails("new job from pool:3333").pool.status,
    "connected",
  );
});

test("colored SRBMiner output preserves version and rate identity", async () => {
  const { parseAggregate, parseProcessDetails } = await esm("telemetry.js");
  assert.equal(
    parseProcessDetails("\x1b[32mSRBMiner-MULTI\x1b[0m \x1b[33m3.6.7\x1b[0m")
      .minerVersion,
    "3.6.7",
  );
  assert.equal(parseAggregate("\x1b[32mTotal: \x1b[0m65.00 TH/s"), 65e12);
});

test("stopped snapshots cannot mix desired SRBMiner identity with a previous launch", async () => {
  const { processSnapshot, stoppedProcessState } = await esm("telemetry.js");
  const miner = {
    id: "nanominer-1",
    type: "nanominer",
    deviceType: "GPU",
    running: false,
    config: { engine: "srbminer", algorithm: "pearlhash", version: "next" },
    activeConfig: { engine: "nanominer", algorithm: "etchash", version: "old" },
    engine: "nanominer",
    minerVersion: "3.10.0",
    pid: 42,
    startTime: Date.now(),
    hashrate: 12,
    hashrateObservedAt: new Date().toISOString(),
    paused: true,
    pauseReason: "old",
    shares: { accepted: 99, rejected: 0 },
    pool: { status: "connected" },
    effectiveSettings: { devFeePercent: 1 },
    restartPendingAt: Date.now() + 10000,
  };
  const snapshot = processSnapshot(miner);
  assert.equal(snapshot.engine, "srbminer");
  assert.equal(snapshot.algorithm, "pearlhash");
  assert.equal(snapshot.desiredConfigVersion, "next");
  assert.equal(snapshot.quality, "unavailable");
  for (const key of [
    "activeConfig",
    "appliedConfigVersion",
    "hashrate",
    "hashrateObservedAt",
    "pid",
    "startedAt",
    "minerVersion",
    "shares",
    "pool",
    "effectiveSettings",
    "pauseReason",
  ])
    assert.equal(snapshot[key], null, key);
  assert.equal(snapshot.paused, false);
  assert.ok(snapshot.restartPendingAt);
  assert.equal(
    miner.activeConfig.version,
    "old",
    "snapshot does not mutate input",
  );
  const cleared = { ...miner, ...stoppedProcessState() };
  assert.equal(cleared.config.version, "next");
  assert.equal(cleared.restartPendingAt, miner.restartPendingAt);
  const live = processSnapshot({ ...miner, running: true, paused: false });
  assert.equal(live.engine, "nanominer");
  assert.equal(live.algorithm, "etchash");
  assert.equal(live.appliedConfigVersion, "old");
  assert.equal(live.hashrate, 12);
  assert.equal(
    processSnapshot({ ...miner, running: true, hashrate: -1 }).hashrate,
    null,
  );
});

test("late native polls cannot undo a completed control or an exit", async () => {
  const { reconcileNativeStatus } = await esm("telemetry.js");
  const stopped = {
    id: "gpu",
    controlRevision: 2,
    running: false,
    config: { engine: "srbminer" },
  };
  assert.equal(
    reconcileNativeStatus(stopped, { running: true, runId: "old", pid: 12 }, 1),
    stopped,
  );
  assert.equal(
    reconcileNativeStatus(stopped, { running: true, runId: "old" }, null),
    stopped,
    "poll begun during an operation remains ineligible after it completes",
  );
  const started = {
    ...stopped,
    controlRevision: 3,
    running: true,
    runId: "new",
    pid: 13,
  };
  assert.equal(
    reconcileNativeStatus(started, { running: false, runId: "old" }, 2),
    started,
  );
  assert.equal(
    reconcileNativeStatus({ ...started, loading: true }, { running: false }, 3)
      .running,
    true,
  );
  const accepted = reconcileNativeStatus(
    started,
    { running: true, runId: "new", pid: 13 },
    3,
  );
  assert.equal(accepted.pid, 13);
});

test("automatic restart retains output from its own run and discards the previous run's counters", async () => {
  const { applyProcessObservation, reconcileNativeStatus } =
    await esm("telemetry.js");
  const old = {
    id: "cpu",
    controlRevision: 1,
    runId: "old",
    running: true,
    hashrate: 10,
    shares: { accepted: 100 },
    minerVersion: "old-version",
    pool: { status: "connected" },
  };
  const output = applyProcessObservation(old, "new", {
    hashrate: 20,
    hashrateObservedAt: "2026-09-14T12:00:00Z",
    minerVersion: "3.6.7",
  });
  assert.equal(output.shares, null);
  assert.equal(output.pool, null);
  assert.equal(
    reconcileNativeStatus(output, { running: false, runId: "old" }, 1),
    output,
  );
  const next = reconcileNativeStatus(
    output,
    { running: true, runId: "new", pid: 22, startedAt: 1000 },
    output.controlRevision,
  );
  assert.equal(next.hashrate, 20);
  assert.equal(next.minerVersion, "3.6.7");
  assert.equal(next.runId, "new");
  const silent = reconcileNativeStatus(
    old,
    { running: true, runId: "new", pid: 22 },
    1,
  );
  assert.equal(silent.hashrate, null);
  assert.equal(silent.minerVersion, null);
});
