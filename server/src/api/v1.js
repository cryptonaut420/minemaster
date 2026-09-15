const express = require("express");
const { ObjectId } = require("mongodb");
const { requireAccess, accessActor: actor } = require("../middleware/auth");
const apiKeys = require("../services/apiKeys");
const { getDb, readiness } = require("../db/mongodb");
const Miner = require("../models/Miner");
const Config = require("../models/Config");
const HashRate = require("../models/HashRate");
const { summary, viewRig, date } = require("../services/telemetry");
const commands = require("../services/commands");
const monitoring = require("../services/monitoring");
const ws = require("../websocket/server");
const router = express.Router();
const fail = (message, status = 400) =>
  Object.assign(Error(message), { status });
const route = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res)).catch(next);
const limitOf = (query, fallback = 100, max = 500) => {
  const limit = query.limit === undefined ? fallback : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > max)
    throw fail(`limit must be 1–${max}`);
  return limit;
};
function decode(cursor) {
  try {
    return JSON.parse(Buffer.from(cursor, "base64url").toString());
  } catch (_) {
    throw fail("Invalid cursor");
  }
}
function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
async function rig(id) {
  const m = await Miner.getById(id);
  if (!m) throw fail("Rig not found", 404);
  return decorate([m.toJSON()]).then(([r]) => r);
}
async function decorate(rigs) {
  const incidents = await getDb()
    .collection("incidents")
    .find({ minerId: { $in: rigs.map((r) => r.id) }, resolvedAt: null })
    .toArray();
  const byRig = new Map();
  for (const incident of incidents) {
    if (incident.suppressed) continue;
    if (!byRig.has(incident.minerId)) byRig.set(incident.minerId, []);
    byRig.get(incident.minerId).push(incident);
  }
  return rigs.map((r) => {
    const open = r.maintenance ? [] : byRig.get(r.id) || [];
    return {
      ...r,
      openIncidents: open.map((i) => ({
        key: i.key,
        rule: i.rule,
        message: i.message,
        severity: i.severity,
        acknowledgedAt: i.acknowledgedAt,
      })),
      attention: r.attention || open.length > 0,
      reason:
        open.find((i) => i.severity === "critical")?.message ||
        (r.attention ? r.reason : open[0]?.message) ||
        r.reason,
    };
  });
}
async function fleet(query = {}) {
  const all = await decorate(
    (
      await Miner.getAll({
        includeArchived:
          query.includeArchived === "true" ||
          ["archived", "forgotten"].includes(query.status),
        includeForgotten:
          query.includeForgotten === "true" || query.status === "forgotten",
      })
    ).map((view) => view.toJSON()),
  );
  const q = String(query.q || "")
    .trim()
    .toLowerCase();
  if (
    query.status &&
    ![
      "online",
      "mining",
      "offline",
      "stale",
      "error",
      "archived",
      "forgotten",
    ].includes(query.status)
  )
    throw fail("Invalid status");
  return all.filter(
    (r) =>
      (!q ||
        [r.name, r.hostname, r.id, r.ip, r.group, ...(r.tags || [])]
          .join(" ")
          .toLowerCase()
          .includes(q)) &&
      (!query.status || r.status === query.status) &&
      (!query.attention || r.attention === (query.attention === "true")) &&
      (!query.tag || r.tags?.includes(query.tag)) &&
      (!query.group || r.group === query.group),
  );
}
async function pageRigs(query) {
  const limit = limitOf(query),
    all = await fleet(query);
  const sort = query.sort || "name";
  if (!["name", "lastSeen", "status", "id"].includes(sort))
    throw fail("Invalid sort");
  const direction = query.order === "desc" ? -1 : 1;
  if (query.order && !["asc", "desc"].includes(query.order))
    throw fail("order must be asc or desc");
  const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  all.sort(
    (a, b) =>
      direction *
      (compare(a[sort] || "", b[sort] || "") || compare(a.id, b.id)),
  );
  const cursor = query.cursor ? decode(query.cursor) : null;
  if (
    query.cursor &&
    (!cursor ||
      typeof cursor !== "object" ||
      cursor.sort !== sort ||
      cursor.direction !== direction ||
      typeof cursor.id !== "string" ||
      typeof cursor.value !== "string")
  )
    throw fail("Cursor does not match sort");
  const remaining = cursor
    ? all.filter(
        (r) =>
          direction *
            (compare(r[sort] || "", cursor.value) || compare(r.id, cursor.id)) >
          0,
      )
    : all;
  const data = remaining.slice(0, limit),
    last = data.at(-1);
  const pending = await getDb()
    .collection("commands")
    .find({
      minerId: { $in: data.map((r) => r.id) },
      status: { $in: commands.ACTIVE },
    })
    .sort({ createdAt: -1 })
    .toArray();
  const pendingByRig = new Map();
  for (const c of pending) {
    if (!pendingByRig.has(c.minerId)) pendingByRig.set(c.minerId, []);
    pendingByRig
      .get(c.minerId)
      .push({
        id: c.id,
        action: c.action,
        deviceType: c.deviceType,
        status: c.status,
      });
  }
  for (const r of data) r.pendingCommands = pendingByRig.get(r.id) || [];
  return {
    data,
    total: all.length,
    nextCursor:
      remaining.length > limit
        ? encode({ sort, direction, value: last[sort] || "", id: last.id })
        : null,
    asOf: new Date().toISOString(),
  };
}
async function records(collection, query, extra = {}) {
  const limit = limitOf(query, 100, 1000),
    match = { ...extra };
  if (query.minerId) match.minerId = String(query.minerId);
  if (query.processId) match.processId = String(query.processId);
  if (query.status) match.status = String(query.status);
  if (query.level) match.level = String(query.level);
  if (query.kind) match.kind = String(query.kind);
  if (query.batchId) match.batchId = String(query.batchId);
  if (query.q)
    match.message = {
      $regex: String(query.q)
        .slice(0, 200)
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      $options: "i",
    };
  const field = ["commands", "apiKeys"].includes(collection)
    ? "createdAt"
    : collection === "incidents"
      ? "openedAt"
      : "timestamp";
  if (query.from || query.to) {
    match[field] = {};
    for (const [key, op] of [
      ["from", "$gte"],
      ["to", "$lt"],
    ])
      if (query[key]) {
        const time = date(query[key]);
        if (time === null) throw fail("Invalid date range");
        match[field][op] = new Date(time);
      }
    if (query.from && query.to && date(query.from) >= date(query.to))
      throw fail("from must precede to");
  }
  if (query.cursor) {
    const c = decode(query.cursor);
    if (
      !c ||
      typeof c !== "object" ||
      !ObjectId.isValid(c.id) ||
      date(c.at) === null
    )
      throw fail("Invalid cursor");
    match.$or = [
      { [field]: { $lt: new Date(c.at) } },
      { [field]: new Date(c.at), _id: { $lt: new ObjectId(c.id) } },
    ];
  }
  const rows = await getDb()
    .collection(collection)
    .find(
      match,
      collection === "apiKeys" ? { projection: { secretHash: 0 } } : {},
    )
    .sort({ [field]: -1, _id: -1 })
    .limit(limit + 1)
    .maxTimeMS(15000)
    .toArray();
  const data = rows.slice(0, limit),
    last = data.at(-1);
  if (
    [
      "commands",
      "logs",
      "events",
      "metrics",
      "hashrates",
      "incidents",
    ].includes(collection)
  ) {
    const rigs = await getDb()
      .collection("miners")
      .find(
        {
          id: {
            $in: [...new Set(data.map((row) => row.minerId).filter(Boolean))],
          },
        },
        { projection: { id: 1, name: 1 } },
      )
      .toArray();
    const names = new Map(rigs.map((r) => [r.id, r.name]));
    for (const row of data)
      row.minerName = names.get(row.minerId) || row.minerId || "Fleet";
  }
  return {
    data,
    nextCursor:
      rows.length > limit
        ? encode({ at: last[field], id: String(last._id) })
        : null,
  };
}
function csv(res, rows, filename, nextCursor = null) {
  const columns = [...new Set(rows.flatMap(Object.keys))].filter(
    (k) => k !== "_id",
  );
  const cell = (v) => {
    const text =
      v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    return `"${text.replace(/"/g, '""')}"`;
  };
  res
    .set("X-Next-Cursor", nextCursor || "")
    .type("text/csv")
    .attachment(filename)
    .send(
      [
        columns.map(cell).join(","),
        ...rows.map((r) => columns.map((k) => cell(r[k])).join(",")),
      ].join("\r\n"),
    );
}
router.use(requireAccess);
router.use((req, res, next) => {
  if (Object.values(req.query).some((value) => typeof value !== "string"))
    return next(fail("Query parameters must be single text values"));
  for (const key of [
    "includeArchived",
    "includeForgotten",
    "attention",
    "resolved",
    "suppressed",
    "acknowledged",
  ])
    if (
      req.query[key] !== undefined &&
      req.query[key] !== "" &&
      !["true", "false"].includes(req.query[key])
    )
      return next(fail(`${key} must be true or false`));
  next();
});
router.get(
  "/api-keys",
  route(async (req, res) => {
    const result = await records("apiKeys", req.query);
    res.json({
      ...result,
      data: result.data.map((key) => apiKeys.metadata(key)),
    });
  }),
);
router.post(
  "/api-keys",
  route(async (req, res) =>
    res.status(201).json(await apiKeys.create(req.body, actor(req))),
  ),
);
router.delete(
  "/api-keys/:id",
  route(async (req, res) => {
    const data = await apiKeys.revoke(req.params.id, actor(req));
    ws.revokeKeyObservers(req.params.id);
    res.json({ data });
  }),
);
router.get("/openapi.json", (req, res) => res.json(require("./openapi.json")));
router.get(
  "/health",
  route(async (req, res) =>
    res.json({ ...(await readiness()), monitoring: ws.monitoringStatus() }),
  ),
);
router.get(
  "/fleet/summary",
  route(async (req, res) => {
    const rigs = await fleet(req.query),
      result = summary(rigs);
    const incidents = await getDb()
      .collection("incidents")
      .find({ minerId: { $in: rigs.map((r) => r.id) }, resolvedAt: null })
      .toArray();
    res.json({
      ...result,
      monitoring: ws.monitoringStatus(),
      incidents: {
        open: incidents.filter((i) => !i.suppressed).length,
        critical: incidents.filter(
          (i) => !i.suppressed && i.severity === "critical",
        ).length,
        suppressed: incidents.filter((i) => i.suppressed).length,
      },
      scope: req.query,
    });
  }),
);
router.get(
  "/rigs",
  route(async (req, res) => {
    const page = await pageRigs(req.query);
    if (req.query.format === "csv")
      return csv(res, page.data, "minemaster-rigs.csv", page.nextCursor);
    res.json(page);
  }),
);
router.get(
  "/rigs/:id",
  route(async (req, res) => res.json({ data: await rig(req.params.id) })),
);
router.get(
  "/rigs/:id/devices",
  route(async (req, res) => {
    const r = await rig(req.params.id);
    res.json({
      hardware: r.hardware,
      devices: r.devices,
      processes: r.processes,
      stats: r.stats,
      capabilities: r.capabilities,
      appUpdate: r.appUpdate || null,
    });
  }),
);
router.patch(
  "/rigs/:id",
  route(async (req, res) => {
    const r = await rig(req.params.id),
      changes = {};
    for (const field of ["name", "group"])
      if (req.body[field] !== undefined) {
        if (
          typeof req.body[field] !== "string" ||
          req.body[field].length > 120 ||
          (field === "name" && !req.body[field].trim())
        )
          throw fail(`Invalid ${field}`);
        changes[field] = req.body[field].trim();
      }
    if (req.body.tags !== undefined) {
      if (
        !Array.isArray(req.body.tags) ||
        req.body.tags.length > 20 ||
        req.body.tags.some((t) => typeof t !== "string" || t.length > 50)
      )
        throw fail("Use up to 20 short tags");
      changes.tags = [
        ...new Set(req.body.tags.map((t) => t.trim()).filter(Boolean)),
      ];
    }
    if (req.body.maintenanceUntil !== undefined) {
      const t = date(req.body.maintenanceUntil);
      if (
        req.body.maintenanceUntil !== null &&
        (t === null || t < Date.now() || t > Date.now() + 30 * 86400000)
      )
        throw fail("Maintenance must end within 30 days");
      changes.maintenanceUntil = t === null ? null : new Date(t).toISOString();
    }
    if (req.body.recovery !== undefined) {
      const policy = req.body.recovery;
      if (
        !policy ||
        typeof policy.enabled !== "boolean" ||
        !Number.isInteger(policy.zeroSeconds) ||
        policy.zeroSeconds < 120 ||
        policy.zeroSeconds > 3600 ||
        !Number.isInteger(policy.cooldownMinutes) ||
        policy.cooldownMinutes < 5 ||
        policy.cooldownMinutes > 1440 ||
        !Number.isInteger(policy.maxPerDay) ||
        policy.maxPerDay < 1 ||
        policy.maxPerDay > 10
      )
        throw fail(
          "Recovery needs enabled, zeroSeconds (120–3600), cooldownMinutes (5–1440), maxPerDay (1–10)",
        );
      changes.recovery = policy;
    }
    if (req.body.acknowledgeInventory === true)
      changes.expectedDeviceIds = r.hardware.gpus.map((g) => g.deviceId);
    if (req.body.archived !== undefined) {
      if (typeof req.body.archived !== "boolean")
        throw fail("archived must be boolean");
      changes.archivedAt = req.body.archived ? new Date().toISOString() : null;
    }
    if (req.body.restore === true) {
      changes.forgottenAt = null;
      changes.archivedAt = null;
    }
    const updated = await Miner.update(r.id, changes);
    if (
      changes.archivedAt ||
      changes.maintenanceUntil ||
      changes.recovery?.enabled === false
    ) {
      const pending = await getDb()
        .collection("commands")
        .find({
          minerId: r.id,
          actor: "automatic-recovery",
          status: { $in: commands.ACTIVE },
        })
        .toArray();
      for (const c of pending)
        await commands.cancel(c.id, "Recovery paused by operator");
    }
    await monitoring.check(updated, await monitoring.rules());
    await monitoring.event(r.id, "operator-update", {
      actor: actor(req),
      changes,
    });
    ws.broadcast({ type: "miner_updated", miner: updated.toJSON() });
    res.json({ data: updated.toJSON() });
  }),
);
router.delete(
  "/rigs/:id",
  route(async (req, res) => {
    if (!(await ws.forget(req.params.id))) throw fail("Rig not found", 404);
    res.json({ success: true, historyPreserved: true });
  }),
);
router.get(
  "/metrics/hashrate",
  route(async (req, res) => {
    const query = { ...req.query };
    if (!query.minerId)
      query.minerIds = (await fleet(req.query)).map((r) => r.id);
    const result = await HashRate.getTimeSeries(query);
    if (req.query.format === "csv")
      return csv(res, result.data, "minemaster-hashrate.csv");
    res.json(result);
  }),
);
for (const [path, collection] of [
  ["metrics/hashrate/raw", "hashrates"],
  ["metrics/sensors", "metrics"],
  ["logs", "logs"],
  ["events", "events"],
  ["commands", "commands"],
])
  router.get(
    `/${path}`,
    route(async (req, res) => {
      const result = await records(collection, req.query);
      if (req.query.format === "csv")
        return csv(
          res,
          result.data,
          `minemaster-${collection}.csv`,
          result.nextCursor,
        );
      res.json(result);
    }),
  );
router.post(
  "/commands",
  route(async (req, res) => {
    const key = req.get("Idempotency-Key");
    if (Array.isArray(req.body.minerIds))
      return res
        .status(202)
        .json(
          await commands.bulk(req.body.minerIds, req.body, actor(req), key),
        );
    if (typeof req.body.minerId !== "string")
      throw fail("minerId or minerIds is required");
    res.status(202).json({
      data: await commands.create(req.body.minerId, req.body, actor(req), key),
    });
  }),
);
router.get(
  "/commands/:id",
  route(async (req, res) => {
    const command = await getDb()
      .collection("commands")
      .findOne({ id: req.params.id });
    if (!command) throw fail("Command not found", 404);
    res.json({ data: command });
  }),
);
router.post(
  "/commands/:id/cancel",
  route(async (req, res) =>
    res.json({ data: await commands.cancel(req.params.id) }),
  ),
);
router.get(
  "/incidents",
  route(async (req, res) => {
    const match = {};
    if (req.query.resolved !== "true") match.resolvedAt = null;
    else match.resolvedAt = { $ne: null };
    if (req.query.suppressed)
      match.suppressed = req.query.suppressed === "true";
    if (req.query.acknowledged)
      match.acknowledgedAt =
        req.query.acknowledged === "true" ? { $ne: null } : null;
    if (req.query.severity) {
      if (!["warning", "critical"].includes(req.query.severity))
        throw fail("Invalid severity");
      match.severity = req.query.severity;
    }
    const scoped = [
      "q",
      "status",
      "attention",
      "group",
      "tag",
      "includeArchived",
      "includeForgotten",
    ].some((k) => req.query[k]);
    if (scoped && !req.query.minerId)
      match.minerId = { $in: (await fleet(req.query)).map((r) => r.id) };
    const query = { ...req.query };
    // q/status select rigs for this resource, rather than incident message/status fields.
    delete query.q;
    delete query.status;
    const result = await records("incidents", query, match);
    res.json(result);
  }),
);
router.post(
  "/incidents/:key/acknowledge",
  route(async (req, res) => {
    const result = await getDb()
      .collection("incidents")
      .findOneAndUpdate(
        { key: req.params.key, resolvedAt: null },
        { $set: { acknowledgedAt: new Date(), acknowledgedBy: actor(req) } },
        { returnDocument: "after" },
      );
    if (!result) throw fail("Active incident not found", 404);
    res.json({ data: result });
  }),
);
router.get(
  "/monitoring/rules",
  route(async (req, res) =>
    res.json({
      data: await monitoring.rules(),
      limits: monitoring.RULE_LIMITS,
      automaticRecovery: "per-rig opt-in; sustained zero only",
    }),
  ),
);
router.put(
  "/monitoring/rules",
  route(async (req, res) => {
    const rules = monitoring.validateRules(req.body, await monitoring.rules());
    await getDb()
      .collection("settings")
      .updateOne({ id: "monitoring" }, { $set: { rules } }, { upsert: true });
    await monitoring.event(null, "monitoring-rules-updated", {
      actor: actor(req),
      rules,
    });
    res.json({ data: rules });
  }),
);
router.get(
  "/mining/engines",
  route(async (req, res) =>
    res.json({
      data: {
        srbminer: {
          ...require("../services/srbminer.json"),
          platforms: ["win32-x64", "linux-x64"],
          scopes: ["CPU", "GPU"],
          singleAlgorithmPerProcess: true,
          notes:
            "Vendor support is not a guarantee for every model/driver. Fees exclude pool fees. Slots remain xmrig (CPU) and nanominer (GPU).",
        },
      },
    }),
  ),
);
router.get(
  "/configs",
  route(async (req, res) => res.json({ data: await Config.getAll() })),
);
router.put(
  "/configs/:type",
  route(async (req, res) =>
    res.json({
      data: await Config.update(
        req.params.type,
        req.body,
        actor(req),
        req.get("If-Match")?.replace(/"/g, "") || req.body.version,
      ),
    }),
  ),
);
router.get(
  "/configs/:type/revisions",
  route(async (req, res) => {
    if (!Config.DEFAULTS[req.params.type]) throw fail("Unknown type");
    res.json({ data: await Config.revisions(req.params.type) });
  }),
);
router.post(
  "/configs/:type/rollback",
  route(async (req, res) => {
    const revision = await getDb()
      .collection("configRevisions")
      .findOne({ type: req.params.type, version: req.body.version });
    if (!revision) throw fail("Revision not found", 404);
    const clean = Object.fromEntries(
      Object.keys(Config.DEFAULTS[req.params.type]).map((k) => [
        k,
        revision[k],
      ]),
    );
    res.json({
      data: await Config.update(
        req.params.type,
        clean,
        actor(req),
        req.body.expectedVersion,
      ),
    });
  }),
);
router.post(
  "/configs/:type/apply",
  route(async (req, res) => {
    if (!Config.DEFAULTS[req.params.type]) throw fail("Unknown type");
    const ids = req.body.minerIds;
    if (!Array.isArray(ids))
      throw fail("Choose explicit minerIds for the rollout");
    const deviceType = req.params.type === "xmrig" ? "CPU" : "GPU";
    res.status(202).json(
      await commands.bulk(
        ids,
        {
          action: req.body.restart === true ? "restart" : "config-update",
          deviceType,
          configType: req.params.type,
          restartRunningOnly: true,
        },
        actor(req),
        req.get("Idempotency-Key"),
      ),
    );
  }),
);
module.exports = router;
module.exports.route = route;
module.exports.fleet = fleet;
module.exports.pageRigs = pageRigs;
module.exports.records = records;
