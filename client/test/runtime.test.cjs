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
  await fs.chmod(customPath, 0o755);
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

test("Linux checks executable permission and distinguishes missing-loader errors from quarantine", async (t) => {
  const { describeError } = require("../electron/mining/runtime");
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "minemaster-linux-check-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, "non-executable");
  await fs.writeFile(file, "fixture");
  await fs.chmod(file, 0o600);
  const runtime = createRuntime({
    userData: root,
    bundledRoot: root,
    hostname: "fixture",
    platform: "linux",
    arch: "x64",
  });
  assert.equal((await runtime.inspect("xmrig", file)).status, "unavailable");
  assert.match(
    describeError({ code: "ENOENT" }, file, "linux").message,
    /dynamic loader/,
  );
  assert.match(
    describeError({ code: "EACCES" }, file, "linux").message,
    /noexec/,
  );
  assert.match(
    describeError({ code: "EPERM" }, file, "win32").message,
    /Protection History/,
  );
});
