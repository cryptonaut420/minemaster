const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("vm");
const fs = require("fs");
const path = require("path");
function setup() {
  const sockets = [],
    timers = new Map();
  let nextTimer = 0;
  class Socket {
    static OPEN = 1;
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.sent = [];
      sockets.push(this);
    }
    close() {
      this.closed = true;
    }
    send(value) {
      this.sent.push(JSON.parse(value));
    }
  }
  const raw = fs.readFileSync(
    path.join(__dirname, "../../client/src/services/masterServer.js"),
    "utf8",
  );
  const code = raw.slice(
    raw.indexOf("class MasterServerService"),
    raw.indexOf("// Export singleton instance"),
  );
  const service = vm.runInNewContext(`${code}; new MasterServerService()`, {
    WebSocket: Socket,
    window: { crypto: { randomUUID: () => "fixture-boot" } },
    TextEncoder,
    console,
    setTimeout: (fn) => {
      timers.set(++nextTimer, fn);
      return nextTimer;
    },
    clearTimeout: (id) => timers.delete(id),
    setInterval: () => 1,
    clearInterval() {},
    getSystemId: async () => "fixture-system",
    versionInfo: { displayVersion: "fixture-version" },
  });
  service.config = {
    enabled: true,
    host: "fixture.local",
    port: "443",
    autoReconnect: false,
  };
  return { service, sockets, timers };
}
test("desktop reconnect ignores retired socket close and uses TLS for string port 443", async () => {
  const { service, sockets, timers } = setup();
  const first = service.connect().catch((e) => e.message);
  service.disconnect();
  service.config.enabled = true;
  const second = service.connect();
  sockets[1].readyState = 1;
  sockets[1].onopen();
  await second;
  sockets[0].onclose();
  await first;
  for (const timer of [...timers.values()]) timer();
  assert.equal(service.connected, true);
  assert.equal(service.ws, sockets[1]);
  assert.equal(sockets[1].closed, undefined);
  assert.equal(sockets[1].url, "wss://fixture.local");
});
test("desktop registration reports real build metadata and log buffering stays bounded", async () => {
  const { service, sockets } = setup();
  const connected = service.connect();
  sockets[0].readyState = 1;
  sockets[0].onopen();
  await connected;
  await service.bind({ hostname: "fixture" });
  const register = sockets[0].sent.find((m) => m.type === "register");
  assert.equal(register.data.protocolVersion, 2);
  assert.equal(register.data.version, "fixture-version");
  assert.equal(register.data.capabilities.commandResults, true);
  for (let i = 0; i < 510; i++) service.queueLog("cpu", `line ${i}`);
  assert.equal(service.logQueue.length, 500);
  assert.equal(service.droppedLogs, 10);
  service.bound = true;
  service.flushLogs();
  assert.equal(sockets[0].sent.at(-1).data.entries.length, 100);
  assert.equal(service.logQueue.length, 400);
  assert.equal(service.droppedLogs, 1);
});
