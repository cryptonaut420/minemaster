const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("events");
const { createProcessManager } = require("../electron/mining/processManager");
function fixture(options = {}) {
  let live = true;
  const children = [],
    messages = [];
  const runtime = {
    launchSpec: async () => ({
      executable: "/fixture/miner",
      args: [],
      cwd: "/fixture",
      diagnostic: { status: "ready", version: "test" },
    }),
    inspect: async () => ({ status: "ready" }),
    prepare: async () => {},
  };
  const manager = createProcessManager({
    runtime,
    alive: () => live,
    wait: async () => {},
    stopPolls: 1,
    spawnProcess: () => {
      const p = new EventEmitter();
      p.pid = 321;
      p.stdout = new EventEmitter();
      p.stderr = new EventEmitter();
      children.push(p);
      return p;
    },
    signal: async () => {
      live = false;
    },
    emit: (...args) => messages.push(args),
    ...options,
  });
  return {
    manager,
    children,
    messages,
    runtime,
    setLive: (value) => {
      live = value;
    },
  };
}
const request = {
  minerId: "cpu",
  minerType: "xmrig",
  config: { version: "v1", gpus: [0] },
};
test("two Nanominer processes stop independently and repair waits until both release the engine", async () => {
  const live = new Set();
  let nextPid = 1000,
    repairs = 0;
  const f = fixture({
    alive: (pid) => live.has(pid),
    spawnProcess: () => {
      const p = new EventEmitter();
      p.pid = ++nextPid;
      p.stdout = new EventEmitter();
      p.stderr = new EventEmitter();
      live.add(p.pid);
      return p;
    },
    signal: async (p) => live.delete(p.pid),
  });
  f.runtime.prepare = async () => {
    repairs++;
  };
  const cpu = await f.manager.start({
    ...request,
    config: { engine: "nanominer" },
  });
  const gpu = await f.manager.start({
    minerId: "gpu",
    minerType: "nanominer",
    config: {},
  });
  assert.notEqual(cpu.pid, gpu.pid);
  assert.equal(cpu.engine, "nanominer");
  await f.manager.stop({ minerId: "cpu" });
  assert.equal(f.manager.snapshot("gpu").running, true);
  assert.equal((await f.manager.repair("cpu", "nanominer")).success, false);
  assert.equal(repairs, 0);
  await f.manager.stop({ minerId: "gpu" });
  assert.equal((await f.manager.repair("cpu", "nanominer")).success, true);
  assert.equal(repairs, 1);
});
test("a repair cannot race past a different process preparing the same engine", async () => {
  let release, entered;
  const ready = new Promise((r) => (entered = r));
  const f = fixture();
  const launch = f.runtime.launchSpec;
  f.runtime.launchSpec = async (...args) => {
    entered();
    await new Promise((r) => (release = r));
    return launch(...args);
  };
  const start = f.manager.start({
    minerId: "gpu",
    minerType: "nanominer",
    config: {},
  });
  await ready;
  const repair = f.manager.repair("cpu", "nanominer");
  release();
  assert.equal((await start).success, true);
  assert.equal((await repair).success, false);
});
test("launch snapshots deep configuration; a duplicate start does not create another process", async () => {
  const { manager, children } = fixture();
  const input = structuredClone(request);
  const result = await manager.start(input);
  input.config.gpus.push(1);
  assert.equal(result.success, true);
  assert.deepEqual(result.activeConfig.gpus, [0]);
  assert.ok(result.startedAt);
  await manager.start(request);
  assert.equal(children.length, 1);
});
test("failed stop retains tracking even when ChildProcess.killed is true", async () => {
  const { manager, children } = fixture({
    signal: async () => {
      throw Error("denied");
    },
  });
  await manager.start(request);
  children[0].killed = true;
  const result = await manager.stop({ minerId: "cpu" });
  assert.equal(result.success, false);
  assert.equal(manager.snapshot("cpu").pid, 321);
  assert.match(result.error, /321/);
});
test("stop cancels an in-progress preparation before any miner is spawned", async () => {
  let release, preparing;
  const ready = new Promise((r) => (preparing = r));
  const f = fixture({
    runtime: {
      launchSpec: async () => {
        preparing();
        await new Promise((r) => (release = r));
        return {};
      },
    },
  });
  const start = f.manager.start(request);
  await ready;
  const stop = f.manager.stop({ minerId: "cpu" });
  release();
  assert.equal((await start).success, false);
  assert.equal((await stop).success, true);
  assert.equal(f.children.length, 0);
});
test("obsolete close events cannot delete a replacement process", async () => {
  const f = fixture();
  await f.manager.start(request);
  const old = f.children[0];
  await f.manager.stop({ minerId: "cpu" });
  f.setLive(true);
  await f.manager.start(request);
  old.emit("close", 1);
  assert.equal(f.manager.snapshot("cpu").running, true);
  assert.equal(f.messages.length, 0);
});
test("startup error is returned with a structured file diagnostic", async () => {
  const f = fixture({
    wait: async () => {
      f.children[0].emit(
        "error",
        Object.assign(Error("blocked"), { code: "EPERM" }),
      );
    },
  });
  const result = await f.manager.start(request);
  assert.equal(result.success, false);
  assert.equal(result.diagnostic.code, "EPERM");
  assert.match(result.error, /Protection History/);
});
test("exit during launch fails; later unexpected exit is emitted with useful log tail", async () => {
  const f = fixture({
    wait: async () => {
      const p = f.children[0];
      p.stdout.emit("data", "pool unreachable\n");
      p.exitCode = 1;
      p.emit("close", 1);
    },
  });
  const result = await f.manager.start(request);
  assert.equal(result.success, false);
  assert.match(result.error, /pool unreachable/);
  assert.equal(
    f.messages.find(([name]) => name === "miner-closed")[1].expected,
    false,
  );
});
test("shutdown awaits pending starts, stops miners, and rejects new starts", async () => {
  const f = fixture();
  await f.manager.start(request);
  assert.deepEqual(await f.manager.stopAll(), ["cpu"]);
  assert.equal(f.manager.snapshot("cpu").running, false);
  assert.equal((await f.manager.start(request)).success, false);
});
test("repair refuses a running miner and never launches one", async () => {
  const f = fixture();
  await f.manager.start(request);
  assert.equal((await f.manager.repair("cpu", "xmrig")).success, false);
  await f.manager.stop({ minerId: "cpu" });
  assert.equal((await f.manager.repair("cpu", "xmrig")).success, true);
  assert.equal(f.children.length, 1);
  const custom = await f.manager.repair("cpu", "xmrig", "/custom/xmrig");
  assert.equal(custom.success, false);
  assert.match(custom.error, /custom executable/);
});
test("repair cancels pending crash recovery and leaves the miner stopped", async () => {
  const tasks = new Map();
  const f = fixture({
    schedule: (fn) => {
      tasks.set(1, fn);
      return 1;
    },
    unschedule: (id) => tasks.delete(id),
  });
  await f.manager.start({ ...request, config: { restartOnCrash: true } });
  f.children[0].exitCode = 1;
  f.children[0].emit("close", 1);
  assert.equal(tasks.size, 1);
  assert.equal((await f.manager.repair("cpu", "xmrig")).success, true);
  assert.equal(tasks.size, 0);
  assert.equal(f.manager.snapshot("cpu").restartPendingAt, null);
  assert.equal(f.manager.snapshot("cpu").running, false);
  assert.equal(f.children.length, 1);
});
test("crash recovery is opt-in, uses a bounded budget, and Stop cancels a pending restart", async () => {
  const tasks = new Map();
  let counter = 0;
  const f = fixture({
    schedule: (fn) => {
      const id = ++counter;
      tasks.set(id, fn);
      return id;
    },
    unschedule: (id) => tasks.delete(id),
  });
  const input = {
    ...request,
    config: { restartOnCrash: true, maxCrashRestartsPerHour: 1 },
  };
  await f.manager.start(input);
  f.children[0].exitCode = 1;
  f.children[0].emit("close", 1);
  assert.equal(tasks.size, 1);
  assert.ok(f.manager.snapshot("cpu").restartPendingAt);
  const retry = [...tasks.values()][0];
  tasks.clear();
  retry();
  await f.manager.start(input); // Wait for the queued retry; this call must not spawn a duplicate.
  assert.equal(f.children.length, 2);
  f.children[1].exitCode = 1;
  f.children[1].emit("close", 1);
  assert.equal(tasks.size, 0);
  const g = fixture({
    schedule: (fn) => {
      tasks.set(999, fn);
      return 999;
    },
    unschedule: (id) => tasks.delete(id),
  });
  await g.manager.start(input);
  g.children[0].exitCode = 1;
  g.children[0].emit("close", 1);
  assert.equal(tasks.size, 1);
  await g.manager.stop({ minerId: "cpu" });
  assert.equal(tasks.size, 0);
});
