import React, { useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { ErrorNotice, at, rate } from "./Operations";
import "./FleetOverview.css";

export const algorithmName = (value) =>
  ({
    kawpow: "KawPow",
    "rx/0": "RandomX",
    "rx/arq": "RandomARQ",
    autolykos: "Autolykos",
  })[value] ||
  value ||
  "Algorithm not reported";

export default function FleetOverview({
  summary,
  history,
  timeframe,
  setTimeframe,
  filtered,
  onAttention,
  actions,
}) {
  const [selected, setSelected] = useState(null);
  const groups = summary?.algorithms || [];
  const historyGroups = [
    ...groups,
    ...(history.data?.series || []).filter(
      (g) => !groups.some((a) => a.key === g.key),
    ),
  ].sort(
    (a, b) =>
      (a.deviceType === "GPU" ? 0 : 1) - (b.deviceType === "GPU" ? 0 : 1),
  );
  const group =
    historyGroups.find((g) => g.key === selected) || historyGroups[0];
  const rows = (history.data?.data || [])
    .filter((p) => p.key === group?.key)
    .map((p) => ({ ...p, time: Date.parse(p.timestamp) }));
  const counts = summary?.counts;
  return (
    <section
      className="fleet-performance"
      aria-label="Fleet mining performance"
    >
      <div className="fleet-performance-heading">
        <div className="fleet-performance-title">
          <h2>{filtered ? "Hashrate in this view" : "Total fleet hashrate"}</h2>
          <span>
            {filtered
              ? "Matching rigs across all pages"
              : "All rigs across every page"}
          </span>
        </div>
        {actions}
      </div>
      <div className="fleet-total-grid">
        {["GPU", "CPU"].map((scope) => {
          const rates = groups.filter((g) => g.deviceType === scope);
          return (
            <section
              key={scope}
              className={`fleet-total fleet-${scope.toLowerCase()}`}
              aria-label={`${scope} fleet hashrate`}
            >
              <h3>{scope} mining</h3>
              {rates.length ? (
                rates.map((g) => (
                  <div key={g.key} className="fleet-total-reading">
                    <strong>
                      {g.reportingProcesses
                        ? rate(g.hashrate)
                        : g.runningProcesses
                          ? "Waiting for rate"
                          : g.pausedProcesses
                            ? "Paused"
                            : "Not mining"}
                    </strong>
                    <span>
                      {algorithmName(g.algorithm)}{" "}
                      <small>
                        {g.reportingProcesses}/{g.runningProcesses} running
                        processes reporting
                        {g.unavailableProcesses ? " · Partial total" : ""}
                      </small>
                    </span>
                  </div>
                ))
              ) : (
                <div className="fleet-total-reading">
                  <strong>{summary ? "Not reported" : "—"}</strong>
                  <span>
                    {summary
                      ? `No ${scope} reports in this view`
                      : "Loading fleet totals…"}
                  </span>
                </div>
              )}
            </section>
          );
        })}
        <div className="fleet-at-a-glance" aria-label="Fleet status">
          <div>
            <strong>
              {counts?.mining ?? "—"}
              <small> / {counts?.total ?? "—"}</small>
            </strong>
            <span>rigs mining</span>
          </div>
          <p>
            <span className="fleet-online-dot" />
            {counts?.online ?? "—"} online{" "}
            <span className="fleet-offline-dot" />
            {counts?.offline ?? "—"} offline
          </p>
          <button className="fleet-attention" onClick={onAttention}>
            {counts?.attention ?? "—"} need attention
          </button>
        </div>
      </div>
      <div className="fleet-history" aria-label="Hashrate history">
        <div className="fleet-history-heading">
          <h3>Hashrate history</h3>
          <div className="fleet-history-tools">
            {historyGroups.length > 0 && (
              <div role="tablist" aria-label="Chart algorithm">
                {historyGroups.map((g) => (
                  <button
                    role="tab"
                    aria-selected={g.key === group?.key}
                    key={g.key}
                    onClick={() => setSelected(g.key)}
                  >
                    {g.deviceType} · {algorithmName(g.algorithm)}
                  </button>
                ))}
              </div>
            )}
            <label className="fleet-timeframe">
              <span className="visually-hidden">History period</span>
              <select
                aria-label="History period"
                value={timeframe}
                onChange={(e) => setTimeframe(e.target.value)}
              >
                {[
                  ["1h", "Last hour"],
                  ["24h", "24 hours"],
                  ["7d", "7 days"],
                  ["30d", "30 days"],
                  ["90d", "90 days"],
                ].map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <ErrorNotice error={history.error} retry={history.reload} />
        {history.loading ? (
          <div className="fleet-chart-empty">Loading hashrate history…</div>
        ) : rows.some((p) => Number.isFinite(p.hashrate)) ? (
          <div
            className="fleet-chart"
            role="img"
            aria-label={`${group.deviceType} ${algorithmName(group.algorithm)} fleet hashrate history for ${timeframe}`}
          >
            <ResponsiveContainer width="100%" height={150}>
              <AreaChart
                data={rows}
                margin={{ right: 12, left: 0, top: 12, bottom: 0 }}
              >
                <CartesianGrid
                  stroke="var(--op-border)"
                  strokeDasharray="3 4"
                  vertical={false}
                />
                <XAxis
                  dataKey="time"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  minTickGap={65}
                  stroke="var(--op-muted)"
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(t) =>
                    timeframe === "1h" || timeframe === "24h"
                      ? new Date(t).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : new Date(t).toLocaleDateString([], {
                          month: "short",
                          day: "numeric",
                        })
                  }
                />
                <YAxis
                  width={82}
                  tickFormatter={rate}
                  stroke="var(--op-muted)"
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  labelFormatter={at}
                  formatter={(value, name, item) => [
                    `${rate(value)} · ${Math.round(item.payload.coverage * 100)}% coverage`,
                    algorithmName(group.algorithm),
                  ]}
                  contentStyle={{
                    background: "#161b22",
                    border: "1px solid #444c56",
                    borderRadius: 8,
                    color: "#e6edf3",
                  }}
                />
                <Area
                  dataKey="hashrate"
                  type="linear"
                  stroke={group.deviceType === "GPU" ? "#39c5cf" : "#b39afa"}
                  fill={group.deviceType === "GPU" ? "#39c5cf" : "#b39afa"}
                  fillOpacity={0.1}
                  strokeWidth={2}
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="fleet-chart-empty">
            {history.error
              ? "History could not be loaded. Retry above."
              : "No hashrate samples in this period yet."}
          </div>
        )}
        <div className="fleet-chart-caption">
          <span>
            Totals stay separate by algorithm. Gaps mean no reading; hover for
            sample coverage.
          </span>
          <span>
            {summary?.hardware?.gpuPowerWatts != null
              ? `${Math.round(summary.hardware.gpuPowerWatts).toLocaleString()} W measured GPU power · ${summary.hardware.gpuPowerReportingDevices}/${summary.hardware.gpus} GPUs reporting`
              : "GPU power not reported"}
          </span>
        </div>
      </div>
    </section>
  );
}
