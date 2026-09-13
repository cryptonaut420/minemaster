import React, { useEffect, useRef, useState } from "react";
import api from "../services/api";
import {
  Badge,
  CommandHistory,
  ErrorNotice,
  at,
  errorText,
  useResource,
  requestId,
} from "./Operations";
import "./Dashboard.css";
const algorithms = {
  xmrig: ["rx/0", "rx/wow", "rx/arq", "cn/r", "cn/half", "ghostrider"],
  nanominer: [
    "ethash",
    "etchash",
    "kawpow",
    "autolykos",
    "autolykos2",
    "octopus",
    "conflux",
    "ton",
    "kaspa",
    "karlsenhash",
    "nexa",
  ],
};
const labels = {
  coin: "Coin label",
  algorithm: "Algorithm",
  pool: "Pool address",
  user: "Wallet / user",
  password: "Pool password",
  threadPercentage: "CPU threads (%)",
  additionalArgs: "Additional arguments",
  rigName: "Worker name",
};
export default function Configs() {
  const resource = useResource("configs"),
    [type, setType] = useState("xmrig"),
    [drafts, setDrafts] = useState(() => {
      try {
        return JSON.parse(
          sessionStorage.getItem("minemaster-config-drafts") || "{}",
        );
      } catch (_) {
        return {};
      }
    }),
    [baseline, setBaseline] = useState({}),
    [error, setError] = useState(""),
    [fields, setFields] = useState({}),
    [pending, setPending] = useState(false),
    [message, setMessage] = useState(""),
    [targets, setTargets] = useState({}),
    [q, setQuery] = useState(""),
    [restart, setRestart] = useState(false),
    [results, setResults] = useState(null),
    [cursor, setCursor] = useState(null),
    [targetRows, setTargetRows] = useState([]);
  const revisions = useResource(`configs/${type}/revisions`),
    rigs = useResource("rigs", { q, limit: 100, cursor });
  const rolloutKey = useRef(requestId());
  useEffect(() => {
    if (resource.data) {
      setBaseline(resource.data.data);
      setDrafts((prev) => ({ ...resource.data.data, ...prev }));
    }
  }, [resource.data]);
  useEffect(() => {
    sessionStorage.setItem("minemaster-config-drafts", JSON.stringify(drafts));
  }, [drafts]);
  const dirty = Object.keys(drafts).some(
    (t) =>
      baseline[t] && JSON.stringify(drafts[t]) !== JSON.stringify(baseline[t]),
  );
  const currentDirty =
    baseline[type] &&
    JSON.stringify(drafts[type]) !== JSON.stringify(baseline[type]);
  useEffect(() => {
    const warn = (e) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    setCursor(null);
    setTargetRows([]);
  }, [q]);
  const draft = drafts[type];
  async function save(e) {
    e.preventDefault();
    setPending(true);
    setError("");
    setFields({});
    setMessage("");
    try {
      const { data } = await api.put(`/v1/configs/${type}`, draft, {
        headers: { "If-Match": draft.version },
      });
      setDrafts((prev) => ({ ...prev, [type]: data.data }));
      setBaseline((prev) => ({ ...prev, [type]: data.data }));
      setMessage(
        "Desired configuration saved. Choose rigs below to deliver it.",
      );
      revisions.reload();
      rolloutKey.current = requestId();
    } catch (e) {
      setError(errorText(e));
      setFields(e.response?.data?.fields || {});
    } finally {
      setPending(false);
    }
  }
  async function apply(e) {
    e.preventDefault();
    setPending(true);
    setError("");
    try {
      const { data } = await api.post(
        `/v1/configs/${type}/apply`,
        { minerIds: Object.keys(targets), restart },
        { headers: { "Idempotency-Key": rolloutKey.current } },
      );
      setResults(data.results);
      setMessage(
        "Rollout dispatched. Each rig reports its own outcome in command history.",
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  }
  async function rollback(version) {
    setPending(true);
    try {
      const { data } = await api.post(`/v1/configs/${type}/rollback`, {
        version,
        expectedVersion: baseline[type].version,
      });
      setDrafts((prev) => ({ ...prev, [type]: data.data }));
      setBaseline((prev) => ({ ...prev, [type]: data.data }));
      revisions.reload();
      setMessage(
        "Prior values restored as a new desired revision. Apply separately.",
      );
      setError("");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="operations">
      <header className="op-header">
        <div>
          <h1>Mining configurations</h1>
          <p>
            Save desired settings, deliver them to selected rigs, and inspect
            the running version.
          </p>
        </div>
        <Badge status={dirty ? "warning" : "online"}>
          {dirty ? "Unsaved drafts retained in this tab" : "Saved"}
        </Badge>
      </header>
      <ErrorNotice error={error || resource.error} retry={resource.reload} />
      {message && (
        <p role="status" className="op-success">
          {message}
        </p>
      )}
      <div className="op-tabs" role="tablist" aria-label="Configuration types">
        {["xmrig", "nanominer"].map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={type === t}
            onClick={() => {
              setType(t);
              setError("");
              setFields({});
              setResults(null);
              rolloutKey.current = requestId();
            }}
          >
            {t === "xmrig" ? "CPU · XMRig" : "GPU · Nanominer"}
            {baseline[t] &&
            JSON.stringify(drafts[t]) !== JSON.stringify(baseline[t])
              ? " *"
              : ""}
          </button>
        ))}
      </div>
      <div className="op-config-layout">
        <section className="op-surface">
          <h2>Desired settings</h2>
          <p className="op-muted">
            Current saved version {baseline[type]?.version || "Loading…"}
          </p>
          {draft && (
            <form onSubmit={save} className="op-config-form">
              {Object.entries(draft)
                .filter(([k]) => labels[k])
                .map(([k, value]) => (
                  <label key={k} htmlFor={`config-${type}-${k}`}>
                    {labels[k]}
                    {k === "algorithm" ? (
                      <select
                        id={`config-${type}-${k}`}
                        value={value}
                        onChange={(e) =>
                          setDrafts({
                            ...drafts,
                            [type]: { ...draft, [k]: e.target.value },
                          })
                        }
                      >
                        {algorithms[type].map((a) => (
                          <option key={a}>{a}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id={`config-${type}-${k}`}
                        type={k === "threadPercentage" ? "number" : "text"}
                        min={k === "threadPercentage" ? 10 : undefined}
                        max={k === "threadPercentage" ? 100 : undefined}
                        value={value ?? ""}
                        aria-invalid={!!fields[k]}
                        aria-describedby={fields[k] ? `error-${k}` : undefined}
                        onChange={(e) =>
                          setDrafts({
                            ...drafts,
                            [type]: {
                              ...draft,
                              [k]:
                                k === "threadPercentage"
                                  ? Number(e.target.value)
                                  : e.target.value,
                            },
                          })
                        }
                      />
                    )}
                    {fields[k] && (
                      <span className="op-warning" id={`error-${k}`}>
                        {fields[k]}
                      </span>
                    )}
                  </label>
                ))}
              <p className="op-muted">
                Local worker name, password, GPU selection, and executable path
                can override these values. Running processes retain their launch
                configuration until restarted.
              </p>
              <div className="op-actions">
                <button
                  className="op-primary"
                  disabled={pending || !currentDirty}
                >
                  Save desired settings
                </button>
                <button
                  type="button"
                  disabled={pending || !currentDirty}
                  onClick={() => {
                    setDrafts({ ...drafts, [type]: baseline[type] });
                    setFields({});
                  }}
                >
                  Discard this draft
                </button>
              </div>
            </form>
          )}
          <details className="op-revisions">
            <summary>Revision history & rollback</summary>
            <ErrorNotice error={revisions.error} retry={revisions.reload} />
            <ul className="op-feed">
              {revisions.data?.data.map((r) => (
                <li key={r.version}>
                  <strong>{r.version}</strong>
                  <small>
                    {at(r.createdAt)} · {r.actor}
                  </small>
                  <span>
                    {r.algorithm} · {r.pool}
                  </span>
                  <button
                    disabled={
                      pending ||
                      currentDirty ||
                      r.version === baseline[type]?.version
                    }
                    onClick={() => rollback(r.version)}
                  >
                    Restore these values
                  </button>
                </li>
              ))}
            </ul>
          </details>
        </section>
        <section className="op-surface">
          <h2>Deliver to rigs</h2>
          <p>
            Choose explicit targets. Restart affects only running{" "}
            {type === "xmrig" ? "CPU" : "GPU"} processes; stopped processes stay
            stopped.
          </p>
          <label>
            Find targets
            <input
              value={q}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rig name or group tag"
            />
          </label>
          <ErrorNotice error={rigs.error} retry={rigs.reload} />
          <form onSubmit={apply}>
            <div className="op-targets">
              {[...targetRows, ...(rigs.data?.data || [])].map((r) => (
                <label className="op-check" key={r.id}>
                  <input
                    type="checkbox"
                    checked={!!targets[r.id]}
                    disabled={
                      !r.freshness.connected || r.protocolVersion < 2 || pending
                    }
                    onChange={(e) => {
                      setTargets((prev) => {
                        const next = { ...prev };
                        e.target.checked
                          ? (next[r.id] = r.name)
                          : delete next[r.id];
                        return next;
                      });
                      setResults(null);
                      rolloutKey.current = requestId();
                    }}
                  />
                  <span>
                    {r.name}
                    <small>
                      {r.reason}
                      {r.protocolVersion < 2 ? " · Agent upgrade required" : ""}
                    </small>
                  </span>
                  <Badge status={r.status} />
                </label>
              ))}
            </div>
            {rigs.data?.nextCursor && (
              <button
                type="button"
                onClick={() => {
                  setTargetRows([...targetRows, ...rigs.data.data]);
                  setCursor(rigs.data.nextCursor);
                }}
              >
                More targets
              </button>
            )}
            <label className="op-check">
              <input
                type="checkbox"
                checked={restart}
                onChange={(e) => {
                  setRestart(e.target.checked);
                  rolloutKey.current = requestId();
                  setResults(null);
                }}
              />
              Restart running processes after delivery
            </label>
            <p>
              {Object.keys(targets).length} selected:{" "}
              {Object.values(targets).join(", ") || "Choose rigs above"}
            </p>
            <button
              className="op-primary"
              disabled={
                pending ||
                currentDirty ||
                !Object.keys(targets).length ||
                !!results
              }
            >
              {pending
                ? "Working…"
                : restart
                  ? "Deliver and restart selected"
                  : "Deliver desired settings"}
            </button>
            {currentDirty && (
              <p className="op-warning">
                Save or discard this draft before delivery.
              </p>
            )}
          </form>
          {results && (
            <ul className="op-feed">
              {results.map((r) => (
                <li key={r.minerId}>
                  <strong>{targets[r.minerId] || r.minerId}</strong>
                  {r.error || <Badge status={r.command.status} />}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <div className="op-surface">
        <CommandHistory refresh={results} />
      </div>
    </div>
  );
}
