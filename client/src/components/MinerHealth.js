import React from "react";
import { formatMinerRate, formatUptime } from "../utils/formatters";
import "./MinerHealth.css";
export default function MinerHealth({
  miner,
  onMaintenance,
  onStop,
  compact = false,
}) {
  const diagnostic = miner.diagnostic;
  const pending =
    miner.running &&
    JSON.stringify(miner.activeConfig) !== JSON.stringify(miner.config);
  const problem =
    miner.error ||
    (diagnostic?.status === "unavailable" ? diagnostic.message : null);
  return (
    <section
      className={`miner-health ${problem ? "needs-attention" : ""}`}
      aria-label={`${miner.deviceType} mining health`}
    >
      <div className="health-summary">
        <strong>
          {miner.deviceType} ·{" "}
          {miner.loading ? "Working…" : formatMinerRate(miner)}
        </strong>
        <span>
          {miner.minerVersion || diagnostic?.version
            ? `Engine ${miner.minerVersion || diagnostic.version}`
            : "Engine not verified"}
        </span>
        {miner.running && (
          <span>Uptime {formatUptime(Date.now() - miner.startTime)}</span>
        )}
        {miner.pid && <span>PID {miner.pid}</span>}
        {miner.restartPendingAt && (
          <span className="pending-config">
            Restart scheduled{" "}
            {new Date(miner.restartPendingAt).toLocaleTimeString()}
          </span>
        )}
        {pending && (
          <span className="pending-config">Settings pending restart</span>
        )}
      </div>
      {!compact && (
        <div className="health-facts">
          <span>
            Algorithm:{" "}
            {miner.activeConfig?.algorithm ||
              miner.config.algorithm ||
              "Not configured"}
          </span>
          <span>Pool: {miner.pool?.status || "No connection sample"}</span>
          <span>
            Shares:{" "}
            {miner.shares
              ? `${miner.shares.accepted} accepted / ${miner.shares.rejected} rejected`
              : "No sample"}
          </span>
          <span>
            {miner.localOverrides?.length
              ? `Local settings: ${miner.localOverrides.join(", ")}`
              : "No reported local overrides"}
          </span>
        </div>
      )}
      {diagnostic?.status === "retrying" && (
        <p role="status">{diagnostic.message}</p>
      )}
      {problem && (
        <p className="health-error" role="status">
          {problem}
        </p>
      )}
      <div className="health-actions">
        {miner.restartPendingAt && onStop && (
          <button disabled={miner.loading} onClick={() => onStop(miner.id)}>
            Cancel scheduled restart
          </button>
        )}
        <button
          disabled={miner.loading}
          onClick={() => onMaintenance(miner.id, "miner-diagnose")}
        >
          Check miner files
        </button>
        <button
          disabled={
            miner.loading ||
            miner.running ||
            !!miner.config.customPath ||
            diagnostic?.code === "UNSUPPORTED_PLATFORM"
          }
          onClick={() => onMaintenance(miner.id, "miner-repair")}
          title="Restore the verified bundled release. Does not start mining."
        >
          Repair {miner.type}
        </button>
        {diagnostic?.path && (
          <button
            onClick={() =>
              navigator.clipboard?.writeText(diagnostic.path).catch(() => {})
            }
          >
            Copy file path
          </button>
        )}
      </div>
      {(problem || !compact) && (
        <details className="repair-help">
          <summary>Miner files and Windows troubleshooting</summary>
          <p>
            {diagnostic?.message ||
              "Use Check miner files to verify the executable."}
          </p>
          {diagnostic?.path && <code>{diagnostic.path}</code>}
          <ol>
            <li>
              Open Windows Security → Virus &amp; threat protection → Protection
              history. Match the detection to this exact file and record the
              threat name.
            </li>
            <li>
              Confirm this is your intentionally installed miner and review the
              detection. Follow your device policy or ask its administrator to
              review it.
            </li>
            <li>
              After that review is resolved, stop the affected miner and choose
              Repair. Repair restores the official pinned release; it never
              changes Windows protection settings or starts mining.
            </li>
          </ol>
          <p>
            Default CPU mining runs without the optional MSR kernel driver. Hash
            verification confirms the upstream file; it does not determine
            whether a security detection is a false positive.
          </p>
          <button onClick={() => window.electronAPI?.openProtectionHistory()}>
            Microsoft Protection History guidance
          </button>
        </details>
      )}
    </section>
  );
}
