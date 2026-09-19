import React, { useEffect, useRef, useState } from "react";
import api from "../services/api";
import { useNotifications } from "./Notifications";
const actionLabel = (action) =>
  ({
    start: "Start mining",
    stop: "Stop mining",
    restart: "Restart mining",
    "device-enable": "Enable mining",
    "device-disable": "Disable mining",
    "miner-diagnose": "Check miner files",
    "miner-repair": "Repair miner files",
    "app-update-check": "Check app updates",
    "app-update-install": "Install app update",
  })[action] || action;
export const requestId = () =>
  window.crypto?.randomUUID?.() ||
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
export const errorText = (e) =>
  e.response?.data?.error || e.message || "Request failed";
export { rate } from "../utils/rates";
export const at = (value) =>
  value ? new Date(value).toLocaleString() : "Not reported";
export function Badge({ children, status = "" }) {
  return (
    <span className={`op-badge op-${status}`}>
      {children || status.replaceAll("_", " ")}
    </span>
  );
}
export function ErrorNotice({ error, retry }) {
  return error ? (
    <div className="op-error" role="alert">
      {error}
      {retry && (
        <button type="button" onClick={retry}>
          Retry
        </button>
      )}
    </div>
  ) : null;
}
export function useResource(path, params = {}, interval = 0) {
  const [state, setState] = useState({ data: null, error: "", loading: true });
  const query = JSON.stringify(params),
    generation = useRef(0),
    loader = useRef(),
    resourceKey = useRef(null);
  useEffect(() => {
    let disposed = false,
      controller,
      inFlight = false;
    if (!path) {
      setState({ data: null, error: "", loading: false });
      loader.current = null;
      return;
    }
    async function load() {
      const id = ++generation.current;
      controller?.abort();
      controller = new AbortController();
      inFlight = true;
      try {
        const response = await api.get(`/v1/${path}`, {
          params: JSON.parse(query),
          signal: controller.signal,
        });
        if (!disposed && id === generation.current)
          setState({ data: response.data, error: "", loading: false });
      } catch (error) {
        if (
          !disposed &&
          error.code !== "ERR_CANCELED" &&
          id === generation.current
        )
          setState((prev) => ({
            ...prev,
            error: errorText(error),
            loading: false,
          }));
      } finally {
        if (id === generation.current) inFlight = false;
      }
    }
    const nextKey = `${path}:${query}`;
    if (resourceKey.current !== nextKey)
      setState({ data: null, error: "", loading: true });
    resourceKey.current = nextKey;
    loader.current = load;
    load();
    const timer = interval
      ? setInterval(() => {
          if (!inFlight) load();
        }, interval)
      : null;
    return () => {
      disposed = true;
      controller?.abort();
      clearInterval(timer);
    };
  }, [path, query, interval]);
  return { ...state, reload: () => loader.current?.() };
}
export function CommandHistory({ minerId, refresh = 0 }) {
  const notify = useNotifications();
  const [status, setStatus] = useState(""),
    [cursor, setCursor] = useState(null),
    [pages, setPages] = useState([]);
  const { data, error, reload, loading } = useResource(
    "commands",
    { ...(minerId ? { minerId } : {}), limit: 50, status, cursor },
    cursor ? 0 : 10000,
  );
  const [actionError, setActionError] = useState("");
  useEffect(() => {
    reload();
  }, [refresh]); // eslint-disable-line react-hooks/exhaustive-deps
  const cancel = async (id) => {
    try {
      await api.post(`/v1/commands/${id}/cancel`);
      notify.info(
        "Cancellation requested. Check the command's final result.",
        5000,
      );
      setActionError("");
      reload();
    } catch (e) {
      setActionError(errorText(e));
      notify.error(errorText(e), 10000);
    }
  };
  return (
    <section>
      <div className="op-section-title">
        <h3>Command history</h3>
        <button onClick={reload}>Refresh</button>
      </div>
      <label>
        Command status
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setCursor(null);
            setPages([]);
          }}
        >
          <option value="">All outcomes</option>
          {[
            "queued",
            "sent",
            "received",
            "running",
            "succeeded",
            "failed",
            "timed_out",
            "canceled",
          ].map((s) => (
            <option key={s} value={s}>
              {s.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </label>
      <ErrorNotice error={error || actionError} retry={reload} />
      {loading && <p>Loading commands…</p>}
      {data?.data.length === 0 && (
        <p className="op-empty">No commands have been issued.</p>
      )}
      <ol className="op-feed">
        {data?.data.map((c) => (
          <li key={c.id}>
            <div className="op-row">
              <strong>
                {actionLabel(c.action)} · {c.deviceType}
              </strong>
              <Badge status={c.status} />
            </div>
            <small>
              {at(c.createdAt)}
              {!minerId && ` · ${c.minerName || c.minerId}`}
            </small>
            {c.error && <p className="op-warning">{c.error}</p>}
            <details>
              <summary>Execution details</summary>
              <pre>
                {JSON.stringify(
                  {
                    id: c.id,
                    deadline: c.deadline,
                    history: c.history,
                    result: c.result,
                  },
                  null,
                  2,
                )}
              </pre>
            </details>
            {["queued", "sent", "received", "running"].includes(c.status) && (
              <button onClick={() => cancel(c.id)}>
                Cancel pending action
              </button>
            )}
          </li>
        ))}
      </ol>
      <div className="op-pagination">
        <button
          disabled={!pages.length}
          onClick={() => {
            setCursor(pages.at(-1));
            setPages(pages.slice(0, -1));
          }}
        >
          Previous
        </button>
        <span>Page {pages.length + 1}</span>
        <button
          disabled={!data?.nextCursor}
          onClick={() => {
            setPages([...pages, cursor]);
            setCursor(data.nextCursor);
          }}
        >
          Next
        </button>
      </div>
    </section>
  );
}
export function Records({ kind, minerId }) {
  const [query, setQuery] = useState(""),
    [level, setLevel] = useState(""),
    [from, setFrom] = useState(""),
    [cursor, setCursor] = useState(null),
    [older, setOlder] = useState([]),
    [exportError, setExportError] = useState(""),
    [paused, setPaused] = useState(false),
    [processId, setProcessId] = useState("");
  const params = {
    ...(minerId ? { minerId } : {}),
    ...(kind === "logs" ? { q: query, level } : {}),
    ...(from ? { from: new Date(from).toISOString() } : {}),
    limit: 100,
    cursor,
    processId,
  };
  const result = useResource(kind, params, cursor || paused ? 0 : 15000);
  useEffect(() => {
    setCursor(null);
    setOlder([]);
  }, [query, level, from, minerId, kind, processId]);
  async function download() {
    try {
      const response = await api.get(`/v1/${kind}`, {
        params: { ...params, format: "csv", limit: 1000 },
        responseType: "blob",
      });
      const url = URL.createObjectURL(response.data),
        a = document.createElement("a");
      a.href = url;
      a.download = `minemaster-${kind}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setExportError("");
    } catch (e) {
      setExportError(errorText(e));
    }
  }
  return (
    <section>
      <div className="op-section-title">
        <h3>{kind === "logs" ? "Miner logs" : "Rig events"}</h3>
        <div className="op-actions">
          <button onClick={download}>Export up to 1,000 entries</button>
          {cursor ? (
            <button
              onClick={() => {
                setCursor(null);
                setOlder([]);
                setPaused(false);
              }}
            >
              Back to latest
            </button>
          ) : (
            <button onClick={() => setPaused(!paused)}>
              {paused ? "Resume live feed" : "Pause live feed"}
            </button>
          )}
        </div>
      </div>
      <div className="op-toolbar">
        {kind === "logs" && (
          <label>
            Process
            <input
              value={processId}
              placeholder="Any process"
              onChange={(e) => setProcessId(e.target.value)}
            />
          </label>
        )}
        {kind === "logs" && (
          <>
            <label>
              Search logs
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Pool, error, accepted…"
              />
            </label>
            <label>
              Level
              <select value={level} onChange={(e) => setLevel(e.target.value)}>
                <option value="">All levels</option>
                {["info", "warning", "error", "debug"].map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </label>
          </>
        )}
        <label>
          Since
          <input
            type="datetime-local"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
      </div>
      <ErrorNotice error={result.error || exportError} retry={result.reload} />
      <p className="op-muted">
        Newest received entries first. Hover over a time for the agent’s
        observation time.
      </p>
      <div className="op-log" aria-label={kind}>
        {[...older, ...(result.data?.data || [])].map((row) => (
          <div key={row._id}>
            <time
              title={
                row.observedAt
                  ? `Agent observed: ${at(row.observedAt)}`
                  : undefined
              }
            >
              {at(row.timestamp)}
            </time>
            <Badge status={row.level || "info"}>{row.level || row.kind}</Badge>
            <span>
              {!minerId && (
                <strong>{row.minerName || row.minerId || "Fleet"} · </strong>
              )}
              {row.processId || ""} {row.message || JSON.stringify(row.details)}
            </span>
          </div>
        ))}
        {!result.loading && !result.data?.data.length && (
          <p>No entries in this range.</p>
        )}
      </div>
      {result.data?.nextCursor && (
        <button
          onClick={() => {
            setOlder([...older, ...result.data.data]);
            setCursor(result.data.nextCursor);
          }}
        >
          Load older entries
        </button>
      )}
    </section>
  );
}
export function ActionDialog({
  rigs,
  onClose,
  onDone,
  initialAction = "restart",
}) {
  const notify = useNotifications();
  const commandToast = useRef(null);
  const [action, setAction] = useState(initialAction),
    [deviceType, setScope] = useState("CPU"),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [results, setResults] = useState(null),
    [batchId, setBatchId] = useState(null),
    [complete, setComplete] = useState(false);
  const tracking = useResource(
    batchId ? "commands" : null,
    { batchId, limit: 500 },
    complete ? 0 : 1500,
  );
  const liveResults = results?.map((r) => ({
    ...r,
    command:
      tracking.data?.data.find((c) => c.id === r.command?.id) || r.command,
  }));
  const active =
    liveResults?.filter((r) =>
      ["queued", "sent", "received", "running"].includes(r.command?.status),
    ) || [];
  useEffect(() => {
    if (liveResults && !active.length && !complete) {
      setComplete(true);
      const failed = liveResults.filter(
        (r) => r.command?.status !== "succeeded",
      ).length;
      notify.updateToast(
        commandToast.current,
        failed
          ? `${actionLabel(action)}: ${failed} rigs need attention. See command results.`
          : `${actionLabel(action)} completed on ${liveResults.length} ${liveResults.length === 1 ? "rig" : "rigs"}.`,
        failed ? "error" : "success",
        failed ? 10000 : 5000,
      );
      onDone();
    }
  }, [results, tracking.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const dialog = useRef(null),
    key = useRef(requestId());
  useEffect(() => {
    dialog.current.showModal();
  }, []);
  async function submit(e) {
    e.preventDefault();
    setPending(true);
    setError("");
    commandToast.current = notify.info(
      `${actionLabel(action)} requested. Waiting for rig results…`,
      6000,
    );
    try {
      const { data } = await api.post(
        "/v1/commands",
        { minerIds: rigs.map((r) => r.id), action, deviceType },
        { headers: { "Idempotency-Key": key.current } },
      );
      setResults(data.results);
      setBatchId(data.batchId);
      onDone();
    } catch (e) {
      setError(errorText(e));
      notify.updateToast(commandToast.current, errorText(e), "error", 10000);
    } finally {
      setPending(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="op-dialog"
      aria-labelledby="command-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!pending) onClose();
      }}
    >
      <form onSubmit={submit}>
        <h2 id="command-dialog-title">
          Control {rigs.length} {rigs.length === 1 ? "rig" : "rigs"}
        </h2>
        <p>{rigs.map((r) => r.name).join(", ")}</p>
        <p className="op-muted">
          GPU controls apply to the whole GPU mining process. Results appear in
          this dialog and command history.
        </p>
        <label>
          Action
          <select
            disabled={pending || !!results}
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              if (e.target.value.startsWith("app-update-")) setScope("ALL");
              key.current = requestId();
            }}
          >
            {[
              "start",
              "stop",
              "restart",
              "device-enable",
              "device-disable",
              "miner-diagnose",
              "miner-repair",
              "app-update-check",
              "app-update-install",
            ].map((a) => (
              <option key={a} value={a}>
                {actionLabel(a)}
              </option>
            ))}
          </select>
        </label>
        {action === "miner-repair" && (
          <p className="op-warning">
            Stop the selected processes first. Repair restores verified upstream
            files and leaves mining stopped. It does not change Windows
            protection policies. Requires MineMaster 1.2 or later.
          </p>
        )}
        {action.startsWith("app-update-") && (
          <p className="op-warning">
            Requires desktop 1.3.1. Check downloads an available app update
            without stopping mining. Install stops all miners and hands off to
            the installer. Success is confirmed only when the rig reconnects
            with the requested version; allow up to 10 minutes. Cancellation
            cannot reverse an installer already handed off.
          </p>
        )}
        <label>
          Process scope
          <select
            disabled={pending || !!results || action.startsWith("app-update-")}
            value={deviceType}
            onChange={(e) => {
              setScope(e.target.value);
              key.current = requestId();
            }}
          >
            <option>CPU</option>
            <option>GPU</option>
            <option value="ALL">CPU and GPU</option>
          </select>
        </label>
        <ErrorNotice
          error={error || tracking.error}
          retry={tracking.error ? tracking.reload : undefined}
        />
        {results && (
          <p role="status">
            {active.length
              ? `${active.length} command${active.length === 1 ? "" : "s"} awaiting completion…`
              : "All requests have an outcome."}
          </p>
        )}
        {results && (
          <ul className="op-feed">
            {liveResults.map((r) => (
              <li key={r.minerId}>
                {rigs.find((m) => m.id === r.minerId)?.name}:{" "}
                {r.error || (
                  <>
                    <Badge status={r.command.status} />
                    {r.command.error && (
                      <p className="op-warning">{r.command.error}</p>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="op-actions">
          {!!active.length && (
            <button
              type="button"
              disabled={pending}
              onClick={async () => {
                setPending(true);
                const outcomes = await Promise.allSettled(
                  active.map((r) =>
                    api.post(`/v1/commands/${r.command.id}/cancel`),
                  ),
                );
                const failure = outcomes.find(
                  (r) =>
                    r.status === "rejected" &&
                    r.reason.response?.status !== 409,
                );
                setError(failure ? errorText(failure.reason) : "");
                setPending(false);
                tracking.reload();
                onDone();
              }}
            >
              Cancel pending commands
            </button>
          )}
          <button type="button" disabled={pending} onClick={onClose}>
            {results ? "Done" : "Cancel"}
          </button>
          {!results && (
            <button className="op-primary" disabled={pending} type="submit">
              {pending ? "Sending…" : actionLabel(action)}
            </button>
          )}
        </div>
      </form>
    </dialog>
  );
}
