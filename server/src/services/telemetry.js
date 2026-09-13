const FRESH_MS = 60000;
const CONNECTION_MS = 90000;
const number = (v, min = 0, max = Number.MAX_VALUE) =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max
    ? v
    : null;
const date = (v) => {
  const n = typeof v === "number" ? v : Date.parse(v);
  return Number.isFinite(n) ? n : null;
};
const iso = (v) => (date(v) === null ? null : new Date(date(v)).toISOString());
function gpuIdentity(gpu, index) {
  const bus = gpu.pciBus || gpu.busAddress || gpu.bus;
  let normalized = bus
    ? String(bus)
        .toLowerCase()
        .replace(/^00000000:/, "0000:")
    : null;
  if (normalized && /^[0-9a-f]{2}:[0-9a-f]{2}\.[0-7]$/.test(normalized))
    normalized = `0000:${normalized}`;
  return (
    gpu.deviceId ||
    (bus
      ? `pci:${normalized}`
      : gpu.uuid
        ? `uuid:${gpu.uuid}`
        : `index:${gpu.id ?? index}`)
  );
}
function normalizeGpus(gpus = []) {
  const seen = new Set();
  return (Array.isArray(gpus) ? gpus : [])
    .filter(Boolean)
    .filter(
      (g) =>
        g.integrated !== true && !/basic display|virtual/i.test(g.model || ""),
    )
    .map((g, i) => ({
      ...g,
      deviceId: gpuIdentity(g, i),
      identityQuality:
        g.deviceId || g.uuid || g.bus || g.pciBus || g.busAddress
          ? "hardware"
          : "positional",
    }))
    .filter((g) => {
      if (seen.has(g.deviceId)) return false;
      seen.add(g.deviceId);
      return true;
    });
}
function normalizeProcesses(payload, now = Date.now()) {
  let input = payload.processes || payload.miners;
  if (!Array.isArray(input)) {
    const d = payload.devices || {};
    input = [];
    if (d.cpu)
      input.push({ ...d.cpu, id: "xmrig-1", type: "xmrig", deviceType: "CPU" });
    if (d.gpus?.length)
      input.push({
        id: "nanominer-1",
        type: "nanominer",
        deviceType: "GPU",
        running: d.gpus.some((g) => g.running),
        enabled: d.gpus.some((g) => g.enabled !== false),
        algorithm: d.gpus.find((g) => g.algorithm)?.algorithm,
        hashrate:
          payload.deviceType === "GPU"
            ? payload.hashrate
            : d.gpus.reduce((n, g) => n + (number(g.hashrate) || 0), 0),
      });
  }
  if (
    input.length > 32 ||
    input.some((p) => !p || typeof p !== "object" || Array.isArray(p))
  )
    throw Object.assign(Error("Report at most 32 process objects"), {
      status: 400,
    });
  const seen = new Set();
  return input.map((p) => {
    if (p.deviceType !== undefined && !["CPU", "GPU"].includes(p.deviceType))
      throw Object.assign(Error("Process deviceType must be CPU or GPU"), {
        status: 400,
      });
    const id = String(
      p.id || p.minerId || (p.deviceType === "GPU" ? "nanominer-1" : "xmrig-1"),
    ).slice(0, 100);
    if (seen.has(id))
      throw Object.assign(
        Error("Process IDs must be unique within a snapshot"),
        { status: 400 },
      );
    seen.add(id);
    const observed = date(p.hashrateObservedAt ?? p.observedAt);
    const protocol2 = payload.protocolVersion >= 2;
    const validTime = observed !== null && observed <= now + 5000;
    const rate = number(p.hashrate);
    const quality =
      rate === null
        ? "unavailable"
        : protocol2 && !validTime
          ? "unavailable"
          : now - (observed ?? now) > FRESH_MS
            ? "stale"
            : rate === 0
              ? "zero"
              : "valid";
    return {
      id,
      type: p.type || (p.deviceType === "GPU" ? "nanominer" : "xmrig"),
      deviceType: p.deviceType === "GPU" ? "GPU" : "CPU",
      running: p.running === true,
      enabled: p.enabled !== false,
      algorithm:
        typeof p.algorithm === "string" ? p.algorithm.slice(0, 80) : null,
      hashrate: rate,
      hashrateObservedAt: validTime
        ? iso(observed)
        : protocol2
          ? null
          : new Date(now).toISOString(),
      quality,
      startedAt: iso(p.startedAt ?? p.startTime),
      activeConfig: p.activeConfig || null,
      appliedConfigVersion: p.appliedConfigVersion || null,
      desiredConfigVersion: p.desiredConfigVersion || null,
      error: typeof p.error === "string" ? p.error.slice(0, 2000) : null,
      pid: number(p.pid),
      minerVersion: p.minerVersion || null,
      shares: p.shares || null,
      pool: p.pool || null,
      localOverrides: p.localOverrides || [],
      enabledDeviceIds: Array.isArray(p.enabledDeviceIds)
        ? p.enabledDeviceIds
        : null,
      source: protocol2 ? "observed" : "legacy-cached",
    };
  });
}
function viewRig(rig, now = Date.now()) {
  const r = { ...rig };
  const connected =
    !!r.connectionId &&
    now - (date(r.connectionLastSeen || r.lastSeen) ?? 0) <= CONNECTION_MS;
  const fresh =
    connected && now - (date(r.telemetryReceivedAt) ?? 0) <= FRESH_MS;
  r.processes = (r.processes || []).map((p) => ({
    ...p,
    quality: !fresh
      ? "stale"
      : date(p.hashrateObservedAt) === null || number(p.hashrate) === null
        ? "unavailable"
        : now - date(p.hashrateObservedAt) > FRESH_MS
          ? "stale"
          : p.quality,
    uptime:
      fresh && p.running && date(p.startedAt) !== null
        ? Math.max(0, Math.floor((now - date(p.startedAt)) / 1000))
        : null,
  }));
  if (r.stats)
    r.stats = {
      ...r.stats,
      quality:
        !fresh || now - (date(r.stats.observedAt) ?? 0) > FRESH_MS
          ? "stale"
          : r.stats.quality,
    };
  r.status = r.forgottenAt
    ? "forgotten"
    : r.archivedAt
      ? "archived"
      : !connected
        ? "offline"
        : !fresh
          ? "stale"
          : r.processes.some((p) => p.error)
            ? "error"
            : r.processes.some((p) => p.running)
              ? "mining"
              : "online";
  r.freshness = {
    connected,
    telemetryFresh: fresh,
    lastTelemetryAt: r.telemetryReceivedAt || null,
    ageSeconds:
      date(r.telemetryReceivedAt) === null
        ? null
        : Math.max(0, Math.floor((now - date(r.telemetryReceivedAt)) / 1000)),
  };
  r.mining = fresh && r.processes.some((p) => p.running);
  r.maintenance = date(r.maintenanceUntil) > now;
  r.configDrift = r.processes
    .filter(
      (p) =>
        p.running &&
        p.desiredConfigVersion &&
        p.desiredConfigVersion !== p.appliedConfigVersion,
    )
    .map((p) => p.id);
  r.attention =
    !r.archivedAt &&
    !r.forgottenAt &&
    !r.maintenance &&
    (!fresh ||
      r.status === "error" ||
      r.configDrift.length > 0 ||
      r.processes.some(
        (p) =>
          p.running && ["zero", "stale", "unavailable"].includes(p.quality),
      ));
  r.reason = !connected
    ? "Agent disconnected"
    : !fresh
      ? "Telemetry overdue"
      : r.processes.find((p) => p.error)?.error ||
        (r.configDrift.length
          ? "Configuration pending"
          : r.processes.some((p) => p.running && p.quality === "zero")
            ? "Zero hashrate"
            : r.processes.some(
                  (p) =>
                    p.running && ["stale", "unavailable"].includes(p.quality),
                )
              ? "Hashrate unavailable"
              : r.mining
                ? "Mining"
                : "Idle");
  return r;
}
function summary(rigs, now = Date.now()) {
  const counts = {
    total: 0,
    online: 0,
    mining: 0,
    offline: 0,
    stale: 0,
    error: 0,
    attention: 0,
    maintenance: 0,
    configDrift: 0,
    idle: 0,
  };
  const algorithms = {};
  const hardware = {
    gpus: 0,
    sensorReportingRigs: 0,
    gpuPowerReportingDevices: 0,
    gpuPowerWatts: null,
    maxTemperatureC: null,
  };
  for (const raw of rigs) {
    const r = viewRig(raw, now);
    if (r.archivedAt || r.forgottenAt) continue;
    counts.total++;
    if (r.freshness.connected) counts.online++;
    if (r.status in counts && r.status !== "online") counts[r.status]++;
    if (r.attention) counts.attention++;
    if (raw.openIncidents?.length && !r.attention && !r.maintenance)
      counts.attention++;
    if (r.maintenance) counts.maintenance++;
    if (r.configDrift.length) counts.configDrift++;
    if (r.status === "online") counts.idle++;
    hardware.gpus += r.hardware?.gpus?.length || 0;
    if (r.stats?.quality === "observed") {
      hardware.sensorReportingRigs++;
      const readings = (r.hardware?.gpus || [])
        .map((g) => r.stats.gpus?.find((s) => s.deviceId === g.deviceId))
        .filter(Boolean);
      for (const g of readings)
        if (number(g.powerWatts) !== null) {
          hardware.gpuPowerWatts = (hardware.gpuPowerWatts ?? 0) + g.powerWatts;
          hardware.gpuPowerReportingDevices++;
        }
      const temperatures = [
        r.stats.cpu?.temperature,
        ...readings.map((g) => g.temperature),
      ].filter((t) => number(t, -30, 150) !== null);
      if (temperatures.length)
        hardware.maxTemperatureC = Math.max(
          hardware.maxTemperatureC ?? -Infinity,
          ...temperatures,
        );
    }
    for (const p of r.processes) {
      if (!p.algorithm) continue;
      const key = `${p.deviceType}:${p.algorithm}`;
      const group = (algorithms[key] ||= {
        key,
        deviceType: p.deviceType,
        algorithm: p.algorithm,
        hashrate: 0,
        reportingProcesses: 0,
        runningProcesses: 0,
        unavailableProcesses: 0,
        unit: "H/s",
      });
      if (p.running) group.runningProcesses++;
      if (
        r.freshness.telemetryFresh &&
        p.running &&
        ["valid", "zero"].includes(p.quality)
      ) {
        group.hashrate += p.hashrate;
        group.reportingProcesses++;
      } else if (p.running) group.unavailableProcesses++;
    }
  }
  return {
    asOf: new Date(now).toISOString(),
    counts,
    algorithms: Object.values(algorithms).map((g) => ({
      ...g,
      hashrate: g.reportingProcesses ? g.hashrate : null,
      quality: !g.reportingProcesses
        ? "unavailable"
        : g.unavailableProcesses
          ? "partial"
          : "valid",
    })),
    hardware,
    freshnessThresholdSeconds: FRESH_MS / 1000,
  };
}
module.exports = {
  FRESH_MS,
  CONNECTION_MS,
  number,
  date,
  iso,
  normalizeGpus,
  gpuIdentity,
  normalizeProcesses,
  viewRig,
  summary,
};
