const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { followLog } = require("../electron/mining/logTail");
test("file-only Windows output is captured once, with original file time; truncation and close are isolated", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "minemaster-tail-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "miner.log"),
    rows = [];
  const tail = followLog(
    file,
    (data, observedAt) => rows.push({ data, observedAt }),
    { interval: 100000 },
  );
  t.after(() => tail.close());
  await tail.poll(); // File not yet created: retry rather than permanently giving up.
  await fs.writeFile(file, "KawPow: GPU 0: 45.10 MH/s Total: 45.10 MH/s\n");
  const old = new Date(Date.now() - 120000);
  await fs.utimes(file, old, old);
  await tail.poll();
  await tail.poll();
  assert.equal(rows.length, 1);
  assert.equal(Date.parse(rows[0].observedAt), old.getTime());
  const telemetry = await import(
    "data:text/javascript;base64," +
      Buffer.from(
        await fs.readFile(
          path.join(__dirname, "../src/utils/telemetry.js"),
          "utf8",
        ),
      ).toString("base64")
  );
  assert.equal(telemetry.parseAggregate(rows[0].data), 45100000);
  await fs.writeFile(file, "Total: 0 H/s\n");
  await tail.poll();
  assert.equal(rows.length, 2);
  assert.equal(telemetry.parseAggregate(rows[1].data), 0);
  tail.close();
  await fs.appendFile(file, "Total: 99 MH/s\n");
  await tail.poll();
  assert.equal(rows.length, 2);
});
test("file tail bounds each read and preserves UTF-8 split across reads", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "minemaster-tail-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "miner.log"),
    rows = [];
  const text = "a".repeat(256 * 1024 - 1) + "€\n";
  await fs.writeFile(file, text);
  const tail = followLog(file, (data) => rows.push(data), { interval: 100000 });
  t.after(() => tail.close());
  await tail.poll();
  await tail.poll();
  assert.equal(rows.join(""), text);
});
