const { randomUUID, createHash } = require("crypto");
const { getDb } = require("../db/mongodb");
const Miner = require("../models/Miner");
const Config = require("../models/Config");
const { viewRig } = require("./telemetry");
const FINAL = ["succeeded", "failed", "timed_out", "canceled"];
const ACTIVE = ["queued", "sent", "received", "running"];
let transport = () => false,
  publish = () => {};
const problem = (message, status = 400) =>
  Object.assign(Error(message), { status });
function normalize(input = {}) {
  const aliases = {
    "restart-device": "restart",
    "start-cpu": "start",
    "stop-cpu": "stop",
    "start-gpu": "start",
    "stop-gpu": "stop",
  };
  const action = aliases[input.action] || input.action;
  const scope =
    input.deviceType ||
    (/-cpu$/.test(input.action)
      ? "CPU"
      : /-gpu$/.test(input.action)
        ? "GPU"
        : "ALL");
  if (
    ![
      "start",
      "stop",
      "restart",
      "device-enable",
      "device-disable",
      "config-update",
      "miner-diagnose",
      "miner-repair",
      "app-update-check",
      "app-update-install",
    ].includes(action)
  )
    throw problem("Unsupported action");
  if (input.gpuId != null || input.deviceId != null)
    throw problem(
      "Individual GPU control is unavailable; use explicit GPU process scope",
      422,
    );
  if (input.config)
    throw problem("Save a configuration revision before applying it");
  const deviceType = String(scope).toUpperCase();
  if (!["CPU", "GPU", "ALL"].includes(deviceType))
    throw problem("deviceType must be CPU, GPU, or ALL");
  if (action.startsWith("app-update-") && deviceType !== "ALL")
    throw problem("Application updates require ALL scope");
  const timeoutSeconds =
    input.timeoutSeconds === undefined
      ? action === "app-update-install"
        ? 600
        : action === "miner-repair"
          ? 300
          : 60
      : Number(input.timeoutSeconds);
  if (
    !Number.isInteger(timeoutSeconds) ||
    timeoutSeconds < 5 ||
    timeoutSeconds > (action === "app-update-install" ? 1800 : 300)
  )
    throw problem(
      "timeoutSeconds must be 5–300 (up to 1800 for app installation)",
    );
  if (input.configType && !["xmrig", "nanominer"].includes(input.configType))
    throw problem("Invalid configuration type");
  if (input.configType && !["restart", "config-update"].includes(action))
    throw problem(
      "configType is only valid for configuration delivery or restart rollout",
    );
  if (
    input.configType &&
    deviceType !== (input.configType === "xmrig" ? "CPU" : "GPU")
  )
    throw problem("Configuration type must match process scope");
  return {
    action,
    deviceType,
    timeoutSeconds,
    restartRunningOnly: input.restartRunningOnly === true,
    ...(input.configType ? { configType: input.configType } : {}),
  };
}
function configure(send, notify) {
  transport = send;
  publish = notify;
}
async function changed(command) {
  publish({ type: "command_updated", command });
  return command;
}
async function createOne(minerId, input, actor = "admin", idempotencyKey) {
  const spec = normalize(input),
    db = getDb();
  if (
    idempotencyKey &&
    (typeof idempotencyKey !== "string" || idempotencyKey.length > 160)
  )
    throw problem("Invalid idempotency key");
  const signature = JSON.stringify({ minerId, ...spec });
  const storedKey = idempotencyKey
    ? `${createHash("sha256").update(actor).digest("hex")}:${idempotencyKey}`
    : null;
  if (idempotencyKey) {
    const existing = await db
      .collection("commands")
      .findOne({ idempotencyKey: storedKey });
    if (existing) {
      if (existing.signature !== signature)
        throw problem("Idempotency key was used for another command", 409);
      return existing;
    }
  }
  const miner = await Miner.getById(minerId);
  if (!miner || miner.forgottenAt) throw problem("Rig not found", 404);
  if (miner.archivedAt || !miner.bound || !viewRig(miner).freshness.connected)
    throw problem("Rig must be active, bound, and connected", 409);
  if (miner.protocolVersion < 2 || !miner.capabilities?.commandResults)
    throw problem("Upgrade this agent for acknowledged remote control", 422);
  if (
    ["miner-diagnose", "miner-repair"].includes(spec.action) &&
    !miner.capabilities?.minerMaintenance
  )
    throw problem("Upgrade this agent for miner diagnostics and repair", 422);
  if (spec.action.startsWith("app-update-") && !miner.capabilities?.appUpdates)
    throw problem("Upgrade this agent for application update controls", 422);
  if (
    spec.action === "app-update-install" &&
    (!viewRig(miner).freshness.telemetryFresh ||
      miner.appUpdate?.state !== "downloaded" ||
      !miner.appUpdate?.supported ||
      !miner.appUpdate?.version)
  )
    throw problem(
      "A supported downloaded update and fresh rig status are required",
      409,
    );
  if (spec.deviceType === "GPU" && !miner.hardware?.gpus?.length)
    throw problem("No physical GPUs reported", 422);
  if (
    !["stop", "device-disable"].includes(spec.action) &&
    (await db.collection("commands").countDocuments({
      minerId,
      status: { $in: ACTIVE },
      ...(spec.deviceType === "ALL"
        ? {}
        : { deviceType: { $in: [spec.deviceType, "ALL"] } }),
    }))
  )
    throw problem(
      "Another command is pending for this process. Wait or cancel it first.",
      409,
    );
  if (
    actor === "automatic-recovery" &&
    !require("./recovery")
      .candidates(miner)
      .some((p) => p.deviceType === spec.deviceType)
  )
    throw problem("Recovery condition no longer applies", 409);
  const now = new Date(),
    command = {
      id: randomUUID(),
      minerId,
      ...spec,
      actor,
      signature,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      deadline: new Date(+now + spec.timeoutSeconds * 1000),
      batchId: input.batchId || null,
      history: [{ status: "queued", at: now }],
    };
  if (spec.action === "app-update-install") {
    command.targetVersion = miner.appUpdate.version;
    command.sourceVersion = miner.version;
    command.sourceBootId = miner.bootId;
  }
  if (idempotencyKey) command.idempotencyKey = storedKey;
  if (spec.action === "config-update" || spec.configType) {
    command.configs = await Config.getAll();
    for (const type of spec.deviceType === "ALL"
      ? ["xmrig", "nanominer"]
      : [spec.deviceType === "CPU" ? "xmrig" : "nanominer"]) {
      // A start/restart needs a launchable configuration; saving an incomplete draft is allowed.
      const process = miner.processes?.find((p) => p.type === type);
      const applicable =
        (type !== "nanominer" || miner.hardware?.gpus?.length) &&
        process?.enabled !== false &&
        (!spec.restartRunningOnly || process?.running);
      if (spec.action !== "config-update" && applicable)
        Config.validate(type, command.configs[type], { partial: false });
    }
  }
  const cpuConfig = command.configs?.xmrig || miner.desiredConfigs?.xmrig;
  if (
    ["CPU", "ALL"].includes(spec.deviceType) &&
    ["start", "restart", "config-update", "device-enable"].includes(
      spec.action,
    ) &&
    cpuConfig?.engine === "nanominer" &&
    !miner.capabilities?.cpuEngines?.includes?.("nanominer")
  )
    throw problem(
      "This agent cannot run Nanominer CPU. Upgrade it or select XMRig for this CPU configuration.",
      422,
    );
  try {
    await db.collection("commands").insertOne(command);
  } catch (error) {
    if (error.code === 11000 && idempotencyKey)
      return createOne(minerId, input, actor, idempotencyKey);
    throw error;
  }
  if (["stop", "device-disable"].includes(command.action)) {
    const superseded = await db
      .collection("commands")
      .find({
        minerId,
        status: { $in: ACTIVE },
        action: { $in: ["start", "restart", "app-update-install"] },
        ...(command.deviceType === "ALL"
          ? {}
          : { deviceType: { $in: [command.deviceType, "ALL"] } }),
      })
      .toArray();
    for (const old of superseded)
      await cancel(old.id, "Superseded by a newer stop");
  }
  if (command.configs) {
    const changes = {};
    for (const type of command.deviceType === "ALL"
      ? ["xmrig", "nanominer"]
      : [command.deviceType === "CPU" ? "xmrig" : "nanominer"])
      changes[`desiredConfigs.${type}`] = command.configs[type];
    await Miner.update(minerId, changes);
  }
  const state =
    command.action === "stop" || command.action === "device-disable"
      ? "stopped"
      : command.action === "start" || command.action === "restart"
        ? "running"
        : null;
  if (state)
    await Miner.update(minerId, {
      [`desiredState.${command.deviceType}`]: {
        state,
        commandId: command.id,
        updatedAt: now.toISOString(),
      },
    });
  const dispatched = await db.collection("commands").updateOne(
    { id: command.id, status: "queued" },
    {
      $set: { status: "sent", sentAt: now, updatedAt: now },
      $push: { history: { status: "sent", at: now } },
    },
  );
  // An operator can cancel while preparation is awaiting storage. Never dispatch a terminal command.
  if (!dispatched.matchedCount)
    return changed(await db.collection("commands").findOne({ id: command.id }));
  const sent = transport(miner.connectionId, {
    type: "command",
    data: { ...command, status: "sent" },
  });
  if (!sent)
    await report(minerId, {
      id: command.id,
      status: "failed",
      error: "Connection unavailable during dispatch",
    });
  return changed(await db.collection("commands").findOne({ id: command.id }));
}
const dispatchQueues = new Map();
async function create(minerId, input, actor, key) {
  const previous = dispatchQueues.get(minerId) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(() => createOne(minerId, input, actor, key));
  dispatchQueues.set(minerId, next);
  try {
    return await next;
  } finally {
    if (dispatchQueues.get(minerId) === next) dispatchQueues.delete(minerId);
  }
}
async function report(minerId, result) {
  if (
    !["received", "running", "succeeded", "failed", "canceled"].includes(
      result.status,
    )
  )
    throw problem("Invalid command result status");
  // Installation success is confirmed by a new registration, never by dispatch/handoff alone.
  const existing = await getDb()
    .collection("commands")
    .findOne({ id: result.id, minerId });
  if (
    existing?.action === "app-update-install" &&
    result.status === "succeeded"
  )
    result = { ...result, status: "running" };
  const allowed =
    result.status === "received"
      ? ["sent"]
      : result.status === "running"
        ? ["sent", "received", "running"]
        : ACTIVE;
  const now = new Date();
  const command = await getDb()
    .collection("commands")
    .findOneAndUpdate(
      {
        id: result.id,
        minerId,
        status: { $in: allowed },
        deadline: { $gt: now },
      },
      {
        $set: {
          status: result.status,
          updatedAt: now,
          result: result.result || null,
          error: result.error ? String(result.error).slice(0, 2000) : null,
        },
        $push: { history: { status: result.status, at: now } },
      },
      { returnDocument: "after" },
    );
  if (command) await changed(command);
  return command;
}
async function confirmAppVersion(miner) {
  const version = String(miner.version || "").split("+")[0];
  if (!version) return;
  const rows = await getDb()
    .collection("commands")
    .find({
      minerId: miner.id,
      action: "app-update-install",
      status: { $in: ACTIVE },
      deadline: { $gt: new Date() },
    })
    .toArray();
  for (const row of rows) {
    if (String(row.targetVersion || "").split("+")[0] !== version) continue;
    if (
      String(row.sourceVersion || "").split("+")[0] === version ||
      (row.sourceBootId && row.sourceBootId === miner.bootId)
    )
      continue;
    const now = new Date();
    const completed = await getDb()
      .collection("commands")
      .findOneAndUpdate(
        { id: row.id, status: { $in: ACTIVE }, deadline: { $gt: now } },
        {
          $set: {
            status: "succeeded",
            updatedAt: now,
            error: null,
            result: {
              phase: "version-confirmed",
              version: miner.version,
              bootId: miner.bootId,
            },
          },
          $push: { history: { status: "succeeded", at: now } },
        },
        { returnDocument: "after" },
      );
    if (completed) await changed(completed);
  }
}
async function cancel(id, reason = "Canceled by operator") {
  const now = new Date();
  const command = await getDb()
    .collection("commands")
    .findOneAndUpdate(
      { id, status: { $in: ACTIVE } },
      {
        $set: { status: "canceled", updatedAt: now, error: reason },
        $push: { history: { status: "canceled", at: now } },
      },
      { returnDocument: "after" },
    );
  if (!command) throw problem("Command is missing or already finished", 409);
  const miner = await Miner.getById(command.minerId);
  transport(miner?.connectionId, { type: "command-cancel", data: { id } });
  return changed(command);
}
async function expire(restarting = false) {
  const db = getDb(),
    now = new Date();
  const rows = await db
    .collection("commands")
    .find({
      status: { $in: ACTIVE },
      ...(restarting ? {} : { deadline: { $lte: now } }),
    })
    .toArray();
  for (const c of rows) {
    const status = "timed_out",
      error = restarting
        ? "Server restarted; execution outcome unknown. Inspect the rig before retrying."
        : "No completion before deadline; execution outcome unknown.";
    const updated = await db.collection("commands").findOneAndUpdate(
      { id: c.id, status: { $in: ACTIVE } },
      {
        $set: { status, error, updatedAt: now },
        $push: { history: { status, at: now } },
      },
      { returnDocument: "after" },
    );
    if (updated) {
      const m = await Miner.getById(c.minerId);
      transport(m?.connectionId, {
        type: "command-cancel",
        data: { id: c.id },
      });
      await changed(updated);
    }
  }
}
async function bulk(ids, spec, actor, key) {
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > 500 ||
    ids.some((id) => typeof id !== "string")
  )
    throw problem("Provide 1–500 rig IDs");
  normalize(spec);
  if (key && (typeof key !== "string" || key.length > 100))
    throw problem("Bulk idempotency keys must be at most 100 characters");
  ids = [...new Set(ids)];
  const batchId = key
      ? `batch:${createHash("sha256")
          .update(JSON.stringify([actor, key]))
          .digest("hex")
          .slice(0, 32)}`
      : randomUUID(),
    results = [];
  // Bound dispatch concurrency; every target has its own result and can fail independently.
  for (let i = 0; i < ids.length; i += 8)
    results.push(
      ...(await Promise.all(
        ids.slice(i, i + 8).map(async (minerId) => {
          try {
            return {
              minerId,
              command: await create(
                minerId,
                { ...spec, batchId },
                actor,
                key ? `${key}:${minerId}` : undefined,
              ),
            };
          } catch (e) {
            return { minerId, error: e.message, status: e.status || 503 };
          }
        }),
      )),
    );
  return { batchId, results };
}
module.exports = {
  configure,
  confirmAppVersion,
  normalize,
  create,
  report,
  cancel,
  expire,
  bulk,
  FINAL,
  ACTIVE,
};
