import React, { useState } from "react";
import { formatMinerRate, formatUptime } from "../utils/formatters";
import "./MinerHealth.css";
import { engineFor } from "../utils/miningConfig";
import versionInfo from "../version.json";
export default function MinerHealth({
  miner,
  onMaintenance,
  onStop,
  compact = false,
}) {
  const [copyMessage, setCopyMessage] = useState("");
  const copy = async (value, label) => {
    try {
      if (!navigator.clipboard) throw Error("Clipboard unavailable");
      await navigator.clipboard.writeText(value);
      setCopyMessage(`${label} copied`);
    } catch {
      setCopyMessage(
        "Could not copy. Select the file details below to copy them manually.",
      );
    }
  };
  const engine = engineFor(
    miner.type,
    miner.running ? miner.activeConfig : miner.config,
  );
  const differentEngine =
    miner.diagnostic?.engine && miner.diagnostic.engine !== engine;
  const diagnostic = differentEngine ? null : miner.diagnostic;
  const pending =
    miner.running &&
    JSON.stringify(miner.activeConfig) !== JSON.stringify(miner.config);
  const problem =
    (!differentEngine && miner.error) ||
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
          {engine} ·{" "}
          {(miner.running && miner.minerVersion) ||
            diagnostic?.version ||
            "Files not checked"}
        </span>
        {miner.running && (
          <span>Uptime {formatUptime(Date.now() - miner.startTime)}</span>
        )}
        {miner.pid && <span>PID {miner.pid}</span>}
        {miner.running && miner.effectiveSettings?.cpuThreads && (
          <span>{miner.effectiveSettings.cpuThreads} CPU threads</span>
        )}
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
      {miner.configNotice && <p role="status">{miner.configNotice}</p>}
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
          Repair {engine}
        </button>
        {diagnostic?.path && (
          <button onClick={() => copy(diagnostic.path, "File path")}>
            Copy file path
          </button>
        )}
        {diagnostic && (
          <button
            onClick={() =>
              copy(
                JSON.stringify(
                  {
                    appVersion: versionInfo.displayVersion,
                    processId: miner.id,
                    engine,
                    diagnostic,
                  },
                  null,
                  2,
                ),
                "Diagnostic report",
              )
            }
          >
            Copy diagnostic report
          </button>
        )}
      </div>
      {copyMessage && <p role="status">{copyMessage}</p>}
      {(problem || !compact || diagnostic?.windows) && (
        <details className="repair-help">
          <summary>Miner files and troubleshooting</summary>
          <p>
            {diagnostic?.message ||
              "Use Check miner files to verify the executable."}
          </p>
          {diagnostic?.path && <code>{diagnostic.path}</code>}
          {diagnostic?.expectedSha256 && (
            <p>
              Expected executable SHA-256
              <code>{diagnostic.expectedSha256}</code>
            </p>
          )}
          {diagnostic?.windows && (
            <div className="windows-diagnostic">
              <strong>Windows check · {diagnostic.windows.status}</strong>
              <p>
                Checked{" "}
                {diagnostic.windows.checkedAt
                  ? new Date(diagnostic.windows.checkedAt).toLocaleString()
                  : "Time unavailable"}
              </p>
              <p>{diagnostic.windows.message}</p>
              <p>
                Executable signature:{" "}
                {diagnostic.windows.signatureStatus || "Unavailable"}
              </p>
              {diagnostic.windows.detections?.map((d, i) => (
                <div key={i}>
                  <strong>{d.threatName}</strong>
                  <p>
                    {d.detectedAt
                      ? new Date(d.detectedAt).toLocaleString()
                      : "Detection time unavailable"}{" "}
                    · recorded action{" "}
                    {d.actionSuccess === true
                      ? "succeeded"
                      : d.actionSuccess === false
                        ? "failed"
                        : "unknown"}
                  </p>
                  <code>{d.resource}</code>
                </div>
              ))}
              {diagnostic.windows.status === "available" &&
                !diagnostic.windows.detections?.length && (
                  <p>No matching Defender history was returned.</p>
                )}
            </div>
          )}
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
          <button onClick={() => window.electronAPI?.openFileReview()}>
            Microsoft file review
          </button>
        </details>
      )}
    </section>
  );
}
