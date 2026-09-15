import React from "react";
import EngineOptions from "./EngineOptions";
import { algorithmsFor, engineFor, srbAlgorithm } from "../utils/miningConfig";
import "./MinerConfig.css";
import { formatMinerRate } from "../utils/formatters";
import { useGpuList } from "../hooks/useSystemInfo";

function NanominerConfig({
  miner,
  onConfigChange,
  onStart,
  onStop,
  isBoundToMaster = false,
  defaultWorkerName = "",
}) {
  const algorithms = algorithmsFor(miner.type, miner.config);
  const srb = engineFor(miner.type, miner.config) === "srbminer";
  const algorithmInfo = srb
    ? srbAlgorithm(miner.type, miner.config.algorithm)
    : null;
  const { gpuList, systemInfo } = useGpuList();
  const gpuDetectionComplete = systemInfo?.gpuDetectionStatus === "complete";

  // Check if GPU is detected
  const hasGpu =
    !gpuDetectionComplete ||
    (systemInfo?.gpus &&
      Array.isArray(systemInfo.gpus) &&
      systemInfo.gpus.length > 0 &&
      systemInfo.gpus.some((gpu) => {
        if (!gpu) return false;
        const model = (gpu.model || gpu.name || "").toLowerCase();
        // Exclude "no gpu detected" or empty models
        return (
          model &&
          !model.includes("no gpu") &&
          !model.includes("detected") &&
          model.trim().length > 0
        );
      }));

  const handleChange = (field, value) => {
    onConfigChange({
      ...miner.config,
      [field]: value,
    });
  };

  // Helper to check if field should be disabled
  const isFieldDisabled = (field) => {
    if (!isBoundToMaster) return false;
    // Allow rigName to be edited even when bound
    return field !== "rigName";
  };

  // Check if start button should be disabled
  const isStartDisabled =
    miner.loading ||
    !miner.config.pool ||
    !miner.config.user ||
    !miner.config.algorithm ||
    !hasGpu ||
    miner.enabled === false;

  // Get disabled reason for tooltip
  const getDisabledReason = () => {
    if (miner.loading) return "Miner is starting...";
    if (!miner.config.pool) return "Pool address required";
    if (!miner.config.user) return "Wallet address required";
    if (!miner.config.algorithm) return "Algorithm required";
    if (!gpuDetectionComplete) return "Detecting GPU...";
    if (!hasGpu) return "No GPU detected";
    if (miner.enabled === false) return "GPU mining is disabled";
    return "Start Mining";
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
              className={`btn btn-start ${!hasGpu ? "disabled-no-gpu" : ""}`}
              onClick={onStart}
              disabled={isStartDisabled}
              title={getDisabledReason()}
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
      {algorithmInfo && (
        <p className="field-hint">
          {algorithmInfo.argument} · {algorithmInfo.fee}% developer fee ·{" "}
          {algorithmInfo.devices.filter((d) => d !== "CPU").join(", ")}{" "}
          (specific model/driver support varies).
        </p>
      )}
      <div className="config-form">
        <p className="field-hint">
          GPU controls apply to the entire selected mining process. Sensor order
          is not a reliable mining device index.
        </p>
        {miner.config.gpus?.length > 0 && (
          <p className="field-hint">
            Explicit legacy Nanominer device indices:{" "}
            {miner.config.gpus.join(", ")}. Check these against Nanominer's
            device listing after hardware changes.{" "}
            <button
              disabled={miner.running || isBoundToMaster}
              onClick={() => handleChange("gpus", [])}
            >
              Use all GPUs
            </button>
          </p>
        )}
        {gpuDetectionComplete && !hasGpu && (
          <div className="no-gpu-warning">
            ⚠️ No GPU detected - GPU mining is unavailable on this system. The
            Start Mining button is disabled.
          </div>
        )}

        {isBoundToMaster && (
          <div className="master-bound-notice">
            🔗 Bound to Master Server - Most settings are controlled remotely.
            Only rig name can be changed locally.
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
              placeholder="ETC"
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
              {algorithms.map((algo) => (
                <option key={algo} value={algo}>
                  {algo}
                </option>
              ))}
              {!algorithms.includes(miner.config.algorithm) && (
                <option value={miner.config.algorithm}>
                  {miner.config.algorithm} (review compatibility)
                </option>
              )}
            </select>
          </div>
        </div>

        <div className="form-group">
          <label htmlFor={`${miner.id}-pool-address`}> Pool Address</label>
          <input
            id={`${miner.id}-pool-address`}
            type="text"
            placeholder="etc.2miners.com:1010"
            value={miner.config.pool}
            onChange={(e) => handleChange("pool", e.target.value)}
            disabled={miner.running || isFieldDisabled("pool")}
          />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor={`${miner.id}-wallet-address`}>
              {" "}
              Wallet Address
            </label>
            <input
              id={`${miner.id}-wallet-address`}
              type="text"
              placeholder="Your wallet address"
              value={miner.config.user}
              onChange={(e) => handleChange("user", e.target.value)}
              disabled={miner.running || isFieldDisabled("user")}
            />
          </div>

          <div className="form-group">
            <label htmlFor={`${miner.id}-rig-name-optional`}>
              {" "}
              Rig Name (optional)
            </label>
            <input
              id={`${miner.id}-rig-name-optional`}
              type="text"
              placeholder={defaultWorkerName || "worker1"}
              value={miner.config.rigName}
              onChange={(e) => handleChange("rigName", e.target.value)}
              disabled={miner.running || isFieldDisabled("rigName")}
            />
            <span className="field-hint">
              Identifies this machine on the pool. Defaults to{" "}
              {defaultWorkerName ? `"${defaultWorkerName}"` : "hostname"} if
              empty.
            </span>
          </div>
        </div>

        {gpuList.length > 0 && (
          <div className="form-group">
            <label>GPU Configuration</label>
            <div className="gpu-selector-advanced">
              {gpuList.map((gpu, idx) => {
                return (
                  <div key={idx} className="gpu-card">
                    <div className="gpu-card-header">
                      <strong>{gpu.deviceId || `GPU sensor ${idx}`}</strong>
                    </div>

                    <div className="gpu-card-body">
                      <div className="gpu-model">{gpu.model}</div>

                      <div className="gpu-stats-grid">
                        <div className="gpu-stat">
                          <span className="gpu-stat-label">Usage:</span>
                          <span className="gpu-stat-value">
                            {gpu.usage !== null && gpu.usage !== undefined
                              ? `${gpu.usage.toFixed(1)}%`
                              : "N/A"}
                          </span>
                        </div>

                        <div className="gpu-stat">
                          <span className="gpu-stat-label">Temp:</span>
                          <span className="gpu-stat-value">
                            {gpu.temperature !== null &&
                            gpu.temperature !== undefined
                              ? `${Math.round(gpu.temperature)}°C`
                              : "N/A"}
                          </span>
                        </div>

                        {gpu.vramUsed !== null && gpu.vramTotal !== null && (
                          <div className="gpu-stat">
                            <span className="gpu-stat-label">VRAM:</span>
                            <span className="gpu-stat-value">
                              {(gpu.vramUsed / 1024).toFixed(1)} /{" "}
                              {(gpu.vramTotal / 1024).toFixed(1)} GB
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default NanominerConfig;
