const { MongoClient } = require("mongodb");
require("dotenv").config();
let client,
  db,
  indexesReady = false;
const rawRetention = Number(process.env.RAW_RETENTION_DAYS || 7);
if (!Number.isInteger(rawRetention) || rawRetention < 1 || rawRetention > 365)
  throw Error("RAW_RETENTION_DAYS must be 1–365");
async function ensureIndexes(database) {
  const miners = database.collection("miners");
  for (const field of ["systemId", "connectionId"]) {
    const duplicates = await miners
      .aggregate([
        { $match: { [field]: { $type: "string" } } },
        { $group: { _id: `$${field}`, count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } },
        { $limit: 1 },
      ])
      .toArray();
    if (duplicates.length)
      throw Error(
        `Duplicate ${field} values require explicit migration repair`,
      );
    await miners.createIndex(
      { [field]: 1 },
      {
        name: `${field}_strings_v2`,
        unique: true,
        partialFilterExpression: { [field]: { $type: "string" } },
      },
    );
    const existing = await miners.listIndexes().toArray();
    for (const index of existing)
      if (
        index.sparse &&
        index.unique &&
        Object.keys(index.key).length === 1 &&
        index.key[field]
      )
        await miners.dropIndex(index.name);
  }
  await miners.createIndex({ id: 1 }, { unique: true });
  await miners.createIndex({ archivedAt: 1, forgottenAt: 1, name: 1 });
  await database
    .collection("admins")
    .createIndex({ email: 1 }, { unique: true });
  await database.collection("apiKeys").createIndex({ id: 1 }, { unique: true });
  await database
    .collection("apiKeys")
    .createIndex({ secretHash: 1 }, { unique: true });
  await database.collection("apiKeys").createIndex({ createdAt: -1, _id: -1 });
  for (const name of ["hashrates", "metrics", "logs", "events"]) {
    const c = database.collection(name);
    await c.createIndex({ minerId: 1, timestamp: -1, _id: -1 });
    const indexes = await c.listIndexes().toArray();
    const ttl = indexes.find(
      (i) => i.expireAfterSeconds !== undefined && i.key.timestamp,
    );
    if (ttl && ttl.expireAfterSeconds !== rawRetention * 86400)
      await database.command({
        collMod: name,
        index: { name: ttl.name, expireAfterSeconds: rawRetention * 86400 },
      });
    else if (!ttl)
      await c.createIndex(
        { timestamp: -1 },
        { expireAfterSeconds: rawRetention * 86400 },
      );
  }
  await database.collection("hashrates").createIndex(
    { minerId: 1, processId: 1, observedAt: 1, algorithm: 1 },
    {
      unique: true,
      partialFilterExpression: {
        observedAt: { $type: "date" },
        processId: { $type: "string" },
      },
    },
  );
  await database
    .collection("hashrateBuckets")
    .createIndex(
      { minerId: 1, processId: 1, algorithm: 1, deviceType: 1, timestamp: 1 },
      { unique: true },
    );
  await database
    .collection("hashrateBuckets")
    .createIndex({ timestamp: 1 }, { expireAfterSeconds: 90 * 86400 });
  await database
    .collection("commands")
    .createIndex({ id: 1 }, { unique: true });
  await database.collection("commands").createIndex(
    { idempotencyKey: 1 },
    {
      unique: true,
      partialFilterExpression: { idempotencyKey: { $type: "string" } },
    },
  );
  await database
    .collection("commands")
    .createIndex({ minerId: 1, createdAt: -1 });
  await database.collection("commands").createIndex({ status: 1, deadline: 1 });
  await database
    .collection("commands")
    .createIndex({ createdAt: 1 }, { expireAfterSeconds: 90 * 86400 });
  await database
    .collection("incidents")
    .createIndex({ key: 1 }, { unique: true });
  await database
    .collection("incidents")
    .createIndex({ resolvedAt: 1, openedAt: -1, _id: -1 });
  await database
    .collection("settings")
    .createIndex({ id: 1 }, { unique: true });
  await database
    .collection("configRevisions")
    .createIndex({ type: 1, version: -1 }, { unique: true });
}
async function connect() {
  if (db) return db;
  const host = process.env.MONGO_HOST || "localhost",
    port = process.env.MONGO_PORT || 27017,
    name = process.env.MONGO_DB_NAME || "minemaster";
  const credentials =
    process.env.MONGO_USERNAME && process.env.MONGO_PASSWORD
      ? `${encodeURIComponent(process.env.MONGO_USERNAME)}:${encodeURIComponent(process.env.MONGO_PASSWORD)}@`
      : "";
  client = new MongoClient(
    process.env.MONGO_URL ||
      `mongodb://${credentials}${host}:${port}/${name}${credentials ? "?authSource=admin" : ""}`,
    { serverSelectionTimeoutMS: 5000 },
  );
  await client.connect();
  db = client.db(name);
  try {
    await ensureIndexes(db);
    indexesReady = true;
    return db;
  } catch (e) {
    await disconnect();
    throw e;
  }
}
function getDb() {
  if (!db) throw Error("Database unavailable");
  return db;
}
async function readiness() {
  if (!db || !indexesReady) throw Error("Database indexes not ready");
  await db.command({ ping: 1 });
  return {
    database: "ready",
    indexes: "ready",
    rawRetentionDays: rawRetention,
  };
}
async function disconnect() {
  if (client) await client.close();
  client = db = null;
  indexesReady = false;
}
module.exports = {
  connect,
  getDb,
  disconnect,
  readiness,
  ensureIndexes,
  rawRetention,
};
