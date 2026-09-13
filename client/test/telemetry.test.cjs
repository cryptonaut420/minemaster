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
