const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const {
  SRB,
  validate,
  srbArguments,
  switchEngine,
  engineFor,
} = require("../src/utils/miningConfig");
const { createRuntime } = require("../electron/mining/runtime");
const {
  releaseFor,
  selectArchiveMembers,
} = require("../electron/mining/install");
const base = {
  engine: "srbminer",
  pool: "pool.example:3333",
  user: "wallet",
  password: "x",
  algorithm: "rx/0",
};

test("SRBMiner scope catalog and fees match backend and all managed algorithms validate", () => {
  assert.deepEqual(SRB, require("../../server/src/services/srbminer.json"));
  const Config = require("../../server/src/models/Config");
  for (const row of SRB.algorithms)
    for (const type of ["xmrig", "nanominer"]) {
      const config = { ...base, algorithm: row.algorithm };
      const supported =
        type === "xmrig"
          ? row.devices.includes("CPU")
          : row.devices.some((d) => d !== "CPU");
      assert.equal(
        validate(type, config).valid,
        supported,
        `${type}:${row.algorithm}`,
      );
      if (supported)
        assert.doesNotThrow(() =>
          Config.validate(type, config, { partial: false }),
        );
      else
        assert.throws(() => Config.validate(type, config, { partial: false }));
    }
  assert.equal(engineFor("nanominer", { engine: "srbminer" }), "srbminer");
  for (const type of ["xmrig", "nanominer"]) {
    const config = switchEngine(
      type,
      {
        algorithm: "unsupported",
        customPath: "old",
        gpus: [1],
        additionalArgs: "--background",
      },
      "srbminer",
    );
    assert.equal(config.customPath, "");
    assert.deepEqual(config.gpus, []);
    assert.equal(config.additionalArgs, "");
    assert.ok(validate(type, { ...base, ...config }).valid);
  }
});

test("SRBMiner rejects silent tuning overrides and list injection in both validators", () => {
  const Config = require("../../server/src/models/Config");
  for (const patch of [
    { user: "one,two" },
    { password: "x!y" },
    { password: "x#y" },
    { pauseOnBattery: true },
    { cpuPriority: 2 },
    { additionalArgs: "--algorithm pearlhash" },
    { srbCpuPriority: 6 },
    { srbRetrySeconds: 0 },
    { srbGpuIntensity: 32 },
  ]) {
    assert.equal(
      validate("xmrig", { ...base, ...patch }).valid,
      false,
      JSON.stringify(patch),
    );
    assert.throws(() => Config.validate("xmrig", { ...base, ...patch }));
  }
  assert.equal(
    validate("nanominer", { ...base, algorithm: "pearlhash", gpus: [0] }).valid,
    false,
  );
});

for (const platform of ["linux", "win32"])
  test(`SRBMiner ${platform} launch specs isolate CPU/GPU and preserve pools, tuning and ownership`, async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "minemaster-srb-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const customPath = path.join(root, "fake-miner");
    await fs.writeFile(customPath, "never executed");
    await fs.chmod(customPath, 0o755);
    const runtime = createRuntime({
      userData: root,
      bundledRoot: root,
      platform,
      arch: "x64",
      hostname: "test-rig",
      logicalCores: 16,
    });
    const cpu = await runtime.launchSpec("xmrig", "xmrig-1", {
      ...base,
      customPath,
      threads: 30,
      hugePages: false,
      srbCpuPriority: 1,
      backupPools: ["stratum+ssl://backup:4444"],
      keepAlive: true,
    });
    const gpu = await runtime.launchSpec("nanominer", "nanominer-1", {
      ...base,
      customPath,
      algorithm: "pearlhash",
      srbGpuIntensity: 21,
      rigName: "gpu-worker",
    });
    const arg = (spec, key) => spec.args[spec.args.indexOf(key) + 1];
    assert.notEqual(cpu.cwd, gpu.cwd);
    assert.equal(cpu.executable, gpu.executable);
    assert.equal(arg(cpu, "--algorithm"), "randomx");
    assert.equal(arg(gpu, "--algorithm"), "pearlhash");
    assert.equal(arg(cpu, "--cpu-threads"), "16");
    assert.equal(arg(cpu, "--cpu-threads-priority"), "1");
    assert.equal(arg(cpu, "--pool"), "pool.example:3333,backup:4444");
    assert.equal(arg(cpu, "--tls"), "false,true");
    assert.equal(arg(cpu, "--password"), "x!x");
    assert.equal(arg(cpu, "--wallet"), "wallet,wallet");
    assert.ok(cpu.args.includes("--disable-gpu"));
    assert.ok(cpu.args.includes("--disable-huge-pages"));
    assert.ok(gpu.args.includes("--disable-cpu"));
    assert.equal(arg(gpu, "--gpu-intensity"), "21");
    assert.equal(arg(gpu, "--worker"), "gpu-worker");
    for (const spec of [cpu, gpu]) {
      assert.ok(spec.args.includes("--disable-msr-tweaks"));
      assert.ok(spec.args.includes("--disable-worker-watchdog"));
      assert.ok(spec.args.includes("--gpu-disable-oc"));
      assert.ok(!spec.args.includes("--background"));
      assert.ok(!spec.args.includes("--api-enable"));
      assert.equal(spec.engine, "srbminer");
      assert.equal(
        JSON.parse(await fs.readFile(path.join(spec.cwd, "config.json")))
          .engine,
        "srbminer",
      );
    }
    assert.equal(cpu.effectiveSettings.devFeePercent, 0.85);
    assert.equal(gpu.effectiveSettings.devFeePercent, 2);
    assert.equal(
      srbArguments("xmrig", { ...base, threadPercentage: 50 }, "rig", 16).at(
        -3,
      ),
      "8",
    );
  });

test("SRBMiner release manifests preserve notices and never extract its optional Windows driver", () => {
  for (const platform of ["linux", "win32"]) {
    const release = releaseFor("srbminer", platform, "x64");
    assert.equal(release.version, "3.6.7");
    assert.deepEqual(Object.keys(release.files), [
      release.binary,
      "ReadMe.txt",
    ]);
    const prefix = "SRBMiner-Multi-3-6-7/";
    const members = selectArchiveMembers(
      [
        release.binary,
        "ReadMe.txt",
        "WinRing0x64.sys",
        "start-mining-pearl.bat",
      ]
        .map((n) => prefix + n)
        .join("\n"),
      release,
    );
    assert.deepEqual(members, [prefix + release.binary, prefix + "ReadMe.txt"]);
  }
  assert.throws(() => releaseFor("srbminer", "darwin", "arm64"), /not bundled/);
  assert.ok(
    require("../package.json").build.files.includes("src/utils/srbminer.json"),
  );
});

test("SRBMiner refuses unsupported targets even with a custom executable", async () => {
  for (const [platform, arch] of [
    ["linux", "arm64"],
    ["win32", "arm64"],
    ["darwin", "x64"],
  ]) {
    const runtime = createRuntime({
      userData: "/unused",
      bundledRoot: "/unused",
      platform,
      arch,
    });
    await assert.rejects(
      runtime.launchSpec("xmrig", "xmrig-1", {
        ...base,
        customPath: "/never-read",
      }),
      { code: "UNSUPPORTED_PLATFORM" },
    );
  }
});

test("SRBMiner rejects nondefault tuning belonging to the other process scope", () => {
  const Config = require("../../server/src/models/Config");
  for (const [type, patch] of [
    ["xmrig", { srbGpuIntensity: 12 }],
    ["nanominer", { algorithm: "pearlhash", srbCpuPriority: 4 }],
  ]) {
    const config = { ...base, ...patch };
    assert.equal(validate(type, config).valid, false);
    assert.throws(() => Config.validate(type, config));
  }
});
