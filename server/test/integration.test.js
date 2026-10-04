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
    timestamp: Date.now() - 180000,
    processes: [
      {
        id: "xmrig-1",
        type: "xmrig",
        deviceType: "CPU",
        running: false,
        diagnostic: {
          status: "ready",
          version: "6.26.0",
          stage: "file verification",
          syscall: "open",
          windows: {
            status: "available",
            checkedPaths: ["C:\\MineMaster\\miners\\srbminer\\fixture.zip"],
            detections: [],
          },
          unexpectedSecret: "never persist",
        },
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
  assert.equal(
    detail.data.data.processes[0].diagnostic.stage,
    "file verification",
  );
  assert.equal(detail.data.data.processes[0].diagnostic.syscall, "open");
  assert.deepEqual(
    detail.data.data.processes[0].diagnostic.windows.checkedPaths,
    ["C:\\MineMaster\\miners\\srbminer\\fixture.zip"],
  );
  assert.equal(
    detail.data.data.processes[0].diagnostic.unexpectedSecret,
    undefined,
  );
  assert.equal(detail.data.data.clockWarning, null);
  assert.ok(detail.data.data.agentClock.differenceSeconds >= 180);
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
      autoInstall: true,
      updatedAt: new Date().toISOString(),
    },
  });
  await waitFor(
    async () =>
      (await db.collection("miners").findOne({ id })).appUpdate?.state ===
      "downloaded",
  );
  assert.equal(
    (await db.collection("miners").findOne({ id })).appUpdate.autoInstall,
    true,
  );
  assert.equal(
    (await api(`/v1/rigs/${id}`)).data.data.appUpdate.autoInstall,
    true,
  );
  assert.equal(
    (
      await api("/v1/commands", "POST", {
        minerId: id,
        action: "app-update-install",
        deviceType: "ALL",
        targetVersion: "1.4.7",
      })
    ).status,
    409,
  );
  assert.equal(
    await db
      .collection("commands")
      .countDocuments({ minerId: id, action: "app-update-install" }),
    0,
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
    result: { update: { phase: "installer-handoff" } },
  });
  await waitFor(
    async () =>
      (await db.collection("commands").findOne({ id: cmd.data.id })).status ===
      "running",
  );
  await require("../src/services/commands").expire(true);
  assert.equal(
    (await db.collection("commands").findOne({ id: cmd.data.id })).status,
    "running",
  );
  const expired = {
    ...(await db.collection("commands").findOne({ id: cmd.data.id })),
    _id: new ObjectId(),
    id: "expired-install-handoff",
    deadline: new Date(Date.now() - 1),
  };
  await db.collection("commands").insertOne(expired);
  await require("../src/services/commands").expire(true);
  assert.equal(
    (await db.collection("commands").findOne({ id: expired.id })).status,
    "timed_out",
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
    assert.equal(catalog.data.data.srbminer.version, "3.7.1");
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

test("activity sorting puts mining before online and offline across cursor pages", async () => {
  const now = new Date().toISOString(),
    group = "activity-sort-fixture";
  await db.collection("miners").insertMany([
    {
      id: "sort-offline",
      systemId: "sort-offline",
      name: "AAA",
      group,
      lastSeen: now,
      processes: [],
    },
    {
      id: "sort-idle",
      systemId: "sort-idle",
      name: "BBB",
      group,
      lastSeen: now,
      connectionId: "sort-idle-connection",
      connectionLastSeen: now,
      telemetryReceivedAt: now,
      processes: [],
    },
    {
      id: "sort-mining",
      systemId: "sort-mining",
      name: "ZZZ",
      group,
      lastSeen: now,
      connectionId: "sort-mining-connection",
      connectionLastSeen: now,
      telemetryReceivedAt: now,
      processes: [{ id: "cpu", running: true, deviceType: "CPU" }],
    },
  ]);
  let cursor = "",
    ids = [];
  do {
    const result = await api(
      `/v1/rigs?group=${group}&sort=activity&limit=1${cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}`,
    );
    assert.equal(result.status, 200);
    ids.push(...result.data.data.map((r) => r.id));
    cursor = result.data.nextCursor;
  } while (cursor);
  assert.deepEqual(ids, ["sort-mining", "sort-idle", "sort-offline"]);
  const reverse = await api(`/v1/rigs?group=${group}&sort=activity&order=desc`);
  assert.deepEqual(
    reverse.data.data.map((r) => r.id),
    [...ids].reverse(),
  );
});

test("repeated current-run miner errors produce actionable incidents with shared API filtering", async (t) => {
  const monitoring = require("../src/services/monitoring");
  const now = Date.now();
  const id = "fixture-repeated-errors";
  const at = (ms) => new Date(ms).toISOString();
  const process = {
    id: "nanominer-1",
    type: "nanominer",
    engine: "nanominer",
    deviceType: "GPU",
    running: true,
    enabled: true,
    startedAt: at(now - 120000),
    algorithm: "kawpow",
    hashrate: 36519,
    hashrateObservedAt: at(now),
    quality: "valid",
  };
  const rig = {
    id,
    name: "Repeated errors fixture",
    group: "error-fixture",
    connectionId: "fixture-error-socket",
    connectionLastSeen: at(now),
    telemetryReceivedAt: at(now),
    processes: [process],
  };
  await db.collection("miners").insertOne(rig);
  t.after(async () => {
    await db.collection("miners").deleteOne({ id });
    for (const collection of ["logs", "incidents", "events"])
      await db.collection(collection).deleteMany({ minerId: id });
  });
  const logs = (observedAt, overrides = {}) =>
    Array.from({ length: 3 }, () => ({
      minerId: id,
      processId: process.id,
      timestamp: new Date(now),
      observedAt: new Date(observedAt),
      level: "error",
      message: "GPU 1 OpenCL call error -49(106)",
      ...overrides,
    }));
  const active = () =>
    db
      .collection("incidents")
      .findOne({ minerId: id, rule: "miner_errors", resolvedAt: null });
  // Old runs, unknown observation time, and other process output cannot trigger it.
  await db
    .collection("logs")
    .insertMany([
      ...logs(now - 130000),
      ...logs(now, { observedAt: null }),
      ...logs(now, { processId: "old-process" }),
    ]);
  await monitoring.check(rig, monitoring.DEFAULT_RULES, now);
  assert.equal(await active(), null);
  await db.collection("logs").insertMany(logs(now - 1000));
  await monitoring.check(rig, monitoring.DEFAULT_RULES, now);
  assert.match((await active()).message, /nanominer-1.*OpenCL/);
  const query = "q=error-fixture&attention=true";
  assert.equal((await api(`/v1/rigs?${query}`)).data.total, 1);
  assert.equal((await api(`/v1/fleet/summary?${query}`)).data.counts.total, 1);
  assert.equal((await api(`/v1/incidents?${query}`)).data.data.length, 1);
  await monitoring.check(
    { ...rig, maintenanceUntil: at(now + 60000) },
    monitoring.DEFAULT_RULES,
    now,
  );
  assert.equal((await active()).suppressed, true);
  for (const update of [
    { paused: true },
    { running: false },
    { startedAt: at(now + 1) },
  ]) {
    await monitoring.check(
      { ...rig, processes: [{ ...process, ...update }] },
      monitoring.DEFAULT_RULES,
      now,
    );
    assert.equal(await active(), null);
    await monitoring.check(rig, monitoring.DEFAULT_RULES, now);
    assert.ok(await active());
  }
  await monitoring.check(
    rig,
    { ...monitoring.DEFAULT_RULES, miner_errors: false },
    now,
  );
  assert.equal(await active(), null);
  await monitoring.check(rig, monitoring.DEFAULT_RULES, now);
  const later = now + 6 * 60000;
  await monitoring.check(
    { ...rig, connectionLastSeen: at(later), telemetryReceivedAt: at(later) },
    monitoring.DEFAULT_RULES,
    later,
  );
  assert.equal(await active(), null);
});

test("saved coin profiles isolate drafts, preserve snapshots and enforce access and concurrency", async () => {
  const before = (await api("/v1/configs")).data.data;
  const commandsBefore = await db.collection("commands").countDocuments();
  const profile = {
    name: "Quantus fixture",
    type: "nanominer",
    config: {
      engine: "srbminer",
      algorithm: "quantus",
      coin: "QTC",
      pool: "qtc-us.kryptex.network:7049",
      user: "synthetic-wallet",
    },
  };
  const denied = { Authorization: "" };
  assert.equal(
    (await api("/v1/config-profiles", "GET", undefined, denied)).status,
    401,
  );
  const key = (
    await api("/v1/api-keys", "POST", {
      name: "Profile read",
      permission: "read",
    })
  ).data;
  const read = { Authorization: "", "X-API-Key": key.secret };
  assert.equal(
    (await api("/v1/config-profiles", "POST", profile, read)).status,
    403,
  );
  assert.equal(
    (
      await api("/v1/config-profiles", "POST", {
        ...profile,
        config: { ...profile.config, user: "" },
      })
    ).status,
    400,
  );
  assert.equal(
    (await api("/v1/config-profiles", "POST", { ...profile, type: "xmrig" }))
      .status,
    400,
  );
  const created = await api("/v1/config-profiles", "POST", profile);
  assert.equal(created.status, 201);
  const saved = created.data.data,
    url = `/v1/config-profiles/${saved.id}`;
  assert.deepEqual(saved.config.backupPools, []);
  assert.equal(saved.config.tls, false);
  assert.equal(saved.config.password, "x");
  assert.equal(saved.config.version, undefined);
  assert.equal(
    (await api(url, "GET", undefined, read)).data.data.name,
    profile.name,
  );
  assert.ok(
    (await api("/v1/config-profiles?type=nanominer")).data.data.some(
      (r) => r.id === saved.id,
    ),
  );
  assert.equal(
    (await api("/v1/config-profiles?type=xmrig")).data.data.some(
      (r) => r.id === saved.id,
    ),
    false,
  );
  assert.equal((await api("/v1/config-profiles?type=invalid")).status, 400);
  for (const method of ["PUT", "DELETE"])
    assert.equal((await api(url, method, profile, read)).status, 403);
  assert.equal((await api(url, "PUT", profile)).status, 428);
  const changed = {
    ...profile,
    name: "Pearl fixture",
    config: {
      ...profile.config,
      algorithm: "pearlhash",
      coin: "PRL",
      pool: "prl-us.kryptex.network:7048",
    },
  };
  const updated = await api(url, "PUT", changed, { "If-Match": saved.version });
  assert.equal(updated.status, 200);
  assert.notEqual(updated.data.data.version, saved.version);
  assert.equal(
    (await api(url, "PUT", profile, { "If-Match": saved.version })).status,
    409,
  );
  assert.equal(
    (await api(url, "DELETE", undefined, { "If-Match": saved.version })).status,
    409,
  );
  assert.deepEqual((await api("/v1/configs")).data.data, before);
  assert.equal(
    await db.collection("commands").countDocuments(),
    commandsBefore,
  );
  await api(`/v1/api-keys/${key.data.id}`, "DELETE");
  assert.equal((await api(url, "GET", undefined, read)).status, 401);
  assert.equal(
    (
      await api(url, "DELETE", undefined, {
        "If-Match": updated.data.data.version,
      })
    ).status,
    200,
  );
  assert.equal((await api(url)).status, 404);
});

test("direct profile delivery isolates the selected GPU assignment and captures a versioned snapshot", async () => {
  const ws = await socket();
  const reg = registration("profile-target");
  reg.capabilities.gpuEngines = ["nanominer", "srbminer"];
  send(ws, "register", reg);
  await waitFor(() => ws.messages.some((m) => m.type === "bound"));
  const rig = await db.collection("miners").findOne({ systemId: reg.systemId });
  const defaults = (await api("/v1/configs")).data.data;
  const cpu = rig.desiredConfigs.xmrig;
  const profile = (
    await api("/v1/config-profiles", "POST", {
      name: "Direct Quantus",
      type: "nanominer",
      config: {
        engine: "srbminer",
        algorithm: "quantus",
        coin: "QTC",
        pool: "pool.example:1234",
        user: "fixture-wallet",
      },
    })
  ).data.data;
  const url = `/v1/config-profiles/${profile.id}/apply`;
  const body = { minerIds: [rig.id], restart: true };
  const headers = {
    "If-Match": profile.version,
    "Idempotency-Key": "direct-profile",
  };
  assert.equal((await api(url, "POST", body)).status, 428);
  assert.equal(
    (await api(url, "POST", body, { "If-Match": "old" })).status,
    409,
  );
  const readKey = (
    await api("/v1/api-keys", "POST", {
      name: "Direct profile read",
      permission: "read",
    })
  ).data;
  assert.equal(
    (
      await api(url, "POST", body, {
        ...headers,
        Authorization: "",
        "X-API-Key": readKey.secret,
      })
    ).status,
    403,
  );
  const response = await api(url, "POST", body, headers);
  assert.equal(response.status, 202);
  const command = response.data.results[0].command;
  assert.equal(command.status, "sent");
  assert.equal(command.deviceType, "GPU");
  assert.equal(command.restartRunningOnly, true);
  assert.equal(command.configs.nanominer.version, profile.version);
  assert.equal(command.configs.nanominer.algorithm, "quantus");
  assert.equal(command.configs.xmrig, undefined);
  assert.equal(command.profileName, profile.name);
  assert.equal(
    (await api(url, "POST", body, headers)).data.results[0].command.id,
    command.id,
  );
  const assigned = await db.collection("miners").findOne({ id: rig.id });
  assert.deepEqual(assigned.desiredConfigs.xmrig, cpu);
  assert.deepEqual((await api("/v1/configs")).data.data, defaults);
  await api(
    `/v1/config-profiles/${profile.id}`,
    "PUT",
    {
      name: profile.name,
      type: profile.type,
      config: { ...profile.config, pool: "new-pool.example:1234" },
    },
    { "If-Match": profile.version },
  );
  assert.equal((await api(url, "POST", body, headers)).status, 409);
  assert.equal(
    (await db.collection("commands").findOne({ id: command.id })).configs
      .nanominer.pool,
    "pool.example:1234",
  );
  await api("/v1/commands", "POST", {
    minerId: rig.id,
    action: "stop",
    deviceType: "GPU",
  });
  assert.equal(
    (await db.collection("commands").findOne({ id: command.id })).status,
    "canceled",
  );
  // A reconnect retains the per-rig profile even after the library is edited.
  const second = await socket();
  send(second, "register", reg);
  const bound = await waitFor(() =>
    second.messages.find((m) => m.type === "bound"),
  );
  assert.equal(bound.data.configs.nanominer.version, profile.version);
  ws.terminate();
  second.terminate();
});

test("fleet profile activation snapshots offline delivery, preserves CPU and rejects stale defaults", async () => {
  const Config = require("../src/models/Config"),
    Profiles = require("../src/models/ConfigProfile");
  const reg = registration("fleet-profile-offline");
  reg.capabilities.gpuEngines = ["nanominer", "srbminer"];
  const ws = await socket();
  send(ws, "register", reg);
  await waitFor(() => ws.messages.some((m) => m.type === "bound"));
  const rig = await db.collection("miners").findOne({ systemId: reg.systemId }),
    cpu = rig.desiredConfigs.xmrig;
  ws.close();
  await waitFor(
    async () =>
      !(await db.collection("miners").findOne({ id: rig.id })).connectionId,
  );
  const profile = await Profiles.create(
    {
      name: "Fleet test Quantus",
      type: "nanominer",
      config: {
        engine: "srbminer",
        algorithm: "quantus",
        coin: "QUAN",
        pool: "original.example:1234",
        user: "fixture-wallet",
      },
    },
    "test",
  );
  const config = await Config.get("nanominer"),
    url = `/v1/config-profiles/${profile.id}/activate`,
    headers = { "If-Match": profile.version };
  assert.equal((await api(url, "POST", {}, headers)).status, 428);
  assert.equal(
    (await api(url, "POST", { expectedConfigVersion: "old" }, headers)).status,
    409,
  );
  const response = await api(
    url,
    "POST",
    { expectedConfigVersion: config.version },
    headers,
  );
  assert.equal(response.status, 202);
  assert.equal(
    response.data.results.find((r) => r.minerId === rig.id).status,
    "awaiting_reconnect",
  );
  let assigned = await db.collection("miners").findOne({ id: rig.id });
  assert.deepEqual(assigned.desiredConfigs.xmrig, cpu);
  assert.equal(
    assigned.pendingProfileActivation.nanominer.profile.version,
    profile.version,
  );
  await Profiles.update(
    profile.id,
    {
      name: profile.name,
      type: profile.type,
      config: { ...profile.config, pool: "edited.example:1234" },
    },
    "test",
    profile.version,
  );
  const second = await socket();
  send(second, "register", reg);
  const message = await waitFor(() =>
    second.messages.find(
      (m) => m.type === "command" && m.data.profileId === profile.id,
    ),
  );
  assert.equal(message.data.configs.nanominer.pool, "original.example:1234");
  assert.equal(message.data.restartRunningOnly, true);
  assert.equal(message.data.configs.xmrig, undefined);
  assigned = await db.collection("miners").findOne({ id: rig.id });
  assert.equal(assigned.pendingProfileActivation?.nanominer, undefined);
  await db.collection("miners").updateOne(
    { id: rig.id },
    {
      $set: {
        "pendingProfileActivation.nanominer": { id: "older", profile },
      },
    },
  );
  await api("/v1/commands", "POST", {
    minerId: rig.id,
    action: "stop",
    deviceType: "GPU",
  });
  assert.equal(
    (await db.collection("miners").findOne({ id: rig.id }))
      .pendingProfileActivation?.nanominer,
    undefined,
  );
  second.terminate();
});

test("conditional profile restarts preserve stopped intent and CPU-only delivery is config-only", async () => {
  const commands = require("../src/services/commands");
  const ws = await socket(),
    reg = registration("conditional-profile-intent");
  reg.capabilities.cpuEngines = ["xmrig", "nanominer", "srbminer"];
  reg.capabilities.gpuEngines = ["nanominer", "srbminer", "krig"];
  send(ws, "register", reg);
  await waitFor(() => ws.messages.some((m) => m.type === "bound"));
  const rig = await db.collection("miners").findOne({ systemId: reg.systemId });
  const intent = {
    state: "stopped",
    commandId: "prior-stop",
    updatedAt: new Date().toISOString(),
  };
  await db.collection("miners").updateOne(
    { id: rig.id },
    {
      $set: {
        desiredState: { ALL: intent, CPU: intent, GPU: intent },
        processes: [
          { id: "xmrig-1", type: "xmrig", deviceType: "CPU", running: true },
          {
            id: "nanominer-1",
            type: "nanominer",
            deviceType: "GPU",
            running: false,
          },
        ],
      },
    },
  );
  const conditional = await api("/v1/commands", "POST", {
    minerId: rig.id,
    action: "restart",
    deviceType: "ALL",
    restartRunningOnly: true,
  });
  assert.equal(conditional.status, 202);
  assert.deepEqual(
    (await db.collection("miners").findOne({ id: rig.id })).desiredState,
    { ALL: intent, CPU: intent, GPU: intent },
  );
  await commands.cancel(conditional.data.data.id);
  const profile = await require("../src/models/ConfigProfile").create(
    {
      name: "CPU-only delivery fixture",
      type: "nanominer",
      config: {
        engine: "nanominer",
        algorithm: "kawpow",
        coin: "RVN",
        pool: "fixture.example:1234",
        user: "fixture-wallet",
      },
    },
    "test",
  );
  await db.collection("miners").updateOne(
    { id: rig.id },
    {
      $set: {
        "hardware.gpus": [],
        "pendingProfileActivation.nanominer": {
          id: "cpu-only",
          profile,
          actor: "test",
        },
      },
    },
  );
  const delivered =
    await require("../src/services/profileActivation").deliverPending(
      rig.id,
      rig.connectionId,
      "nanominer",
    );
  assert.equal(
    delivered[0].command?.action,
    "config-update",
    JSON.stringify(delivered),
  );
  assert.equal(
    (await db.collection("miners").findOne({ id: rig.id })).desiredState.GPU
      .state,
    "stopped",
  );
  await commands.cancel(delivered[0].command.id);
  const start = await api("/v1/commands", "POST", {
    minerId: rig.id,
    action: "start",
    deviceType: "CPU",
  });
  assert.equal(start.status, 202);
  assert.equal(
    (await db.collection("miners").findOne({ id: rig.id })).desiredState.CPU
      .state,
    "running",
  );
  await commands.cancel(start.data.data.id);
  ws.terminate();
});

test("stopped miner incidents persist, respect maintenance, and resolve on recovery", async () => {
  const monitoring = require("../src/services/monitoring"),
    now = Date.now();
  const rig = {
    id: "stopped-miner-incident",
    connectionId: "test",
    connectionLastSeen: new Date(now),
    telemetryReceivedAt: new Date(now),
    processes: [
      {
        id: "nanominer-1",
        deviceType: "GPU",
        engine: "krig",
        enabled: true,
        running: false,
        error: "Miner exited (0).",
      },
    ],
  };
  const key = `${rig.id}:miner_failure`;
  await monitoring.check(rig, monitoring.DEFAULT_RULES, now);
  let incident = await db.collection("incidents").findOne({ key });
  assert.equal(incident?.resolvedAt, null);
  assert.equal(incident?.severity, "critical");
  await monitoring.check(
    { ...rig, maintenanceUntil: new Date(now + 60000) },
    monitoring.DEFAULT_RULES,
    now,
  );
  assert.equal(
    (await db.collection("incidents").findOne({ key })).suppressed,
    true,
  );
  await monitoring.check(
    { ...rig, processes: [{ ...rig.processes[0], error: null }] },
    monitoring.DEFAULT_RULES,
    now,
  );
  assert.ok((await db.collection("incidents").findOne({ key })).resolvedAt);
});

test("server profitability schedule persists daily deduplication and isolates provider/Discord failures", async () => {
  const service = require("../src/services/profitability");
  const jobs = db.collection("scheduledJobs");
  const previous = process.env.PROFITABILITY_DISCORD_WEBHOOK;
  process.env.PROFITABILITY_DISCORD_WEBHOOK =
    "https://discord.com/api/webhooks/123/synthetic-never-used";
  let reviews = 0,
    sends = 0;
  const result = {
    checkedAt: new Date().toISOString(),
    opportunities: [],
    gaps: ["Synthetic missing model"],
    groupsChecked: 0,
    activeGroups: 1,
  };
  const options = {
    clock: () => new Date("2026-09-29T16:00:00Z"),
    reviewFn: async () => {
      reviews++;
      return result;
    },
    discordFetch: async (url, request) => {
      sends++;
      assert.deepEqual(JSON.parse(request.body).allowed_mentions, {
        parse: [],
      });
      return {
        ok: true,
        json: async () => ({ id: "synthetic-discord-receipt" }),
      };
    },
  };
  try {
    await jobs.deleteOne({ _id: "daily-profitability" });
    await service.run({
      ...options,
      clock: () => new Date("2026-09-29T15:59:00Z"),
    });
    assert.equal(reviews, 0);
    await Promise.all([service.run(options), service.run(options)]);
    assert.equal(reviews, 1);
    assert.equal(sends, 1);
    await service.run(options);
    assert.equal(reviews, 1);
    let state = await service.status();
    assert.equal(state.lastDelivery.status, "sent");
    assert.equal(state.running, false);
    assert.equal(JSON.stringify(state).includes("synthetic-never-used"), false);
    await service.run({
      ...options,
      force: true,
      discordFetch: async () => {
        throw Error("network unavailable");
      },
    });
    state = await service.status();
    assert.equal(state.lastDelivery.status, "failed-or-uncertain");
    assert.equal(state.running, false);
    await service.run(options);
    assert.equal(reviews, 2); // no blind retry after uncertain delivery
    await service.run({
      ...options,
      force: true,
      reviewFn: async () => {
        throw Error("provider unavailable");
      },
    });
    assert.equal(
      (await service.status()).lastResult.error,
      "provider unavailable",
    );
    const key = (
      await api("/v1/api-keys", "POST", {
        name: "Profitability read",
        permission: "read",
      })
    ).data;
    const read = { Authorization: "", "X-API-Key": key.secret };
    assert.equal(
      (await api("/v1/profitability", "GET", undefined, read)).status,
      200,
    );
    assert.equal(
      (await api("/v1/profitability/check", "POST", {}, read)).status,
      403,
    );
    await api(`/v1/api-keys/${key.data.id}`, "DELETE");
    assert.equal(
      (await api("/v1/profitability", "GET", undefined, read)).status,
      401,
    );
    delete process.env.PROFITABILITY_DISCORD_WEBHOOK;
    assert.equal(
      (await api("/v1/profitability/check", "POST", {})).status,
      422,
    );
  } finally {
    if (previous === undefined)
      delete process.env.PROFITABILITY_DISCORD_WEBHOOK;
    else process.env.PROFITABILITY_DISCORD_WEBHOOK = previous;
  }
});

test("WebSocket clocks ahead and behind retain fresh API rates, sensors and original history", async () => {
  for (const offset of [-240000, 240000]) {
    const identity = `clock-tolerance-${offset}`;
    const ws = await socket();
    send(ws, "register", registration(identity));
    const rig = await waitFor(() =>
      db.collection("miners").findOne({ systemId: identity }),
    );
    const report = Date.now() + offset;
    const sample = new Date(report - 10000).toISOString();
    send(ws, "status-update", {
      timestamp: report,
      processes: [
        {
          id: "nanominer-1",
          deviceType: "GPU",
          type: "nanominer",
          engine: "srbminer",
          running: true,
          algorithm: "quantus",
          hashrate: 200e6,
          hashrateObservedAt: sample,
          startedAt: new Date(report - 600000).toISOString(),
        },
      ],
      stats: {
        observedAt: sample,
        cpu: { usage: 20 },
        gpus: [
          { deviceId: "pci:0000:01:00.0", temperature: 52, powerWatts: 170 },
        ],
      },
    });
    await waitFor(
      async () =>
        (await db.collection("miners").findOne({ id: rig.id })).processes?.[0]
          ?.hashrate === 200e6,
    );
    const detail = (await api(`/v1/rigs/${rig.id}`)).data.data;
    assert.equal(detail.processes[0].quality, "valid");
    assert.equal(detail.processes[0].hashrateObservedAt, sample);
    assert.equal(detail.stats.gpus[0].temperature, 52);
    assert.equal(detail.clockWarning, null);
    const stored = await db
      .collection("hashrates")
      .findOne({ minerId: rig.id });
    assert.equal(stored.observedAt.toISOString(), sample);
    ws.close();
  }
});

test("clock-offset Stop, pause, missing samples and removal close history in observation time", async () => {
  for (const offset of [-180000, 180000])
    for (const transition of ["stop", "pause", "remove", "unavailable"]) {
      const identity = `history-end-${offset}-${transition}`;
      const ws = await socket();
      send(ws, "register", registration(identity));
      const rig = await waitFor(() =>
        db.collection("miners").findOne({ systemId: identity }),
      );
      const report = Date.now() + offset;
      const p = {
        id: "nanominer-1",
        type: "nanominer",
        deviceType: "GPU",
        engine: "srbminer",
        running: true,
        algorithm: "quantus",
        hashrate: 100,
        hashrateObservedAt: new Date(report - 20000).toISOString(),
      };
      send(ws, "status-update", { timestamp: report, processes: [p] });
      await waitFor(
        async () =>
          (await db.collection("miners").findOne({ id: rig.id })).processes?.[0]
            ?.hashrate === 100,
      );
      // A sweep must not pre-fill the freshness window before the actual end.
      const Miner = require("../src/models/Miner"),
        originalAll = Miner.getAll;
      Miner.getAll = async () => [rig];
      try {
        await require("../src/websocket/server").sweep();
      } finally {
        Miner.getAll = originalAll;
      }
      assert.equal(
        await db
          .collection("hashrateBuckets")
          .countDocuments({ minerId: rig.id }),
        0,
      );
      const next =
        transition === "remove"
          ? []
          : [
              {
                ...p,
                running: transition !== "stop",
                paused: transition === "pause",
                hashrate: null,
                ...(transition === "unavailable"
                  ? { hashrateObservedAt: null }
                  : {}),
              },
            ];
      send(ws, "status-update", { timestamp: report, processes: next });
      await waitFor(async () => {
        const rows = (await db.collection("miners").findOne({ id: rig.id }))
          .processes;
        return transition === "remove"
          ? rows?.length === 0
          : transition === "unavailable"
            ? rows?.[0]?.hashrate === null
            : transition === "stop"
              ? rows?.[0]?.running === false
              : rows?.[0]?.paused === true;
      });
      const rows = await db
        .collection("hashrateBuckets")
        .find({ minerId: rig.id })
        .toArray();
      assert.equal(
        rows.reduce((n, r) => n + r.coveredMs, 0),
        20000,
        `${offset} ${transition}`,
      );
      assert.equal(
        rows.reduce((n, r) => n + r.integral, 0),
        2000000,
      );
      assert.equal(
        await db.collection("hashrates").countDocuments({ minerId: rig.id }),
        1,
      );
      ws.close();
    }
});

test("monitor sweeps expire rates by engine in the original bounded report clock", async () => {
  const Miner = require("../src/models/Miner"),
    HashRate = require("../src/models/HashRate"),
    websocket = require("../src/websocket/server"),
    telemetry = require("../src/services/telemetry");
  const now = Date.now(),
    fixtures = [],
    recorded = [];
  for (const offset of [-180000, 0, 180000])
    for (const [engine, age] of [
      ["srbminer", 20000],
      ["srbminer", 90000],
      ["srbminer", 121000],
      ["nanominer", 61000],
    ]) {
      const at = now + offset - age;
      fixtures.push({
        id: `sweep-clock-${offset}-${engine}-${age}`,
        agentClock: telemetry.clockObservation(at, now - age),
        processes: [
          {
            id: "gpu",
            engine,
            algorithm: "quantus",
            deviceType: "GPU",
            running: true,
            hashrate: 100,
            hashrateObservedAt: new Date(at).toISOString(),
          },
        ],
      });
    }
  const originalAll = Miner.getAll,
    originalById = Miner.getById,
    originalRecord = HashRate.record;
  Miner.getAll = async () => fixtures;
  Miner.getById = async (id) => fixtures.find((r) => r.id === id);
  HashRate.record = async (...args) => recorded.push(args);
  try {
    await websocket.sweep();
    const expired = fixtures.filter((r) => /-(121000|61000)$/.test(r.id));
    assert.deepEqual(
      recorded.map(([id]) => id).sort(),
      expired.map((r) => r.id).sort(),
    );
    for (const [id, boundary, previous] of recorded) {
      assert.equal(boundary.hashrate, null, id);
      assert.equal(boundary.quality, "unavailable", id);
      assert.equal(
        Date.parse(boundary.hashrateObservedAt),
        Date.parse(previous.hashrateObservedAt) +
          telemetry.rateFreshMs(previous),
        id,
      );
    }
  } finally {
    Miner.getAll = originalAll;
    Miner.getById = originalById;
    HashRate.record = originalRecord;
  }
});

test("KRig profiles require capability support, survive reconnect and preserve GPU telemetry and failed controls", async () => {
  const Miner = require("../src/models/Miner");
  const Config = require("../src/models/Config");
  const prior = await Config.get("nanominer");
  const ids = [];
  try {
    const saved = await api("/v1/configs/nanominer", "PUT", {
      ...Config.DEFAULTS.nanominer,
      engine: "krig",
      algorithm: "quantus",
      coin: "QTC",
      pool: "pool.test:7049",
      user: "test-wallet",
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    const catalog = await api("/v1/mining/engines");
    assert.equal(catalog.data.data.krig.version, "1.5.6");
    assert.deepEqual(catalog.data.data.krig.scopes, ["GPU"]);
    assert.equal((await fetch(origin + "/api/v1/mining/engines")).status, 401);
    const legacy = await socket(),
      capable = await socket();
    send(legacy, "register", registration("krig-legacy"));
    const reg = {
      ...registration("krig-capable"),
      capabilities: {
        commandResults: true,
        minerMaintenance: true,
        gpuEngines: ["nanominer", "srbminer", "krig"],
        cpuEngines: ["nanominer"],
      },
    };
    send(capable, "register", reg);
    const oldBind = await waitFor(() =>
      legacy.messages.find((m) => m.type === "bound"),
    );
    const bind = await waitFor(() =>
      capable.messages.find((m) => m.type === "bound"),
    );
    ids.push(oldBind.data.minerId, bind.data.minerId);
    assert.equal(oldBind.data.configs.nanominer, undefined);
    assert.equal(bind.data.configs.nanominer.engine, "krig");
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
    const applied = await api("/v1/configs/nanominer/apply", "POST", {
      minerIds: [ids[1]],
    });
    assert.equal(applied.status, 202);
    const command = applied.data.results[0].command;
    const dispatch = await waitFor(() =>
      capable.messages.find(
        (m) => m.type === "command" && m.data.id === command.id,
      ),
    );
    assert.equal(dispatch.data.deviceType, "GPU");
    assert.equal(dispatch.data.configs.nanominer.engine, "krig");
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
          deviceType: "GPU",
          engine: "krig",
          running: true,
          enabled: true,
          algorithm: "quantus",
          hashrate: 160e6,
          hashrateObservedAt: stamp,
          startedAt: stamp,
          minerVersion: "1.5.6",
          activeConfig: saved.data.data,
          shares: {
            accepted: 12,
            rejected: 1,
            observedAt: stamp,
            source: "krig-api",
          },
        },
      ],
    });
    await waitFor(
      async () =>
        (await api(`/v1/rigs/${ids[1]}/devices`)).data.processes?.[0]
          ?.engine === "krig",
    );
    const process = (await api(`/v1/rigs/${ids[1]}/devices`)).data.processes[0];
    assert.equal(process.hashrate, 160e6);
    assert.equal(process.algorithm, "quantus");
    assert.equal(process.shares.accepted, 12);
    const restart = await api("/v1/commands", "POST", {
      minerId: ids[1],
      action: "restart",
      deviceType: "GPU",
    });
    assert.equal(restart.status, 202);
    await waitFor(() =>
      capable.messages.find(
        (m) => m.type === "command" && m.data.id === restart.data.data.id,
      ),
    );
    send(capable, "command-result", {
      id: restart.data.data.id,
      status: "failed",
      error: "KRig GPU driver unavailable",
    });
    await waitFor(
      async () =>
        (await api(`/v1/commands/${restart.data.data.id}`)).data.data.status ===
        "failed",
    );
    send(capable, "register", { ...reg, silent: true });
    const rebound = await waitFor(() =>
      capable.messages.find((m) => m.type === "registered"),
    );
    assert.equal(rebound.data.configs.nanominer.engine, "krig");
  } finally {
    const current = await Config.get("nanominer");
    await Config.update(
      "nanominer",
      { ...prior, version: current.version },
      "test-restore",
      current.version,
    );
    for (const id of ids) await Miner.delete(id);
  }
});

test("database failures are unavailable responses, never successful empty data", async () => {
  await require("../src/db/mongodb").disconnect();
  assert.equal((await api("/v1/rigs")).status, 503);
  assert.equal((await api("/v1/config-profiles")).status, 503);
  assert.equal((await api("/health")).status, 503);
  assert.equal((await api("/live")).status, 200);
  assert.equal((await fetch(origin + "/")).status, 404); // Development shell routing remains independent of MongoDB.
});
