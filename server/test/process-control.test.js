const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const vm = require("vm");
const { EventEmitter } = require("events");
const source = fs.readFileSync(
  require("path").join(__dirname, "../../client/electron/main.js"),
  "utf8",
);
function handler(name, nextMarker, context) {
  const start = source.indexOf(`ipcMain.handle('${name}'`),
    end = source.indexOf(nextMarker, start);
  let fn;
  vm.runInNewContext(source.slice(start, end), {
    ipcMain: {
      handle: (_, h) => {
        fn = h;
      },
    },
    processOperations: new Set(),
    ...context,
  });
  return fn;
}
test("Electron retains process tracking after failed stop and does not treat killed flag as exit", async () => {
  const proc = { pid: 321, killed: true },
    miners = { cpu: { process: proc, type: "xmrig" } };
  const stop = handler("stop-miner", "ipcMain.handle('get-miner-status'", {
    miners,
    isProcessRunning: () => true,
    killMinerProcess: async () => false,
    execAsync: async () => {},
    setTimeout: (resolve) => {
      resolve();
      return 1;
    },
    clearTimeout() {},
    clearInterval() {},
    process: { platform: "linux" },
  });
  const result = await stop(null, { minerId: "cpu" });
  assert.equal(result.success, false);
  assert.match(result.error, /321/);
  assert.equal(miners.cpu.process, proc);
  assert.equal(proc._expectedStop, false);
});
test("Electron rejects a process that exits during launch and ignores obsolete process close", async () => {
  const miners = {},
    messages = [],
    proc = new EventEmitter();
  proc.pid = 321;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  const start = handler("start-miner", "// Check if process is still running", {
    miners,
    spawn: () => proc,
    getXmrigPath: () => "/fixture/xmrig",
    buildXmrigArgs: () => [],
    path: require("path"),
    sendToRenderer: (...m) => messages.push(m),
    isProcessRunning: () => false,
    setTimeout: (resolve) => {
      resolve();
      return 1;
    },
    clearTimeout() {},
  });
  assert.equal(
    (await start(null, { minerId: "cpu", minerType: "xmrig", config: {} }))
      .success,
    false,
  );
  const replacement = { process: { pid: 999 } };
  miners.cpu = replacement;
  proc.emit("close", 1);
  assert.equal(miners.cpu, replacement);
  assert.equal(messages.length, 0);
});
test("Electron launch returns actual immutable configuration and start time", async () => {
  const miners = {},
    proc = new EventEmitter();
  proc.pid = 321;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  const start = handler("start-miner", "// Check if process is still running", {
    miners,
    spawn: () => proc,
    getXmrigPath: () => "/fixture/xmrig",
    buildXmrigArgs: () => [],
    path: require("path"),
    sendToRenderer: () => {},
    isProcessRunning: () => true,
    setTimeout: (resolve) => {
      resolve();
      return 1;
    },
    clearTimeout() {},
  });
  const config = { algorithm: "rx/0", version: "launch-1" },
    result = await start(null, { minerId: "cpu", minerType: "xmrig", config });
  config.version = "later";
  assert.equal(result.success, true);
  assert.equal(result.activeConfig.version, "launch-1");
  assert.equal(result.pid, 321);
  assert.ok(result.startedAt > 0);
});
