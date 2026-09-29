export const rateFreshMs = (miner) =>
  (miner.engine || miner.activeConfig?.engine) === "srbminer" ? 120000 : 60000;
export function minerLogLevel(line) {
  const text = String(line || "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .trim(); // eslint-disable-line no-control-regex
  // Nanominer prints this policy description at startup; it is not a failure.
  if (
    /^(?:\d{4}-[A-Za-z]{3}-\d{2} \d{2}:\d{2}:\d{2}:\s*)?Never calling reboot\.bat \(always restarting the miner in case of errors\)\.$/i.test(
      text,
    )
  )
    return "info";
  return /error|failed|fatal/i.test(text) ? "error" : "info";
}
// Process aggregates only: a per-GPU line must never replace the process total.
export function parseAggregate(line) {
  const text = String(line || "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, ""); // eslint-disable-line no-control-regex
  // Nanominer prints a separate rolling average with the same "Total:" label.
  // It must not refresh or replace the current process observation.
  if (/\blast\s+\d+\s+(?:min(?:ute)?s?|hours?|h)\b/i.test(text)) return null;
  const match =
    text.match(
      /\bspeed\s+\S+\s+((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s+(?:[\d.,]+|n\/a)\s+(?:[\d.,]+|n\/a)\s*([kmgpt]?h\/s)\b/i,
    ) ||
    text.match(
      /\bTotal(?:\s+speed|\s+hashrate)?\s*:\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*([kmgpt]?h\/s)\b/i,
    );
  if (!match) return null;
  const rate =
    Number(match[1].replace(/,/g, "")) *
    {
      "h/s": 1,
      "kh/s": 1e3,
      "mh/s": 1e6,
      "gh/s": 1e9,
      "th/s": 1e12,
      "ph/s": 1e15,
    }[match[2].toLowerCase()];
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
    const key = ["stderr", "file"].includes(stream) ? stream : "stdout";
    if (!streams.has(key)) streams.set(key, createLineBuffer());
    return streams.get(key)(chunk);
  };
}
export function parseShares(line, observedAt = new Date().toISOString()) {
  const text = String(line).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, ""); // eslint-disable-line no-control-regex
  if (/\blast\s+\d+\s+(?:min(?:ute)?s?|hours?|h)\b/i.test(text)) return null;
  const nano = text.match(
    /\bTotal speed:\s*[\d.,]+\s*[kmgpt]?H\/s,\s*Total shares:\s*(\d+)\s+Rejected:\s*(\d+)\b/i,
  );
  if (nano) {
    // Nanominer's total includes rejected submissions, unlike XMRig/SRB A:R.
    // Upstream log sequence: nanopool/nanominer issue #309.
    const total = Number(nano[1]),
      rejected = Number(nano[2]);
    if (
      !Number.isSafeInteger(total) ||
      !Number.isSafeInteger(rejected) ||
      rejected > total
    )
      return null;
    return {
      accepted: total - rejected,
      rejected,
      observedAt,
      source: "nanominer-counter",
    };
  }
  const match = String(line).match(
    /\b(?:accepted|rejected)\s*\((\d+)\/(\d+)\)/i,
  );
  const srb = String(line)
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .match(
      /\bTotal:\s*[\d.,]+\s*[kmgpt]?H\/s\s*\[[^\]]*\bA:(\d+)\s+R:(\d+)\b/i,
    ); // eslint-disable-line no-control-regex
  if (srb)
    return {
      accepted: Number(srb[1]),
      rejected: Number(srb[2]),
      observedAt,
      source: "srbminer-counter",
    };
  return match
    ? {
        accepted: Number(match[1]),
        rejected: Number(match[2]),
        observedAt,
        source: "xmrig-counter",
      }
    : null;
}
// Clear observations owned by a finished run without changing desired configuration or retry intent.
export function stoppedProcessState() {
  return {
    running: false,
    observationRunId: null,
    hashrate: null,
    hashrateObservedAt: null,
    activeConfig: null,
    engine: null,
    effectiveSettings: null,
    startTime: null,
    pid: null,
    minerVersion: null,
    shares: null,
    pool: null,
    paused: false,
    pauseReason: null,
  };
}
// Poll replies may arrive after a control or exit event. Never replace newer lifecycle state.
export function reconcileNativeStatus(miner, status, requestedRevision) {
  if (
    !status ||
    miner.loading ||
    (miner.controlRevision || 0) !== requestedRevision
  )
    return miner;
  const changedRun = status.runId && status.runId !== miner.runId;
  const observationsMatch =
    status.runId && status.runId === miner.observationRunId;
  return {
    ...miner,
    ...status,
    startTime: status.startedAt,
    ...(changedRun && !observationsMatch
      ? {
          hashrate: null,
          hashrateObservedAt: null,
          shares: null,
          pool: null,
          minerVersion: null,
          paused: false,
          pauseReason: null,
          observationRunId: null,
        }
      : {}),
    ...(!status.running ? stoppedProcessState() : {}),
  };
}
export function applyProcessObservation(miner, runId, observation) {
  const changedRun = runId && runId !== (miner.observationRunId || miner.runId);
  return {
    ...miner,
    ...(changedRun
      ? {
          hashrate: null,
          hashrateObservedAt: null,
          shares: null,
          pool: null,
          minerVersion: null,
          paused: false,
          pauseReason: null,
        }
      : {}),
    ...observation,
    ...(changedRun
      ? { controlRevision: (miner.controlRevision || 0) + 1 }
      : {}),
    observationRunId: runId || null,
  };
}
export function processSnapshot(miner, now = Date.now()) {
  if (miner.running !== true) miner = { ...miner, ...stoppedProcessState() };
  const observed = miner.hashrateObservedAt || null;
  const observedTime = Date.parse(observed);
  const valid =
    typeof miner.hashrate === "number" &&
    Number.isFinite(miner.hashrate) &&
    miner.hashrate >= 0;
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
          now - observedTime > rateFreshMs(miner)
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
export function parseProcessDetails(
  line,
  observedAt = new Date().toISOString(),
) {
  const text = String(line || "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, ""), // eslint-disable-line no-control-regex
    result = {};
  const version =
    text.match(/\bXMRig\/(\d+\.\d+\.\d+(?:[-\w.]*)?)/i) ||
    text.match(/\bnanominer\s+(?:v(?:ersion)?\s*)?(\d+\.\d+\.\d+)/i) ||
    text.match(/\bSRBMiner-MULTI\s+(?:v)?(\d+\.\d+\.\d+)/i) ||
    text.match(/\bMiner version:\s*(\d+\.\d+\.\d+)/i);
  if (version) result.minerVersion = version[1];
  const pool = text.match(
    /\b(?:new job from|use pool|(?:re)?connected to(?: pool)?:?)\s+([^\s]+)/i,
  );
  if (pool)
    result.pool = {
      address: pool[1],
      status: /\b(?:new job from|(?:re)?connected to)\b/i.test(text)
        ? "connected"
        : "connecting",
      observedAt,
      source: "process-log",
    };
  else if (
    /\b(?:connect error|connection refused|no active pools|connection (?:was )?(?:closed|lost))\b/i.test(
      text,
    )
  )
    result.pool = {
      status: "disconnected",
      observedAt,
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
