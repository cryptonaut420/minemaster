const { getDb } = require("../db/mongodb");
const { viewRig, number, date, normalizeGpus } = require("./telemetry");
const DEFAULT_RULES = {
  offline: true,
  stale: true,
  zero: true,
  temperature: true,
  missing_gpu: true,
  rejects: true,
  crash_loop: true,
  temperatureC: 85,
  zeroGraceSeconds: 120,
  rejectPercent: 5,
  restartWindowMinutes: 15,
  restartCount: 3,
};
const RULE_LIMITS = {
  temperatureC: { min: 1, max: 150 },
  zeroGraceSeconds: { min: 1, max: 3600, integer: true },
  rejectPercent: { min: 0.1, max: 100 },
  restartWindowMinutes: { min: 1, max: 1440, integer: true },
  restartCount: { min: 1, max: 100, integer: true },
};
function validateRules(input, current = DEFAULT_RULES) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw Object.assign(Error("Provide a rules object"), { status: 400 });
  for (const [key, value] of Object.entries(input)) {
    const bound = RULE_LIMITS[key];
    if (
      !Object.hasOwn(DEFAULT_RULES, key) ||
      typeof value !== typeof DEFAULT_RULES[key] ||
      (bound &&
        (!Number.isFinite(value) ||
          value < bound.min ||
          value > bound.max ||
          (bound.integer && !Number.isInteger(value))))
    )
      throw Object.assign(
        Error(
          bound
            ? `${key} must be ${bound.min}–${bound.max}${bound.integer ? " (whole number)" : ""}`
            : `Invalid rule: ${key}`,
        ),
        { status: 400 },
      );
  }
  return { ...current, ...input };
}
function sensors(payload, now = Date.now()) {
  const s = payload.stats || {},
    observed = date(s.observedAt);
  const fresh =
    observed !== null && now - observed <= 60000 && observed <= now + 5000;
  const source = payload.protocolVersion >= 2 ? fresh : true;
  const cpu = s.cpu || {},
    memory = s.memory || {};
  return {
    observedAt: source ? new Date(observed ?? now).toISOString() : null,
    quality: source ? "observed" : "unavailable",
    cpu: {
      usage: source ? number(cpu.usage, 0, 100) : null,
      temperature: source ? number(cpu.temperature, -30, 150) : null,
    },
    memory: {
      total: source ? number(memory.total) : null,
      used: source ? number(memory.used) : null,
      usage: source ? number(memory.usage, 0, 100) : null,
    },
    gpus: normalizeGpus(s.gpus || []).map((g) => ({
      deviceId: g.deviceId,
      identityQuality: g.identityQuality,
      model: g.model || null,
      temperature: source ? number(g.temperature, -30, 150) : null,
      usage: source ? number(g.usage, 0, 100) : null,
      powerWatts: source ? number(g.powerWatts) : null,
      memoryUsed: source ? number(g.memoryUsed) : null,
      memoryTotal: source ? number(g.memoryTotal) : null,
    })),
  };
}
function evaluate(raw, rules = DEFAULT_RULES, now = Date.now()) {
  const r = viewRig(raw, now),
    issues = [];
  if (r.archivedAt || r.forgottenAt) return issues;
  const add = (rule, message, severity = "warning") => {
    if (rules[rule]) issues.push({ rule, message, severity });
  };
  if (!r.freshness.connected) add("offline", "Agent disconnected", "critical");
  else if (!r.freshness.telemetryFresh)
    add("stale", "Agent connected but telemetry is overdue");
  if (r.freshness.telemetryFresh) {
    for (const p of r.processes) {
      if (
        p.running &&
        p.quality === "zero" &&
        date(p.startedAt) !== null &&
        now - date(p.startedAt) > rules.zeroGraceSeconds * 1000
      )
        add("zero", `${p.id} reports zero hashrate`);
      const total =
        (number(p.shares?.accepted) || 0) + (number(p.shares?.rejected) || 0);
      if (
        p.running &&
        total >= 20 &&
        (p.shares.rejected / total) * 100 > rules.rejectPercent
      )
        add(
          "rejects",
          `${p.id} rejected ${((p.shares.rejected / total) * 100).toFixed(1)}% of ${total} shares`,
        );
    }
    const expected = r.expectedDeviceIds || [];
    const actual = new Set((r.hardware?.gpus || []).map((g) => g.deviceId));
    if (expected.some((id) => !actual.has(id)))
      add("missing_gpu", "A GPU from the acknowledged inventory is missing");
    if (
      date(r.stats?.observedAt) !== null &&
      now - date(r.stats.observedAt) < 60000
    ) {
      if (
        r.stats.cpu?.temperature >= rules.temperatureC ||
        r.stats.gpus?.some((g) => g.temperature >= rules.temperatureC)
      )
        add(
          "temperature",
          `Temperature reached ${rules.temperatureC}°C threshold`,
          "critical",
        );
    }
  }
  return issues;
}
async function rules() {
  return {
    ...DEFAULT_RULES,
    ...(await getDb().collection("settings").findOne({ id: "monitoring" }))
      ?.rules,
  };
}
async function checkOne(raw, settings, now) {
  const db = getDb(),
    issues = evaluate(raw, settings, now);
  if (!raw.archivedAt && !raw.forgottenAt && settings.crash_loop) {
    const exits = await db.collection("events").countDocuments({
      minerId: raw.id,
      kind: "process-exit",
      "details.unexpected": true,
      timestamp: {
        $gte: new Date(now - settings.restartWindowMinutes * 60000),
      },
    });
    if (exits >= settings.restartCount)
      issues.push({
        rule: "crash_loop",
        message: `${exits} unexpected exits in ${settings.restartWindowMinutes} minutes`,
        severity: "critical",
      });
  }
  const active = await db
    .collection("incidents")
    .find({ minerId: raw.id, resolvedAt: null })
    .toArray();
  const keys = new Set();
  // Preserve all affected processes when CPU and GPU trigger the same rig rule.
  const byRule = new Map();
  for (const issue of issues) {
    const previous = byRule.get(issue.rule);
    byRule.set(
      issue.rule,
      previous
        ? { ...issue, message: `${previous.message}; ${issue.message}` }
        : issue,
    );
  }
  for (const issue of byRule.values()) {
    const key = `${raw.id}:${issue.rule}`;
    keys.add(key);
    const existing = active.find((x) => x.key === key);
    const suppressed = date(raw.maintenanceUntil) > now;
    if (existing)
      await db
        .collection("incidents")
        .updateOne(
          { _id: existing._id },
          { $set: { ...issue, lastSeenAt: new Date(now), suppressed } },
        );
    else {
      // One current document per rule/rig; preserve resolved occurrences in events.
      await db.collection("incidents").updateOne(
        { key },
        {
          $set: {
            ...issue,
            minerId: raw.id,
            openedAt: new Date(now),
            lastSeenAt: new Date(now),
            resolvedAt: null,
            acknowledgedAt: null,
            acknowledgedBy: null,
            suppressed,
          },
        },
        { upsert: true },
      );
      await event(raw.id, "incident-opened", issue);
    }
  }
  for (const old of active)
    if (!keys.has(old.key)) {
      await db
        .collection("incidents")
        .updateOne({ _id: old._id }, { $set: { resolvedAt: new Date(now) } });
      await event(raw.id, "incident-resolved", { rule: old.rule });
    }
}
const checks = new Map();
async function check(raw, settings, now = Date.now()) {
  const next = (checks.get(raw.id) || Promise.resolve())
    .catch(() => {})
    .then(() => checkOne(raw, settings, now));
  checks.set(raw.id, next);
  try {
    return await next;
  } finally {
    if (checks.get(raw.id) === next) checks.delete(raw.id);
  }
}
async function event(minerId, kind, details = {}, timestamp = new Date()) {
  return getDb()
    .collection("events")
    .insertOne({
      minerId,
      kind: String(kind).slice(0, 80),
      details,
      timestamp,
    });
}
async function ingestLogs(minerId, entries) {
  if (!Array.isArray(entries) || entries.length > 100)
    throw Object.assign(Error("Log batch must contain at most 100 entries"), {
      status: 400,
    });
  const now = Date.now();
  const rows = entries
    .filter((x) => x && typeof x.message === "string")
    .map((x) => ({
      minerId,
      timestamp: new Date(),
      observedAt:
        date(x.observedAt) !== null && date(x.observedAt) <= now + 5000
          ? new Date(date(x.observedAt))
          : null,
      processId: String(x.processId || "agent").slice(0, 100),
      level: ["debug", "info", "warning", "error"].includes(x.level)
        ? x.level
        : "info",
      message: x.message.slice(0, 4000),
      sequence: number(x.sequence),
    }));
  if (rows.length) await getDb().collection("logs").insertMany(rows);
}
module.exports = {
  sensors,
  evaluate,
  rules,
  check,
  event,
  ingestLogs,
  DEFAULT_RULES,
  RULE_LIMITS,
  validateRules,
};
