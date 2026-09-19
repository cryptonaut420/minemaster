import React, { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api from "../services/api";
import { useWebSocket } from "../hooks/useWebSocket";
import {
  ActionDialog,
  Badge,
  CommandHistory,
  ErrorNotice,
  Records,
  at,
  errorText,
  rate,
  useResource,
} from "./Operations";
import "./Dashboard.css";
import useQuickControls from "../hooks/useQuickControls";
import FleetOverview, { algorithmName } from "./FleetOverview";
import { useNotifications } from "./Notifications";
import {
  primaryControl,
  compactIssue,
  rigSensors,
  processRateLabel,
  needsNanominerTelemetryUpdate,
} from "../utils/rigControls";
function QuickButtons({ rig, controls, blocked = false }) {
  const receipt = controls.receipts[rig.id];
  const control = primaryControl(rig, receipt);
  const failure =
    receipt?.error ||
    (["failed", "timed_out", "canceled"].includes(receipt?.command?.status) &&
      (receipt.command.error || "Action did not complete"));
  return (
    <div className="op-quick" aria-label={`Mining controls for ${rig.name}`}>
      <button
        className={control.action === "stop" ? "op-pause" : "op-play"}
        aria-label={`${control.action === "stop" ? "Pause" : "Play"} mining on ${rig.name}`}
        title={
          blocked
            ? "Refresh rig status before sending a command"
            : control.reason
        }
        disabled={blocked || control.disabled}
        onClick={() => controls.run(control.action, [rig])}
      >
        <span aria-hidden="true">{control.action === "stop" ? "Ⅱ" : "▶"}</span>{" "}
        {control.label}
      </button>
      {failure && (
        <small role="alert" className="op-command-error" title={failure}>
          {String(failure).slice(0, 110)}
          {String(failure).length > 110 ? "…" : ""}
        </small>
      )}
    </div>
  );
}
const sensorValue = (value, suffix) =>
  typeof value === "number" && Number.isFinite(value)
    ? `${Math.round(value)}${suffix}`
    : "—";
function RigMiningCell({ rig, scope }) {
  const processes = (rig.processes || []).filter((p) => p.deviceType === scope);
  const sensors = rigSensors(rig);
  const cpu = rig.hardware?.cpu;
  return (
    <div className={`fleet-mining-cell fleet-${scope.toLowerCase()}`}>
      {processes.length ? (
        processes.map((p) => (
          <div className="fleet-rig-rate" key={p.id}>
            <strong
              className={
                p.running &&
                rig.freshness?.telemetryFresh &&
                ["valid", "zero"].includes(p.quality)
                  ? ""
                  : "fleet-rate-unavailable"
              }
            >
              {processRateLabel(rig, p, rate)}
            </strong>
            <span>
              {algorithmName(p.algorithm)}
              {p.engine
                ? ` · ${{ nanominer: "Nanominer", xmrig: "XMRig", srbminer: "SRBMiner" }[p.engine] || p.engine}`
                : ""}
            </span>
          </div>
        ))
      ) : (
        <div className="fleet-rig-rate">
          <strong className="fleet-rate-unavailable">Not reported</strong>
        </div>
      )}
      {scope === "CPU" ? (
        <div className="fleet-device">
          <span className="fleet-device-model" title={cpu?.brand || cpu?.model}>
            {cpu?.brand || cpu?.model || "CPU not reported"}
          </span>
          <div className="fleet-sensors">
            <span className={sensors.cpu.temperature >= 85 ? "fleet-hot" : ""}>
              Temp <b>{sensorValue(sensors.cpu.temperature, "°C")}</b>
            </span>
            <span>
              Load <b>{sensorValue(sensors.cpu.usage, "%")}</b>
            </span>
          </div>
        </div>
      ) : sensors.gpus.length ? (
        sensors.gpus.map((g) => (
          <div className="fleet-device" key={g.deviceId}>
            <span
              className="fleet-device-model"
              title={`${g.model || "GPU"} · ${g.deviceId}`}
            >
              {g.model || "GPU"}
            </span>
            <div className="fleet-sensors">
              <span className={g.sensor.temperature >= 85 ? "fleet-hot" : ""}>
                Temp <b>{sensorValue(g.sensor.temperature, "°C")}</b>
              </span>
              <span>
                Load <b>{sensorValue(g.sensor.usage, "%")}</b>
              </span>
              <span>
                <b>{sensorValue(g.sensor.powerWatts, " W")}</b>
              </span>
            </div>
          </div>
        ))
      ) : (
        <small>GPU hardware not reported</small>
      )}
    </div>
  );
}
function RigSystemCell({ rig }) {
  const { memory } = rigSensors(rig);
  const total = rig.hardware?.ram?.total || memory.total;
  return (
    <div className="fleet-system">
      <span>
        RAM <strong>{sensorValue(memory.usage, "%")}</strong>
      </span>
      <small>
        {total
          ? `${(total / 1024 ** 3).toFixed(0)} GB installed`
          : "Capacity not reported"}
      </small>
    </div>
  );
}
function ageLabel(value) {
  const age = value
    ? Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000))
    : null;
  return age === null || !Number.isFinite(age)
    ? "Not reported"
    : age < 60
      ? `${age}s ago`
      : age < 3600
        ? `${Math.floor(age / 60)}m ago`
        : age < 86400
          ? `${Math.floor(age / 3600)}h ago`
          : `${Math.floor(age / 86400)}d ago`;
}
function RigDetail({ id, close, onAction, onChanged, controls }) {
  const notify = useNotifications();
  const panel = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    panel.current?.focus({ preventScroll: true });
    panel.current?.scrollIntoView({ block: "start" });
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, [id]);
  const { data, error, reload } = useResource(`rigs/${id}`, {}, 15000),
    r = data?.data;
  const [tab, setTab] = useState("Overview"),
    [edit, setEdit] = useState(null),
    [saveError, setSaveError] = useState(""),
    [saving, setSaving] = useState(false);
  const sensors = useResource(
    "metrics/sensors",
    { minerId: id, limit: 120 },
    30000,
  );
  async function update(changes) {
    setSaving(true);
    try {
      await api.patch(`/v1/rigs/${id}`, changes);
      setEdit(null);
      setSaveError("");
      reload();
      onChanged();
      notify.success(`${r?.name || "Rig"} updated.`);
    } catch (e) {
      setSaveError(errorText(e));
      notify.error(errorText(e), 10000);
    } finally {
      setSaving(false);
    }
  }
  return (
    <aside
      ref={panel}
      tabIndex={-1}
      className="op-detail"
      aria-label="Rig details"
    >
      <div className="op-section-title">
        <h2>{r?.name || "Rig details"}</h2>
        <button onClick={close}>Close</button>
      </div>
      <ErrorNotice error={error || saveError} retry={reload} />
      {r && (
        <>
          <div className="op-row">
            <Badge status={r.status}>
              {r.status === "online" ? "Stopped · online" : r.status}
            </Badge>
            <span>{r.reason}</span>
          </div>
          <p className="op-muted">Last telemetry {at(r.telemetryReceivedAt)}</p>
          {needsNanominerTelemetryUpdate(r) && (
            <p className="op-warning">
              Client 1.4.4 restores Nanominer log capture on Windows. Update
              this agent to recover missing hashrate reporting.
            </p>
          )}
          <QuickButtons rig={r} controls={controls} blocked={!!error} />
          <div className="op-actions">
            <button
              className="op-primary"
              disabled={
                !r.freshness.connected ||
                r.protocolVersion < 2 ||
                !!r.archivedAt ||
                !!r.forgottenAt
              }
              onClick={() => onAction([r])}
            >
              Advanced actions
            </button>
            <button
              onClick={() =>
                setEdit({
                  name: r.name,
                  group: r.group || "",
                  tags: (r.tags || []).join(", "),
                })
              }
            >
              Edit rig
            </button>
          </div>
          <div className="op-tabs" role="tablist" aria-label="Rig sections">
            {["Overview", "Commands", "Logs", "Events"].map((t) => (
              <button
                role="tab"
                aria-selected={tab === t}
                key={t}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </div>
          {tab === "Overview" && (
            <>
              <dl className="op-facts">
                <dt>Agent version</dt>
                <dd>
                  {r.version || "Not reported"}
                  {r.protocolVersion < 2 &&
                    " · Upgrade for acknowledged commands"}
                </dd>
                <dt>Hostname / address</dt>
                <dd>
                  {r.hostname} / {r.ip || "Unknown"}
                </dd>
                <dt>Group</dt>
                <dd>{r.group || "Ungrouped"}</dd>
                <dt>Tags</dt>
                <dd>{r.tags?.join(", ") || "None"}</dd>
                <dt>CPU</dt>
                <dd>
                  {r.hardware.cpu?.brand ||
                    r.hardware.cpu?.model ||
                    "Not reported"}
                </dd>
                <dt>Memory</dt>
                <dd>
                  {r.stats?.memory?.usage == null
                    ? "Not reported"
                    : `${r.stats.memory.usage.toFixed(1)}% used`}
                </dd>
                <dt>Maintenance until</dt>
                <dd>{at(r.maintenanceUntil)}</dd>
              </dl>
              <section className="op-process" aria-label="Application updates">
                <h3>Application updates</h3>
                <p>
                  {r.appUpdate
                    ? `${r.appUpdate.state}${r.appUpdate.version ? " · " + r.appUpdate.version : ""}${r.appUpdate.percent != null ? " · " + r.appUpdate.percent + "%" : ""}`
                    : "Not reported — update this agent for remote update status"}
                </p>
                {r.appUpdate && (
                  <>
                    <p>
                      {r.appUpdate.supported
                        ? "Installation supported"
                        : "Automatic installation unavailable for this build"}{" "}
                      ·{" "}
                      {r.freshness.telemetryFresh
                        ? "Current agent report"
                        : "Stale agent report"}
                    </p>
                    <p>{r.appUpdate.message}</p>
                    <p className="op-muted">
                      Last update transition {at(r.appUpdate.updatedAt)}
                    </p>
                  </>
                )}
                <p className="op-muted">
                  Use Advanced actions → Check app updates or Install app update
                  with whole-rig scope.
                </p>
              </section>
              {r.processes.map((p) => (
                <section className="op-process" key={p.id}>
                  <div className="op-row">
                    <h3>
                      {p.deviceType} · {p.engine || "Engine not reported"}
                    </h3>
                    <Badge status={p.running ? p.quality : "online"}>
                      {p.paused
                        ? `Paused: ${p.pauseReason || "miner"}`
                        : p.running
                          ? p.quality
                          : "Stopped"}
                    </Badge>
                  </div>
                  <strong>
                    {p.running && ["valid", "zero"].includes(p.quality)
                      ? rate(p.hashrate)
                      : "No current rate"}
                  </strong>
                  <p>
                    {p.algorithm || "Algorithm not reported"} ·{" "}
                    {p.uptime == null
                      ? "Uptime unknown"
                      : `${Math.floor(p.uptime / 60)} min uptime`}
                  </p>
                  <p className="op-muted">
                    Observed {at(p.hashrateObservedAt)}
                  </p>
                  <dl className="op-facts">
                    <dt>Desired version</dt>
                    <dd>{p.desiredConfigVersion || "Local configuration"}</dd>
                    <dt>Loaded version</dt>
                    <dd>{p.loadedConfigVersion || "Not reported"}</dd>
                    <dt>Running version</dt>
                    <dd>{p.appliedConfigVersion || "Not reported"}</dd>
                    <dt>Local overrides</dt>
                    <dd>
                      {(Array.isArray(p.localOverrides)
                        ? p.localOverrides
                        : []
                      ).join(", ") || "None reported"}
                    </dd>
                    <dt>Miner version</dt>
                    <dd>
                      {p.engine || "Engine not reported"} ·{" "}
                      {p.minerVersion ||
                        p.diagnostic?.version ||
                        "Not reported"}
                    </dd>
                    {p.running && p.effectiveSettings?.cpuThreads && (
                      <>
                        <dt>CPU threads at launch</dt>
                        <dd>{p.effectiveSettings.cpuThreads}</dd>
                      </>
                    )}
                    <dt>Miner files</dt>
                    <dd>
                      {p.diagnostic?.status || "Not checked"}{" "}
                      {p.diagnostic?.code || ""}
                    </dd>
                    <dt>Process ID</dt>
                    <dd>{p.pid || "Not reported"}</dd>
                    <dt>Pool</dt>
                    <dd>
                      {p.pool
                        ? `${p.pool.status} ${p.pool.address || ""} · ${at(p.pool.observedAt)}`
                        : "Not reported"}
                    </dd>
                    <dt>Shares</dt>
                    <dd>
                      {p.shares
                        ? `${p.shares.accepted} accepted / ${p.shares.rejected} rejected`
                        : "Unavailable"}
                    </dd>
                  </dl>
                  {p.diagnostic && (
                    <details>
                      <summary>Miner diagnostics and repair status</summary>
                      <p>{p.diagnostic.message}</p>
                      <p className="op-muted">{p.diagnostic.path}</p>
                      <p>Checked {at(p.diagnostic.observedAt)}</p>
                      {p.diagnostic.expectedSha256 && (
                        <p className="op-muted">
                          Expected executable SHA-256:{" "}
                          {p.diagnostic.expectedSha256}
                        </p>
                      )}
                      {p.diagnostic.windows && (
                        <div>
                          <p>
                            Windows check: {p.diagnostic.windows.status} ·{" "}
                            {at(p.diagnostic.windows.checkedAt)}
                          </p>
                          <p>{p.diagnostic.windows.message}</p>
                          <p>
                            Signature:{" "}
                            {p.diagnostic.windows.signatureStatus ||
                              "Unavailable"}
                          </p>
                          {p.diagnostic.windows.detections?.map((d, i) => (
                            <p key={i}>
                              {d.threatName} · {at(d.detectedAt)}
                              <br />
                              {d.resource}
                            </p>
                          ))}
                        </div>
                      )}
                    </details>
                  )}
                  <details>
                    <summary>Configuration used at launch</summary>
                    <pre>
                      {JSON.stringify(p.activeConfig, null, 2) ||
                        "Not reported"}
                    </pre>
                  </details>
                  {p.error && <p className="op-warning">{p.error}</p>}
                </section>
              ))}
              <div className="op-row">
                <h3>Hardware & sensors</h3>
                <Badge status={r.stats?.quality || "unavailable"} />
              </div>
              <p>
                CPU:{" "}
                {r.stats?.cpu?.temperature == null
                  ? "Temperature unavailable"
                  : `${r.stats.cpu.temperature}°C`}{" "}
                ·{" "}
                {r.stats?.cpu?.usage == null
                  ? "Usage unavailable"
                  : `${r.stats.cpu.usage.toFixed(1)}% usage`}
              </p>
              <p className="op-muted">
                Report time {at(r.stats?.observedAt)} · CPU usage{" "}
                {at(r.stats?.cpu?.observedAt)} · CPU temperature{" "}
                {at(r.stats?.cpu?.temperatureObservedAt)}
                {r.stats?.quality !== "observed" && " · Last known readings"}
              </p>
              <ul className="op-feed">
                {(r.expectedDeviceIds || [])
                  .filter(
                    (id) => !r.hardware.gpus.some((g) => g.deviceId === id),
                  )
                  .map((id) => (
                    <li key={`missing:${id}`}>
                      <Badge status="critical">Missing GPU</Badge>
                      <small>{id}</small>
                    </li>
                  ))}
                {r.hardware.gpus.map((g) => {
                  const s = r.stats?.gpus?.find(
                    (s) => s.deviceId === g.deviceId,
                  );
                  return (
                    <li key={g.deviceId}>
                      <strong>{g.model}</strong>
                      <small>
                        {g.deviceId} · {g.identityQuality} identity · Sensor
                        observed {at(s?.observedAt)}
                      </small>
                      <span>
                        {s?.temperature == null
                          ? "Temperature unavailable"
                          : `${s.temperature}°C`}{" "}
                        ·{" "}
                        {s?.powerWatts == null
                          ? "Power unavailable"
                          : `${s.powerWatts.toFixed(0)} W`}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <details>
                <summary>
                  Sensor history ({sensors.data?.data.length || 0} samples)
                </summary>
                <ErrorNotice error={sensors.error} retry={sensors.reload} />
                <div className="op-log">
                  {sensors.data?.data.map((s) => (
                    <div key={s._id}>
                      <time>{at(s.observedAt || s.timestamp)}</time>
                      <span>
                        CPU{" "}
                        {s.cpu?.temperature == null
                          ? "—"
                          : `${s.cpu.temperature}°C`}{" "}
                        · Memory {s.memory?.usage?.toFixed(1) ?? "—"}% · GPU{" "}
                        {s.gpus
                          ?.map((g) => `${g.temperature ?? "—"}°C`)
                          .join(", ") || "—"}
                      </span>
                    </div>
                  ))}
                </div>
              </details>
              <div className="op-actions">
                <button
                  disabled={saving}
                  onClick={() =>
                    update({
                      maintenanceUntil: new Date(
                        Date.now() + 3600000,
                      ).toISOString(),
                    })
                  }
                >
                  Maintenance for 1 hour
                </button>
                {r.maintenanceUntil && (
                  <button
                    disabled={saving}
                    onClick={() => update({ maintenanceUntil: null })}
                  >
                    End maintenance
                  </button>
                )}
                <button
                  disabled={saving}
                  onClick={() => update({ acknowledgeInventory: true })}
                >
                  Accept current GPU inventory
                </button>
                <button
                  disabled={saving}
                  onClick={() => update({ archived: !r.archivedAt })}
                >
                  {r.archivedAt ? "Restore from archive" : "Archive rig"}
                </button>
                {r.forgottenAt && (
                  <button
                    disabled={saving}
                    onClick={() => update({ restore: true })}
                  >
                    Restore forgotten rig
                  </button>
                )}
              </div>
              <details>
                <summary>
                  Automatic recovery · {r.recovery?.enabled ? "Enabled" : "Off"}
                </summary>
                <p>
                  Restart a process still running at zero for{" "}
                  {(r.recovery?.zeroSeconds || 300) / 60} minutes, with a{" "}
                  {r.recovery?.cooldownMinutes || 30}-minute cooldown and at
                  most {r.recovery?.maxPerDay || 2} attempts per day.
                  Maintenance, operator stops, and unknown command outcomes
                  block recovery.
                </p>
                <button
                  disabled={saving}
                  onClick={() =>
                    update({
                      recovery: {
                        enabled: !r.recovery?.enabled,
                        zeroSeconds: r.recovery?.zeroSeconds || 300,
                        cooldownMinutes: r.recovery?.cooldownMinutes || 30,
                        maxPerDay: r.recovery?.maxPerDay || 2,
                      },
                    })
                  }
                >
                  {r.recovery?.enabled
                    ? "Disable recovery"
                    : "Enable bounded recovery"}
                </button>
              </details>
              <details>
                <summary>Forget this rig</summary>
                <p>
                  Disconnect this agent and prevent automatic registration until
                  restored. History is retained.
                </p>
                <button
                  className="op-danger"
                  disabled={saving}
                  onClick={async () => {
                    setSaving(true);
                    try {
                      await api.delete(`/v1/rigs/${id}`);
                      notify.success(`${r.name} forgotten and disconnected.`);
                      onChanged();
                      close();
                    } catch (e) {
                      setSaveError(errorText(e));
                      notify.error(errorText(e), 10000);
                    } finally {
                      setSaving(false);
                    }
                  }}
                >
                  Forget and disconnect
                </button>
              </details>
            </>
          )}
          {tab === "Commands" && <CommandHistory minerId={id} />}
          {tab === "Logs" && <Records kind="logs" minerId={id} />}
          {tab === "Events" && <Records kind="events" minerId={id} />}
          {edit && (
            <form
              className="op-edit"
              onSubmit={(e) => {
                e.preventDefault();
                update({ ...edit, tags: edit.tags.split(",") });
              }}
            >
              <h3>Edit rig</h3>
              {["name", "group", "tags"].map((k) => (
                <label key={k}>
                  {k}
                  <input
                    value={edit[k]}
                    onChange={(e) => setEdit({ ...edit, [k]: e.target.value })}
                    required={k === "name"}
                  />
                </label>
              ))}
              <div className="op-actions">
                <button disabled={saving} type="submit">
                  {saving ? "Saving…" : "Save rig"}
                </button>
                <button type="button" onClick={() => setEdit(null)}>
                  Cancel
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </aside>
  );
}
function Monitoring({ filters = {}, onSelect }) {
  const notify = useNotifications();
  const [resolved, setResolved] = useState("false"),
    [severity, setSeverity] = useState(""),
    [cursor, setCursor] = useState(null),
    [pages, setPages] = useState([]);
  const resource = useResource("monitoring/rules"),
    incidents = useResource(
      "incidents",
      { ...filters, resolved, severity, limit: 50, cursor },
      cursor ? 0 : 30000,
    );
  const [draft, setDraft] = useState(null),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    if (resource.data) setDraft(resource.data.data);
  }, [resource.data]);
  const save = async (e) => {
    e.preventDefault();
    try {
      await api.put("/v1/monitoring/rules", draft);
      setError("");
      setSaved(true);
      notify.success("Monitoring rules saved.");
    } catch (e) {
      setError(errorText(e));
      notify.error(errorText(e), 10000);
    }
  };
  return (
    <section className="op-surface">
      <h2>Monitoring rules</h2>
      <p className="op-muted">
        Incident scope:{" "}
        {Object.entries(filters)
          .filter(([, value]) => value)
          .map(([name, value]) => `${name}: ${value}`)
          .join(", ") || "All rigs"}
        . Change scope in Fleet.
      </p>
      <p>
        Incidents are evaluated every 30 seconds. Maintenance suppresses alerts
        while preserving their history. Recovery is off by default. Enable
        bounded recovery for individual rigs in their overview.
      </p>
      <ErrorNotice
        error={error || resource.error || incidents.error}
        retry={resource.reload}
      />
      {draft && (
        <form onSubmit={save} className="op-rule-form">
          {Object.entries(draft).map(([k, v]) => (
            <label key={k}>
              {k.replace(/([A-Z])/g, " $1").replaceAll("_", " ")}
              {typeof v === "boolean" ? (
                <input
                  type="checkbox"
                  checked={v}
                  onChange={(e) => {
                    setDraft({ ...draft, [k]: e.target.checked });
                    setSaved(false);
                  }}
                />
              ) : (
                <input
                  type="number"
                  min={resource.data?.limits?.[k]?.min ?? 1}
                  max={resource.data?.limits?.[k]?.max ?? 86400}
                  step={resource.data?.limits?.[k]?.integer ? 1 : "any"}
                  value={v}
                  onChange={(e) => {
                    setDraft({ ...draft, [k]: Number(e.target.value) });
                    setSaved(false);
                  }}
                />
              )}
            </label>
          ))}
          <button className="op-primary">Save rules</button>
          {saved && <span role="status">Rules saved</span>}
        </form>
      )}
      <div className="op-toolbar">
        <label>
          Incident state
          <select
            value={resolved}
            onChange={(e) => {
              setResolved(e.target.value);
              setCursor(null);
              setPages([]);
            }}
          >
            <option value="false">Open</option>
            <option value="true">Resolved</option>
          </select>
        </label>
        <label>
          Severity
          <select
            value={severity}
            onChange={(e) => {
              setSeverity(e.target.value);
              setCursor(null);
              setPages([]);
            }}
          >
            <option value="">All severities</option>
            <option value="critical">Critical</option>
            <option value="warning">Warning</option>
          </select>
        </label>
      </div>
      <IncidentList
        incidents={incidents}
        resolved={resolved === "true"}
        onSelect={onSelect}
      />
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
          disabled={!incidents.data?.nextCursor}
          onClick={() => {
            setPages([...pages, cursor]);
            setCursor(incidents.data.nextCursor);
          }}
        >
          Next
        </button>
      </div>
    </section>
  );
}
function IncidentList({ incidents, resolved = false, onSelect }) {
  const [error, setError] = useState("");
  return (
    <section>
      <h3>{resolved ? "Resolved incidents" : "Open incidents"}</h3>
      <ErrorNotice error={error || incidents.error} retry={incidents.reload} />
      <ul className="op-feed">
        {incidents.data?.data.map((i) => (
          <li key={i.key}>
            <div className="op-row">
              <strong>{i.message}</strong>
              <Badge status={i.suppressed ? "suppressed" : i.severity} />
            </div>
            <small>
              {onSelect ? (
                <button onClick={() => onSelect(i.minerId)}>
                  {i.minerName || i.minerId}
                </button>
              ) : (
                i.minerName || i.minerId
              )}{" "}
              · Since {at(i.openedAt)}
            </small>
            {i.resolvedAt ? (
              <span className="op-muted">Resolved {at(i.resolvedAt)}</span>
            ) : i.acknowledgedAt ? (
              <span className="op-muted">
                Acknowledged {at(i.acknowledgedAt)}
              </span>
            ) : (
              <button
                onClick={async () => {
                  try {
                    await api.post(
                      `/v1/incidents/${encodeURIComponent(i.key)}/acknowledge`,
                    );
                    setError("");
                    incidents.reload();
                  } catch (e) {
                    setError(errorText(e));
                  }
                }}
              >
                Acknowledge
              </button>
            )}
          </li>
        ))}
      </ul>
      {incidents.data?.data.length === 0 && (
        <p className="op-empty">
          No {resolved ? "resolved" : "open"} incidents in this view.
        </p>
      )}
    </section>
  );
}
export default function Dashboard() {
  const [columns, setColumns] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("minemaster-columns") || "{}");
    } catch (_) {
      return {};
    }
  });
  const [search, setSearch] = useSearchParams(),
    [screen, setScreen] = useState("Fleet"),
    [selected, setSelected] = useState({}),
    [detail, setDetail] = useState(null),
    [action, setAction] = useState(null),
    [cursor, setCursor] = useState(null),
    [pageStack, setPageStack] = useState([]),
    [timeframe, setTimeframe] = useState("24h");
  const [savedViews, setSavedViews] = useState(() => {
      try {
        return JSON.parse(localStorage.getItem("minemaster-views") || "[]");
      } catch (_) {
        return [];
      }
    }),
    [viewName, setViewName] = useState("");
  const params = Object.fromEntries(search),
    filters = {
      q: params.q || "",
      status: params.status || "",
      attention: params.attention || "",
      group: params.group || "",
      tag: params.tag || "",
      includeArchived: params.includeArchived || "",
      includeForgotten: params.includeForgotten || "",
    };
  const summary = useResource("fleet/summary", filters, 15000),
    fleet = useResource(
      "rigs",
      {
        ...filters,
        sort: params.sort || "activity",
        order: params.order || "asc",
        limit: 50,
        cursor,
      },
      30000,
    ),
    history = useResource("metrics/hashrate", { ...filters, timeframe }, 60000),
    incidents = useResource("incidents", { ...filters, limit: 8 }, 30000);
  const [socketError, setSocketError] = useState("");
  const reloadRef = useRef(),
    invalidation = useRef(null);
  reloadRef.current = () => {
    summary.reload();
    fleet.reload();
    incidents.reload();
  };
  const { connected } = useWebSocket((message) => {
    if (
      message.type === "service_error" ||
      message.code === "authentication_required"
    )
      setSocketError(message.error);
    if (message.type === "monitoring_updated") setSocketError("");
    if (
      [
        "miner_updated",
        "miner_deleted",
        "command_updated",
        "subscribed",
        "monitoring_updated",
      ].includes(message.type)
    ) {
      if (!invalidation.current)
        invalidation.current = setTimeout(() => {
          invalidation.current = null;
          reloadRef.current();
        }, 3000);
    }
  });
  useEffect(() => () => clearTimeout(invalidation.current), []);
  const rows = fleet.data?.data || [];
  function filter(key, value) {
    const next = new URLSearchParams(search);
    value ? next.set(key, value) : next.delete(key);
    setSearch(next, { replace: true });
    setCursor(null);
    setPageStack([]);
    setSelected({});
  }
  const picked = Object.values(selected);
  const controls = useQuickControls(() => reloadRef.current());
  return (
    <div className="operations">
      <header className="op-header">
        <div>
          <h1>Mining fleet</h1>
          <p>Mining performance, hardware and controls.</p>
        </div>
        <div className="op-connection">
          <Badge status={connected ? "online" : "offline"}>
            {connected ? "Live" : "Reconnecting"}
          </Badge>
          <small>Summary updated {at(summary.data?.asOf)}</small>
        </div>
      </header>
      <ErrorNotice
        error={summary.error || fleet.error || socketError}
        retry={() => {
          summary.reload();
          fleet.reload();
          setSocketError("");
        }}
      />
      {(summary.error || fleet.error) && summary.data && (
        <p className="op-warning">
          Showing last received data from {at(summary.data.asOf)}. Status and
          totals may be out of date.
        </p>
      )}
      {summary.data?.monitoring &&
        (screen === "Monitoring" ||
          !["healthy", "starting"].includes(
            summary.data.monitoring.status,
          )) && (
          <p
            className={
              ["healthy", "starting"].includes(summary.data.monitoring.status)
                ? "op-muted"
                : "op-warning"
            }
            role="status"
          >
            Monitoring {summary.data.monitoring.status} · Last sweep{" "}
            {at(summary.data.monitoring.lastSweepAt)}
            {summary.data.monitoring.failedRigs > 0 &&
              ` · ${summary.data.monitoring.failedRigs} rigs could not be checked`}
          </p>
        )}
      <div className="op-tabs" role="tablist" aria-label="Operations views">
        {["Fleet", "Activity", "Monitoring"].map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={screen === t}
            onClick={() => setScreen(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {screen === "Activity" && (
        <div className="op-surface">
          <h2>Fleet-wide activity</h2>
          <p className="op-muted">
            Activity across all rigs. Open a rig’s detail panel for its own
            command history and logs.
          </p>
          <CommandHistory />
          <Records kind="events" />
          <Records kind="logs" />
        </div>
      )}
      {screen === "Monitoring" && (
        <Monitoring
          filters={filters}
          onSelect={(id) => {
            setDetail(id);
            setScreen("Fleet");
          }}
        />
      )}
      {screen === "Fleet" && (
        <>
          {controls.notice && (
            <div className="op-control-notice" role="status">
              {controls.notice}
            </div>
          )}
          {Object.values(controls.receipts).some(
            (r) =>
              r.error || ["failed", "timed_out"].includes(r.command?.status),
          ) && (
            <details className="op-control-errors">
              <summary>Some rigs need attention — view command results</summary>
              {Object.values(controls.receipts)
                .filter(
                  (r) =>
                    r.error ||
                    ["failed", "timed_out"].includes(r.command?.status),
                )
                .map((r) => (
                  <p key={r.minerId}>
                    {r.name || r.minerId}:{" "}
                    {r.error || r.command.error || r.command.status}
                  </p>
                ))}
            </details>
          )}
          <FleetOverview
            actions={
              <div
                className="fleet-all-actions"
                role="group"
                aria-label="Whole fleet controls"
              >
                <small>Whole fleet · every page &amp; filter</small>
                <div className="op-actions">
                  <button
                    className="op-play"
                    disabled={controls.busy || !!fleet.error}
                    onClick={() => controls.run("start")}
                    title="Start enabled, stopped mining across the fleet"
                  >
                    ▶ Play all
                  </button>
                  <button
                    className="op-pause"
                    disabled={!!fleet.error}
                    onClick={() => controls.run("stop")}
                    title="Pause all connected rigs, including pending starts"
                  >
                    Ⅱ Pause all
                  </button>
                </div>
              </div>
            }
            summary={summary.data}
            history={history}
            timeframe={timeframe}
            setTimeframe={setTimeframe}
            filtered={Object.values(filters).some(Boolean)}
            onAttention={() =>
              filter("attention", filters.attention === "true" ? "" : "true")
            }
          />
          <div className="op-toolbar op-filters">
            <label className="op-search">
              Find rigs
              <input
                value={filters.q}
                onChange={(e) => filter("q", e.target.value)}
                placeholder="Name, host, address, group, tag…"
              />
            </label>
            <label>
              Status
              <select
                value={filters.status}
                onChange={(e) => filter("status", e.target.value)}
              >
                <option value="">All statuses</option>
                {[
                  "mining",
                  "online",
                  "offline",
                  "stale",
                  "error",
                  "archived",
                  "forgotten",
                ].map((s) => (
                  <option key={s} value={s}>
                    {s === "online" ? "Stopped · online" : s}
                  </option>
                ))}
              </select>
            </label>
            {Object.values(filters).some(Boolean) && (
              <button
                onClick={() => {
                  setSearch({});
                  setCursor(null);
                  setPageStack([]);
                  setSelected({});
                }}
              >
                Clear filters
              </button>
            )}
            <details>
              <summary>
                More filters &amp; saved views
                {[filters.group, filters.tag, filters.attention].some(Boolean)
                  ? " · active"
                  : ""}
              </summary>
              <div className="op-toolbar">
                <label>
                  Group
                  <input
                    value={filters.group}
                    onChange={(e) => filter("group", e.target.value)}
                    placeholder="Any group"
                  />
                </label>
                <label>
                  Tag
                  <input
                    value={filters.tag}
                    onChange={(e) => filter("tag", e.target.value)}
                    placeholder="Any tag"
                  />
                </label>
                <label>
                  Attention
                  <select
                    value={filters.attention}
                    onChange={(e) => filter("attention", e.target.value)}
                  >
                    <option value="">All rigs</option>
                    <option value="true">Needs attention</option>
                    <option value="false">No attention flagged</option>
                  </select>
                </label>
              </div>
              <label>
                Saved view
                <select
                  value=""
                  onChange={(e) => {
                    setSearch(savedViews[Number(e.target.value)].query);
                    setCursor(null);
                    setPageStack([]);
                    setSelected({});
                  }}
                >
                  <option value="">Choose view…</option>
                  {savedViews.map((v, i) => (
                    <option key={i} value={i}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                View name
                <input
                  value={viewName}
                  maxLength={60}
                  onChange={(e) => setViewName(e.target.value)}
                />
              </label>
              <button
                disabled={!viewName.trim()}
                onClick={() => {
                  const next = [
                    ...savedViews.filter((v) => v.name !== viewName.trim()),
                    { name: viewName.trim(), query: search.toString() },
                  ].slice(-20);
                  setSavedViews(next);
                  localStorage.setItem(
                    "minemaster-views",
                    JSON.stringify(next),
                  );
                  setViewName("");
                }}
              >
                Save current view
              </button>
              <label className="op-check">
                <input
                  type="checkbox"
                  checked={filters.includeArchived === "true"}
                  onChange={(e) =>
                    filter("includeArchived", e.target.checked ? "true" : "")
                  }
                />
                Include archived
              </label>
              <label className="op-check">
                <input
                  type="checkbox"
                  checked={filters.includeForgotten === "true"}
                  onChange={(e) =>
                    filter("includeForgotten", e.target.checked ? "true" : "")
                  }
                />
                Include forgotten
              </label>
            </details>
          </div>
          <div className={`op-workspace ${detail ? "op-has-detail" : ""}`}>
            <section className="op-surface">
              <div className="op-section-title">
                <h2>
                  Rigs{" "}
                  <span className="op-muted">{fleet.data?.total ?? "—"}</span>
                </h2>
                <div className="op-actions">
                  <details>
                    <summary>Columns</summary>
                    {["identity"].map((key) => (
                      <label className="op-check" key={key}>
                        <input
                          type="checkbox"
                          checked={!!columns[key]}
                          onChange={(e) => {
                            const next = {
                              ...columns,
                              [key]: e.target.checked,
                            };
                            setColumns(next);
                            localStorage.setItem(
                              "minemaster-columns",
                              JSON.stringify(next),
                            );
                          }}
                        />
                        Host &amp; IP address
                      </label>
                    ))}
                  </details>
                  <label className="op-sort">
                    Sort rigs
                    <select
                      aria-label="Sort rigs"
                      value={`${params.sort || "activity"}:${params.order || "asc"}`}
                      onChange={(e) => {
                        const [sort, order] = e.target.value.split(":");
                        const next = new URLSearchParams(search);
                        next.set("sort", sort);
                        next.set("order", order);
                        setSearch(next);
                        setCursor(null);
                        setPageStack([]);
                      }}
                    >
                      <option value="activity:asc">
                        Mining &amp; online first
                      </option>
                      <option value="activity:desc">Offline first</option>
                      <option value="name:asc">Name A–Z</option>
                      <option value="name:desc">Name Z–A</option>
                      <option value="lastSeen:desc">Recently seen</option>
                      <option value="lastSeen:asc">Longest absent</option>
                      <option value="status:asc">State A–Z</option>
                      <option value="status:desc">State Z–A</option>
                    </select>
                  </label>
                  {!!picked.length && (
                    <span>{picked.length} selected across pages</span>
                  )}
                  {!!picked.length && (
                    <>
                      <button
                        className="op-play"
                        disabled={controls.busy || !!fleet.error}
                        onClick={() => controls.run("start", picked)}
                      >
                        ▶ Play selected
                      </button>
                      <button
                        className="op-pause"
                        disabled={!!fleet.error}
                        onClick={() => controls.run("stop", picked)}
                      >
                        Ⅱ Pause selected
                      </button>
                    </>
                  )}
                  {!!picked.length && (
                    <button onClick={() => setSelected({})}>
                      Clear selection
                    </button>
                  )}
                  <button
                    disabled={!picked.length}
                    onClick={() => setAction(picked)}
                  >
                    Advanced actions
                  </button>
                  <button onClick={fleet.reload}>Refresh</button>
                </div>
              </div>
              {fleet.loading && <p className="op-empty">Loading rigs…</p>}
              {fleet.data?.data.length === 0 && (
                <p className="op-empty">
                  No rigs match these filters. Clear filters or register an
                  agent.
                </p>
              )}
              <div className="op-table-wrap">
                <table className="op-table fleet-table">
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          aria-label="Select all rigs on this page"
                          checked={
                            !!rows.length && rows.every((r) => selected[r.id])
                          }
                          onChange={(e) =>
                            setSelected((prev) => {
                              const next = { ...prev };
                              rows.forEach((r) => {
                                if (e.target.checked) next[r.id] = r;
                                else delete next[r.id];
                              });
                              return next;
                            })
                          }
                        />
                      </th>
                      <th>Rig</th>
                      <th>Mining</th>
                      <th>GPU hashrate &amp; hardware</th>
                      <th>CPU hashrate &amp; hardware</th>
                      <th>System</th>
                      <th>Last seen</th>
                      {columns.identity && <th>Identity</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr
                        key={r.id}
                        className={`op-rig-row op-rig-${r.status} ${detail === r.id ? "op-selected" : ""}`}
                      >
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Select ${r.name}`}
                            checked={!!selected[r.id]}
                            onChange={(e) =>
                              setSelected((prev) => {
                                const next = { ...prev };
                                e.target.checked
                                  ? (next[r.id] = r)
                                  : delete next[r.id];
                                return next;
                              })
                            }
                          />
                        </td>
                        <td className="fleet-rig-identity" data-label="Rig">
                          <button
                            className="op-rig-name"
                            onClick={() => setDetail(r.id)}
                          >
                            {r.name}
                          </button>
                          <small>{r.group || r.hostname}</small>
                          <div className="fleet-rig-state">
                            <Badge status={r.status}>
                              {r.status === "online"
                                ? "Stopped"
                                : r.status === "error"
                                  ? "Needs attention"
                                  : r.status}
                            </Badge>
                            {r.maintenance && (
                              <Badge status="suppressed">Maintenance</Badge>
                            )}
                          </div>
                          {compactIssue(r) && (
                            <button
                              className="fleet-issue-link"
                              onClick={() => setDetail(r.id)}
                            >
                              {compactIssue(r)}
                            </button>
                          )}
                        </td>
                        <td className="fleet-rig-control" data-label="Mining">
                          <QuickButtons
                            rig={r}
                            controls={controls}
                            blocked={!!fleet.error}
                          />
                        </td>
                        <td data-label="GPU mining">
                          <RigMiningCell rig={r} scope="GPU" />
                        </td>
                        <td data-label="CPU mining">
                          <RigMiningCell rig={r} scope="CPU" />
                        </td>
                        <td data-label="System">
                          <RigSystemCell rig={r} />
                        </td>
                        <td className="fleet-last-seen" data-label="Last seen">
                          <time
                            title={`Last agent contact: ${at(r.lastSeen)} · Telemetry: ${at(r.telemetryReceivedAt)}`}
                          >
                            {ageLabel(r.lastSeen || r.telemetryReceivedAt)}
                          </time>
                          <small title={r.version}>
                            {r.version
                              ? `v${r.version.split("+")[0]}`
                              : "Version not reported"}
                          </small>
                        </td>
                        {columns.identity && (
                          <td data-label="Identity">
                            {r.hostname}
                            <small>{r.ip}</small>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="op-pagination">
                <button
                  disabled={!pageStack.length}
                  onClick={() => {
                    setCursor(pageStack.at(-1));
                    setPageStack(pageStack.slice(0, -1));
                  }}
                >
                  Previous
                </button>
                <span>Page {pageStack.length + 1} · Up to 50 rigs</span>
                <button
                  disabled={!fleet.data?.nextCursor}
                  onClick={() => {
                    setPageStack([...pageStack, cursor]);
                    setCursor(fleet.data.nextCursor);
                  }}
                >
                  Next
                </button>
              </div>
            </section>
            {detail ? (
              <RigDetail
                key={detail}
                id={detail}
                close={() => setDetail(null)}
                onAction={setAction}
                controls={controls}
                onChanged={() => {
                  fleet.reload();
                  summary.reload();
                }}
              />
            ) : null}
          </div>
        </>
      )}
      {action && (
        <ActionDialog
          rigs={action}
          onClose={() => setAction(null)}
          onDone={() => {
            fleet.reload();
            summary.reload();
          }}
        />
      )}
    </div>
  );
}
