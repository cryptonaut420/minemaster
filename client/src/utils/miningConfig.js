// Shared renderer/native validation: configurations must describe the process we actually launch.
const SRB = require("./srbminer.json");
const GPU_ALGORITHMS = [
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
];
const aliases = { conflux: "octopus", autolykos2: "autolykos" };
// Preserve the legacy CPU slot/ID while allowing a different executable behind it.
const engineFor = (type, config = {}) => config?.engine || type;
function supportsSrbPlatform(platform, arch) {
  return ["win32", "linux"].includes(platform) && arch === "x64";
}
function poolAddress(value) {
  if (typeof value !== "string" || /[\s\r\n\0]/.test(value)) return false;
  const match = value.match(
    /^(?:(?:stratum\+(?:tcp|ssl|tls)):\/\/)?(\[[0-9a-f:]+\]|[\w.-]+):(\d+)$/i,
  );
  return !!match && Number(match[2]) > 0 && Number(match[2]) <= 65535;
}
function parseArguments(text = "") {
  if (typeof text !== "string" || text.length > 2000 || /[\r\n\0]/.test(text))
    throw Error(
      "Additional arguments must be one line, at most 2000 characters",
    );
  const args = [];
  let current = "",
    quote = null,
    started = false;
  for (const char of text) {
    if (char === quote) {
      quote = null;
      started = true;
    } else if (!quote && (char === '"' || char === "'")) {
      quote = char;
      started = true;
    } else if (!quote && /\s/.test(char)) {
      if (started) args.push(current);
      current = "";
      started = false;
    } else {
      current += char;
      started = true;
    }
  }
  if (quote) throw Error("Additional arguments contain an unclosed quote");
  if (started) args.push(current);
  // These bypass foreground ownership or make reported pool/algorithm/CPU identity inaccurate.
  const forbidden =
    /^(?:-B|-c|-o|-u|-p|-O|-a|-t|-l|-S|-V|-h|--(?:background|config|url|user|pass|userpass|algo|coin|threads|cpu-max-threads-hint|rig-id|log-file|syslog|version|help|dry-run|bench|stress|submit|verify|opencl(?:-.+)?|cuda(?:-.+)?|no-cpu|http-.+|randomx-wrmsr|randomx-no-rdmsr|print-time|export-topology))(?:=|$)/;
  if (
    args.some(
      (arg) =>
        forbidden.test(arg) ||
        /^-[BcoupaOtlSVh]/.test(arg) ||
        /^--(?:cpu-priority|pause-on-active|pause-on-battery|no-huge-pages|huge-pages-jit)(?:=|$)/.test(
          arg,
        ),
    )
  )
    throw Error(
      "Additional arguments override managed process settings. Use the configuration fields for pool, CPU limits and worker identity.",
    );
  return args;
}
function validate(type, config) {
  const errors = [];
  if (!config || typeof config !== "object")
    return { valid: false, errors: ["Configuration is required"] };
  for (const [key, value] of Object.entries(config)) {
    if (
      typeof value === "string" &&
      (/[\r\n\0]/.test(value) ||
        value.length > (key === "additionalArgs" ? 2000 : 1000))
    )
      errors.push(`${key} must be a single line of text`);
  }
  if (!poolAddress(config.pool))
    errors.push(
      "Pool must be host:port, including a valid port (1–65535); IPv6 may use [address]:port",
    );
  if (typeof config.user !== "string" || !config.user.trim())
    errors.push("Wallet address or pool username is required");
  if (
    typeof config.algorithm !== "string" ||
    !/^[\w/-]+$/.test(config.algorithm)
  )
    errors.push("Algorithm is required");
  const integer = (key, min, max) => {
    if (
      config[key] !== undefined &&
      (!Number.isInteger(config[key]) || config[key] < min || config[key] > max)
    )
      errors.push(`${key} must be an integer from ${min} to ${max}`);
  };
  integer("crashRestartDelaySeconds", 10, 600);
  integer("maxCrashRestartsPerHour", 0, 5);
  const engine = engineFor(type, config);
  if (engine === "srbminer") {
    errors.push(...validateSrb(type, config));
  }
  if (type === "xmrig") {
    if (!["xmrig", "nanominer", "srbminer"].includes(engineFor(type, config)))
      errors.push("Choose XMRig, Nanominer or SRBMiner for CPU mining");
    integer("threadPercentage", 10, 100);
    integer("threads", 0, 1024);
    integer("cpuPriority", 0, 5);
    integer("pauseOnActive", 0, 3600);
    integer("donateLevel", 0, 100);
    try {
      parseArguments(config.additionalArgs);
    } catch (e) {
      errors.push(e.message);
    }
    if (engineFor(type, config) === "nanominer") {
      if (config.algorithm !== "rx/0")
        errors.push("Nanominer CPU mining requires RandomX (rx/0)");
      if (
        [
          config.pool,
          ...(Array.isArray(config.backupPools) ? config.backupPools : []),
        ].some((pool) => typeof pool === "string" && pool.includes("://"))
      )
        errors.push("Nanominer pools must use host:port without a URL scheme");
      if (
        typeof config.additionalArgs === "string" &&
        config.additionalArgs.trim()
      )
        errors.push("Additional XMRig arguments cannot be used with Nanominer");
      if (
        config.pauseOnBattery ||
        config.pauseOnActive > 0 ||
        config.cpuPriority > 0 ||
        config.tls ||
        config.keepAlive ||
        config.hugePages === false
      )
        errors.push(
          "Nanominer supports thread limits and crash recovery here. Use XMRig for activity/battery pauses, priority, strict TLS, keepalive or huge-page overrides.",
        );
    }
  } else if (type === "nanominer" && engine !== "srbminer") {
    if (engine !== "nanominer") errors.push("Unsupported GPU engine");
    if (
      [
        config.pool,
        ...(Array.isArray(config.backupPools) ? config.backupPools : []),
      ].some((pool) => typeof pool === "string" && pool.includes("://"))
    )
      errors.push(
        "Nanominer pool addresses must use host:port without a URL scheme",
      );
    const algorithm =
      typeof config.algorithm === "string"
        ? config.algorithm.toLowerCase()
        : "";
    if (!GPU_ALGORITHMS.includes(aliases[algorithm] || algorithm))
      errors.push(
        "Algorithm is not supported by Nanominer 3.10 GPU mining; choose a supported algorithm",
      );
    if (!config.coin || !/^[\w-]+$/.test(config.coin))
      errors.push("Coin is required");
    if (
      config.gpus != null &&
      (!Array.isArray(config.gpus) ||
        config.gpus.some((id) => !Number.isInteger(id) || id < 0 || id > 255))
    )
      errors.push("GPU indices must be integers from 0 to 255");
  } else if (type !== "nanominer") errors.push("Unknown miner type");
  for (const key of [
    "tls",
    "keepAlive",
    "hugePages",
    "pauseOnBattery",
    "restartOnCrash",
  ])
    if (config[key] !== undefined && typeof config[key] !== "boolean")
      errors.push(`${key} must be true or false`);
  if (
    config.backupPools !== undefined &&
    (!Array.isArray(config.backupPools) ||
      config.backupPools.length > 3 ||
      config.backupPools.some((pool) => !poolAddress(pool)))
  )
    errors.push("Use up to three valid backup pool addresses");
  return { valid: !errors.length, errors };
}
function xmrigConfig(config, hostname) {
  return {
    autosave: false,
    background: false,
    colors: false,
    "print-time": 10,
    "donate-level": Math.max(1, config.donateLevel ?? 1),
    cpu: {
      enabled: true,
      "huge-pages": config.hugePages !== false,
      priority: config.cpuPriority ?? 0,
      yield: true,
      "max-threads-hint": config.threadPercentage ?? 100,
    },
    randomx: { mode: "auto", wrmsr: false, rdmsr: false, numa: true },
    opencl: false,
    cuda: false,
    http: { enabled: false },
    "pause-on-battery": config.pauseOnBattery === true,
    "pause-on-active": config.pauseOnActive || false,
    pools: [config.pool, ...(config.backupPools || [])].map((url) => ({
      url,
      user: config.user,
      pass: config.password || hostname,
      algo: config.algorithm,
      "rig-id": config.workerName || hostname,
      keepalive: config.keepAlive === true,
      tls: config.tls === true || /^stratum\+(ssl|tls):/.test(url),
    })),
  };
}
function nanominerConfig(
  config,
  hostname,
  { cpu = false, logicalCores = 1 } = {},
) {
  const algo = cpu
    ? "RandomX"
    : aliases[config.algorithm.toLowerCase()] || config.algorithm.toLowerCase();
  // Global settings precede the algorithm section. Never let the engine replace itself or reboot a rig.
  return [
    "webPort = 0",
    "mport = 0",
    "watchdog = false",
    "autoUpdate = false",
    "noLog = true",
    "noColor = true",
    "countDevShares = false",
    "",
    `[${algo}]`,
    `coin = ${config.coin || (cpu ? "XMR" : "")}`,
    `wallet = ${config.user}`,
    `rigName = ${(cpu ? config.workerName : config.rigName) || hostname}`,
    ...(cpu
      ? [
          `cpuThreads = ${cpuThreads(config, logicalCores)}`,
          `rigPassword = ${config.password || hostname}`,
        ]
      : []),
    ...[config.pool, ...(config.backupPools || [])].map(
      (pool, i) => `pool${i + 1} = ${pool}`,
    ),
    ...(config.email ? [`email = ${config.email}`] : []),
    ...(!cpu && config.gpus?.length
      ? [`devices = ${[...new Set(config.gpus)].join(",")}`]
      : []),
    "",
  ].join("\n");
}
function cpuThreads(config, logicalCores) {
  const cores = Math.max(1, Math.floor(logicalCores || 1));
  return config.threads > 0
    ? Math.min(config.threads, cores)
    : Math.max(1, Math.floor((cores * (config.threadPercentage ?? 100)) / 100));
}
function srbAlgorithm(type, algorithm) {
  return SRB.algorithms.find(
    (row) =>
      row.algorithm === algorithm &&
      (type === "xmrig"
        ? row.devices.includes("CPU")
        : row.devices.some((d) => d !== "CPU")),
  );
}
function algorithmsFor(type, config = {}) {
  const engine = engineFor(type, config);
  if (engine === "srbminer")
    return SRB.algorithms
      .filter((r) => srbAlgorithm(type, r.algorithm))
      .map((r) => r.algorithm);
  if (type === "nanominer") return GPU_ALGORITHMS;
  return engine === "nanominer"
    ? ["rx/0"]
    : ["rx/0", "rx/wow", "rx/arq", "cn/r", "cn/half", "ghostrider"];
}
function validateSrb(type, config) {
  const errors = [];
  if (!srbAlgorithm(type, config.algorithm))
    errors.push("Choose an SRBMiner algorithm supported by this CPU/GPU scope");
  for (const [key, spec] of Object.entries(SRB.fields))
    if (
      config[key] !== undefined &&
      (!Number.isInteger(config[key]) ||
        config[key] < spec.min ||
        config[key] > spec.max)
    )
      errors.push(`${key} must be an integer from ${spec.min} to ${spec.max}`);
  const scopeField = type === "xmrig" ? "srbGpuIntensity" : "srbCpuPriority";
  if (
    config[scopeField] !== undefined &&
    config[scopeField] !== SRB.fields[scopeField].default
  )
    errors.push(`${scopeField} does not apply to this CPU/GPU scope`);
  for (const key of ["user", "password", "rigName", "workerName"])
    if (
      config[key] &&
      (typeof config[key] !== "string" || /[,;!#]/.test(config[key]))
    )
      errors.push(`${key} cannot contain SRBMiner list separators (, ; ! #)`);
  if (
    config.additionalArgs?.trim?.() ||
    (config.additionalArgs != null && typeof config.additionalArgs !== "string")
  )
    errors.push(
      "Use the managed SRBMiner settings instead of additional arguments",
    );
  if (
    config.pauseOnBattery ||
    config.pauseOnActive > 0 ||
    config.cpuPriority > 0
  )
    errors.push(
      "Activity pauses and XMRig priority are not supported by SRBMiner; use SRBMiner thread priority",
    );
  if (config.gpus?.length)
    errors.push(
      "Clear old GPU indices before using SRBMiner; device indices differ between engines",
    );
  return errors;
}
function srbArguments(type, config, hostname, logicalCores) {
  const cpu = type === "xmrig";
  const pools = [config.pool, ...(config.backupPools || [])];
  const worker = (cpu ? config.workerName : config.rigName) || hostname;
  if (/[,;!#\r\n\0]/.test(worker))
    throw Error(
      "Worker name contains SRBMiner separators; set an explicit worker name",
    );
  const args = [
    "--algorithm",
    srbAlgorithm(type, config.algorithm).argument,
    cpu ? "--disable-gpu" : "--disable-cpu",
    "--disable-msr-tweaks",
    "--disable-worker-watchdog",
    "--gpu-disable-oc",
    "--pool",
    pools.map((p) => p.replace(/^stratum\+(tcp|ssl|tls):\/\//i, "")).join(","),
    "--wallet",
    pools.map(() => config.user).join(","),
    "--worker",
    pools.map(() => worker).join(","),
    "--password",
    pools.map(() => config.password || "x").join("!"),
    "--tls",
    pools
      .map((p) =>
        config.tls === true || /^stratum\+(ssl|tls):/i.test(p)
          ? "true"
          : "false",
      )
      .join(","),
    "--keepalive",
    pools.map(() => (config.keepAlive === true ? "true" : "false")).join(","),
    "--retry-time",
    String(config.srbRetrySeconds ?? 10),
    "--give-up-limit",
    String(config.srbPoolAttempts ?? 5),
    "--main-pool-reconnect",
    String(config.srbMainPoolSeconds ?? 600),
    "--job-timeout",
    pools.map(() => config.srbJobTimeout ?? 0).join(","),
    "--esm",
    pools.map(() => config.srbStratumMode ?? 0).join(","),
  ];
  if (cpu)
    args.push(
      "--cpu-threads",
      String(cpuThreads(config, logicalCores)),
      "--cpu-threads-priority",
      String(config.srbCpuPriority ?? 2),
    );
  if (cpu && config.hugePages === false) args.push("--disable-huge-pages");
  if (!cpu && config.srbGpuIntensity > 0)
    args.push("--gpu-intensity", String(config.srbGpuIntensity));
  return args;
}
function switchEngine(type, config, engine) {
  const next = Object.assign({}, config, {
    engine,
    customPath: "",
    gpus: [],
    additionalArgs: "",
    cpuPriority: 0,
    pauseOnBattery: false,
    pauseOnActive: 0,
    tls: false,
    keepAlive: false,
    hugePages: true,
  });
  const allowed = algorithmsFor(type, next);
  if (!allowed.includes(next.algorithm))
    next.algorithm = type === "xmrig" ? "rx/0" : "kawpow";
  return next;
}
module.exports = {
  supportsSrbPlatform,
  switchEngine,
  SRB,
  srbAlgorithm,
  algorithmsFor,
  validateSrb,
  srbArguments,
  engineFor,
  cpuThreads,
  GPU_ALGORITHMS,
  poolAddress,
  parseArguments,
  validate,
  xmrigConfig,
  nanominerConfig,
};
