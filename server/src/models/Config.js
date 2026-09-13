const { randomUUID } = require("crypto");
const { getDb } = require("../db/mongodb");
const DEFAULTS = {
  xmrig: {
    coin: "",
    algorithm: "rx/0",
    pool: "",
    user: "",
    password: "x",
    threadPercentage: 100,
    additionalArgs: "",
  },
  nanominer: { coin: "", algorithm: "kawpow", pool: "", user: "", rigName: "" },
};
const ALGORITHMS = {
  xmrig: ["rx/0", "rx/wow", "rx/arq", "cn/r", "cn/half", "ghostrider"],
  nanominer: [
    "ethash",
    "etchash",
    "kawpow",
    "autolykos",
    "autolykos2",
    "octopus",
    "conflux",
    "ton",
    "kaspa",
    "karlsenhash",
    "nexa",
  ],
};
function validate(type, config, { partial = true } = {}) {
  const errors = {};
  if (!DEFAULTS[type])
    throw Object.assign(Error("Unknown config type"), { status: 400 });
  if (!config || typeof config !== "object" || Array.isArray(config))
    throw Object.assign(Error("Config must be an object"), { status: 400 });
  for (const [key, value] of Object.entries(config)) {
    if (["version", "updatedAt"].includes(key)) continue;
    if (!(key in DEFAULTS[type])) {
      errors[key] = "Unsupported field";
      continue;
    }
    if (key === "threadPercentage") {
      if (!Number.isInteger(value) || value < 10 || value > 100)
        errors[key] = "Use an integer from 10 to 100";
    } else if (
      typeof value !== "string" ||
      value.length > (key === "additionalArgs" ? 2000 : 500) ||
      /[\r\n]/.test(value)
    )
      errors[key] = "Use a single-line text value";
  }
  if (
    config.algorithm !== undefined &&
    !ALGORITHMS[type].includes(config.algorithm)
  )
    errors.algorithm = "Unsupported algorithm";
  if (
    config.pool !== undefined &&
    config.pool !== "" &&
    !/^(?:[a-z]+:\/\/)?[^\s]+:\d{1,5}(?:\/[^\s]*)?$/i.test(config.pool)
  )
    errors.pool = "Use hostname:port";
  if (config.pool) {
    const port = config.pool.match(/:(\d{1,5})(?:\/|$)/)?.[1];
    if (!port || Number(port) < 1 || Number(port) > 65535)
      errors.pool = "Use a port from 1 to 65535";
  }
  if (!partial)
    for (const key of ["pool", "user", "algorithm"])
      if (!config[key]?.trim()) errors[key] = "Required before applying";
  if (Object.keys(errors).length)
    throw Object.assign(Error("Invalid configuration"), {
      status: 400,
      fields: errors,
    });
  return Object.fromEntries(
    Object.entries(config).filter(([k]) => k in DEFAULTS[type]),
  );
}
class Config {
  static async getAll() {
    const c = await getDb().collection("configs").findOne({ _id: "global" });
    return Object.fromEntries(
      Object.entries(DEFAULTS).map(([type, defaults]) => [
        type,
        {
          ...defaults,
          ...(c?.[type] || {}),
          version: c?.[type]?.version || "legacy",
        },
      ]),
    );
  }
  static async get(type) {
    if (!DEFAULTS[type]) return null;
    return (await Config.getAll())[type];
  }
  static async update(type, patch, actor, expectedVersion) {
    const clean = validate(type, patch),
      db = getDb(),
      previous = await Config.get(type);
    const config = {
      ...previous,
      ...clean,
      version: randomUUID(),
      updatedAt: new Date().toISOString(),
    };
    // Ensure a revision exists for the initial state so first-change rollback is possible.
    await db.collection("configRevisions").updateOne(
      { type, version: previous.version },
      {
        $setOnInsert: {
          type,
          ...previous,
          createdAt: new Date(),
          actor: "initial",
        },
      },
      { upsert: true },
    );
    await db
      .collection("configs")
      .updateOne(
        { _id: "global" },
        { $setOnInsert: { ...DEFAULTS, createdAt: new Date() } },
        { upsert: true },
      );
    expectedVersion = expectedVersion || previous.version;
    const filter = { _id: "global" };
    if (expectedVersion && expectedVersion !== "legacy")
      filter[`${type}.version`] = expectedVersion;
    else if (expectedVersion === "legacy")
      filter.$or = [
        { [`${type}.version`]: { $exists: false } },
        { [`${type}.version`]: "legacy" },
      ];
    await db
      .collection("configRevisions")
      .updateOne(
        { type, version: config.version },
        { $setOnInsert: { type, ...config, createdAt: new Date(), actor } },
        { upsert: true },
      );
    const result = await db
      .collection("configs")
      .updateOne(filter, { $set: { [type]: config } });
    if (!result.matchedCount)
      throw Object.assign(
        Error("Configuration changed. Reload and review before saving."),
        { status: 409 },
      );
    return config;
  }
  static async revisions(type) {
    return getDb()
      .collection("configRevisions")
      .find({ type })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();
  }
}
module.exports = Config;
module.exports.validate = validate;
module.exports.DEFAULTS = DEFAULTS;
