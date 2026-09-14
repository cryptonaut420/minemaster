const { randomUUID } = require("crypto");
const Miner = require("../models/Miner");
const Config = require("../models/Config");
const HashRate = require("../models/HashRate");
const { getDb } = require("../db/mongodb");
const {
  normalizeGpus,
  normalizeProcesses,
  reconcileProcess,
  viewRig,
  date,
} = require("../services/telemetry");
const commands = require("../services/commands");
const monitoring = require("../services/monitoring");
const { authenticateAccess } = require("../middleware/auth");
const connections = new Map(),
  queues = new Map();
let timer,
  sweepBusy = false;
let monitorState = {
  status: "starting",
  lastSweepAt: null,
  lastSuccessfulSweepAt: null,
  failedRigs: 0,
};
function monitoringStatus() {
  const overdue =
    monitorState.lastSweepAt &&
    Date.now() - date(monitorState.lastSweepAt) > 90000;
  return {
    ...monitorState,
    status: overdue ? "overdue" : monitorState.status,
    running: sweepBusy,
    intervalSeconds: 30,
  };
}
function serialize(key, work) {
  const previous = queues.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(work);
  queues.set(key, next);
  next
    .finally(() => {
      if (queues.get(key) === next) queues.delete(key);
    })
    .catch(() => {});
  return next;
}
function sendToMiner(connectionId, message) {
  const c = connections.get(connectionId);
  if (!c || c.closed || c.ws.readyState !== 1) return false;
  if (c.ws.bufferedAmount > 1024 * 1024) {
    c.ws.close(1013, "Consumer too slow");
    return false;
  }
  c.ws.send(JSON.stringify(message));
  return true;
}
function broadcast(message) {
  // Agents receive only their own protocol messages. Observer updates are incremental.
  for (const [id, c] of connections)
    if (c.observer && !c.minerId) {
      if (c.principal?.expiresAt && c.principal.expiresAt <= Date.now()) {
        c.observer = false;
        c.ws.close(4001, "Observer credentials expired");
      } else sendToMiner(id, message);
    }
}
function revokeKeyObservers(id) {
  for (const c of connections.values())
    if (
      c.observer &&
      c.principal?.kind === "api-key" &&
      c.principal.id === id
    ) {
      c.observer = false;
      c.ws.close(4001, "API key revoked");
    }
}
function broadcastMiner(miner) {
  if (miner) broadcast({ type: "miner_updated", miner: miner.toJSON() });
}
async function register(c, data) {
  if (c.observer) throw Error("Open a separate connection to register a miner");
  if (
    typeof data.systemId !== "string" ||
    !data.systemId.trim() ||
    data.systemId.length > 200
  )
    throw Error("A stable systemId is required");
  if (c.minerId && c.systemId !== data.systemId)
    throw Error("A connection cannot change rig identity");
  let miner = await Miner.getBySystemId(data.systemId);
  if (miner?.forgottenAt) {
    sendToMiner(c.id, {
      type: "error",
      error: "Rig was forgotten. Restore it in admin before registering again.",
    });
    c.ws.close(1000, "Rig forgotten");
    return;
  }
  if (c.closed) return;
  const info = data.systemInfo || {},
    gpus = normalizeGpus(info.gpus || info.gpu?.controllers || []);
  const hostname = info.hostname || info.os?.hostname || "unknown";
  const changes = {
    systemId: data.systemId,
    hostname,
    name: miner?.name || data.clientName || hostname,
    reportedName: data.clientName || hostname,
    os: info.os?.distro || info.os?.release || info.platform || "unknown",
    hardware: {
      cpu: info.cpu || null,
      gpus,
      memory: info.memory || info.mem || null,
      gpuDetectionStatus: info.gpuDetectionStatus || null,
      gpuObservedAt: info.gpuObservedAt || null,
    },
    connectionId: c.id,
    connectionLastSeen: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
    telemetryReceivedAt: null,
    bound: true,
    protocolVersion: data.protocolVersion === 2 ? 2 : 1,
    version: data.version || null,
    bootId: data.bootId || null,
    capabilities: data.capabilities || {},
    ip: c.ip,
    observedPeerIp: c.peerIp,
    addressSource:
      process.env.TRUST_PROXY_IP === "true" ? "forwarded" : "socket",
  };
  const previousId = miner?.connectionId;
  if (!miner) {
    changes.expectedDeviceIds = gpus.map((g) => g.deviceId);
    miner = await Miner.create(changes);
  } else miner = await Miner.update(miner.id, changes);
  c.minerId = miner.id;
  c.systemId = data.systemId;
  c.observer = false;
  if (previousId && previousId !== c.id) {
    const previous = connections.get(previousId);
    if (previous) {
      previous.closed = true;
      previous.ws.close(1000, "Replaced by newer connection");
      connections.delete(previousId);
    }
  }
  await commands.confirmAppVersion(miner);
  const configs = miner.desiredConfigs || (await Config.getAll());
  if (!miner.desiredConfigs)
    await Miner.update(miner.id, { desiredConfigs: configs });
  sendToMiner(c.id, {
    type: data.silent ? "registered" : "bound",
    data: {
      minerId: miner.id,
      configs: Config.forAgent(configs, miner.capabilities),
      protocolVersion: 2,
      capabilities: { commandResults: true, logs: true },
    },
  });
  if (Config.forAgent(configs, miner.capabilities) !== configs)
    sendToMiner(c.id, {
      type: "error",
      error:
        "An assigned mining engine is unavailable on this agent. Upgrade the client or assign a supported engine; incompatible settings were not delivered.",
    });
  await monitoring.event(miner.id, "agent-connected", {
    version: miner.version,
    bootId: miner.bootId,
  });
  broadcastMiner(miner);
}
async function owned(c) {
  if (c.closed || !c.minerId) return null;
  const m = await Miner.getById(c.minerId);
  return m && m.connectionId === c.id && !m.forgottenAt ? m : null;
}
async function status(c, data) {
  const miner = await owned(c);
  if (!miner) return;
  const now = new Date().toISOString();
  const payload = { ...data, protocolVersion: miner.protocolVersion };
  const processes = normalizeProcesses(payload);
  for (const process of processes) {
    process.loadedConfigVersion = process.desiredConfigVersion;
    process.desiredConfigVersion =
      miner.desiredConfigs?.[process.type]?.version ||
      process.desiredConfigVersion;
    const previous = miner.processes?.find((p) => p.id === process.id);
    reconcileProcess(process, previous, miner.telemetryReceivedAt);
    const closedInterval =
      previous?.running && !process.running
        ? {
            ...process,
            hashrateObservedAt: now,
            hashrate: null,
            quality: "unavailable",
            algorithm: previous.algorithm,
          }
        : process;
    await HashRate.record(miner.id, closedInterval, previous);
  }
  for (const previous of miner.processes || [])
    if (!processes.some((p) => p.id === previous.id))
      await HashRate.record(
        miner.id,
        {
          ...previous,
          running: false,
          hashrate: null,
          hashrateObservedAt: now,
          quality: "unavailable",
        },
        previous,
      );
  const gpuInfo = data.systemInfo?.gpus;
  const hardware = gpuInfo
    ? {
        ...miner.hardware,
        gpus: normalizeGpus(gpuInfo),
        gpuDetectionStatus: data.systemInfo.gpuDetectionStatus || null,
        gpuObservedAt: data.systemInfo.gpuObservedAt || null,
      }
    : miner.hardware;
  const stats = monitoring.sensors(payload);
  const devices = {
    cpu: processes.find((p) => p.deviceType === "CPU") || { running: false },
    gpus: hardware.gpus.map((g) => ({
      ...g,
      hashrate: null,
      telemetry: stats.gpus.find((s) => s.deviceId === g.deviceId) || null,
    })),
    gpuProcess: processes.find((p) => p.deviceType === "GPU") || null,
  };
  // History is persisted before the snapshot; replaying a failed update is safe.
  if (!miner.lastMetricAt || Date.now() - date(miner.lastMetricAt) >= 30000)
    await getDb()
      .collection("metrics")
      .insertOne({ minerId: miner.id, timestamp: new Date(), ...stats });
  const updated = await Miner.update(
    miner.id,
    {
      processes,
      appUpdate: require("../services/appUpdates").normalize(data.appUpdate),
      hardware,
      devices,
      stats,
      telemetryReceivedAt: now,
      connectionLastSeen: now,
      lastSeen: now,
      lastMetricAt:
        !miner.lastMetricAt || Date.now() - date(miner.lastMetricAt) >= 30000
          ? now
          : miner.lastMetricAt,
      reportedName: data.clientName || miner.reportedName,
    },
    { connectionId: c.id, forgottenAt: null },
  );
  if (updated) broadcastMiner(updated);
}
async function handle(c, message) {
  const data = message.data || message;
  if (message.type === "register") return register(c, data);
  if (message.type === "subscribe") {
    if (!c.minerId) {
      const principal = await authenticateAccess({
        token: data.token,
        apiKey: data.apiKey,
      });
      if (!principal) {
        c.observer = false;
        sendToMiner(c.id, {
          type: "error",
          code: "authentication_required",
          error:
            "An admin session or valid API key is required for fleet subscriptions",
        });
        c.ws.close(4001, "Observer authentication required");
        return;
      }
      c.principal = principal;
      c.observer = true;
      sendToMiner(c.id, { type: "subscribed", protocolVersion: 2 });
    }
    return;
  }
  if (message.type === "heartbeat" || message.type === "ping") {
    const miner = await owned(c);
    if (miner)
      await Miner.update(
        miner.id,
        { connectionLastSeen: new Date().toISOString() },
        { connectionId: c.id },
      );
    sendToMiner(c.id, { type: "pong" });
    return;
  }
  const miner = await owned(c);
  if (!miner) return;
  switch (message.type) {
    case "status-update":
      return status(c, data);
    case "hashrate-update": {
      // Legacy agent compatibility only. V2 reports original observations in its process snapshot.
      if (miner.protocolVersion >= 2) return;
      const h = data.hashrate || {},
        id = h.minerId || (h.deviceType === "GPU" ? "nanominer-1" : "xmrig-1");
      const next = normalizeProcesses({
        miners: [{ ...h, id, running: true }],
      })[0];
      await HashRate.record(
        miner.id,
        next,
        miner.processes?.find((p) => p.id === id),
      );
      const processes = (miner.processes || [])
        .filter((p) => p.id !== id)
        .concat(next);
      broadcastMiner(
        await Miner.update(miner.id, { processes }, { connectionId: c.id }),
      );
      return;
    }
    case "command-result":
      return commands.report(miner.id, data);
    case "logs":
      return monitoring.ingestLogs(miner.id, data.entries);
    case "event":
      return monitoring.event(miner.id, data.kind, data.details || {});
    case "request-configs": {
      const assigned = miner.desiredConfigs || (await Config.getAll());
      const supported = Config.forAgent(assigned, miner.capabilities);
      sendToMiner(c.id, { type: "config-update", data: supported });
      if (supported !== assigned)
        sendToMiner(c.id, {
          type: "error",
          error:
            "An assigned mining engine is unavailable on this agent. Upgrade the client or assign a supported engine; incompatible settings were not delivered.",
        });
      return;
    }
    case "unbound": {
      broadcastMiner(
        await Miner.update(
          miner.id,
          { bound: false, connectionId: null },
          { connectionId: c.id },
        ),
      );
      sendToMiner(c.id, { type: "unbound" });
      c.ws.close(1000, "Unbound");
      return;
    }
    default:
      throw Error("Unsupported message type");
  }
}
async function close(c) {
  c.closed = true;
  connections.delete(c.id);
  if (!c.minerId) return;
  await serialize(c.systemId, async () => {
    const miner = await Miner.update(
      c.minerId,
      { connectionId: null, disconnectedAt: new Date().toISOString() },
      { connectionId: c.id },
    );
    if (miner) {
      broadcastMiner(miner);
      await monitoring.event(miner.id, "agent-disconnected");
    }
  });
}
async function sweep() {
  if (sweepBusy) return;
  sweepBusy = true;
  const started = Date.now();
  let failedRigs = 0;
  try {
    for (const c of connections.values()) {
      if (c.observer && c.principal?.kind === "api-key") {
        const active = await getDb()
          .collection("apiKeys")
          .findOne({
            id: c.principal.id,
            revokedAt: null,
            $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
          });
        if (!active) {
          revokeKeyObservers(c.principal.id);
          continue;
        }
      }
      if (!c.alive) {
        c.ws.terminate();
        continue;
      }
      c.alive = false;
      c.ws.ping();
    }
    await commands.expire();
    const settings = await monitoring.rules();
    for (const miner of await Miner.getAll()) {
      try {
        await serialize(miner.systemId || miner.id, async () => {
          const latest = await Miner.getById(miner.id);
          if (!latest) return;
          // Close observed intervals even if no more samples arrive; never hold a rate beyond its freshness limit.
          for (const p of latest.processes || [])
            if (Date.now() - date(p.hashrateObservedAt) >= 60000)
              await HashRate.record(
                latest.id,
                { ...p, hashrateObservedAt: null, quality: "unavailable" },
                p,
              );
          await monitoring.check(latest, settings);
          await require("../services/recovery").check(latest);
        });
      } catch (error) {
        failedRigs++;
        console.error(`Monitoring rig ${miner.id} failed:`, error.message);
      }
    }
    monitorState = {
      status: failedRigs ? "degraded" : "healthy",
      lastSweepAt: new Date().toISOString(),
      lastSuccessfulSweepAt: failedRigs
        ? monitorState.lastSuccessfulSweepAt
        : new Date().toISOString(),
      failedRigs,
      durationMs: Date.now() - started,
    };
    broadcast({
      type: "monitoring_updated",
      asOf: monitorState.lastSweepAt,
      monitoring: monitoringStatus(),
    });
  } catch (error) {
    monitorState = {
      ...monitorState,
      status: "unavailable",
      lastSweepAt: new Date().toISOString(),
      failedRigs,
      durationMs: Date.now() - started,
    };
    console.error("Monitoring sweep failed:", error.message);
    broadcast({ type: "service_error", error: "Monitoring unavailable" });
  } finally {
    sweepBusy = false;
  }
}
function initialize(wss) {
  commands.configure(sendToMiner, broadcast);
  wss.on("connection", (ws, req) => {
    const c = {
      id: randomUUID(),
      ws,
      alive: true,
      observer: false,
      closed: false,
      ip:
        process.env.TRUST_PROXY_IP === "true"
          ? String(req.headers["x-forwarded-for"] || req.socket.remoteAddress)
              .split(",")[0]
              .trim()
          : req.socket.remoteAddress,
      peerIp: req.socket.remoteAddress,
      pending: 0,
    };
    connections.set(c.id, c);
    sendToMiner(c.id, {
      type: "connected",
      connectionId: c.id,
      protocolVersion: 2,
    });
    ws.on("pong", () => {
      c.alive = true;
      if (c.minerId)
        serialize(c.systemId, () =>
          Miner.update(
            c.minerId,
            { connectionLastSeen: new Date().toISOString() },
            { connectionId: c.id },
          ),
        ).catch((e) => console.error("Pong update failed:", e.message));
    });
    ws.on("message", (raw) => {
      if (c.closed) return;
      try {
        const message = JSON.parse(raw.toString());
        if (!message || typeof message !== "object")
          throw Error("Invalid message");
        if (++c.pending > 100) {
          c.ws.close(1013, "Message queue full");
          return;
        }
        const registrationKey =
          message.type === "register"
            ? (message.data || message).systemId
            : null;
        if (typeof registrationKey === "string" && !c.systemId)
          c.systemId = registrationKey;
        serialize(c.systemId || c.id, () =>
          c.closed ? null : handle(c, message),
        )
          .catch((error) => {
            console.error("Rig message failed:", error.message);
            sendToMiner(c.id, { type: "error", error: error.message });
          })
          .finally(() => c.pending--);
      } catch (error) {
        sendToMiner(c.id, { type: "error", error: "Invalid JSON message" });
      }
    });
    ws.on("close", () =>
      close(c).catch((error) =>
        console.error("Disconnect update failed:", error.message),
      ),
    );
    ws.on("error", (error) => console.error("WebSocket error:", error.message));
  });
  timer = setInterval(sweep, 30000);
  timer.unref();
}
async function forget(id) {
  const miner = await Miner.getById(id);
  if (!miner) return false;
  return serialize(miner.systemId || id, async () => {
    const pending = await getDb()
      .collection("commands")
      .find({ minerId: id, status: { $in: commands.ACTIVE } })
      .toArray();
    for (const command of pending)
      await commands.cancel(command.id, "Rig forgotten");
    await Miner.delete(id);
    await monitoring.check(
      { ...miner, forgottenAt: new Date().toISOString() },
      await monitoring.rules(),
    );
    await monitoring.event(id, "rig-forgotten", { historyPreserved: true });
    const c = connections.get(miner.connectionId);
    if (c) {
      c.closed = true;
      c.ws.close(1000, "Rig forgotten");
      connections.delete(c.id);
    }
    broadcast({ type: "miner_deleted", minerId: id });
    return true;
  });
}
function shutdown() {
  clearInterval(timer);
}
module.exports = {
  initialize,
  shutdown,
  broadcast,
  sendToMiner,
  sendToConnection: sendToMiner,
  forget,
  serialize,
  sweep,
  connections,
  revokeKeyObservers,
  monitoringStatus,
  viewRig,
};
