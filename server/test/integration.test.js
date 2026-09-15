const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("events");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { MongoClient, ObjectId } = require("mongodb");
const WebSocket = require("ws");
let mongo, db, app, origin, token;
const sockets = [];
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (predicate) => {
  for (let i = 0; i < 100; i++) {
    const value = await predicate();
    if (value) return value;
    await delay(20);
  }
  throw Error("Condition timeout");
};
async function api(path, method = "GET", body, headers = {}) {
  const response = await fetch(`${origin}/api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, data: await response.json() };
}
async function socket() {
  const ws = new WebSocket(origin.replace("http", "ws") + "/ws");
  ws.messages = [];
  ws.on("message", (m) => ws.messages.push(JSON.parse(m)));
  await once(ws, "open");
  sockets.push(ws);
  return ws;
}
const send = (ws, type, data) => ws.send(JSON.stringify({ type, data }));
const registration = (id) => ({
  systemId: id,
  protocolVersion: 2,
  version: "test-agent",
  capabilities: { commandResults: true, cpuEngines: ["xmrig", "nanominer"] },
  systemInfo: {
    hostname: id,
    gpus: [
      { model: "Vega 64", busAddress: "0000:01:00.0" },
      { model: "Vega 64", busAddress: "0000:02:00.0" },
    ],
  },
});
before(
  async () => {
    // Never use an environment-configured deployment database.
    mongo = await MongoMemoryServer.create({ binary: { version: "7.0.24" } });
    process.env.MONGO_URL = mongo.getUri();
    process.env.MONGO_DB_NAME = "minemaster_regression";
    process.env.JWT_SECRET = "isolated-regression-secret";
    const storage = require("../src/db/mongodb");
    db = await storage.connect();
    app = require("../src/server");
    await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${app.server.address().port}`;
    token = require("../src/middleware/auth").generateToken({
      _id: new ObjectId(),
      email: "fixture@local.test",
    });
  },
  { timeout: 180000 },
);
after(async () => {
  for (const s of sockets) s.terminate();
  require("../src/websocket/server").shutdown();
  if (app) {
    await new Promise((r) => app.wss.close(r));
    await new Promise((r) => app.server.close(r));
  }
  await require("../src/db/mongodb").disconnect();
  await mongo?.stop();
});
test("indexes accept multiple null optional IDs and migrate existing sparse indexes", async () => {
  const client = new MongoClient(mongo.getUri());
  await client.connect();
  const migration = client.db("migration_test");
  await migration
    .collection("miners")
    .createIndex({ systemId: 1 }, { unique: true, sparse: true });
  await migration.collection("miners").insertOne({ id: "one", systemId: null });
  await require("../src/db/mongodb").ensureIndexes(migration);
  await migration.collection("miners").insertMany([
    { id: "two", systemId: null, connectionId: null },
    { id: "three", systemId: null, connectionId: null },
  ]);
  assert.equal(
    (await migration.collection("miners").find().toArray()).length,
    3,
  );
  assert.ok(
    (await migration.collection("hashrates").listIndexes().toArray()).some(
      (i) => i.expireAfterSeconds === 604800,
    ),
  );
  await client.close();
});
test("time-weighted fleet sum, unlike algorithms, null gaps and replay-safe rollups", async () => {
  const HashRate = require("../src/models/HashRate"),
    base = Math.floor((Date.now() - 600000) / 60000) * 60000;
  for (const [id, value, algorithm] of [
    ["one", 100, "rx/0"],
    ["two", 200, "rx/0"],
    ["gpu", 50e6, "kawpow"],
  ]) {
    const previous = {
      id: "process",
      deviceType: id === "gpu" ? "GPU" : "CPU",
      running: true,
      quality: "valid",
      algorithm,
      hashrate: value,
      hashrateObservedAt: new Date(base).toISOString(),
    };
    const next = {
      ...previous,
      hashrateObservedAt: new Date(base + 60000).toISOString(),
      hashrate: 0,
      quality: "zero",
    };
    await HashRate.record(id, next, previous);
    await HashRate.record(id, next, previous);
  }
  const result = await HashRate.getTimeSeries({
    from: new Date(base).toISOString(),
    to: new Date(base + 120000).toISOString(),
    resolution: 60,
  });
  assert.equal(result.data.find((p) => p.key === "CPU:rx/0").hashrate, 300);
  assert.equal(result.data.find((p) => p.key === "GPU:kawpow").hashrate, 50e6);
  assert.equal(result.data.filter((p) => p.hashrate === null).length, 2);
  assert.equal(await db.collection("hashrates").countDocuments(), 3);
});
test("new session owns state; old close and overlapping telemetry cannot clobber it", async () => {
  const first = await socket();
  send(first, "register", registration("rig-race"));
  await waitFor(() => first.messages.some((m) => m.type === "bound"));
  const initial = await db
    .collection("miners")
    .findOne({ systemId: "rig-race" });
  const second = await socket();
  send(second, "register", registration("rig-race"));
  await waitFor(() => second.messages.some((m) => m.type === "bound"));
  const now = new Date().toISOString();
  send(second, "status-update", {
    protocolVersion: 2,
    processes: [
      {
        id: "cpu",
        deviceType: "CPU",
        running: true,
        algorithm: "rx/0",
        hashrate: 0,
        hashrateObservedAt: now,
      },
      {
        id: "gpu",
        deviceType: "GPU",
        running: true,
        algorithm: "kawpow",
        hashrate: 15e6,
        hashrateObservedAt: now,
      },
    ],
    stats: { observedAt: now, cpu: { temperature: 40 } },
  });
  send(second, "heartbeat", {});
  const rig = await waitFor(async () => {
    const m = await db.collection("miners").findOne({ id: initial.id });
    return m?.processes?.length === 2 && m;
  });
  assert.notEqual(rig.connectionId, initial.connectionId);
  assert.equal(rig.processes[0].hashrate, 0);
  assert.equal(rig.hardware.gpus.length, 2);
  const summary = await api("/v1/fleet/summary");
  assert.equal(
    summary.data.algorithms.find((g) => g.algorithm === "kawpow").hashrate,
    15e6,
  );
  await delay(40);
  assert.ok(
    (await db.collection("miners").findOne({ id: initial.id })).connectionId,
  );
});
test("observer updates never fan out to registered agents", async () => {
  const observer = await socket();
  send(observer, "subscribe", { token });
  await waitFor(() => observer.messages.some((m) => m.type === "subscribed"));
  const agent = sockets.find(
    (s) => s.readyState === 1 && s.messages.some((m) => m.type === "bound"),
  );
  const before = agent.messages.length;
  require("../src/websocket/server").broadcast({
    type: "fixture-change",
    value: 1,
  });
  await waitFor(() =>
    observer.messages.some((m) => m.type === "fixture-change"),
  );
  assert.equal(
    agent.messages.slice(before).some((m) => m.type === "fixture-change"),
    false,
  );
});
test("commands return 202, acknowledge results, idempotently retry and reject unsafe scope fallback", async () => {
  const rig = await db.collection("miners").findOne({ systemId: "rig-race" });
  const agent = sockets.find(
    (s) =>
      s.readyState === 1 && s.messages.some((m) => m.data?.minerId === rig.id),
  );
  const body = { minerId: rig.id, action: "stop", deviceType: "CPU" };
  const created = await api("/v1/commands", "POST", body, {
    "Idempotency-Key": "stop-once",
  });
  assert.equal(created.status, 202);
  assert.equal(created.data.data.status, "sent");
  const command = await waitFor(() =>
    agent.messages.find((m) => m.type === "command"),
  );
  assert.equal(command.data.action, "stop");
  assert.equal(command.data.deviceType, "CPU");
  send(agent, "command-result", { id: command.data.id, status: "received" });
  send(agent, "command-result", {
    id: command.data.id,
    status: "failed",
    error: "PID still running",
  });
  await waitFor(
    async () =>
      (await db.collection("commands").findOne({ id: command.data.id }))
        .status === "failed",
  );
  send(agent, "command-result", { id: command.data.id, status: "succeeded" });
  await delay(40);
  assert.equal(
    (await api(`/v1/commands/${command.data.id}`)).data.data.status,
    "failed",
  );
  assert.equal(
    (
      await api("/v1/commands", "POST", body, {
        "Idempotency-Key": "stop-once",
      })
    ).data.data.id,
    command.data.id,
  );
  assert.equal(
    (await api("/v1/commands", "POST", { ...body, gpuId: 999 })).status,
    422,
  );
});
test("configuration revisions and optimistic concurrency preserve changes", async () => {
  const saved = await api("/v1/configs/xmrig", "PUT", {
    pool: "pool.local:3333",
    user: "fixture",
    version: "legacy",
  });
  assert.equal(saved.status, 200);
  assert.equal(
    (
      await api("/v1/configs/xmrig", "PUT", {
        pool: "other:3333",
        version: "legacy",
      })
    ).status,
    409,
  );
  const revisions = await api("/v1/configs/xmrig/revisions");
  assert.ok(
    revisions.data.data.some((r) => r.version === saved.data.data.version),
  );
  assert.equal(
    (await api("/v1/configs/nanominer", "PUT", { threadPercentage: "bad" }))
      .status,
    400,
  );
});
test("saved global revisions do not silently replace an existing rig assignment", async () => {
  const rig = await db.collection("miners").findOne({ systemId: "rig-race" });
  const agent = sockets.find(
    (s) =>
      s.readyState === 1 && s.messages.some((m) => m.data?.minerId === rig.id),
  );
  const before = agent.messages.length;
  send(agent, "request-configs");
  const reply = await waitFor(() =>
    agent.messages.slice(before).find((m) => m.type === "config-update"),
  );
  assert.equal(reply.data.xmrig.version, "legacy");
  const rollout = await api("/v1/configs/xmrig/apply", "POST", {
    minerIds: [rig.id],
  });
  assert.equal(rollout.status, 202);
  assert.equal(
    rollout.data.results[0].command.configs.xmrig.version,
    (await api("/v1/configs")).data.data.xmrig.version,
  );
  const assigned = await db.collection("miners").findOne({ id: rig.id });
  assert.notEqual(assigned.desiredConfigs.xmrig.version, "legacy");
  await require("../src/services/commands").cancel(
    rollout.data.results[0].command.id,
  );
});
test("bulk results preserve target errors and retry the same batch without duplicate dispatch", async () => {
  const rig = await db.collection("miners").findOne({ systemId: "rig-race" });
  const body = {
    minerIds: [rig.id, "missing", rig.id],
    action: "stop",
    deviceType: "CPU",
  };
  const first = await api("/v1/commands", "POST", body, {
    "Idempotency-Key": "bulk-repeat",
  });
  const retry = await api("/v1/commands", "POST", body, {
    "Idempotency-Key": "bulk-repeat",
  });
  assert.equal(first.data.results.length, 2);
  assert.equal(first.data.results[1].status, 404);
  assert.equal(first.data.batchId, retry.data.batchId);
  assert.equal(
    first.data.results[0].command.id,
    retry.data.results[0].command.id,
  );
  await require("../src/services/commands").cancel(
    first.data.results[0].command.id,
  );
});
test("deadlines and server restart preserve unknown outcomes without replay", async () => {
  const rig = await db.collection("miners").findOne({ systemId: "rig-race" });
  const created = await api("/v1/commands", "POST", {
    minerId: rig.id,
    action: "stop",
    deviceType: "CPU",
  });
  await db
    .collection("commands")
    .updateOne(
      { id: created.data.data.id },
      { $set: { deadline: new Date(Date.now() - 1) } },
    );
  await require("../src/services/commands").expire();
  const final = await db
    .collection("commands")
    .findOne({ id: created.data.data.id });
  assert.equal(final.status, "timed_out");
  assert.match(final.error, /unknown/);
  const second = await api("/v1/commands", "POST", {
    minerId: rig.id,
    action: "stop",
    deviceType: "GPU",
  });
  await require("../src/services/commands").expire(true);
  assert.match(
    (await db.collection("commands").findOne({ id: second.data.data.id }))
      .error,
    /Server restarted/,
  );
});
test("incidents acknowledge, resolve, reopen and respect maintenance", async () => {
  const monitor = require("../src/services/monitoring"),
    settings = monitor.DEFAULT_RULES;
  const fixture = { id: "incident-fixture", connectionId: null, processes: [] };
  await monitor.check(fixture, settings);
  const key = `${fixture.id}:offline`;
  const first = await db.collection("incidents").findOne({ key });
  assert.equal(first.resolvedAt, null);
  assert.equal(
    (await api(`/v1/incidents/${encodeURIComponent(key)}/acknowledge`, "POST"))
      .status,
    200,
  );
  const now = new Date().toISOString();
  await monitor.check(
    {
      ...fixture,
      connectionId: "connected",
      connectionLastSeen: now,
      telemetryReceivedAt: now,
    },
    settings,
  );
  assert.ok((await db.collection("incidents").findOne({ key })).resolvedAt);
  await monitor.check(
    {
      ...fixture,
      maintenanceUntil: new Date(Date.now() + 60000).toISOString(),
    },
    settings,
  );
  const reopened = await db.collection("incidents").findOne({ key });
  assert.equal(reopened.acknowledgedAt, null);
  assert.equal(reopened.suppressed, true);
});
test("recovery enforces cooldown, daily budget, and unknown-outcome stop", async () => {
  const Miner = require("../src/models/Miner"),
    recovery = require("../src/services/recovery"),
    commandService = require("../src/services/commands"),
    websocket = require("../src/websocket/server");
  const now = Date.now(),
    stamp = new Date(now).toISOString();
  const rig = await Miner.create({
    systemId: "recovery-fixture",
    connectionId: "simulated",
    bound: true,
    protocolVersion: 2,
    capabilities: { commandResults: true },
    connectionLastSeen: stamp,
    telemetryReceivedAt: stamp,
    recovery: {
      enabled: true,
      zeroSeconds: 300,
      cooldownMinutes: 5,
      maxPerDay: 2,
    },
    processes: [
      {
        id: "cpu",
        deviceType: "CPU",
        type: "xmrig",
        running: true,
        enabled: true,
        quality: "zero",
        hashrate: 0,
        hashrateObservedAt: stamp,
        zeroSince: new Date(now - 301000).toISOString(),
      },
    ],
  });
  commandService.configure(
    () => true,
    () => {},
  );
  try {
    await recovery.check(rig, now);
    await recovery.check(rig, now);
    let rows = await db
      .collection("commands")
      .find({ minerId: rig.id })
      .toArray();
    assert.equal(rows.length, 1);
    await commandService.report(rig.id, {
      id: rows[0].id,
      status: "succeeded",
    });
    await recovery.check(rig, now);
    assert.equal(
      await db.collection("commands").countDocuments({ minerId: rig.id }),
      1,
    );
    await db
      .collection("commands")
      .updateOne(
        { id: rows[0].id },
        { $set: { status: "timed_out", createdAt: new Date(now - 601000) } },
      );
    await recovery.check(rig, now);
    assert.equal(
      await db.collection("commands").countDocuments({ minerId: rig.id }),
      1,
    );
    await db
      .collection("commands")
      .updateOne(
        { id: rows[0].id },
        { $set: { status: "failed" }, $unset: { idempotencyKey: "" } },
      );
    await recovery.check(rig, now);
    rows = await db.collection("commands").find({ minerId: rig.id }).toArray();
    assert.equal(rows.length, 2);
    await db
      .collection("commands")
      .updateMany(
        { minerId: rig.id },
        { $set: { status: "failed", createdAt: new Date(now - 601000) } },
      );
    await recovery.check(rig, now);
    assert.equal(
      await db.collection("commands").countDocuments({ minerId: rig.id }),
      2,
    );
  } finally {
    commandService.configure(websocket.sendToMiner, websocket.broadcast);
    await Miner.delete(rig.id);
  }
});
test("API keys gate all operational routes, enforce permissions and never expose stored secrets", async () => {
  const none = { Authorization: "" };
  for (const path of [
    "/v1/rigs",
    "/v1/fleet/summary",
    "/v1/openapi.json",
    "/miners",
    "/configs",
    "/stats/hashrates-timeseries",
  ])
    assert.equal((await api(path, "GET", undefined, none)).status, 401, path);
  const created = await api("/v1/api-keys", "POST", {
    name: "Read fixture",
    permission: "read",
  });
  assert.equal(created.status, 201);
  const { secret, data } = created.data;
  assert.match(secret, /^mm_/);
  const headers = { Authorization: "", "X-API-Key": secret };
  assert.equal((await api("/v1/rigs", "GET", undefined, headers)).status, 200);
  assert.equal(
    (await api("/v1/commands", "POST", { action: "stop" }, headers)).status,
    403,
  );
  assert.equal(
    (await api("/miners/missing", "DELETE", undefined, headers)).status,
    403,
  );
  assert.equal(
    (
      await api(
        "/v1/api-keys",
        "POST",
        { name: "Escalate", permission: "manage" },
        headers,
      )
    ).status,
    403,
  );
  const listed = await api("/v1/api-keys", "GET", undefined, headers);
  assert.equal(JSON.stringify(listed.data).includes(secret), false);
  assert.equal(JSON.stringify(listed.data).includes("secretHash"), false);
  const stored = await db.collection("apiKeys").findOne({ id: data.id });
  assert.notEqual(stored.secretHash, secret);
  assert.ok(stored.lastUsedAt);
  assert.equal(
    (
      await api("/v1/rigs", "GET", undefined, {
        Authorization: `Bearer ${secret}`,
      })
    ).status,
    200,
  );
  await api(`/v1/api-keys/${data.id}`, "DELETE");
  assert.equal((await api("/v1/rigs", "GET", undefined, headers)).status, 401);
  const manager = (
    await api("/v1/api-keys", "POST", {
      name: "Manager fixture",
      permission: "manage",
    })
  ).data;
  const managedHeaders = { Authorization: `Bearer ${manager.secret}` };
  const rig = await db.collection("miners").findOne({ systemId: "rig-race" });
  assert.equal(
    (
      await api(
        `/v1/rigs/${rig.id}`,
        "PATCH",
        { group: "Key managed" },
        managedHeaders,
      )
    ).status,
    200,
  );
  const event = await db.collection("events").findOne({
    minerId: rig.id,
    kind: "operator-update",
    "details.actor": { $regex: "^api-key:Manager fixture" },
  });
  assert.ok(event);
  await db
    .collection("apiKeys")
    .updateOne(
      { id: manager.data.id },
      { $set: { expiresAt: new Date(Date.now() - 1) } },
    );
  assert.equal(
    (await api("/v1/rigs", "GET", undefined, managedHeaders)).status,
    401,
  );
  assert.equal(
    (
      await api("/v1/api-keys", "POST", {
        name: "Invalid",
        permission: "owner",
      })
    ).status,
    400,
  );
});
test("fleet observers require credentials; revocation ends live access while miner reporting stays public", async () => {
  const anonymous = await socket();
  send(anonymous, "subscribe");
  await waitFor(() =>
    anonymous.messages.some((m) => m.code === "authentication_required"),
  );
  const key = (
    await api("/v1/api-keys", "POST", {
      name: "Live fixture",
      permission: "read",
    })
  ).data;
  const observer = await socket();
  send(observer, "subscribe", { apiKey: key.secret });
  await waitFor(() => observer.messages.some((m) => m.type === "subscribed"));
  require("../src/websocket/server").broadcast({ type: "before-revocation" });
  await waitFor(() =>
    observer.messages.some((m) => m.type === "before-revocation"),
  );
  await api(`/v1/api-keys/${key.data.id}`, "DELETE");
  await waitFor(() => observer.readyState !== 1);
  require("../src/websocket/server").broadcast({ type: "after-revocation" });
  assert.equal(
    observer.messages.some((m) => m.type === "after-revocation"),
    false,
  );
  const agent = await socket();
  send(agent, "register", registration("public-telemetry"));
  await waitFor(() => agent.messages.some((m) => m.type === "bound"));
  const process = {
    id: "cpu",
    deviceType: "CPU",
    running: true,
    hashrate: 99,
    algorithm: "rx/0",
    hashrateObservedAt: new Date().toISOString(),
  };
  send(agent, "status-update", { processes: [process, process] });
  await waitFor(() => agent.messages.some((m) => /unique/.test(m.error || "")));
  const row = await db
    .collection("miners")
    .findOne({ systemId: "public-telemetry" });
  assert.equal(row.telemetryReceivedAt, null);
  send(agent, "status-update", { processes: [process] });
  await waitFor(
    async () =>
      (await db.collection("miners").findOne({ id: row.id })).processes?.[0]
        ?.hashrate === 99,
  );
  await require("../src/websocket/server").forget(row.id);
});
test("incident filters, pagination, rig names and attention agree with the fleet", async () => {
  const Miner = require("../src/models/Miner"),
    now = new Date().toISOString();
  const a = await Miner.create({
    systemId: "scoped-a",
    name: "Alpha hot rig",
    group: "Scope Alpha",
    connectionId: "scope-alpha",
    connectionLastSeen: now,
    telemetryReceivedAt: now,
    processes: [],
  });
  const b = await Miner.create({
    systemId: "scoped-b",
    name: "Beta rig",
    group: "Scope Beta",
  });
  const openedAt = new Date();
  await db.collection("incidents").insertMany([
    {
      key: `${a.id}:temperature`,
      minerId: a.id,
      rule: "temperature",
      message: "Hot CPU",
      severity: "critical",
      openedAt,
      resolvedAt: null,
      suppressed: false,
    },
    {
      key: `${a.id}:rejects`,
      minerId: a.id,
      rule: "rejects",
      message: "Rejected shares",
      severity: "warning",
      openedAt,
      resolvedAt: null,
      suppressed: false,
    },
    {
      key: `${b.id}:offline`,
      minerId: b.id,
      rule: "offline",
      message: "Offline",
      severity: "critical",
      openedAt,
      resolvedAt: null,
      suppressed: false,
    },
  ]);
  const filtered = await api("/v1/rigs?group=Scope%20Alpha&attention=true");
  assert.equal(filtered.data.total, 1);
  assert.equal(filtered.data.data[0].openIncidents.length, 2);
  const sum = await api("/v1/fleet/summary?group=Scope%20Alpha");
  assert.equal(sum.data.counts.attention, 1);
  assert.equal(sum.data.incidents.open, 2);
  const first = await api("/v1/incidents?group=Scope%20Alpha&limit=1");
  const second = await api(
    `/v1/incidents?group=Scope%20Alpha&limit=1&cursor=${first.data.nextCursor}`,
  );
  assert.equal(first.data.data[0].minerName, "Alpha hot rig");
  assert.notEqual(first.data.data[0].key, second.data.data[0].key);
  assert.equal(second.data.nextCursor, null);
  await api(`/v1/rigs/${a.id}`, "PATCH", { archived: true });
  assert.equal(
    (await api("/v1/rigs?status=archived")).data.data.some(
      (r) => r.id === a.id,
    ),
    true,
  );
  assert.equal(
    (await api(`/v1/incidents?minerId=${a.id}&resolved=true`)).data.data.length,
    2,
  );
  await Miner.delete(a.id);
  await Miner.delete(b.id);
});
test("invalid cursor objects and thresholds return 400 rather than server errors", async () => {
  const nullCursor = Buffer.from("null").toString("base64url");
  for (const path of [
    `/v1/rigs?cursor=${nullCursor}`,
    `/v1/logs?cursor=${nullCursor}`,
    "/v1/rigs?order=wrong",
    "/v1/rigs?attention=maybe",
    "/v1/incidents?minerId[$ne]=x",
  ])
    assert.equal((await api(path)).status, 400, path);
  assert.equal(
    (await api("/v1/monitoring/rules", "PUT", { rejectPercent: 101 })).status,
    400,
  );
});
test("cancellation during command preparation prevents dispatch", async () => {
  const service = require("../src/services/commands"),
    Miner = require("../src/models/Miner"),
    websocket = require("../src/websocket/server");
  const rig = await db.collection("miners").findOne({ systemId: "rig-race" });
  const original = Miner.update,
    sent = [];
  service.configure(
    (id, message) => {
      sent.push(message);
      return true;
    },
    () => {},
  );
  Miner.update = async (id, changes, condition) => {
    if (changes["desiredState.CPU"])
      await service.cancel(changes["desiredState.CPU"].commandId);
    return original.call(Miner, id, changes, condition);
  };
  try {
    const command = await service.create(
      rig.id,
      { action: "stop", deviceType: "CPU" },
      "fixture",
    );
    assert.equal(command.status, "canceled");
    assert.equal(
      sent.some((m) => m.type === "command"),
      false,
    );
  } finally {
    Miner.update = original;
    service.configure(websocket.sendToMiner, websocket.broadcast);
  }
});

test("expiration during command preparation prevents dispatch and preserves terminal state", async () => {
  const service = require("../src/services/commands"),
    Miner = require("../src/models/Miner"),
    websocket = require("../src/websocket/server");
  const rig = await db.collection("miners").findOne({ systemId: "rig-race" });
  const original = Miner.update,
    sent = [];
  service.configure(
    (id, message) => {
      sent.push(message);
      return true;
    },
    () => {},
  );
  Miner.update = async (id, changes, condition) => {
    if (changes["desiredState.CPU"])
      await db
        .collection("commands")
        .updateOne(
          { id: changes["desiredState.CPU"].commandId },
          { $set: { deadline: new Date(Date.now() - 1) } },
        );
    return original.call(Miner, id, changes, condition);
  };
  try {
    const response = await api(
      "/v1/commands",
      "POST",
      {
        minerId: rig.id,
        action: "stop",
        deviceType: "CPU",
      },
      { "Idempotency-Key": "expired-preparation" },
    );
    assert.equal(response.status, 202);
    const command = response.data.data;
    assert.equal(command.status, "timed_out");
    assert.match(command.error, /before dispatch/i);
    assert.equal(command.sentAt, undefined);
    assert.deepEqual(
      command.history.map((h) => h.status),
      ["queued", "timed_out"],
    );
    assert.equal(
      sent.some((m) => m.type === "command"),
      false,
    );
    await service.report(rig.id, { id: command.id, status: "succeeded" });
    assert.equal(
      (await api(`/v1/commands/${command.id}`)).data.data.status,
      "timed_out",
    );
    const replay = await api(
      "/v1/commands",
      "POST",
      {
        minerId: rig.id,
        action: "stop",
        deviceType: "CPU",
      },
      { "Idempotency-Key": "expired-preparation" },
    );
    assert.equal(replay.data.data.id, command.id);
    assert.equal(replay.data.data.status, "timed_out");
    assert.equal(
      sent.some((m) => m.type === "command"),
      false,
    );
  } finally {
    Miner.update = original;
    service.configure(websocket.sendToMiner, websocket.broadcast);
  }
});

test("idempotency belongs to the caller so independent integrations do not collide", async () => {
  const commands = require("../src/services/commands");
  const rig = await db.collection("miners").findOne({ systemId: "rig-race" });
  const input = { action: "stop", deviceType: "CPU" };
  const one = await commands.create(
    rig.id,
    input,
    "integration-one",
    "same-key",
  );
  const two = await commands.create(
    rig.id,
    input,
    "integration-two",
    "same-key",
  );
  assert.notEqual(one.id, two.id);
  assert.equal(
    (await commands.create(rig.id, input, "integration-one", "same-key")).id,
    one.id,
  );
  await commands.cancel(one.id);
  await commands.cancel(two.id);
  const first = await commands.bulk(
    [rig.id],
    input,
    "integration-one",
    "same-batch",
  );
  const second = await commands.bulk(
    [rig.id],
    input,
    "integration-two",
    "same-batch",
  );
  assert.notEqual(first.batchId, second.batchId);
  await commands.cancel(first.results[0].command.id);
  await commands.cancel(second.results[0].command.id);
});
test("stopping closes history without inventing a measured zero sample", async () => {
  const rig = await db.collection("miners").findOne({ systemId: "rig-race" });
  const agent = sockets.find(
    (s) =>
      s.readyState === 1 && s.messages.some((m) => m.data?.minerId === rig.id),
  );
  const p = {
    id: "stop-fixture",
    deviceType: "CPU",
    running: true,
    hashrate: 100,
    algorithm: "rx/0",
    hashrateObservedAt: new Date(Date.now() - 3000).toISOString(),
  };
  send(agent, "status-update", { processes: [p] });
  await waitFor(
    async () =>
      (await db.collection("miners").findOne({ id: rig.id })).processes?.[0]
        ?.id === p.id,
  );
  send(agent, "status-update", {
    processes: [{ ...p, running: false, hashrate: 0 }],
  });
  await waitFor(
    async () =>
      (await db.collection("miners").findOne({ id: rig.id })).processes?.[0]
        ?.running === false,
  );
  const raw = await db
    .collection("hashrates")
    .find({ minerId: rig.id, processId: p.id })
    .toArray();
  assert.deepEqual(
    raw.map((r) => r.hashrate),
    [100],
  );
  assert.ok(
    (
      await db
        .collection("hashrateBuckets")
        .findOne({ minerId: rig.id, processId: p.id })
    ).coveredMs > 0,
  );
});

test("a failed rig check does not prevent monitoring the rest of the fleet", async () => {
  const Miner = require("../src/models/Miner"),
    monitoring = require("../src/services/monitoring"),
    websocket = require("../src/websocket/server");
  const originalAll = Miner.getAll,
    originalById = Miner.getById,
    originalCheck = monitoring.check;
  const ids = ["sweep-bad", "sweep-good"],
    visited = [];
  Miner.getAll = async () => ids.map((id) => ({ id, systemId: id }));
  Miner.getById = async (id) =>
    ids.includes(id) ? { id, processes: [] } : originalById.call(Miner, id);
  monitoring.check = async (rig) => {
    visited.push(rig.id);
    if (rig.id === ids[0]) throw Error("Synthetic per-rig failure");
  };
  try {
    await websocket.sweep();
    assert.deepEqual(visited, ids);
    assert.equal(websocket.monitoringStatus().status, "degraded");
    assert.equal(websocket.monitoringStatus().failedRigs, 1);
    assert.equal((await api("/v1/health")).data.monitoring.status, "degraded");
  } finally {
    Miner.getAll = originalAll;
    Miner.getById = originalById;
    monitoring.check = originalCheck;
  }
});

test("OpenAPI describes every v1 route and invalid ranges return client errors", async () => {
  const description = (await api("/v1/openapi.json")).data;
  const routes = require("../src/api/v1")
    .stack.filter((l) => l.route)
    .map((l) => l.route);
  for (const route of routes)
    for (const method of Object.keys(route.methods)) {
      const specPath = route.path.replace(/:([a-zA-Z]+)/g, "{$1}");
      assert.ok(
        description.paths[specPath]?.[method],
        `${method} ${specPath} missing`,
      );
    }
  assert.equal((await api("/v1/rigs?limit=0")).status, 400);
  assert.equal(
    (await api("/v1/rigs?includeArchived=&includeForgotten=&attention="))
      .status,
    200,
  );
  assert.equal(
    (await api("/v1/metrics/hashrate?timeframe=90d&resolution=60")).status,
    400,
  );
  assert.equal((await api("/v1/logs?from=not-a-date")).status, 400);
});
test("logs and events paginate stably across equal timestamps and retain history on forget", async () => {
  const rig = await db.collection("miners").findOne({ systemId: "rig-race" }),
    timestamp = new Date();
  await db.collection("logs").insertMany(
    Array.from({ length: 4 }, (_, i) => ({
      minerId: rig.id,
      timestamp,
      message: `fixture ${i}`,
      level: "info",
    })),
  );
  const first = await api(`/v1/logs?minerId=${rig.id}&limit=2`),
    second = await api(
      `/v1/logs?minerId=${rig.id}&limit=2&cursor=${first.data.nextCursor}`,
    );
  assert.equal(
    new Set([...first.data.data, ...second.data.data].map((x) => x._id)).size,
    4,
  );
  assert.equal((await api(`/v1/rigs/${rig.id}`, "DELETE")).status, 200);
  assert.equal(
    await db.collection("logs").countDocuments({ minerId: rig.id }),
    4,
  );
  const reconnect = await socket();
  send(reconnect, "register", registration("rig-race"));
  await waitFor(() =>
    reconnect.messages.some((m) => /forgotten/.test(m.error || "")),
  );
  assert.equal((await api("/v1/rigs")).data.total, 0);
});
test("miner repair is capability-gated, acknowledged, and available through the management API", async () => {
  const ws = await socket();
  send(ws, "register", registration("maintenance-capability-test"));
  const bound = await waitFor(() =>
    ws.messages.find((m) => ["bound", "registered"].includes(m.type)),
  );
  const minerId = bound.data.minerId;
  let response = await api("/v1/commands", "POST", {
    minerId,
    action: "miner-repair",
    deviceType: "CPU",
  });
  assert.equal(response.status, 422);
  await db
    .collection("miners")
    .updateOne(
      { id: minerId },
      { $set: { "capabilities.minerMaintenance": true } },
    );
  response = await api("/v1/commands", "POST", {
    minerId,
    action: "miner-repair",
    deviceType: "CPU",
  });
  assert.equal(response.status, 202);
  const received = await waitFor(() =>
    ws.messages.find(
      (m) => m.type === "command" && m.data.action === "miner-repair",
    ),
  );
  assert.equal(received.data.timeoutSeconds, 300);
  send(ws, "command-result", {
    id: received.data.id,
    status: "succeeded",
    result: {
      processes: [
        { id: "xmrig-1", diagnostic: { status: "ready", version: "6.26.0" } },
      ],
    },
  });
  await waitFor(
    async () =>
      (await db.collection("commands").findOne({ id: received.data.id }))
        .status === "succeeded",
  );
  send(ws, "status-update", {
    protocolVersion: 2,
    processes: [
      {
        id: "xmrig-1",
        type: "xmrig",
        deviceType: "CPU",
        running: false,
        diagnostic: { status: "ready", version: "6.26.0" },
      },
    ],
  });
  await waitFor(
    async () =>
      (await db.collection("miners").findOne({ id: minerId })).processes?.[0]
        ?.diagnostic?.version === "6.26.0",
  );
  const detail = await api(`/v1/rigs/${minerId}`);
  assert.equal(detail.data.data.processes[0].diagnostic.status, "ready");
});

test("CPU engine rollout gates old agents, delivers Nanominer to capable agents, and preserves legacy choices", async () => {
  const Config = require("../src/models/Config");
  const previous = await Config.get("xmrig");
  await Config.update(
    "xmrig",
    {
      ...Config.DEFAULTS.xmrig,
      pool: "fixture.pool:3333",
      user: "fixture-wallet",
    },
    "test",
    previous.version,
  );
  const old = await socket();
  send(old, "register", {
    ...registration("legacy-cpu-engine"),
    capabilities: { commandResults: true },
  });
  const oldBound = await waitFor(() =>
    old.messages.find((m) => m.type === "bound"),
  );
  assert.equal(oldBound.data.configs.xmrig, undefined);
  assert.equal(
    (
      await api("/v1/commands", "POST", {
        minerId: oldBound.data.minerId,
        action: "start",
        deviceType: "CPU",
      })
    ).status,
    422,
  );
  const modern = await socket();
  send(modern, "register", registration("dual-cpu-engine"));
  const bound = await waitFor(() =>
    modern.messages.find((m) => m.type === "bound"),
  );
  assert.equal(bound.data.configs.xmrig.engine, "nanominer");
  const response = await api("/v1/commands", "POST", {
    minerId: bound.data.minerId,
    action: "start",
    deviceType: "CPU",
  });
  assert.equal(response.status, 202);
  const command = await waitFor(() =>
    modern.messages.find((m) => m.type === "command"),
  );
  send(modern, "command-result", {
    id: command.data.id,
    status: "succeeded",
    result: {
      processes: [{ id: "xmrig-1", engine: "nanominer", running: true }],
    },
  });
  await waitFor(
    async () =>
      (await db.collection("commands").findOne({ id: command.data.id }))
        .status === "succeeded",
  );
  const stored = await db.collection("configs").findOne({ _id: "global" });
  await db
    .collection("configs")
    .updateOne({ _id: "global" }, { $unset: { "xmrig.engine": "" } });
  assert.equal((await Config.get("xmrig")).engine, "xmrig");
  await db.collection("configs").replaceOne({ _id: "global" }, stored);
});

test("admin app install waits for a new matching-version registration and rejects unsupported agents", async () => {
  const ws = await socket();
  const reg = {
    ...registration("update-rig"),
    version: "1.3.0+test",
    bootId: "before",
    capabilities: { ...registration("x").capabilities, appUpdates: true },
  };
  send(ws, "register", reg);
  const bound = await waitFor(() =>
    ws.messages.find((m) => m.type === "bound"),
  );
  const id = bound.data.minerId;
  assert.equal(
    (
      await api("/v1/commands", "POST", {
        minerId: id,
        action: "app-update-install",
        deviceType: "CPU",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await api("/v1/commands", "POST", {
        minerId: id,
        action: "app-update-install",
        deviceType: "ALL",
      })
    ).status,
    409,
  );
  send(ws, "status-update", {
    processes: [],
    appUpdate: {
      state: "downloaded",
      version: "1.3.1",
      supported: true,
      updatedAt: new Date().toISOString(),
    },
  });
  await waitFor(
    async () =>
      (await db.collection("miners").findOne({ id })).appUpdate?.state ===
      "downloaded",
  );
  const created = await api("/v1/commands", "POST", {
    minerId: id,
    action: "app-update-install",
    deviceType: "ALL",
  });
  assert.equal(created.status, 202);
  const cmd = await waitFor(() =>
    ws.messages.find(
      (m) => m.type === "command" && m.data.action === "app-update-install",
    ),
  );
  assert.equal(cmd.data.targetVersion, "1.3.1");
  send(ws, "command-result", {
    id: cmd.data.id,
    status: "succeeded",
    result: { phase: "installer-handoff" },
  });
  await waitFor(
    async () =>
      (await db.collection("commands").findOne({ id: cmd.data.id })).status ===
      "running",
  );
  const same = await socket();
  send(same, "register", { ...reg, bootId: "same-version-reboot" });
  await waitFor(() => same.messages.some((m) => m.type === "bound"));
  assert.equal(
    (await db.collection("commands").findOne({ id: cmd.data.id })).status,
    "running",
  );
  const updated = await socket();
  send(updated, "register", {
    ...reg,
    version: "1.3.1+verified",
    bootId: "after",
  });
  await waitFor(() => updated.messages.some((m) => m.type === "bound"));
  const complete = await db.collection("commands").findOne({ id: cmd.data.id });
  assert.equal(complete.status, "succeeded");
  assert.equal(complete.result.phase, "version-confirmed");
  const old = await socket();
  send(old, "register", registration("old-update-rig"));
  const oldBound = await waitFor(() =>
    old.messages.find((m) => m.type === "bound"),
  );
  assert.equal(
    (
      await api("/v1/commands", "POST", {
        minerId: oldBound.data.minerId,
        action: "app-update-check",
        deviceType: "ALL",
      })
    ).status,
    422,
  );
});

test("reconnecting zero-rate rigs reset recovery continuity and API retains sensor observation times", async () => {
  const ws = await socket();
  send(ws, "register", registration("continuous-zero-fixture"));
  await waitFor(() => ws.messages.find((m) => m.type === "bound"));
  const rig = await db
    .collection("miners")
    .findOne({ systemId: "continuous-zero-fixture" });
  const observed = new Date().toISOString();
  const old = new Date(Date.now() - 120000).toISOString();
  const process = {
    id: "xmrig-1",
    type: "xmrig",
    deviceType: "CPU",
    running: true,
    enabled: true,
    pid: 10,
    algorithm: "rx/0",
    hashrate: 0,
    hashrateObservedAt: observed,
    startedAt: old,
  };
  send(ws, "status-update", { processes: [process] });
  await waitFor(
    async () =>
      (await db.collection("miners").findOne({ id: rig.id })).processes?.length,
  );
  await db
    .collection("miners")
    .updateOne({ id: rig.id }, { $set: { "processes.0.zeroSince": old } });
  const next = await socket();
  send(next, "register", registration("continuous-zero-fixture"));
  await waitFor(() => next.messages.find((m) => m.type === "bound"));
  send(next, "status-update", {
    processes: [process],
    stats: {
      observedAt: observed,
      cpu: {
        usage: 30,
        observedAt: observed,
        temperature: 95,
        temperatureObservedAt: old,
      },
    },
  });
  await waitFor(
    async () =>
      (await db.collection("miners").findOne({ id: rig.id }))
        .telemetryReceivedAt,
  );
  const response = await api(`/v1/rigs/${rig.id}`);
  assert.equal(response.status, 200);
  const result = response.data.data;
  assert.equal(result.processes[0].zeroSince, observed);
  assert.equal(result.stats.cpu.usage, 30);
  assert.equal(result.stats.cpu.temperature, null);
  assert.equal(result.stats.cpu.temperatureObservedAt, old);
});

test("a restart completing during supersession cannot prevent a newer whole-rig Stop", async () => {
  const ws = await socket();
  send(ws, "register", registration("stop-completion-race"));
  const bound = await waitFor(() =>
    ws.messages.find((m) => m.type === "bound"),
  );
  const id = bound.data.minerId;
  const restart = await api("/v1/commands", "POST", {
    minerId: id,
    action: "restart",
    deviceType: "CPU",
  });
  assert.equal(restart.status, 202);
  const original = db.collection;
  let raced = false;
  db.collection = function (name, ...args) {
    const collection = original.call(this, name, ...args);
    if (name === "commands") {
      const update = collection.findOneAndUpdate.bind(collection);
      collection.findOneAndUpdate = async (filter, change, options) => {
        if (
          !raced &&
          filter.id === restart.data.data.id &&
          change.$set?.status === "canceled"
        ) {
          raced = true;
          await collection.updateOne(
            { id: filter.id },
            { $set: { status: "succeeded" } },
          );
        }
        return update(filter, change, options);
      };
    }
    return collection;
  };
  let stop;
  try {
    stop = await api("/v1/commands", "POST", {
      minerId: id,
      action: "stop",
      deviceType: "ALL",
    });
  } finally {
    db.collection = original;
  }
  assert.equal(raced, true);
  assert.equal(stop.status, 202);
  await waitFor(() =>
    ws.messages.find(
      (m) => m.type === "command" && m.data.id === stop.data.data.id,
    ),
  );
  const rig = await original.call(db, "miners").findOne({ id });
  for (const scope of ["ALL", "CPU", "GPU"]) {
    assert.equal(rig.desiredState[scope].commandId, stop.data.data.id);
    assert.equal(rig.desiredState[scope].state, "stopped");
  }
});

test("attention=false agrees across fleet, summary and incident API views", async () => {
  const Miner = require("../src/models/Miner");
  const stamp = new Date().toISOString();
  const base = {
    group: "Attention regression",
    bound: true,
    connectionId: "synthetic",
    connectionLastSeen: stamp,
    telemetryReceivedAt: stamp,
    processes: [],
  };
  const quiet = await Miner.create({
    ...base,
    systemId: "quiet-attention",
    connectionId: "quiet-attention-connection",
    name: "Quiet",
  });
  const flagged = await Miner.create({
    ...base,
    systemId: "flagged-attention",
    connectionId: "flagged-attention-connection",
    name: "Flagged",
  });
  try {
    await db.collection("incidents").insertOne({
      key: `${flagged.id}:temperature`,
      minerId: flagged.id,
      rule: "temperature",
      message: "Synthetic active incident",
      resolvedAt: null,
      suppressed: false,
      openedAt: new Date(),
      severity: "critical",
    });
    const query = "group=Attention%20regression&attention=false";
    const rigs = await api(`/v1/rigs?${query}`);
    assert.deepEqual(
      rigs.data.data.map((r) => r.id),
      [quiet.id],
    );
    const summary = await api(`/v1/fleet/summary?${query}`);
    assert.equal(summary.data.counts.total, 1);
    assert.equal(summary.data.counts.attention, 0);
    assert.equal((await api(`/v1/incidents?${query}`)).data.data.length, 0);
    assert.equal(
      (await api("/v1/rigs?group=Attention%20regression&attention=true")).data
        .data[0].id,
      flagged.id,
    );
  } finally {
    await Miner.delete(quiet.id);
    await Miner.delete(flagged.id);
  }
});

test("SRBMiner configuration, capability gates, telemetry and failed command receipts agree through the API", async () => {
  const Config = require("../src/models/Config");
  const previous = await Config.get("nanominer");
  let ids = [];
  try {
    const saved = await api("/v1/configs/nanominer", "PUT", {
      ...previous,
      engine: "srbminer",
      algorithm: "pearlhash",
      coin: "PRL",
      pool: "pool.test:3333",
      user: "test-wallet",
      password: "x",
      srbGpuIntensity: 19,
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    const catalog = await api("/v1/mining/engines");
    assert.equal(catalog.status, 200);
    assert.equal(catalog.data.data.srbminer.version, "3.6.7");
    assert.equal(
      catalog.data.data.srbminer.algorithms.find(
        (a) => a.algorithm === "pearlhash",
      ).fee,
      2,
    );
    assert.equal((await fetch(origin + "/api/v1/mining/engines")).status, 401);
    const legacy = await socket(),
      capable = await socket();
    send(legacy, "register", registration("srb-legacy"));
    send(capable, "register", {
      ...registration("srb-capable"),
      capabilities: {
        commandResults: true,
        minerMaintenance: true,
        cpuEngines: ["xmrig", "nanominer", "srbminer"],
        gpuEngines: ["nanominer", "srbminer"],
      },
    });
    const oldBind = await waitFor(() =>
      legacy.messages.find((m) => m.type === "bound"),
    );
    const newBind = await waitFor(() =>
      capable.messages.find((m) => m.type === "bound"),
    );
    ids = [oldBind.data.minerId, newBind.data.minerId];
    assert.equal(oldBind.data.configs.nanominer, undefined);
    await waitFor(() => legacy.messages.find((m) => m.type === "error"));
    assert.equal(newBind.data.configs.nanominer.engine, "srbminer");
    assert.equal(newBind.data.configs.nanominer.srbGpuIntensity, 19);
    for (const action of ["start", "restart", "config-update", "device-enable"])
      assert.equal(
        (
          await api("/v1/commands", "POST", {
            minerId: ids[0],
            action,
            deviceType: "GPU",
          })
        ).status,
        422,
      );
    const apply = await api("/v1/configs/nanominer/apply", "POST", {
      minerIds: [ids[1]],
    });
    assert.equal(apply.status, 202);
    const command = apply.data.results[0].command;
    const dispatch = await waitFor(() =>
      capable.messages.find(
        (m) => m.type === "command" && m.data.id === command.id,
      ),
    );
    assert.equal(dispatch.data.configs.nanominer.algorithm, "pearlhash");
    assert.equal(dispatch.data.deviceType, "GPU");
    send(capable, "command-result", {
      id: command.id,
      status: "succeeded",
      result: { configured: true },
    });
    await waitFor(
      async () =>
        (await api(`/v1/commands/${command.id}`)).data.data.status ===
        "succeeded",
    );
    const stamp = new Date().toISOString();
    send(capable, "status-update", {
      protocolVersion: 2,
      processes: [
        {
          id: "nanominer-1",
          type: "nanominer",
          engine: "srbminer",
          deviceType: "GPU",
          running: true,
          enabled: true,
          algorithm: "pearlhash",
          hashrate: 65e12,
          hashrateObservedAt: stamp,
          startedAt: stamp,
          activeConfig: saved.data.data,
          effectiveSettings: { devFeePercent: 2 },
        },
      ],
    });
    await waitFor(
      async () =>
        (await api(`/v1/rigs/${ids[1]}/devices`)).data.processes?.[0]
          ?.engine === "srbminer",
    );
    const device = (await api(`/v1/rigs/${ids[1]}/devices`)).data.processes[0];
    assert.equal(device.hashrate, 65e12);
    assert.equal(device.algorithm, "pearlhash");
    assert.equal(device.effectiveSettings.devFeePercent, 2);
    const start = await api("/v1/commands", "POST", {
      minerId: ids[1],
      action: "restart",
      deviceType: "GPU",
    });
    const requested = start.data.data;
    await waitFor(() =>
      capable.messages.find(
        (m) => m.type === "command" && m.data.id === requested.id,
      ),
    );
    send(capable, "command-result", {
      id: requested.id,
      status: "failed",
      error: "SRBMiner reports this GPU is unsupported",
    });
    await waitFor(
      async () =>
        (await api(`/v1/commands/${requested.id}`)).data.data.status ===
        "failed",
    );
    assert.match(
      (await api(`/v1/commands/${requested.id}`)).data.data.error,
      /unsupported/,
    );
    // Re-registration must keep the SRBMiner assignment and its engine identity.
    send(capable, "register", {
      ...registration("srb-capable"),
      silent: true,
      capabilities: {
        commandResults: true,
        cpuEngines: ["xmrig", "nanominer", "srbminer"],
        gpuEngines: ["nanominer", "srbminer"],
      },
    });
    const rebound = await waitFor(() =>
      capable.messages.find((m) => m.type === "registered"),
    );
    assert.equal(rebound.data.configs.nanominer.engine, "srbminer");
  } finally {
    const current = await Config.get("nanominer");
    await Config.update(
      "nanominer",
      { ...previous, version: current.version },
      "test-restore",
      current.version,
    );
    for (const id of ids) await require("../src/models/Miner").delete(id);
  }
});

test("management keys can organize and stop a rig despite missing GPU inventory", async () => {
  const client = await socket();
  const data = registration("inventory-failure-rig");
  data.systemInfo.gpus = [];
  send(client, "register", data);
  const bound = await waitFor(() =>
    client.messages.find((m) => m.type === "bound"),
  );
  const id = bound.data.minerId;
  const key = (
    await api("/v1/api-keys", "POST", {
      name: "inventory-control",
      permission: "manage",
    })
  ).data;
  const headers = { Authorization: `Bearer ${key.secret}` };
  try {
    const updated = await api(
      `/v1/rigs/${id}`,
      "PATCH",
      { group: "remote-workshop-unique", tags: ["test-rig"] },
      headers,
    );
    assert.equal(updated.status, 200);
    const rigs = await api(
      "/v1/rigs?q=remote-workshop-unique",
      "GET",
      undefined,
      headers,
    );
    assert.deepEqual(
      rigs.data.data.map((r) => r.id),
      [id],
    );
    const summary = await api(
      "/v1/fleet/summary?q=remote-workshop-unique",
      "GET",
      undefined,
      headers,
    );
    assert.equal(summary.data.counts.total, 1);
    assert.equal(
      (
        await api(
          "/v1/commands",
          "POST",
          { minerId: id, action: "start", deviceType: "GPU" },
          headers,
        )
      ).status,
      422,
    );
    const stopped = await api(
      "/v1/commands",
      "POST",
      { minerId: id, action: "stop", deviceType: "GPU" },
      headers,
    );
    assert.equal(stopped.status, 202);
    const command = stopped.data.data;
    await waitFor(() =>
      client.messages.find(
        (m) => m.type === "command" && m.data.id === command.id,
      ),
    );
    send(client, "command-result", {
      id: command.id,
      status: "succeeded",
      result: { processes: [{ id: "nanominer-1", running: false }] },
    });
    await waitFor(
      async () =>
        (await api(`/v1/commands/${command.id}`, "GET", undefined, headers))
          .data.data.status === "succeeded",
    );
    await api(`/v1/api-keys/${key.data.id}`, "DELETE");
    assert.equal(
      (await api("/v1/rigs", "GET", undefined, headers)).status,
      401,
    );
  } finally {
    await require("../src/models/Miner").delete(id);
    await api(`/v1/api-keys/${key.data.id}`, "DELETE");
  }
});

test("database failures are unavailable responses, never successful empty data", async () => {
  await require("../src/db/mongodb").disconnect();
  assert.equal((await api("/v1/rigs")).status, 503);
  assert.equal((await api("/health")).status, 503);
  assert.equal((await api("/live")).status, 200);
  assert.equal((await fetch(origin + "/")).status, 404); // Development shell routing remains independent of MongoDB.
});
