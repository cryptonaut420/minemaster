const { getDb, rawRetention } = require("../db/mongodb");
const { number, date, FRESH_MS } = require("../services/telemetry");
const MINUTE = 60000;
function intervalParts(previous, nextAt) {
  const start = date(previous?.hashrateObservedAt);
  const rate = number(previous?.hashrate);
  if (
    start === null ||
    rate === null ||
    !previous.algorithm ||
    !previous.running ||
    nextAt <= start
  )
    return [];
  const end = Math.min(nextAt, start + FRESH_MS),
    parts = [];
  for (let cursor = start; cursor < end;) {
    const bucket = Math.floor(cursor / MINUTE) * MINUTE,
      until = Math.min(end, bucket + MINUTE);
    parts.push({ bucket, start: cursor, end: until, rate });
    cursor = until;
  }
  return parts;
}
function queryWindow(query = {}, now = Date.now()) {
  const durations = {
    "1h": 3600000,
    "24h": 86400000,
    "7d": 604800000,
    "30d": 2592000000,
    "90d": 7776000000,
  };
  if (query.timeframe && !durations[query.timeframe])
    throw Object.assign(Error("Invalid timeframe"), { status: 400 });
  const to = query.to ? date(query.to) : now;
  const from = query.from
    ? date(query.from)
    : to === null
      ? null
      : to - (durations[query.timeframe] || durations["24h"]);
  const resolution = query.resolution
    ? Number(query.resolution)
    : to - from > 86400000
      ? 3600
      : 300;
  if (
    from === null ||
    to === null ||
    from >= to ||
    to > now + MINUTE ||
    to - from > 90 * 86400000 ||
    ![60, 300, 900, 3600, 86400].includes(resolution) ||
    (to - from) / (resolution * 1000) > 2500
  )
    throw Object.assign(
      Error(
        "Use a valid range up to 90 days, at most 2500 buckets, and resolution 60/300/900/3600/86400 seconds",
      ),
      { status: 400 },
    );
  return {
    from: Math.floor(from / MINUTE) * MINUTE,
    to: Math.ceil(to / MINUTE) * MINUTE,
    resolution,
  };
}
class HashRate {
  static async record(minerId, p, previous) {
    const db = getDb(),
      observed = date(p.hashrateObservedAt);
    // Finish the previous observed interval, including transitions to zero/stopped/unavailable.
    const nextAt = observed ?? Date.now();
    for (const part of intervalParts(previous, nextAt)) {
      const key = {
        minerId,
        processId: previous.id,
        algorithm: previous.algorithm,
        deviceType: previous.deviceType,
        timestamp: new Date(part.bucket),
      };
      const collection = db.collection("hashrateBuckets");
      // A persisted watermark makes overlapping/replayed intervals idempotent after reconnect/crash.
      const duration = {
        $max: [
          0,
          {
            $subtract: [
              part.end,
              {
                $max: [part.start, { $ifNull: ["$coveredUntil", part.start] }],
              },
            ],
          },
        ],
      };
      await collection.updateOne(
        key,
        [
          {
            $set: {
              ...Object.fromEntries(
                Object.entries(key).map(([field, value]) => [
                  field,
                  { $literal: value },
                ]),
              ),
              integral: {
                $add: [
                  { $ifNull: ["$integral", 0] },
                  { $multiply: [part.rate, duration] },
                ],
              },
              coveredMs: { $add: [{ $ifNull: ["$coveredMs", 0] }, duration] },
              coveredUntil: {
                $max: [part.end, { $ifNull: ["$coveredUntil", part.end] }],
              },
              min: { $min: [part.rate, { $ifNull: ["$min", part.rate] }] },
              max: { $max: [part.rate, { $ifNull: ["$max", part.rate] }] },
            },
          },
        ],
        { upsert: true },
      );
    }
    if (
      observed === null ||
      number(p.hashrate) === null ||
      !p.algorithm ||
      !["valid", "zero"].includes(p.quality)
    )
      return;
    await db.collection("hashrates").updateOne(
      {
        minerId,
        processId: p.id,
        observedAt: new Date(observed),
        algorithm: p.algorithm,
      },
      {
        $setOnInsert: {
          deviceType: p.deviceType,
          hashrate: p.hashrate,
          timestamp: new Date(),
          activeConfigVersion: p.appliedConfigVersion,
          quality: p.quality,
          source: p.source,
        },
      },
      { upsert: true },
    );
  }
  static async getTimeSeries(query = {}) {
    if (typeof query === "string") query = { timeframe: query };
    const window = queryWindow(query),
      width = window.resolution * 1000;
    const match = {
      timestamp: { $gte: new Date(window.from), $lt: new Date(window.to) },
    };
    if (query.minerIds) match.minerId = { $in: query.minerIds };
    if (query.minerId) match.minerId = query.minerId;
    if (query.processId) match.processId = query.processId;
    if (query.algorithm) match.algorithm = query.algorithm;
    if (query.deviceType) match.deviceType = query.deviceType;
    const rows = await getDb()
      .collection("hashrateBuckets")
      .aggregate(
        [
          { $match: match },
          {
            $group: {
              _id: {
                at: {
                  $subtract: [
                    { $toLong: "$timestamp" },
                    { $mod: [{ $toLong: "$timestamp" }, width] },
                  ],
                },
                algorithm: "$algorithm",
                deviceType: "$deviceType",
              },
              integral: { $sum: "$integral" },
              coveredMs: { $sum: "$coveredMs" },
              processes: {
                $addToSet: { rig: "$minerId", process: "$processId" },
              },
              min: { $min: "$min" },
              max: { $max: "$max" },
            },
          },
          { $sort: { "_id.at": 1 } },
        ],
        { maxTimeMS: 15000 },
      )
      .toArray();
    const keys = new Map();
    for (const row of rows) {
      const key = `${row._id.deviceType}:${row._id.algorithm}`;
      if (!keys.has(key))
        keys.set(key, {
          key,
          algorithm: row._id.algorithm,
          deviceType: row._id.deviceType,
          processes: new Set(),
        });
      row.processes.forEach((p) =>
        keys.get(key).processes.add(`${p.rig}:${p.process}`),
      );
    }
    if (
      keys.size > 64 ||
      Math.ceil((window.to - window.from) / width) * keys.size > 50000
    )
      throw Object.assign(
        Error(
          "Too many chart series/points; narrow the range or filter by algorithm/rig",
        ),
        { status: 400 },
      );
    const lookup = new Map(
      rows.map((r) => [
        `${r._id.at}:${r._id.deviceType}:${r._id.algorithm}`,
        r,
      ]),
    );
    const data = [];
    for (
      let at = Math.floor(window.from / width) * width;
      at < window.to;
      at += width
    ) {
      const duration =
        Math.min(at + width, window.to) - Math.max(at, window.from);
      for (const group of keys.values()) {
        const r = lookup.get(`${at}:${group.key}`),
          coverage = r
            ? Math.min(1, r.coveredMs / (duration * group.processes.size))
            : 0;
        data.push({
          timestamp: new Date(at).toISOString(),
          key: group.key,
          algorithm: group.algorithm,
          deviceType: group.deviceType,
          hashrate: r ? r.integral / duration : null,
          coverage,
          reportingProcesses: r?.processes.length || 0,
          expectedProcesses: group.processes.size,
          quality: !r ? "unavailable" : coverage < 0.98 ? "partial" : "valid",
          unit: "H/s",
        });
      }
    }
    return {
      ...window,
      from: new Date(window.from).toISOString(),
      to: new Date(window.to).toISOString(),
      data,
      series: [...keys.values()].map(({ processes, ...g }) => g),
      aggregation:
        "time-weighted observed contribution; gaps are unknown; partial buckets are lower bounds",
      coverageBasis: "processes observed anywhere in this query window",
      rawRetentionDays: rawRetention,
      rollupRetentionDays: 90,
    };
  }
  static async getStats(timeframe) {
    return HashRate.getTimeSeries({ timeframe });
  }
  static async getByMiner(minerId, limit = 100) {
    return getDb()
      .collection("hashrates")
      .find({ minerId })
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();
  }
}
module.exports = HashRate;
module.exports.intervalParts = intervalParts;
module.exports.queryWindow = queryWindow;
