import React from "react";
import EngineOptions from "./EngineOptions";
import "./MinerConfig.css";
import { formatMinerRate } from "../utils/formatters";
import { useSystemInfo, useSystemStats } from "../hooks/useSystemInfo";
import SystemInfoCard from "./SystemInfoCard";
import { engineFor, algorithmsFor, srbAlgorithm } from "../utils/miningConfig";

function MinerConfig({
  miner,
  onConfigChange,
  onStart,
  onStop,
  isBoundToMaster = false,
  defaultWorkerName = "",
}) {
  const systemInfo = useSystemInfo();
  const systemStats = useSystemStats();
  const srb = engineFor(miner.type, miner.config) === "srbminer";
  const nanoCpu = engineFor(miner.type, miner.config) === "nanominer";

  const handleChange = (field, value) => {
    onConfigChange({
      ...miner.config,
      [field]: value,
    });
  };

  // Helper to check if field should be disabled
  const isFieldDisabled = (field) => {
    if (!isBoundToMaster) return false;
    // Allow password to be edited even when bound
    return field !== "password";
  };

  return (
    <div className="miner-config">
      <div className="config-header">
        <div className="config-title">
          <h2>{miner.name}</h2>
          <span className="device-badge">{miner.deviceType}</span>
          {miner.running && (
            <span className="hashrate-badge">{formatMinerRate(miner)}</span>
          )}
        </div>
        <div className="control-buttons">
          {!miner.running ? (
            <button
              className="btn btn-start"
              onClick={onStart}
              disabled={
                miner.loading ||
                miner.enabled === false ||
                !miner.config.pool ||
                !miner.config.user
              }
              title={
                !miner.config.pool || !miner.config.user
                  ? "Pool address and wallet address required"
                  : "Start Mining"
              }
            >
              {miner.loading ? "⏳ Starting..." : "▶ Start Mining"}
            </button>
          ) : (
            <button
              className="btn btn-stop"
              onClick={onStop}
              disabled={miner.loading}
            >
              {miner.loading ? "⏳ Stopping..." : "⏹ Stop Mining"}
            </button>
          )}
        </div>
      </div>

      {/* Validation Errors */}
      {miner.validationErrors && miner.validationErrors.length > 0 && (
        <div className="validation-errors">
          {miner.validationErrors.map((error, idx) => (
            <div key={idx} className="validation-error">
              ⚠️ {error}
            </div>
          ))}
        </div>
      )}

      <EngineOptions
        miner={miner}
        onChange={onConfigChange}
        bound={isBoundToMaster}
      />
      <div className="config-form">
        {isBoundToMaster && (
          <div className="master-bound-notice">
            🔗 Bound to Master Server - Most settings are controlled remotely.
            Only password can be changed locally.
          </div>
        )}

        <div className="form-row">
          <div className="form-group">
            <label htmlFor={`${miner.id}-coin-currency`}>
              {" "}
              Coin / Currency
            </label>
            <input
              id={`${miner.id}-coin-currency`}
              type="text"
              placeholder="XMR"
              value={miner.config.coin}
              onChange={(e) =>
                handleChange("coin", e.target.value.toUpperCase())
              }
              disabled={miner.running || isFieldDisabled("coin")}
            />
          </div>

          <div className="form-group">
            <label htmlFor={`${miner.id}-algorithm`}> Algorithm</label>
            <select
              id={`${miner.id}-algorithm`}
              value={miner.config.algorithm}
              onChange={(e) => handleChange("algorithm", e.target.value)}
              disabled={miner.running || isFieldDisabled("algorithm")}
            >
              {algorithmsFor(miner.type, miner.config).map((algo) => (
                <option key={algo} value={algo}>
                  {algo}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="form-group">
          <label htmlFor={`${miner.id}-pool-address`}> Pool Address</label>
          <input
            id={`${miner.id}-pool-address`}
            type="text"
            placeholder="pool.example.com:3333"
            value={miner.config.pool}
            onChange={(e) => handleChange("pool", e.target.value)}
            disabled={miner.running || isFieldDisabled("pool")}
          />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor={`${miner.id}-wallet-address-username`}>
              {" "}
              Wallet Address / Username
            </label>
            <input
              id={`${miner.id}-wallet-address-username`}
              type="text"
              placeholder="Your wallet address"
              value={miner.config.user}
              onChange={(e) => handleChange("user", e.target.value)}
              disabled={miner.running || isFieldDisabled("user")}
            />
          </div>

          <div className="form-group">
            <label htmlFor={`${miner.id}-password-worker-name`}>
              {" "}
              Password / Worker Name
            </label>
            <input
              id={`${miner.id}-password-worker-name`}
              type="text"
              placeholder={defaultWorkerName || "x"}
              value={miner.config.password}
              onChange={(e) => handleChange("password", e.target.value)}
              disabled={miner.running || isFieldDisabled("password")}
            />
            <span className="field-hint">
              Defaults to{" "}
              {engineFor("xmrig", miner.config) === "srbminer"
                ? "x"
                : defaultWorkerName
                  ? `"${defaultWorkerName}"`
                  : "hostname"}{" "}
              if empty. Some pools use this as the worker name.
            </span>
          </div>
        </div>

        <div className="form-group">
          <label htmlFor={`${miner.id}-worker-name-rig-id-optional`}>
            {" "}
            Worker Name / Rig ID (optional)
          </label>
          <input
            id={`${miner.id}-worker-name-rig-id-optional`}
            type="text"
            placeholder={defaultWorkerName || "worker1"}
            value={miner.config.workerName || ""}
            onChange={(e) => handleChange("workerName", e.target.value)}
            disabled={miner.running || isFieldDisabled("workerName")}
          />
          <span className="field-hint">
            Identifies this machine on the pool. Defaults to{" "}
            {defaultWorkerName ? `"${defaultWorkerName}"` : "hostname"} if
            empty.
          </span>
        </div>

        <div className="form-group thread-control">
          <label>
            CPU thread budget:{" "}
            <span className="thread-percentage">
              {miner.config.threadPercentage ?? 100}%
            </span>
            <span className="field-hint">
              {nanoCpu || srb
                ? "The selected engine uses this percentage of logical CPU threads, rounded down; explicit threads override it."
                : "XMRig chooses efficient threads within this budget; this is not a measured CPU utilization limit."}
            </span>
          </label>
          <div className="slider-container">
            <input
              type="range"
              min="10"
              max="100"
              step="10"
              value={miner.config.threadPercentage || 100}
              onChange={(e) =>
                handleChange("threadPercentage", parseInt(e.target.value))
              }
              disabled={miner.running || isFieldDisabled("threadPercentage")}
              className="thread-slider"
            />
            <div className="slider-ticks">
              <span>10%</span>
              <span>50%</span>
              <span>100%</span>
            </div>
          </div>
        </div>

        {!nanoCpu && !srb && (
          <>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="cpu-priority">CPU priority</label>
                <select
                  id="cpu-priority"
                  value={miner.config.cpuPriority ?? 0}
                  disabled={miner.running || isFieldDisabled("cpuPriority")}
                  onChange={(e) =>
                    handleChange("cpuPriority", Number(e.target.value))
                  }
                >
                  <option value={0}>Idle (keep this PC responsive)</option>
                  <option value={1}>Below normal</option>
                  <option value={2}>Normal</option>
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="pause-active">
                  Pause while this PC is in use
                </label>
                <select
                  id="pause-active"
                  value={miner.config.pauseOnActive ?? 0}
                  disabled={miner.running || isFieldDisabled("pauseOnActive")}
                  onChange={(e) =>
                    handleChange("pauseOnActive", Number(e.target.value))
                  }
                >
                  <option value={0}>Never</option>
                  <option value={60}>Resume after 1 minute idle</option>
                  <option value={300}>Resume after 5 minutes idle</option>
                </select>
              </div>
            </div>
            <div className="form-group">
              <label>
                <input
                  type="checkbox"
                  checked={miner.config.pauseOnBattery === true}
                  disabled={miner.running || isFieldDisabled("pauseOnBattery")}
                  onChange={(e) =>
                    handleChange("pauseOnBattery", e.target.checked)
                  }
                />{" "}
                Pause CPU mining on battery
              </label>
            </div>
            <p className="field-hint">
              Huge pages are used when available. MSR driver tuning is disabled;
              no kernel driver or administrator launch is required. The official
              XMRig release has a minimum 1% developer donation.
            </p>
          </>
        )}
        {nanoCpu && (
          <p className="field-hint">
            Nanominer RandomX has a 2% developer fee. Thread limits and crash
            recovery are supported. Activity/battery pauses, priority and strict
            TLS controls require XMRig. Nanominer negotiates SSL with plaintext
            fallback; no optional kernel driver is installed.
          </p>
        )}
        {srb && (
          <p className="field-hint">
            SRBMiner{" "}
            {srbAlgorithm(miner.type, miner.config.algorithm)?.fee ?? "—"}%
            developer fee for this algorithm. CPU threads, huge pages, pool TLS
            and crash recovery are configurable. MSR tuning is disabled;
            activity/battery pauses are unavailable.
          </p>
        )}
        {/* System Info for CPU Miner */}
        {miner.deviceType === "CPU" && (
          <SystemInfoCard systemInfo={systemInfo} systemStats={systemStats} />
        )}

        {!nanoCpu && !srb && (
          <div className="form-group">
            <label htmlFor={`${miner.id}-additional-arguments-optional`}>
              {" "}
              Additional Arguments (optional)
            </label>
            <input
              id={`${miner.id}-additional-arguments-optional`}
              type="text"
              placeholder="--tls --keepalive"
              value={miner.config.additionalArgs}
              onChange={(e) => handleChange("additionalArgs", e.target.value)}
              disabled={miner.running || isFieldDisabled("additionalArgs")}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default MinerConfig;
