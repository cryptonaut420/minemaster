export function controlUnavailable(rig) {
  if (rig.archivedAt || rig.forgottenAt) return "Restore this rig first";
  if (!rig.freshness?.connected)
    return "Agent offline — reconnect the app to control it";
  if (!(rig.protocolVersion >= 2) || !rig.capabilities?.commandResults)
    return "Update this agent to enable confirmed remote controls";
  return "";
}
export function quickScope(rig, action) {
  if (action === "stop") return "ALL";
  const scopes = (rig.processes || [])
    .filter(
      (p) =>
        p.enabled !== false &&
        (p.deviceType !== "GPU" || rig.hardware?.gpus?.length > 0),
    )
    .map((p) => p.deviceType);
  const unique = [...new Set(scopes)];
  return unique.length === 2 ? "ALL" : unique[0] || null;
}
export function processRateLabel(rig, process, format) {
  if (!rig.freshness?.connected) return "Offline";
  if (!rig.freshness?.telemetryFresh) return "Last report stale";
  if (process.restartPendingAt) return "Restart pending";
  if (!process.running)
    return process.enabled === false ? "Disabled" : "Stopped";
  if (process.paused) return "Paused by miner";
  if (["valid", "zero"].includes(process.quality))
    return format(process.hashrate);
  return process.quality === "stale" ? "Reading stale" : "Waiting for hashrate";
}

export function needsNanominerTelemetryUpdate(rig) {
  return (
    /^1\.4\.3(?:\+|$)/.test(rig.version || "") &&
    rig.freshness?.telemetryFresh &&
    rig.processes?.some(
      (p) =>
        p.running && p.engine === "nanominer" && p.quality === "unavailable",
    )
  );
}
