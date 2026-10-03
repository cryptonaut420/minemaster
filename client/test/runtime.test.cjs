const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const { createRuntime } = require("../electron/mining/runtime");
test("explicit Windows checks include recent failed archives only inside the managed engine directory", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mm-failure-paths-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let failedPath = path.join(
      root,
      "miners/srbminer/3.7.0.staging-fixture/miner.zip",
    ),
    clock = Date.now(),
    targets,
    calls = 0;
  const runtime = createRuntime({
    userData: root,
    bundledRoot: path.join(root, "bundle"),
    platform: "win32",
    arch: "x64",
    hostname: "fixture",
    now: () => clock,
    install: async () => {
      throw Object.assign(Error("fixture write failure"), {
        code: "UNKNOWN",
        path: failedPath,
        syscall: "open",
      });
    },
    windowsDiagnostics: async (paths) => {
      calls++;
      targets = paths;
      return { status: "available", checkedPaths: paths, detections: [] };
    },
  });
  await assert.rejects(runtime.prepare("srbminer", { repair: true }));
  await runtime.inspect("srbminer");
  assert.equal(calls, 0);
  await runtime.inspect("srbminer", null, { includeWindows: true });
  assert.ok(targets.includes(failedPath));
  assert.ok(targets.length <= 6);
  failedPath = path.join(root, "private-document.zip");
  await assert.rejects(runtime.prepare("srbminer", { repair: true }));
  await runtime.inspect("srbminer", null, { includeWindows: true });
  assert.ok(!targets.includes(failedPath));
  clock += 31 * 60 * 1000;
  await runtime.inspect("srbminer", null, { includeWindows: true });
  assert.ok(!targets.some((p) => p.endsWith(".zip")));
});
test("a first file check accepts a verified package and does not call a missing install quarantined", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mm-first-install-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const release = require("../electron/mining/releases.json").nanominer[
    "linux-x64"
  ];
  const runtime = createRuntime({
    userData: root,
    bundledRoot: path.join(root, "bundle"),
    platform: "linux",
    arch: "x64",
    hostname: "fixture",
    verify: async (dir) => {
      if (dir.includes(`${path.sep}bundle${path.sep}`)) return dir;
      throw Object.assign(Error("missing managed copy"), {
        code: "ENOENT",
        path: dir,
        syscall: "open",
      });
    },
  });
  const first = await runtime.inspect("nanominer");
  assert.equal(first.status, "bundled");
  assert.equal(first.version, release.version);
  assert.match(first.message, /first time this engine starts/);
  assert.doesNotMatch(
    first.message,
    /Check file availability|quarantine|Protection History/,
  );
  const dest = path.join(root, "miners", "nanominer", release.version);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(`${dest}.installed`, release.version);
  const removed = await runtime.inspect("nanominer");
  assert.equal(removed.status, "unavailable");
  assert.equal(removed.code, "ENOENT");
  assert.match(removed.message, /file verification failed/);
  const unprepared = createRuntime({
    userData: path.join(root, "empty"),
    bundledRoot: path.join(root, "empty-bundle"),
    platform: "linux",
    arch: "x64",
    hostname: "fixture",
  });
  const missing = await unprepared.inspect("xmrig");
  assert.equal(missing.status, "unavailable");
  assert.equal(missing.code, "PACKAGE_MISSING");
  assert.match(missing.message, /not installed yet/);
  assert.doesNotMatch(missing.message, /Check file availability|quarantine/);
  await assert.rejects(
    unprepared.launchSpec("xmrig", "xmrig-1", {
      engine: "nanominer",
      algorithm: "rx/0",
      pool: "pool:3333",
      user: "fixture",
    }),
    (error) => {
      assert.equal(error.code, "PACKAGE_MISSING");
      assert.equal(error.stage, "file preparation");
      assert.match(error.message, /not installed yet/);
      return true;
    },
  );
});
test("launch preparation preserves inspection and configuration filesystem failure details", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mm-prepare-error-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const runtime = createRuntime({
    userData: root,
    bundledRoot: root,
    platform: "linux",
    arch: "x64",
    hostname: "fixture",
  });
  const customPath = path.join(root, "inert-miner");
  const config = {
    engine: "nanominer",
    algorithm: "rx/0",
    pool: "pool:3333",
    user: "fixture",
    customPath,
  };
  await assert.rejects(
    runtime.launchSpec("xmrig", "xmrig-1", config),
    (error) => {
      assert.equal(error.code, "ENOENT");
      assert.equal(error.stage, "file verification");
      assert.equal(error.syscall, "stat");
      assert.equal(error.path, customPath);
      return true;
    },
  );
  await fs.writeFile(customPath, "inert fixture, never executed", {
    mode: 0o755,
  });
  await fs.writeFile(path.join(root, "processes"), "block directory creation");
  await assert.rejects(
    runtime.launchSpec("xmrig", "xmrig-1", config),
    (error) => {
      assert.equal(error.stage, "process configuration");
      assert.equal(error.syscall, "mkdir");
      assert.ok(error.path.includes("processes"));
      return true;
    },
  );
});
test("file preparation failures retain their stage and OS operation without claiming launch or antivirus detection", () => {
  const { describeError } = require("../electron/mining/runtime");
  const d = describeError(
    {
      code: "UNKNOWN",
      stage: "download",
      syscall: "open",
      path: "C:\\staging\\miner.zip",
    },
    null,
    "win32",
  );
  assert.equal(d.stage, "download");
  assert.equal(d.syscall, "open");
  assert.match(d.message, /download failed/);
  assert.doesNotMatch(d.message, /could not launch/);
  assert.match(d.path, /miner.zip/);
  const missing = describeError(
    { code: "PACKAGE_MISSING", stage: "file preparation", message: "not installed yet" },
    null,
    "win32",
  );
  assert.equal(missing.message, "not installed yet");
  assert.equal(missing.stage, "file preparation");
});
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
