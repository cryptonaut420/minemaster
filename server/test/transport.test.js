const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("vm");
const fs = require("fs");
const path = require("path");
function setup(electronAPI) {
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
    supportsSrbPlatform: require("../../client/src/utils/miningConfig")
      .supportsSrbPlatform,
    WebSocket: Socket,
    window: { electronAPI, crypto: { randomUUID: () => "fixture-boot" } },
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
  assert.equal(service.logQueue.length, 401);
  assert.equal(service.droppedLogs, 0);
});

test("explicit WebSocket origins and custom TLS ports survive reconnect configuration", async () => {
  for (const [config, expected] of [
    [
      { host: "wss://fixture.local:8443/", port: 443 },
      "wss://fixture.local:8443",
    ],
    [{ host: "ws://fixture.local", port: 8080 }, "ws://fixture.local:8080"],
    [
      { host: "fixture.local", port: 8443, secure: true },
      "wss://fixture.local:8443",
    ],
    [{ host: "fixture.local:8080", port: 8080 }, "ws://fixture.local:8080"],
    [{ host: "[::1]", port: 8080 }, "ws://[::1]:8080"],
  ]) {
    const { service, sockets } = setup();
    service.config = { ...service.config, ...config };
    const connected = service.connect();
    assert.equal(sockets[0].url, expected);
    sockets[0].readyState = 1;
    sockets[0].onopen();
    await connected;
    service.disconnect();
  }
});
test("a socket error keeps the connection deadline armed and send applies backpressure", async () => {
  const { service, sockets, timers } = setup();
  const pending = service.connect().catch((e) => e.message);
  sockets[0].onerror(Error("network failure"));
  assert.equal(timers.size, 1);
  [...timers.values()][0]();
  assert.equal(await pending, "Connection timeout");
  const next = service.connect();
  sockets[1].readyState = 1;
  sockets[1].onopen();
  await next;
  sockets[1].bufferedAmount = 2 * 1024 * 1024;
  assert.equal(service.send({ type: "heartbeat" }), false);
});

test("failed log flushes preserve buffered lines and loss counts under backpressure", () => {
  const { service } = setup();
  service.bound = true;
  for (let i = 0; i < 510; i++) service.queueLog("cpu", `line ${i}`);
  service.send = () => false;
  for (let i = 0; i < 5; i++) service.flushLogs();
  assert.equal(service.logQueue.length, 500);
  assert.equal(service.droppedLogs, 10);
  assert.equal(service.logQueue[0].message, "line 10");
  let sent;
  service.send = (message) => {
    sent = message;
    return true;
  };
  service.flushLogs();
  assert.equal(sent.data.entries.length, 100);
  assert.match(sent.data.entries.at(-1).message, /10 log lines dropped/);
  assert.equal(service.logQueue.length, 401);
  assert.equal(service.droppedLogs, 0);
});

test("a timed-out socket cannot revive the connection or deliver late commands", async () => {
  const { service, sockets, timers } = setup();
  const events = [];
  for (const name of ["connected", "bound", "command"])
    service.on(name, () => events.push(name));
  const pending = service.connect().catch((e) => e.message);
  const retired = sockets[0];
  [...timers.values()][0]();
  assert.equal(await pending, "Connection timeout");
  retired.readyState = 1;
  retired.onopen();
  retired.onmessage({ data: JSON.stringify({ type: "bound" }) });
  retired.onmessage({
    data: JSON.stringify({ type: "command", data: { action: "start" } }),
  });
  assert.equal(service.connected, false);
  assert.equal(service.bound, false);
  assert.deepEqual(events, []);
  const replacement = service.connect();
  sockets[1].readyState = 1;
  sockets[1].onopen();
  await replacement;
  retired.onclose();
  assert.equal(service.ws, sockets[1]);
  assert.equal(service.connected, true);
});

for (const character of ["界", "\u0000"])
  test(`large ${character === "界" ? "Unicode" : "JSON-escaped"} logs drain within the wire byte limit`, async () => {
    const { service, sockets } = setup();
    const connected = service.connect();
    sockets[0].readyState = 1;
    sockets[0].onopen();
    await connected;
    service.bound = true;
    let errors = 0;
    service.on("error", () => errors++);
    for (let i = 0; i < 510; i++)
      service.queueLog("cpu", character.repeat(4000));
    for (let i = 0; i < 20 && service.logQueue.length; i++) service.flushLogs();
    assert.equal(service.logQueue.length, 0);
    assert.equal(service.droppedLogs, 0);
    assert.equal(errors, 0);
    const batches = sockets[0].sent.filter((m) => m.type === "logs");
    assert.equal(batches.flatMap((m) => m.data.entries).length, 501);
    assert.equal(
      batches
        .flatMap((m) => m.data.entries)
        .filter((e) => /10 log lines dropped/.test(e.message)).length,
      1,
    );
    for (const batch of batches) {
      assert.ok(batch.data.entries.length <= 100);
      assert.ok(
        Buffer.byteLength(JSON.stringify(batch)) <= service.maxMessageBytes,
      );
    }
  });

test("registration advertises SRBMiner only on supported native targets", async () => {
  for (const [platform, arch, supported] of [
    ["win32", "x64", true],
    ["linux", "x64", true],
    ["linux", "arm64", false],
    ["win32", "arm64", false],
    ["darwin", "x64", false],
    [undefined, undefined, false],
  ]) {
    const { service } = setup({ platform, arch });
    service.connected = true;
    let registration;
    service.send = (message) => {
      registration = message.data;
      return true;
    };
    await service.bind({}, true);
    for (const key of ["cpuEngines", "gpuEngines"])
      assert.equal(
        registration.capabilities[key].includes("srbminer"),
        supported,
        `${platform}/${arch}/${key}`,
      );
  }
});
