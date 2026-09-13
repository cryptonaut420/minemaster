const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  validate,
  poolAddress,
  parseArguments,
  xmrigConfig,
  nanominerConfig,
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
  assert.match(text, /noLog = true/);
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
