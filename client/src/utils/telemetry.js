// Process aggregates only: a per-GPU line must never replace the process total.
export function parseAggregate(line) {
  const text = String(line || "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, ""); // eslint-disable-line no-control-regex
  const match =
    text.match(
      /\bspeed\s+\S+\s+(\d+(?:\.\d+)?)\s+(?:[\d.]+|n\/a)\s+(?:[\d.]+|n\/a)\s*([kmgt]?h\/s)\b/i,
    ) ||
    text.match(
      /\bTotal(?:\s+speed|\s+hashrate)?\s*:\s*(\d+(?:\.\d+)?)\s*([kmgt]?h\/s)\b/i,
    );
  if (!match) return null;
  const rate =
    Number(match[1]) *
    { "h/s": 1, "kh/s": 1e3, "mh/s": 1e6, "gh/s": 1e9, "th/s": 1e12 }[
      match[2].toLowerCase()
    ];
  return Number.isFinite(rate) && rate >= 0 ? rate : null;
}
export function createLineBuffer() {
  let pending = "";
  return (chunk) => {
    pending += String(chunk);
    const lines = pending.split(/\r\n|\r|\n/);
    pending = lines.pop().slice(-16000);
    return lines;
  };
}
// stdout and stderr can interleave in the middle of lines; never concatenate them.
export function createProcessLineBuffer() {
  let currentRun;
  let streams = new Map();
  return (chunk, stream = "stdout", runId = null) => {
    if (currentRun !== runId) {
      currentRun = runId;
      streams = new Map();
    }
    const key = stream === "stderr" ? "stderr" : "stdout";
    if (!streams.has(key)) streams.set(key, createLineBuffer());
    return streams.get(key)(chunk);
  };
}
export function parseShares(line) {
  const match = String(line).match(
    /\b(?:accepted|rejected)\s*\((\d+)\/(\d+)\)/i,
  );
  return match
    ? {
        accepted: Number(match[1]),
        rejected: Number(match[2]),
        observedAt: new Date().toISOString(),
        source: "xmrig-counter",
      }
    : null;
}
export function processSnapshot(miner, now = Date.now()) {
  const observed = miner.hashrateObservedAt || null;
  const observedTime = Date.parse(observed);
  const valid =
    typeof miner.hashrate === "number" && Number.isFinite(miner.hashrate);
  return {
    id: miner.id,
    type: miner.type,
    engine: miner.running
      ? miner.engine || miner.activeConfig?.engine || miner.type
      : miner.config?.engine || miner.type,
    effectiveSettings: miner.running ? miner.effectiveSettings || null : null,
    deviceType: miner.deviceType,
    running: miner.running === true,
    enabled: miner.enabled !== false,
    hashrate: miner.running && valid ? miner.hashrate : null,
    hashrateObservedAt: observed,
    quality: !valid
      ? "unavailable"
      : !Number.isFinite(observedTime) ||
          observedTime > now + 5000 ||
          now - observedTime > 60000
        ? "stale"
        : miner.hashrate === 0
          ? "zero"
          : "valid",
    algorithm:
      miner.activeConfig?.algorithm ||
      (miner.running ? null : miner.config?.algorithm),
    activeConfig: miner.activeConfig || null,
    appliedConfigVersion: miner.activeConfig?.version || null,
    desiredConfigVersion: miner.config?.version || null,
    localOverrides: miner.localOverrides || [],
    startedAt: miner.startTime ? new Date(miner.startTime).toISOString() : null,
    pid: miner.pid || null,
    minerVersion: miner.minerVersion || null,
    error: miner.error || null,
    diagnostic: miner.diagnostic || null,
    paused: miner.paused === true,
    restartPendingAt: miner.restartPendingAt
      ? new Date(miner.restartPendingAt).toISOString()
      : null,
    pauseReason: miner.pauseReason || null,
    shares: miner.shares || null,
    pool: miner.pool || null,
  };
}
export function parseProcessDetails(line) {
  const text = String(line || ""),
    result = {};
  const version =
    text.match(/\bXMRig\/(\d+\.\d+\.\d+(?:[-\w.]*)?)/i) ||
    text.match(/\bnanominer\s+(?:v(?:ersion)?\s*)?(\d+\.\d+\.\d+)/i) ||
    text.match(/\bSRBMiner-MULTI\s+(?:v)?(\d+\.\d+\.\d+)/i);
  if (version) result.minerVersion = version[1];
  const pool = text.match(/\b(?:new job from|use pool)\s+([^\s]+)/i);
  if (pool)
    result.pool = {
      address: pool[1],
      status: /\bnew job from\b/i.test(text) ? "connected" : "connecting",
      observedAt: new Date().toISOString(),
      source: "process-log",
    };
  else if (
    /\b(?:connect error|connection refused|no active pools)\b/i.test(text)
  )
    result.pool = {
      status: "disconnected",
      observedAt: new Date().toISOString(),
      source: "process-log",
    };
  if (/\bpaused\b/i.test(text)) {
    result.paused = true;
    result.pauseReason = /battery/i.test(text)
      ? "battery"
      : /active|activity/i.test(text)
        ? "user-active"
        : "miner-paused";
  }
  if (/\b(?:resumed|resume mining)\b/i.test(text)) {
    result.paused = false;
    result.pauseReason = null;
  }
  return result;
}
