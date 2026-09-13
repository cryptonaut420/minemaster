const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("fs"),
  path = require("path");
const runnerModule = () =>
  import(
    "data:text/javascript;base64," +
      fs
        .readFileSync(path.join(__dirname, "../src/utils/commandRunner.js"))
        .toString("base64")
  );
test("a newer Stop reaches native preparation without waiting for Start to finish", async () => {
  const { createCommandRunner } = await runnerModule();
  let finish, began;
  const starting = new Promise((r) => (began = r));
  let stopped = 0;
  const reports = [];
  const c = createCommandRunner({
    getMiners: () => [{ id: "cpu", deviceType: "CPU", config: {} }],
    start: () => {
      began();
      return new Promise((r) => (finish = r));
    },
    stop: async () => {
      stopped++;
      finish?.({ success: false, error: "canceled" });
      return { success: true };
    },
    report: (r) => reports.push(r),
  });
  const deadline = new Date(Date.now() + 5000).toISOString();
  const a = c.execute({
    id: "a",
    action: "start",
    deviceType: "CPU",
    deadline,
  });
  await starting;
  await c.execute({ id: "b", action: "stop", deviceType: "CPU", deadline });
  await a;
  assert.ok(stopped >= 1);
  assert.equal(reports.findLast((r) => r.id === "a").status, "canceled");
  assert.equal(reports.findLast((r) => r.id === "b").status, "succeeded");
});
test("application installation handoff remains running for server version confirmation", async () => {
  const { createCommandRunner } = await runnerModule();
  const reports = [];
  let calls = 0;
  const c = createCommandRunner({
    getMiners: () => [],
    application: async () => {
      calls++;
      return { success: true, phase: "installer-handoff" };
    },
    report: (r) => reports.push(r),
  });
  await c.execute({
    id: "update",
    action: "app-update-install",
    deviceType: "ALL",
    targetVersion: "1.3.1",
    deadline: new Date(Date.now() + 5000).toISOString(),
  });
  assert.equal(calls, 1);
  assert.equal(reports.at(-1).status, "running");
  assert.equal(reports.at(-1).result.update.phase, "installer-handoff");
});

test("admin Nanominer CPU revisions reach the isolated native config while GPU stays running", async (t) => {
  const os = require("os"),
    { EventEmitter } = require("events");
  const { createRuntime } = require("../electron/mining/runtime"),
    { createProcessManager } = require("../electron/mining/processManager"),
    { mergeAssignment } = await import(
      "data:text/javascript;base64," +
        Buffer.from(
          fs
            .readFileSync(
              path.join(__dirname, "../src/utils/configAssignment.js"),
              "utf8",
            )
            .replace(
              "./miningConfig.js",
              require("url").pathToFileURL(
                path.join(__dirname, "../src/utils/miningConfig.js"),
              ).href,
            ),
        ).toString("base64")
    );
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "minemaster-admin-cpu-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fake = path.join(root, "fake-nanominer");
  fs.writeFileSync(fake, "fixture, never executed");
  fs.chmodSync(fake, 0o755);
  const runtime = createRuntime({
    userData: root,
    bundledRoot: root,
    platform: "linux",
    arch: "x64",
    hostname: "rig",
    logicalCores: 16,
  });
  const alive = new Set();
  let pid = 200;
  const manager = createProcessManager({
    runtime,
    wait: async () => {},
    alive: (p) => alive.has(p),
    signal: async (p) => alive.delete(p.pid),
    spawnProcess: () => {
      const child = new EventEmitter();
      child.pid = ++pid;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      alive.add(pid);
      return child;
    },
  });
  let miners = [
    {
      id: "xmrig-1",
      type: "xmrig",
      deviceType: "CPU",
      enabled: true,
      running: false,
      config: { engine: "nanominer", customPath: fake },
    },
    {
      id: "nanominer-1",
      type: "nanominer",
      deviceType: "GPU",
      enabled: true,
      config: {
        algorithm: "etchash",
        coin: "ETC",
        pool: "gpu:3333",
        user: "gpu-wallet",
        customPath: fake,
      },
    },
  ];
  const start = async (id) => {
    const m = miners.find((x) => x.id === id),
      r = await manager.start({
        minerId: id,
        minerType: m.type,
        config: m.config,
      });
    Object.assign(m, r);
    return r;
  };
  const stop = async (id) => {
    const r = await manager.stop({ minerId: id });
    Object.assign(
      miners.find((x) => x.id === id),
      manager.snapshot(id),
    );
    return r;
  };
  await start("nanominer-1");
  const gpuPid = miners[1].pid;
  const { createCommandRunner } = await runnerModule();
  const reports = [];
  const c = createCommandRunner({
    getMiners: () => miners,
    start,
    stop,
    applyConfigs: (configs) => {
      miners = miners.map((m) =>
        configs[m.type] ? mergeAssignment(m, configs[m.type]) : m,
      );
    },
    report: (r) => reports.push(r),
    delayMs: 0,
  });
  for (const [i, password] of ["first", "second"].entries())
    await c.execute({
      id: "rollout-" + i,
      action: "restart",
      deviceType: "CPU",
      deadline: new Date(Date.now() + 5000).toISOString(),
      configs: {
        xmrig: {
          engine: "nanominer",
          algorithm: "rx/0",
          coin: "XMR",
          pool: "cpu:3333",
          user: "cpu-wallet",
          password,
          threads: 4,
          version: "v" + i,
        },
      },
    });
  const ini = fs.readFileSync(
    path.join(root, "processes/xmrig-1/config.ini"),
    "utf8",
  );
  assert.match(ini, /\[RandomX\]/);
  assert.match(ini, /cpuThreads = 4/);
  assert.match(ini, /rigPassword = second/);
  assert.equal(miners[0].engine, "nanominer");
  assert.equal(miners[0].activeConfig.version, "v1");
  assert.equal(manager.snapshot("nanominer-1").pid, gpuPid);
  assert.ok(reports.filter((r) => r.status === "succeeded").length === 2);
});
