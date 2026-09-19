import React, { useEffect, useRef, useState } from "react";
import api from "../services/api";
import { useNotifications } from "./Notifications";
import SRB from "../../../src/services/srbminer.json";
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
    "ethashb3",
    "fishhash",
    "karlsenhashv2",
    "ubqhash",
    "firopow",
    "kawpow",
    "octopus",
    "autolykos",
    "verthash",
    "conflux",
    "autolykos2",
  ],
};
const labels = {
  engine: "Mining engine",
  coin: "Coin label",
  algorithm: "Algorithm",
  pool: "Pool address",
  user: "Wallet / user",
  password: "Pool password",
  threadPercentage: "CPU threads (%)",
  additionalArgs: "Additional arguments",
  rigName: "Worker name",
  workerName: "CPU worker name",
  restartOnCrash: "Restart after an unexpected exit",
  crashRestartDelaySeconds: "Delay before crash recovery (seconds)",
  maxCrashRestartsPerHour: "Maximum crash restarts per hour (0–5)",
  threads: "Explicit CPU threads (0 = automatic)",
  cpuPriority: "CPU priority (0 idle, 2 normal)",
  pauseOnBattery: "Pause CPU mining on battery",
  pauseOnActive: "Pause on activity; resume after idle seconds (0 = off)",
  hugePages: "Use huge pages when available",
  tls: "Pool TLS",
  keepAlive: "Pool keepalive",
  backupPools: "Backup pools (comma separated, up to three)",
};
Object.assign(
  labels,
  Object.fromEntries(
    Object.entries(SRB.fields).map(([key, field]) => [key, field.label]),
  ),
);
function availableAlgorithms(type, engine) {
  if (engine === "srbminer")
    return SRB.algorithms
      .filter((r) =>
        type === "xmrig"
          ? r.devices.includes("CPU")
          : r.devices.some((d) => d !== "CPU"),
      )
      .map((r) => r.algorithm);
  return type === "xmrig" && engine === "nanominer"
    ? ["rx/0"]
    : algorithms[type];
}
export default function Configs() {
  const notify = useNotifications();
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
      notify.success(
        "Configuration saved. Choose rigs below to apply it.",
        5000,
      );
    } catch (e) {
      setError(errorText(e));
      setFields(e.response?.data?.fields || {});
      notify.error(errorText(e), 10000);
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
      const rejected = data.results.filter(
        (r) => r.error || r.command?.status === "failed",
      ).length;
      notify.showToast(
        rejected
          ? `Configuration rollout: ${rejected} rigs could not accept the request. See results below.`
          : "Configuration sent. Waiting for rig results in command history.",
        rejected ? "error" : "info",
        6000,
      );
      setMessage(
        "Rollout dispatched. Each rig reports its own outcome in command history.",
      );
    } catch (e) {
      setError(errorText(e));
      notify.error(errorText(e), 10000);
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
      notify.success(
        "Prior configuration restored. Apply it to rigs separately.",
        5000,
      );
    } catch (e) {
      setError(errorText(e));
      notify.error(errorText(e), 10000);
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
            {t === "xmrig" ? "CPU mining" : "GPU mining"}
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
              {type === "xmrig" && draft.engine === "nanominer" && (
                <p>
                  Nanominer CPU and GPU are separate processes. RandomX has a 2%
                  fee. Thread limits and crash recovery are supported; advanced
                  activity, priority and TLS controls require XMRig. Older
                  clients must be upgraded before receiving Nanominer CPU
                  settings.
                </p>
              )}
              {draft.engine === "srbminer" && (
                <p>
                  SRBMiner 3.6.7 ·{" "}
                  {SRB.algorithms.find((r) => r.algorithm === draft.algorithm)
                    ?.fee ?? "—"}
                  % developer fee for this algorithm. One algorithm per process.
                  Requires MineMaster 1.4 on Windows/Linux x64. Specific GPU
                  model/driver support varies; the listed vendors are{" "}
                  {SRB.algorithms
                    .find((r) => r.algorithm === draft.algorithm)
                    ?.devices.join(", ")}
                  . MSR tuning, miner-owned restarts and automatic clock changes
                  are disabled.
                </p>
              )}
              {Object.entries(draft)
                .filter(
                  ([k]) =>
                    labels[k] &&
                    (!SRB.fields[k] ||
                      (draft.engine === "srbminer" &&
                        (type === "xmrig"
                          ? k !== "srbGpuIntensity"
                          : k !== "srbCpuPriority"))) &&
                    !(
                      draft.engine === "srbminer" &&
                      [
                        "additionalArgs",
                        "cpuPriority",
                        "pauseOnBattery",
                        "pauseOnActive",
                      ].includes(k)
                    ) &&
                    !(
                      type === "nanominer" &&
                      draft.engine !== "srbminer" &&
                      ["password", "tls", "keepAlive"].includes(k)
                    ) &&
                    !(
                      type === "xmrig" &&
                      draft.engine === "nanominer" &&
                      [
                        "cpuPriority",
                        "pauseOnBattery",
                        "pauseOnActive",
                        "tls",
                        "keepAlive",
                        "hugePages",
                        "additionalArgs",
                      ].includes(k)
                    ),
                )
                .map(([k, value]) => (
                  <label key={k} htmlFor={`config-${type}-${k}`}>
                    {labels[k]}
                    {k === "engine" ? (
                      <select
                        id={`config-${type}-${k}`}
                        value={value}
                        onChange={(e) =>
                          setDrafts({
                            ...drafts,
                            [type]: {
                              ...draft,
                              engine: e.target.value,
                              algorithm: availableAlgorithms(
                                type,
                                e.target.value,
                              ).includes(draft.algorithm)
                                ? draft.algorithm
                                : type === "xmrig"
                                  ? "rx/0"
                                  : "kawpow",
                              ...(type === "xmrig"
                                ? {
                                    additionalArgs: "",
                                    cpuPriority: 0,
                                    pauseOnBattery: false,
                                    pauseOnActive: 0,
                                    hugePages: true,
                                  }
                                : {}),
                              tls: false,
                              keepAlive: false,
                            },
                          })
                        }
                      >
                        <option value="nanominer">
                          Nanominer{" "}
                          {type === "xmrig" ? "· RandomX · 2% fee" : "· GPU"}
                        </option>
                        {type === "xmrig" && (
                          <option value="xmrig">
                            XMRig · advanced CPU controls
                          </option>
                        )}
                        <option value="srbminer">
                          SRBMiner-MULTI · CPU/GPU algorithms
                        </option>
                      </select>
                    ) : k === "algorithm" ? (
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
                        {availableAlgorithms(type, draft.engine).map((a) => (
                          <option key={a}>{a}</option>
                        ))}
                      </select>
                    ) : typeof value === "boolean" ? (
                      <input
                        id={`config-${type}-${k}`}
                        type="checkbox"
                        checked={value}
                        onChange={(e) =>
                          setDrafts({
                            ...drafts,
                            [type]: { ...draft, [k]: e.target.checked },
                          })
                        }
                      />
                    ) : (
                      <input
                        id={`config-${type}-${k}`}
                        type={typeof value === "number" ? "number" : "text"}
                        min={
                          SRB.fields[k]?.min ??
                          (k === "threadPercentage" ? 10 : undefined)
                        }
                        max={
                          SRB.fields[k]?.max ??
                          (k === "threadPercentage" ? 100 : undefined)
                        }
                        value={
                          Array.isArray(value)
                            ? value.join(", ")
                            : (value ?? "")
                        }
                        aria-invalid={!!fields[k]}
                        aria-describedby={fields[k] ? `error-${k}` : undefined}
                        onChange={(e) =>
                          setDrafts({
                            ...drafts,
                            [type]: {
                              ...draft,
                              [k]:
                                typeof value === "number"
                                  ? Number(e.target.value)
                                  : k === "backupPools"
                                    ? e.target.value.trim()
                                      ? e.target.value
                                          .split(",")
                                          .map((v) => v.trim())
                                      : []
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
                configuration until restarted. CPU controls and backup pools
                require MineMaster 1.2 or later; Nanominer CPU selection
                requires 1.3 and SRBMiner requires 1.4. Thread percentage is a
                budget for automatic tuning, not a CPU usage measurement.
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
