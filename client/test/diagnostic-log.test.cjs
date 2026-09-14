const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("fs"),
  os = require("os"),
  path = require("path");
const { createDiagnosticLog } = require("../electron/diagnosticLog");
test("native diagnostics rotate without breaking control on disk or serialization failures", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "minemaster-log-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const log = createDiagnosticLog(dir, { maxBytes: 500 });
  for (let i = 0; i < 15; i++)
    log.record("fixture", { message: "x".repeat(80), i });
  await log.flush();
  assert.ok(fs.statSync(path.join(dir, "client.log")).size <= 500);
  assert.ok(fs.statSync(path.join(dir, "client.log.previous")).size <= 500);
  for (const line of fs
    .readFileSync(path.join(dir, "client.log"), "utf8")
    .trim()
    .split("\n"))
    assert.equal(JSON.parse(line).event, "fixture");
  const cycle = {};
  cycle.self = cycle;
  log.record("cycle", cycle);
  await log.flush();
  const bad = createDiagnosticLog(path.join(dir, "client.log", "impossible"));
  bad.record("failure");
  await bad.flush();
});

test("native log storms bound pending writes and record the exact omitted count", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "minemaster-log-storm-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const log = createDiagnosticLog(dir, { maxPending: 2 });
  const details = { message: "original" };
  log.record("first", details);
  details.message = "mutated after enqueue";
  log.record("second");
  for (let i = 0; i < 100; i++) log.record("storm");
  await log.flush();
  const lines = fs
    .readFileSync(path.join(dir, "client.log"), "utf8")
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.equal(lines.length, 3);
  assert.equal(lines[0].details.message, "original");
  assert.equal(lines[2].event, "diagnostic-log-dropped");
  assert.equal(lines[2].details.count, 100);
  assert.doesNotThrow(() => log.record("invalid", () => {}));
  log.record("recovered");
  await log.flush();
  assert.match(
    fs.readFileSync(path.join(dir, "client.log"), "utf8"),
    /recovered/,
  );
});
