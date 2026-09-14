const { randomUUID } = require("crypto");
const { getDb } = require("../db/mongodb");
const SRB = require("../services/srbminer.json");
const DEFAULTS = {
  xmrig: {
    engine: "nanominer",
    coin: "",
    algorithm: "rx/0",
    pool: "",
    user: "",
    password: "x",
    workerName: "",
    threadPercentage: 50,
    additionalArgs: "",
    restartOnCrash: false,
    crashRestartDelaySeconds: 30,
    maxCrashRestartsPerHour: 2,
    threads: 0,
    cpuPriority: 0,
    pauseOnBattery: false,
    pauseOnActive: 0,
    hugePages: true,
    tls: false,
    keepAlive: false,
    backupPools: [],
  },
  nanominer: {
    engine: "nanominer",
    password: "x",
    tls: false,
    keepAlive: false,
    coin: "",
    algorithm: "kawpow",
    pool: "",
    user: "",
    rigName: "",
    backupPools: [],
    restartOnCrash: false,
    crashRestartDelaySeconds: 30,
    maxCrashRestartsPerHour: 2,
  },
};
for (const type of Object.keys(DEFAULTS))
  for (const [key, spec] of Object.entries(SRB.fields))
    DEFAULTS[type][key] = spec.default;
const ALGORITHMS = {
  xmrig: ["rx/0", "rx/wow", "rx/arq", "cn/r", "cn/half", "ghostrider"],
  nanominer: [
    "ethash",
    "etchash",
    "ethashb3",
    "fishhash",
    "karlsenhashv2",
    "ubqhash",
    "firopow",
    "kawpow",
    "octopus",
    "autolykos",
    "verthash",
    "conflux",
    "autolykos2",
  ],
};
function validPool(value) {
  if (typeof value !== "string" || /\s/.test(value)) return false;
  const match = value.match(
    /^(?:(?:stratum\+(?:tcp|ssl|tls)):\/\/)?(\[[0-9a-f:]+\]|[\w.-]+):(\d+)$/i,
  );
  return !!match && Number(match[2]) > 0 && Number(match[2]) <= 65535;
}
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
    if (SRB.fields[key]) {
      const { min, max } = SRB.fields[key];
      if (!Number.isInteger(value) || value < min || value > max)
        errors[key] = `Use an integer from ${min} to ${max}`;
    } else if (
      [
        "cpuPriority",
        "pauseOnActive",
        "threads",
        "crashRestartDelaySeconds",
        "maxCrashRestartsPerHour",
      ].includes(key)
    ) {
      const max = {
        cpuPriority: 5,
        pauseOnActive: 3600,
        threads: 1024,
        crashRestartDelaySeconds: 600,
        maxCrashRestartsPerHour: 5,
      }[key];
      const min = key === "crashRestartDelaySeconds" ? 10 : 0;
      if (!Number.isInteger(value) || value < min || value > max)
        errors[key] = `Use an integer from 0 to ${max}`;
    } else if (
      [
        "pauseOnBattery",
        "hugePages",
        "tls",
        "keepAlive",
        "restartOnCrash",
      ].includes(key)
    ) {
      if (typeof value !== "boolean") errors[key] = "Use true or false";
    } else if (key === "backupPools") {
      if (
        !Array.isArray(value) ||
        value.length > 3 ||
        value.some((v) => !validPool(v))
      )
        errors[key] = "Use up to three valid host:port pool addresses";
    } else if (key === "threadPercentage") {
      if (!Number.isInteger(value) || value < 10 || value > 100)
        errors[key] = "Use an integer from 10 to 100";
    } else if (
      typeof value !== "string" ||
      value.length > (key === "additionalArgs" ? 2000 : 500) ||
      /[\r\n\0]/.test(value)
    )
      errors[key] = "Use a single-line text value";
  }
  if (
    config.algorithm !== undefined &&
    !(config.engine === "srbminer"
      ? SRB.algorithms.some(
          (r) =>
            r.algorithm === config.algorithm &&
            (type === "xmrig"
              ? r.devices.includes("CPU")
              : r.devices.some((d) => d !== "CPU")),
        )
      : ALGORITHMS[type].includes(config.algorithm))
  )
    errors.algorithm = "Unsupported algorithm";
  if (
    config.engine !== undefined &&
    !(
      type === "xmrig"
        ? ["xmrig", "nanominer", "srbminer"]
        : ["nanominer", "srbminer"]
    ).includes(config.engine)
  )
    errors.engine = "Choose a supported CPU/GPU engine";
  if (type === "xmrig" && config.engine === "nanominer") {
    if (config.algorithm !== undefined && config.algorithm !== "rx/0")
      errors.algorithm = "Nanominer CPU supports rx/0";
    if (config.additionalArgs)
      errors.additionalArgs = "Additional arguments require XMRig";
    for (const key of [
      "pauseOnBattery",
      "pauseOnActive",
      "cpuPriority",
      "tls",
      "keepAlive",
    ])
      if (config[key]) errors[key] = "This override requires XMRig";
    if (config.hugePages === false)
      errors.hugePages = "This override requires XMRig";
  }
  if (
    config.pool !== undefined &&
    config.pool !== "" &&
    !validPool(config.pool)
  )
    errors.pool = "Use host:port with a port from 1 to 65535";
  if (
    ((type === "nanominer" && config.engine !== "srbminer") ||
      config.engine === "nanominer") &&
    [
      config.pool,
      ...(Array.isArray(config.backupPools) ? config.backupPools : []),
    ].some((v) => typeof v === "string" && v.includes("://"))
  )
    errors.pool = "Nanominer requires host:port without a URL scheme";
  if (config.engine === "srbminer") {
    for (const key of ["user", "password", "rigName", "workerName"])
      if (typeof config[key] === "string" && /[,;!#]/.test(config[key]))
        errors[key] = "SRBMiner list separators (, ; ! #) are not allowed";
    if (config.additionalArgs)
      errors.additionalArgs = "Use managed SRBMiner settings";
    for (const key of ["pauseOnBattery", "pauseOnActive", "cpuPriority"])
      if (config[key])
        errors[key] =
          "This setting requires XMRig; use SRBMiner thread priority";
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
          ...(type === "xmrig" && c?.xmrig && !c.xmrig.engine
            ? { engine: "xmrig" }
            : {}),
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
    const db = getDb(),
      previous = await Config.get(type);
    const clean = validate(type, {
      ...patch,
      engine: patch?.engine ?? previous?.engine,
    });
    const config = {
      ...previous,
      ...clean,
      version: randomUUID(),
      updatedAt: new Date().toISOString(),
    };
    validate(type, config);
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
// Legacy slots stay compatible; optional engines require explicit capability support.
Config.supportsEngine = (type, config, capabilities) => {
  const engine = config?.engine || type;
  if (engine === type) return true;
  const supported =
    capabilities?.[type === "xmrig" ? "cpuEngines" : "gpuEngines"];
  return Array.isArray(supported) && supported.includes(engine);
};
Config.forAgent = (configs, capabilities) => {
  const entries = Object.entries(configs || {}).filter(([type, config]) =>
    Config.supportsEngine(type, config, capabilities),
  );
  return entries.length === Object.keys(configs || {}).length
    ? configs
    : Object.fromEntries(entries);
};
module.exports = Config;
module.exports.validate = validate;
module.exports.DEFAULTS = DEFAULTS;
