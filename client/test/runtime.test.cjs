const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const { createRuntime } = require("../electron/mining/runtime");
test("CPU and GPU Nanominer use separate working directories and single-algorithm configs", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "minemaster-runtime-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const customPath = path.join(root, "fake-miner");
  await fs.writeFile(customPath, "This is a test fixture, never executed.");
  const runtime = createRuntime({
    userData: root,
    bundledRoot: root,
    platform: "linux",
    arch: "x64",
    hostname: "test-rig",
    logicalCores: 16,
  });
  const base = { pool: "pool:3333", user: "fixture-wallet", customPath };
  const cpu = await runtime.launchSpec("xmrig", "xmrig-1", {
    ...base,
    engine: "nanominer",
    algorithm: "rx/0",
    coin: "XMR",
    threadPercentage: 50,
  });
  const gpu = await runtime.launchSpec("nanominer", "nanominer-1", {
    ...base,
    algorithm: "etchash",
    coin: "ETC",
  });
  assert.equal(cpu.executable, gpu.executable);
  assert.notEqual(cpu.cwd, gpu.cwd);
  assert.notEqual(cpu.args[0], gpu.args[0]);
  assert.equal(cpu.effectiveSettings.cpuThreads, 8);
  assert.match(await fs.readFile(cpu.args[0], "utf8"), /\[RandomX\]/);
  assert.doesNotMatch(await fs.readFile(cpu.args[0], "utf8"), /\[etchash\]/);
  assert.doesNotMatch(await fs.readFile(gpu.args[0], "utf8"), /\[RandomX\]/);
});
