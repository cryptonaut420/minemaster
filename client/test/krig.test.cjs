const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { EventEmitter } = require("events");
const {
  validate,
  switchEngine,
  krigArguments,
  KRIG,
} = require("../src/utils/miningConfig");
const Config = require("../../server/src/models/Config");
const { createRuntime } = require("../electron/mining/runtime");
const { createProcessManager } = require("../electron/mining/processManager");
const {
  parseKrigStats,
  monitorKrig,
  readStats,
} = require("../electron/mining/krigMonitor");
const base = {
  engine: "krig",
  algorithm: "quantus",
  pool: "pool.example:7049",
  user: "wallet",
  password: "x",
  rigName: "PG_Z6",
};
test("KRig scope, algorithms, tuning and assignment compatibility agree across native and backend", () => {
  assert.deepEqual(KRIG, require("../../server/src/services/krig.json"));
  for (const algorithm of ["quantus", "pearlhash"]) {
    assert.equal(validate("nanominer", { ...base, algorithm }).valid, true);
    assert.doesNotThrow(() =>
      Config.validate("nanominer", { ...base, algorithm }, { partial: false }),
    );
    assert.equal(validate("xmrig", { ...base, algorithm }).valid, false);
    assert.throws(() => Config.validate("xmrig", { ...base, algorithm }));
  }
  for (const patch of [
    { algorithm: "kawpow" },
    { keepAlive: true },
    { rigName: "two/workers" },
    { srbGpuIntensity: 5 },
    { srbRetrySeconds: 20 },
  ]) {
    assert.equal(validate("nanominer", { ...base, ...patch }).valid, false);
    assert.throws(() => Config.validate("nanominer", { ...base, ...patch }));
  }
  assert.equal(
    Config.supportsEngine("nanominer", base, {
      gpuEngines: ["nanominer", "srbminer"],
    }),
    false,
  );
  assert.equal(
    Config.supportsEngine("nanominer", base, { gpuEngines: ["krig"] }),
    true,
  );
  assert.deepEqual(
    Config.forAgent(
      { xmrig: { engine: "nanominer" }, nanominer: base },
      { cpuEngines: ["nanominer"] },
    ),
    { xmrig: { engine: "nanominer" } },
  );
  const changed = switchEngine(
    "nanominer",
    {
      ...base,
      engine: "srbminer",
      algorithm: "kawpow",
      customPath: "old",
      gpus: [1],
      srbGpuIntensity: 20,
    },
    "krig",
  );
  assert.equal(changed.algorithm, "quantus");
  assert.equal(changed.customPath, "");
  assert.deepEqual(changed.gpus, []);
  assert.equal(changed.srbGpuIntensity, 0);
  assert.equal(validate("nanominer", changed).valid, true);
});
test("KRig arguments preserve explicit transport, worker identity and backup credentials without extra processes", () => {
  const args = krigArguments(
    { ...base, backupPools: ["stratum+ssl://backup:443"] },
    "ignored",
    54321,
  );
  assert.deepEqual(args.slice(0, 14), [
    "--coin",
    "quantus",
    "--url",
    "stratum+tcp://pool.example:7049",
    "--user",
    "wallet/PG_Z6",
    "--password",
    "x",
    "--url",
    "stratum+ssl://backup:443",
    "--user",
    "wallet/PG_Z6",
    "--password",
    "x",
  ]);
  assert.ok(args.includes("--no-tui"));
  assert.equal(args[args.indexOf("--api-host") + 1], "127.0.0.1");
  assert.equal(
    krigArguments({ ...base, user: "wallet/explicit" }, "host", 1234)[5],
    "wallet/explicit",
  );
  assert.equal(
    krigArguments({ ...base, tls: true }, "host", 1234)[3],
    "stratum+ssl://pool.example:7049",
  );
});
for (const platform of ["win32", "linux"])
  test(`KRig ${platform} builds an isolated foreground GPU launch with file logs`, async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mm-krig-test-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const customPath = path.join(root, "inert");
    await fs.writeFile(customPath, "never executed");
    await fs.chmod(customPath, 0o755);
    const runtime = createRuntime({
      userData: root,
      bundledRoot: root,
      platform,
      arch: "x64",
      hostname: "fixture",
      chooseApiPort: async () => 54321,
    });
    const spec = await runtime.launchSpec("nanominer", "nanominer-1", {
      ...base,
      customPath,
    });
    assert.equal(spec.engine, "krig");
    assert.equal(spec.apiPort, 54321);
    assert.equal(spec.logFile, path.join(spec.cwd, "miner.log"));
    assert.equal(await fs.readFile(spec.logFile, "utf8"), "");
    assert.equal(spec.args[spec.args.indexOf("--log-file") + 1], spec.logFile);
    assert.equal(
      JSON.parse(await fs.readFile(path.join(spec.cwd, "config.json"))).engine,
      "krig",
    );
  });
test("KRig unsupported platforms are rejected before inspecting custom files", async () => {
  for (const [platform, arch] of [
    ["darwin", "x64"],
    ["linux", "arm64"],
    ["win32", "arm64"],
  ]) {
    const runtime = createRuntime({
      userData: "/unused",
      bundledRoot: "/unused",
      platform,
      arch,
    });
    await assert.rejects(
      runtime.launchSpec("nanominer", "gpu", {
        ...base,
        customPath: "/never-read",
      }),
      { code: "UNSUPPORTED_PLATFORM" },
    );
  }
});
const stats = (khs = 650000, uptime = 10) => ({
  khs,
  stats: {
    algo: "quantus",
    uptime,
    ver: "1.5.6",
    ar: ["12", "1"],
    hs: [999999],
  },
});
test("KRig HiveOS totals use kH/s, retain zero and original time, and reject absent or wrong-run data", () => {
  const context = {
    algorithm: "quantus",
    observedAt: "2026-10-03T10:00:00.000Z",
    elapsedSeconds: 12,
  };
  const result = parseKrigStats(stats(), context).observation;
  assert.equal(result.hashrate, 650e6);
  assert.equal(result.hashrateObservedAt, context.observedAt);
  assert.equal(result.shares.accepted, 12);
  assert.equal(parseKrigStats(stats("0"), context).observation.hashrate, 0);
  for (const body of [
    {},
    stats(null),
    stats(""),
    stats(-1),
    stats(Infinity),
    stats(1, 300),
    { khs: 1, stats: { algo: "pearl", uptime: 10 } },
  ])
    assert.throws(() => parseKrigStats(body, context));
  assert.equal(
    parseKrigStats(
      { khs: 65e9, stats: { algo: "pearl", uptime: 10 } },
      { ...context, algorithm: "pearlhash" },
    ).observation.hashrate,
    65e12,
  );
});
test("KRig poll failures and frozen responses never refresh rates; close cancels in-flight observations", async () => {
  let time = 40000,
    work,
    canceled = false;
  const seen = [],
    errors = [];
  let body = stats(5, 40);
  const monitor = monitorKrig({
    port: 1,
    algorithm: "quantus",
    startedAt: 0,
    now: () => time,
    schedule: (fn) => (work = fn),
    unschedule: () => {},
    request: () => ({
      promise: Promise.resolve(body),
      cancel: () => {
        canceled = true;
      },
    }),
    onData: (v) => seen.push(v),
    onError: (e) => errors.push(e),
  });
  await work();
  assert.equal(seen.length, 1);
  time += 10000;
  await work();
  assert.equal(seen.length, 1);
  assert.equal(errors.length, 1);
  body = {};
  time += 10000;
  await work();
  assert.equal(seen.length, 1);
  monitor.close();
  await work();
  assert.equal(seen.length, 1);
  let resolve;
  const pending = monitorKrig({
    port: 1,
    algorithm: "quantus",
    startedAt: 0,
    now: () => 40000,
    schedule: (fn) => (work = fn),
    unschedule: () => {},
    request: () => ({
      promise: new Promise((r) => (resolve = r)),
      cancel: () => {
        canceled = true;
      },
    }),
    onData: (v) => seen.push(v),
  });
  const call = work();
  pending.close();
  resolve(stats());
  await call;
  assert.equal(canceled, true);
  assert.equal(seen.length, 1);
});
test("KRig API reader handles loopback JSON, failures and bounded responses", async (t) => {
  const http = require("http");
  let response = JSON.stringify(stats()),
    status = 200;
  const server = http.createServer((req, res) => {
    assert.equal(req.url, "/hiveos");
    res.writeHead(status);
    res.end(response);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));
  const port = server.address().port;
  assert.deepEqual(await readStats(port).promise, stats());
  response = "bad";
  await assert.rejects(readStats(port).promise, /JSON/);
  response = "x".repeat(300000);
  await assert.rejects(readStats(port).promise, /size limit/);
  status = 503;
  await assert.rejects(readStats(port).promise, /HTTP 503/);
});
test("KRig GPU stop cancels its monitor, discards late stats, and leaves Nanominer CPU running", async () => {
  const children = [],
    emitted = [],
    monitors = [];
  let pid = 100;
  const manager = createProcessManager({
    runtime: {
      launchSpec: async (type, id, config) => ({
        executable: "/inert",
        args: [],
        cwd: "/tmp",
        apiPort: config.engine === "krig" ? 54321 : null,
        diagnostic: { status: "ready" },
      }),
    },
    spawnProcess: () => {
      const child = new EventEmitter();
      child.pid = ++pid;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      children.push(child);
      return child;
    },
    alive: (id) => children.some((c) => c.pid === id && c.exitCode == null),
    wait: async () => {},
    signal: async (c) => {
      c.exitCode = 0;
      c.emit("exit", 0);
      c.emit("close", 0);
    },
    monitorStats: (options) => {
      const m = {
        options,
        closed: false,
        close() {
          this.closed = true;
        },
      };
      monitors.push(m);
      return m;
    },
    emit: (event, data) => emitted.push({ event, data }),
  });
  await manager.start({
    minerId: "xmrig-1",
    minerType: "xmrig",
    config: { engine: "nanominer" },
  });
  await manager.start({
    minerId: "nanominer-1",
    minerType: "nanominer",
    config: base,
  });
  monitors[0].options.onData({ hashrate: 10 });
  assert.equal(emitted.filter((x) => x.data.telemetry).length, 1);
  assert.equal((await manager.stop({ minerId: "nanominer-1" })).success, true);
  assert.equal(monitors[0].closed, true);
  monitors[0].options.onData({ hashrate: 20 });
  assert.equal(emitted.filter((x) => x.data.telemetry).length, 1);
  assert.equal(manager.snapshot("xmrig-1").running, true);
  await manager.stopAll();
});
