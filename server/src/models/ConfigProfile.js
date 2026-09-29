const { randomUUID } = require("crypto");
const { getDb } = require("../db/mongodb");
const Config = require("./Config");
const fail = (message, status = 400) =>
  Object.assign(Error(message), { status });
const collection = () => getDb().collection("configProfiles");
function clean(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw fail("Profile must be an object");
  if (Object.keys(input).some((k) => !["name", "type", "config"].includes(k)))
    throw fail("Unsupported profile field");
  if (
    typeof input.name !== "string" ||
    !input.name.trim() ||
    input.name.trim().length > 80 ||
    /[\x00-\x1f]/.test(input.name)
  )
    throw fail("Use a profile name from 1 to 80 characters");
  if (!Object.hasOwn(Config.DEFAULTS, input.type))
    throw fail("Unknown config type");
  // A profile is a complete snapshot, never a patch over the currently active coin.
  const config = Config.validate(
    input.type,
    {
      ...Config.DEFAULTS[input.type],
      ...Config.validate(input.type, input.config),
    },
    { partial: false },
  );
  return { name: input.name.trim(), type: input.type, config };
}
class ConfigProfile {
  static async list(type, after = "") {
    if (type && !Object.hasOwn(Config.DEFAULTS, type))
      throw fail("Unknown config type");
    if (typeof after !== "string" || after.length > 100)
      throw fail("Invalid cursor");
    const rows = await collection()
      .find(
        { ...(type ? { type } : {}), ...(after ? { id: { $gt: after } } : {}) },
        { projection: { _id: 0 } },
      )
      .sort({ id: 1 })
      .limit(101)
      .toArray();
    return {
      data: rows.slice(0, 100),
      nextCursor: rows.length > 100 ? rows[99].id : null,
    };
  }
  static async get(id) {
    const profile = await collection().findOne(
      { id },
      { projection: { _id: 0 } },
    );
    if (!profile) throw fail("Profile not found", 404);
    return profile;
  }
  static async create(input, actor) {
    const profile = {
      ...clean(input),
      id: randomUUID(),
      version: randomUUID(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      actor,
    };
    await collection().insertOne({ ...profile });
    return profile;
  }
  static async update(id, input, actor, expectedVersion) {
    const previous = await this.get(id);
    if (!expectedVersion)
      throw fail("If-Match profile version is required", 428);
    const value = clean(input);
    if (value.type !== previous.type)
      throw fail("Profile CPU/GPU type cannot change");
    const update = {
      ...value,
      version: randomUUID(),
      updatedAt: new Date().toISOString(),
      actor,
    };
    const result = await collection().updateOne(
      { id, version: expectedVersion },
      { $set: update },
    );
    if (!result.matchedCount)
      throw fail("Profile changed. Reload before replacing it.", 409);
    return { ...previous, ...update };
  }
  static async remove(id, expectedVersion) {
    if (!expectedVersion)
      throw fail("If-Match profile version is required", 428);
    const result = await collection().deleteOne({
      id,
      version: expectedVersion,
    });
    if (!result.deletedCount) {
      await this.get(id);
      throw fail("Profile changed. Reload before deleting it.", 409);
    }
  }
}
module.exports = ConfigProfile;
