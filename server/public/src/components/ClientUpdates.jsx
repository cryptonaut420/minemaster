import React, { useEffect, useRef, useState } from "react";
import api from "../services/api";
import {
  useResource,
  ErrorNotice,
  errorText,
  requestId,
  Badge,
  at,
} from "./Operations";
import { useNotifications } from "./Notifications";
export default function ClientUpdates({ onActivity }) {
  const data = useResource("client-release", {}, 8000),
    notify = useNotifications();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirm, setConfirm] = useState(false),
    [results, setResults] = useState(null),
    [listFilter, setListFilter] = useState("all"),
    [query, setQuery] = useState("");
  const rows = data.data?.rigs || [],
    release = data.data?.release;
  const online = rows.filter((r) => r.online),
    current = online.filter((r) => r.status === "current"),
    ready = rows.filter((r) => r.canInstall),
    checks = rows.filter((r) => r.canCheck);
  const listViews = [
    { key: "all", label: "All rigs", match: () => true },
    {
      key: "outdated",
      label: "Update needed",
      match: (r) => r.online && !["current", "newer"].includes(r.status),
    },
    {
      key: "issues",
      label: "Needs review",
      match: (r) =>
        r.appUpdate?.state === "error" ||
        r.status === "manual" ||
        (!["current", "newer"].includes(r.status) &&
          ["failed", "timed_out", "canceled"].includes(r.lastUpdate?.status)),
    },
    { key: "offline", label: "Offline", match: (r) => !r.online },
  ];
  const visibleRows = rows.filter(
    (r) =>
      listViews.find((v) => v.key === listFilter).match(r) &&
      r.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const observed = useRef(new Map());
  useEffect(() => {
    for (const rig of data.data?.rigs || []) {
      const command = rig.lastUpdate;
      if (!command) continue;
      const previous = observed.current.get(rig.id);
      if (
        previous?.id === command.id &&
        ["queued", "sent", "received", "running"].includes(previous.status) &&
        ["succeeded", "failed", "timed_out", "canceled"].includes(
          command.status,
        )
      ) {
        const label =
          command.action === "app-update-install"
            ? "Installation"
            : "Update check";
        if (command.status === "succeeded")
          notify.success(
            `${rig.name}: ${label} confirmed${command.action === "app-update-check" ? "; download and installation progress appears here." : "."}`,
          );
        else
          notify.error(
            `${rig.name}: ${label.toLowerCase()} ${command.status.replaceAll("_", " ")}. ${command.error || "See the last attempt below."}`,
            10000,
          );
      }
      observed.current.set(rig.id, { id: command.id, status: command.status });
    }
  }, [data.data]);
  async function run(
    install,
    target = null,
    expectedVersion = release?.version,
  ) {
    setBusy(true);
    setConfirm(false);
    setError("");
    setResults(null);
    notify.info(
      install
        ? "Requesting client installations…"
        : "Checking online clients for updates…",
    );
    try {
      // Refresh immediately: never install a previously staged version after a release changes.
      const fresh = (await api.get("/v1/client-release")).data;
      if (install && fresh.release.version !== expectedVersion)
        throw Error(
          "The latest release changed. Review the refreshed version before installing.",
        );
      const ids = fresh.rigs
        .filter(
          (r) =>
            (!target || r.id === target.id) &&
            (install ? r.canInstall : r.canCheck),
        )
        .map((r) => r.id);
      if (!ids.length)
        throw Error(
          install
            ? "No online rigs have the latest update ready yet."
            : "No online clients need an update check.",
        );
      const operation = requestId(),
        outcomes = [];
      // Bound each request: the server dispatches sequentially and a large
      // fleet must not exceed the HTTP deadline or the 500-target API limit.
      for (let offset = 0; offset < ids.length; offset += 8) {
        const chunk = ids.slice(offset, offset + 8);
        try {
          const response = await api.post(
            "/v1/commands",
            {
              minerIds: chunk,
              action: install ? "app-update-install" : "app-update-check",
              deviceType: "ALL",
              ...(install
                ? { targetVersion: fresh.release.version, timeoutSeconds: 900 }
                : {}),
            },
            {
              timeout: 65000,
              headers: { "Idempotency-Key": `${operation}:${offset}` },
            },
          );
          outcomes.push(...response.data.results);
          for (const result of response.data.results) {
            if (result.command)
              observed.current.set(result.minerId, {
                id: result.command.id,
                status: result.command.status,
              });
          }
        } catch (e) {
          outcomes.push(
            ...chunk.map((id) => ({
              minerId: id,
              error: `${errorText(e)} — outcome unconfirmed; review Activity before retrying.`,
            })),
          );
        }
        setResults([...outcomes]);
      }
      const failures = outcomes.filter((r) => r.error).length;
      if (failures)
        notify.error(
          `${failures} update request${failures === 1 ? " needs" : "s need"} attention. See details below.`,
          10000,
        );
      if (!outcomes.some((r) => r.command)) return;
      notify.info(
        install
          ? "Installations requested. Rigs reconnect after updating; “Current” confirms the reported version."
          : "Checks requested. Clients 1.4.9+ install automatically after download; older clients need Install latest once.",
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
    checking: "Checking for updates",
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
        rigs need to reconnect before updating. Clients 1.4.9+ automatically
        install verified downloads and resume previously running mining. Older
        clients need one installation request to adopt this behavior.
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
          onClick={() => setConfirm({ all: true, version: release.version })}
        >
          Install latest on {ready.length} ready rigs
        </button>
        <button disabled={busy} onClick={data.reload}>
          Refresh versions
        </button>
        {onActivity && (
          <button onClick={onActivity}>View command history</button>
        )}
      </div>
      {confirm && (
        <div className="op-warning">
          <p>
            Install {confirm.version} on{" "}
            {confirm.all ? "all ready online rigs" : confirm.name}? Mining
            pauses briefly and the client restarts. Existing mining intent is
            retained.
          </p>
          <button
            disabled={busy}
            onClick={() =>
              run(true, confirm.all ? null : confirm, confirm.version)
            }
          >
            Confirm installations
          </button>
          <button disabled={busy} onClick={() => setConfirm(false)}>
            Cancel
          </button>
        </div>
      )}
      <div className="op-update-list-tools">
        <div
          className="op-quick-views"
          role="group"
          aria-label="Filter update list"
        >
          {listViews.map((view) => (
            <button
              key={view.key}
              aria-pressed={listFilter === view.key}
              onClick={() => setListFilter(view.key)}
            >
              {view.label} ({rows.filter(view.match).length})
            </button>
          ))}
        </div>
        <label>
          Find a rig in updates
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rig name…"
          />
        </label>
        <small>
          {visibleRows.length} of {rows.length} rigs shown. List filters do not
          change the fleet update actions above.
        </small>
      </div>
      {!visibleRows.length && !data.loading && !data.error && (
        <p className="op-empty">
          No rigs match this update view.{" "}
          <button
            onClick={() => {
              setQuery("");
              setListFilter("all");
            }}
          >
            Show all updates
          </button>
        </p>
      )}
      <ul className="op-feed op-update-list">
        {visibleRows.map((r) => (
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
                {r.status === "ready" &&
                r.appUpdate?.autoInstall &&
                !r.appUpdate?.message
                  ? "Installing automatically"
                  : labels[r.status]}
              </Badge>
              {r.status === "downloading" &&
                Number.isFinite(r.appUpdate?.percent) && (
                  <small>
                    Download:{" "}
                    {Math.max(
                      0,
                      Math.min(100, Math.round(r.appUpdate.percent)),
                    )}
                    %
                  </small>
                )}
              {r.online && !r.telemetryFresh && (
                <small>
                  Update telemetry is overdue; progress is unconfirmed.
                </small>
              )}
              {r.pendingCommand && (
                <small>
                  Pending: {r.pendingCommand.action.replaceAll("-", " ")} ·{" "}
                  {r.pendingCommand.status} · deadline{" "}
                  {at(r.pendingCommand.deadline)}. Manage in Activity.
                </small>
              )}
              {r.lastUpdate && (
                <small
                  className={
                    ["failed", "timed_out", "canceled"].includes(
                      r.lastUpdate.status,
                    )
                      ? "op-warning"
                      : "op-muted"
                  }
                >
                  Last{" "}
                  {r.lastUpdate.action === "app-update-install"
                    ? "installation"
                    : "check"}{" "}
                  · {at(r.lastUpdate.createdAt)} ·{" "}
                  {r.lastUpdate.status.replaceAll("_", " ")}
                  {r.lastUpdate.error ? ` — ${r.lastUpdate.error}` : ""}
                </small>
              )}
              {r.status === "offline" &&
                r.appUpdate?.state === "installing" && (
                  <small>
                    Last installation is unconfirmed. Check MineMaster or the
                    installer on this PC.
                  </small>
                )}
              {r.appUpdate?.state === "error" && r.appUpdate.message && (
                <details className="op-update-error">
                  <summary>Updater error · {at(r.appUpdate.updatedAt)}</summary>
                  <pre>{r.appUpdate.message}</pre>
                </details>
              )}
              {["manual", "ready"].includes(r.status) &&
                r.appUpdate?.message && <small>{r.appUpdate.message}</small>}
            </span>
            <div className="op-actions">
              {r.canCheck && (
                <button
                  disabled={busy || !!data.error}
                  aria-label={`Check and download update on ${r.name}`}
                  onClick={() => run(false, r)}
                >
                  Check & download
                </button>
              )}
              {r.canInstall && (
                <button
                  disabled={busy || !!data.error}
                  aria-label={`Install latest client on ${r.name}`}
                  onClick={() =>
                    setConfirm({
                      id: r.id,
                      name: r.name,
                      version: release.version,
                    })
                  }
                >
                  Install latest
                </button>
              )}
            </div>
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
