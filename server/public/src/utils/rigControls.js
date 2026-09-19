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
        !p.running &&
        !p.restartPendingAt &&
        (p.deviceType !== "GPU" || rig.hardware?.gpus?.length > 0),
    )
    .map((p) => p.deviceType);
  const unique = [...new Set(scopes)];
  return unique.length === 2 ? "ALL" : unique[0] || null;
}
export function primaryControl(rig, receipt) {
  const active = (c) =>
    ["queued", "sent", "received", "running"].includes(c?.status);
  const pending = receipt?.sending || active(receipt?.command);
  const commands = rig.pendingCommands || [];
  const stopping =
    (pending && receipt.action === "stop") ||
    commands.some((c) => ["stop", "device-disable"].includes(c.action));
  const starting =
    (pending && receipt.action === "start") ||
    commands.some((c) =>
      ["start", "restart", "app-update-install"].includes(c.action),
    );
  // Keep cancellation available through preparation, retries and stale reports.
  const stop =
    stopping ||
    starting ||
    rig.processes?.some((p) => p.running || p.restartPendingAt) ||
    (rig.freshness?.connected && !rig.freshness.telemetryFresh);
  const action = stop ? "stop" : "start";
  const unavailable = controlUnavailable(rig);
  return {
    action,
    label: !rig.freshness?.connected
      ? "Offline"
      : stopping
        ? "Pausing…"
        : starting
          ? "Cancel start"
          : stop
            ? "Pause"
            : "Play",
    disabled:
      !!unavailable || !!stopping || (!stop && !quickScope(rig, "start")),
    reason:
      unavailable ||
      (!stop && !quickScope(rig, "start")
        ? "No enabled mining process is ready to start"
        : stop
          ? "Stop CPU and GPU mining, including pending starts"
          : "Start enabled mining"),
  };
}

export function controlOutcome(action, rows, skipped = 0) {
  if (
    !rows.length ||
    rows.some(
      (r) =>
        r.sending ||
        ["queued", "sent", "received", "running"].includes(r.command?.status),
    )
  )
    return null;
  const succeeded = rows.filter(
    (r) => r.command?.status === "succeeded",
  ).length;
  const verb = action === "start" ? "started" : "paused";
  const failed = rows.length - succeeded;
  if (rows.length === 1 && !skipped) {
    const row = rows[0];
    const detail = String(
      row.error ||
        row.command?.error ||
        row.command?.status ||
        "Outcome unknown",
    )
      .split(/\r?\n/)[0]
      .slice(0, 160);
    return {
      type: failed ? "error" : "success",
      message: failed
        ? `${row.name || "Rig"}: ${detail}. See command results.`
        : `${row.name || "Rig"}: mining ${verb}.`,
    };
  }
  return {
    type: failed ? "error" : "success",
    message: `${succeeded} rigs ${verb}.${failed ? ` ${failed} need attention — see command results.` : ""}${skipped ? ` ${skipped} unchanged or unavailable.` : ""}`,
  };
}

export function compactIssue(rig) {
  const reason = rig.reason || "";
  if (rig.openIncidents?.some((i) => i.rule === "miner_errors"))
    return "Miner errors · View details";
  if (rig.status === "offline") return "";
  if (rig.status === "stale") return "Waiting for agent report";
  if (/exited/i.test(reason))
    return "Miner stopped unexpectedly · View details";
  if (/missing|quarantin|access denied/i.test(reason))
    return "Miner files need attention";
  if (["Mining", "Idle", "Agent disconnected", ""].includes(reason))
    return rig.openIncidents?.length
      ? `${rig.openIncidents.length} alerts · View details`
      : "";
  const text = reason.split(/\r?\n|\s+\*\s+/)[0];
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

export function rigSensors(rig) {
  const fresh =
    rig.freshness?.connected &&
    rig.freshness.telemetryFresh &&
    rig.stats?.quality !== "stale";
  return {
    cpu: fresh ? rig.stats?.cpu || {} : {},
    memory: fresh ? rig.stats?.memory || {} : {},
    gpus: (rig.hardware?.gpus || []).map((g) => ({
      ...g,
      sensor:
        fresh && g.deviceId
          ? rig.stats?.gpus?.find((s) => s.deviceId === g.deviceId) || {}
          : {},
    })),
  };
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
