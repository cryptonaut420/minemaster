const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { followLog } = require("../electron/mining/logTail");
test("finishing a file reader drains final output once without waiting for its interval", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "minemaster-final-log-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "miner.log"),
    rows = [];
  await fs.writeFile(file, "Startup failed: no compatible devices\n");
  const tail = followLog(file, (data) => rows.push(data), {
    freshFile: true,
    interval: 100000,
  });
  t.after(() => tail.close());
  const reading = tail.poll();
  await Promise.all([reading, tail.finish(), tail.finish()]);
  assert.equal(rows.join(""), "Startup failed: no compatible devices\n");
  await fs.appendFile(file, "ignored after exit\n");
  await tail.poll();
  assert.equal(rows.length, 1);
});
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
  assert.equal(
    Date.parse(rows[0].observedAt),
    Math.floor((await fs.stat(file)).mtimeMs),
  );
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

test("owned Windows logs observe new bytes even with a frozen write time and discard old output after a gap", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "minemaster-win-tail-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "miner.log"),
    rows = [],
    errors = [];
  let now = Date.now();
  const old = new Date(now - 120000);
  await fs.writeFile(file, "");
  const tail = followLog(
    file,
    (data, at, reset) => rows.push({ data, at, reset }),
    {
      interval: 100000,
      freshFile: true,
      now: () => now,
      onError: (e) => errors.push(e.message),
    },
  );
  t.after(() => tail.close());
  await tail.poll();
  await fs.appendFile(file, "Total: 100 H/s\n");
  await fs.utimes(file, old, old);
  now += 1000;
  await tail.poll();
  assert.equal(Date.parse(rows[0].at), now);
  await tail.poll();
  assert.equal(rows.length, 1);
  await fs.appendFile(file, "Total: 200 H/s\n");
  now += 60000;
  await tail.poll();
  assert.equal(rows.length, 1);
  assert.match(errors[0], /monitoring gap/);
  await fs.appendFile(file, "Total: 300 H/s\n");
  now += 1000;
  await tail.poll();
  assert.match(rows[1].data, /300/);
  assert.equal(rows[1].reset, true);
});
