const { randomBytes, randomUUID, createHash } = require("crypto");
const { getDb } = require("../db/mongodb");
const { date } = require("./telemetry");
const fail = (message, status = 400) =>
  Object.assign(Error(message), { status });
const digest = (secret) => createHash("sha256").update(secret).digest("hex");
function metadata(key, now = Date.now()) {
  const { secretHash, _id, ...safe } = key;
  return {
    ...safe,
    status: key.revokedAt
      ? "revoked"
      : key.expiresAt && +key.expiresAt <= now
        ? "expired"
        : "active",
  };
}
async function create(input, actor) {
  if (
    typeof input.name !== "string" ||
    !input.name.trim() ||
    input.name.length > 80
  )
    throw fail("Choose a key name up to 80 characters");
  if (!["read", "manage"].includes(input.permission))
    throw fail("permission must be read or manage");
  const expiry = input.expiresAt == null ? null : date(input.expiresAt);
  if (
    input.expiresAt != null &&
    (typeof input.expiresAt !== "string" ||
      expiry === null ||
      expiry <= Date.now())
  )
    throw fail("expiresAt must be a future ISO date or null");
  const secret = `mm_${randomBytes(32).toString("base64url")}`;
  const key = {
    id: randomUUID(),
    name: input.name.trim(),
    permission: input.permission,
    prefix: secret.slice(0, 11),
    secretHash: digest(secret),
    createdAt: new Date(),
    createdBy: actor,
    expiresAt: expiry === null ? null : new Date(expiry),
    lastUsedAt: null,
    revokedAt: null,
  };
  await getDb().collection("apiKeys").insertOne(key);
  return { data: metadata(key), secret };
}
async function authenticate(secret) {
  if (typeof secret !== "string" || !/^mm_[A-Za-z0-9_-]{43}$/.test(secret))
    return null;
  const now = new Date();
  const key = await getDb()
    .collection("apiKeys")
    .findOne({
      secretHash: digest(secret),
      revokedAt: null,
      $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
    });
  if (!key) return null;
  // At most one metadata write per minute; validity is checked on every request.
  if (!key.lastUsedAt || now - key.lastUsedAt >= 60000)
    await getDb()
      .collection("apiKeys")
      .updateOne(
        {
          id: key.id,
          $or: [
            { lastUsedAt: null },
            { lastUsedAt: { $lte: new Date(+now - 60000) } },
          ],
        },
        { $set: { lastUsedAt: now } },
      );
  return {
    kind: "api-key",
    id: key.id,
    permission: key.permission,
    actor: `api-key:${key.name} (${key.id})`,
    expiresAt: key.expiresAt ? +key.expiresAt : null,
  };
}
async function revoke(id, actor) {
  await getDb()
    .collection("apiKeys")
    .updateOne(
      { id, revokedAt: null },
      { $set: { revokedAt: new Date(), revokedBy: actor } },
    );
  const key = await getDb().collection("apiKeys").findOne({ id });
  if (!key) throw fail("API key not found", 404);
  return metadata(key);
}
module.exports = { create, authenticate, revoke, metadata };
