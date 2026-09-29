import React, { useState } from "react";
import api from "../services/api";
import {
  useResource,
  ErrorNotice,
  errorText,
  requestId,
  Badge,
} from "./Operations";
import { useNotifications } from "./Notifications";
export default function ClientUpdates() {
  const data = useResource("client-release", {}, 15000),
    notify = useNotifications();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirm, setConfirm] = useState(false),
    [results, setResults] = useState(null);
  const rows = data.data?.rigs || [],
    release = data.data?.release;
  const online = rows.filter((r) => r.online),
    current = online.filter((r) => r.status === "current"),
    ready = rows.filter((r) => r.canInstall),
    checks = rows.filter((r) => r.canCheck && r.status !== "current");
  async function run(install) {
    setBusy(true);
    setConfirm(false);
    setError("");
    notify.info(
      install
        ? "Requesting client installations…"
        : "Checking online clients for updates…",
    );
    try {
      // Refresh immediately: never install a previously staged version after a release changes.
      const fresh = (await api.get("/v1/client-release")).data;
      if (install && fresh.release.version !== release.version)
        throw Error(
          "The latest release changed. Review the refreshed version before installing.",
        );
      const ids = fresh.rigs
        .filter((r) =>
          install ? r.canInstall : r.canCheck && r.status !== "current",
        )
        .map((r) => r.id);
      if (!ids.length)
        throw Error(
          install
            ? "No online rigs have the latest update ready yet."
            : "No online clients need an update check.",
        );
      const response = await api.post(
        "/v1/commands",
        {
          minerIds: ids,
          action: install ? "app-update-install" : "app-update-check",
          deviceType: "ALL",
          ...(install
            ? { targetVersion: fresh.release.version, timeoutSeconds: 900 }
            : {}),
        },
        { headers: { "Idempotency-Key": requestId() } },
      );
      setResults(response.data.results);
      notify.info(
        install
          ? "Installations requested. Rigs reconnect after updating; “Current” confirms the reported version."
          : "Checks requested. Downloads continue on each client; install when ready.",
        9000,
      );
    } catch (e) {
      setError(errorText(e));
      notify.error(errorText(e));
    } finally {
      setBusy(false);
      data.reload();
    }
  }
  const labels = {
    current: "Current",
    newer: "Newer than published release",
    offline: "Offline",
    reconnecting: "Update sent · awaiting reconnect",
    unknown: "Version unknown",
    outdated: "Update needed",
    manual: "Manual update",
    installing: "Installing",
    ready: "Ready to install",
    downloading: "Downloading",
    error: "Update error",
  };
  return (
    <details className="op-surface op-client-updates">
      <summary>
        <strong>Client updates</strong> ·{" "}
        {release
          ? `${current.length}/${online.length} online rigs on ${release.version}`
          : "Checking latest release…"}
        {ready.length ? ` · ${ready.length} ready to install` : ""}
        {rows.some((r) => r.status === "reconnecting")
          ? ` · ${rows.filter((r) => r.status === "reconnecting").length} awaiting reconnect`
          : ""}
      </summary>
      <ErrorNotice error={error || data.error} retry={data.reload} />
      <p>
        {release && (
          <a href={release.url} target="_blank" rel="noreferrer">
            Latest client: {release.version}
          </a>
        )}{" "}
        · Includes every bound rig, regardless of dashboard filters. Offline
        rigs need to reconnect before updating.
      </p>
      <div className="op-actions">
        <button
          disabled={busy || !!data.error || !checks.length}
          onClick={() => run(false)}
        >
          Check & download on {checks.length} online rigs
        </button>
        <button
          className="op-primary"
          disabled={busy || !!data.error || !ready.length}
          onClick={() => setConfirm(true)}
        >
          Install latest on {ready.length} ready rigs
        </button>
        <button disabled={busy} onClick={data.reload}>
          Refresh versions
        </button>
      </div>
      {confirm && (
        <div className="op-warning">
          <p>
            Install {release.version} on all ready online rigs? Mining pauses
            briefly and the client restarts. Existing mining intent is retained.
          </p>
          <button disabled={busy} onClick={() => run(true)}>
            Confirm installations
          </button>
          <button disabled={busy} onClick={() => setConfirm(false)}>
            Cancel
          </button>
        </div>
      )}
      <ul className="op-feed">
        {rows.map((r) => (
          <li key={r.id}>
            <strong>{r.name}</strong>
            <span>
              {r.installed || "Unknown version"} ·{" "}
              <Badge
                status={
                  r.status === "current"
                    ? "online"
                    : r.online
                      ? "warning"
                      : "offline"
                }
              >
                {labels[r.status]}
              </Badge>
              {["error", "manual"].includes(r.status) &&
                r.appUpdate?.message && <small>{r.appUpdate.message}</small>}
            </span>
          </li>
        ))}
      </ul>
      {results?.some((r) => r.error) && (
        <div role="alert" className="op-error">
          {results
            .filter((r) => r.error)
            .map((r) => (
              <p key={r.minerId}>
                {rows.find((x) => x.id === r.minerId)?.name || r.minerId}:{" "}
                {r.error}
              </p>
            ))}
        </div>
      )}
      <p className="op-muted">
        A sent command is not a completed upgrade. Current means the connected
        client reports the latest version. Detailed progress and failures are in
        Activity.
      </p>
    </details>
  );
}
