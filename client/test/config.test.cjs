const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  validate,
  poolAddress,
  parseArguments,
  xmrigConfig,
  nanominerConfig,
  engineFor,
  cpuThreads,
} = require("../src/utils/miningConfig");
const cpu = {
  pool: "[::1]:3333",
  user: "pool-account.worker",
  algorithm: "rx/0",
};
test("accept pool usernames and IPv6 while rejecting invalid ports and malformed values", () => {
  assert.equal(validate("xmrig", cpu).valid, true);
  for (const pool of ["pool:0", "pool:65536", "pool:12\nwatchdog=true"])
    assert.equal(poolAddress(pool), false);
  assert.equal(validate("xmrig", { ...cpu, user: null }).valid, false);
});
test("Nanominer CPU is explicit, isolated from GPU settings, and reports a bounded thread budget", () => {
  const config = {
    ...cpu,
    engine: "nanominer",
    coin: "XMR",
    pool: "pool:3333",
    threadPercentage: 50,
    gpus: [1],
    workerName: "cpu-worker",
  };
  assert.equal(engineFor("xmrig", {}), "xmrig");
  assert.equal(validate("xmrig", config).valid, true);
  const ini = nanominerConfig(config, "rig", { cpu: true, logicalCores: 16 });
  assert.match(ini, /\[RandomX\]/);
  assert.match(ini, /cpuThreads = 8/);
  assert.match(ini, /rigName = cpu-worker/);
  assert.doesNotMatch(ini, /devices =/);
  assert.equal(cpuThreads({ threads: 100 }, 8), 8);
  assert.equal(cpuThreads({ threadPercentage: 10 }, 1), 1);
  for (const patch of [
    { engine: "other" },
    { algorithm: "cn/r" },
    { pauseOnBattery: true },
    { tls: true },
    { additionalArgs: "--tls" },
    { additionalArgs: 42 },
  ])
    assert.equal(validate("xmrig", { ...config, ...patch }).valid, false);
});
test("CPU tuning preserves efficient autoconfiguration and driver-free defaults", () => {
  const c = xmrigConfig(
    { ...cpu, threadPercentage: 50, backupPools: ["backup:4444"] },
    "rig",
  );
  assert.equal(c.cpu["max-threads-hint"], 50);
  assert.equal(c.cpu.priority, 0);
  assert.equal(c.cpu.yield, true);
  assert.equal(c.randomx.wrmsr, false);
  assert.equal(c.randomx.rdmsr, false);
  assert.equal(c.pools.length, 2);
  assert.equal(c.autosave, false);
  assert.equal(c["donate-level"], 1);
});
test("Nanominer chooses the explicit algorithm and disables self-update, watchdog and duplicate disk logs", () => {
  const config = {
    ...cpu,
    algorithm: "autolykos2",
    coin: "ERG",
    gpus: [2, 2, 3],
  };
  const text = nanominerConfig(config, "rig");
  assert.match(text, /\[autolykos\]/);
  assert.match(text, /devices = 2,3/);
  assert.match(text, /autoUpdate = false/);
  assert.match(text, /noLog = false/);
  assert.ok(text.indexOf("watchdog") < text.indexOf("[autolykos]"));
  assert.equal(
    validate("nanominer", { ...config, algorithm: "alephium" }).valid,
    false,
  );
});
test("reject invalid settings at the native boundary and handle quoted argument values", () => {
  assert.deepEqual(parseArguments('--tls --user-agent "MineMaster rig"'), [
    "--tls",
    "--user-agent",
    "MineMaster rig",
  ]);
  for (const args of [
    "--config other.json",
    "-cother.json",
    "--background",
    "--algo=wrong",
    "--cuda",
    "--threads=99",
    '--tls "',
  ])
    assert.throws(() => parseArguments(args));
  for (const patch of [
    { threadPercentage: NaN },
    { cpuPriority: 6 },
    { pauseOnBattery: "yes" },
    { backupPools: ["bad"] },
    { user: "name\ncoin=RVN" },
  ])
    assert.equal(validate("xmrig", { ...cpu, ...patch }).valid, false);
});
test("malformed GPU configuration returns validation errors without throwing", () => {
  const gpu = { ...cpu, algorithm: "etchash", coin: "ETC" };
  for (const patch of [
    { backupPools: {} },
    { backupPools: null },
    { algorithm: 42 },
    { algorithm: {} },
  ]) {
    const result = validate("nanominer", { ...gpu, ...patch });
    assert.equal(result.valid, false);
    assert.ok(result.errors.length);
  }
});
