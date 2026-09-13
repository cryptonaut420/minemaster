import React, { useState, useMemo } from "react";
import "./Dashboard.css";
import MinerHealth from "./MinerHealth";
import { useSystemInfo, useSystemStats } from "../hooks/useSystemInfo";
import {
  formatMinerRate,
  formatBytes,
  formatTemp,
  formatPercent,
} from "../utils/formatters";
import MasterServerPanel from "./MasterServerPanel";

function Dashboard({
  miners,
  onStartAll,
  onStopAll,
  onStart,
  onStop,
  onMaintenance,
  onToggleDevice,
  isBoundToMaster,
  onUnbind,
  clientName,
  onClientNameChange,
}) {
  const systemInfo = useSystemInfo();
  const systemStats = useSystemStats();
  // Note: Status updates to master server are handled in App.js
  // This component only collects local system stats for display

  // Memoize expensive calculations to prevent lag
  const anyRunning = useMemo(
    () => miners.some((m) => m.running || m.restartPendingAt),
    [miners],
  );
  const anyLoading = useMemo(() => miners.some((m) => m.loading), [miners]);

  // Check if GPUs are detected - memoized to only recalculate when systemInfo changes
  const hasGpu = useMemo(() => {
    // Do not treat "detection in progress" as "no GPU".
    if (systemInfo?.gpuDetectionStatus !== "complete") {
      return true;
    }

    return (
      systemInfo?.gpus &&
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
      })
    );
  }, [systemInfo]);

  const [isEditingName, setIsEditingName] = useState(false);
  const [editName, setEditName] = useState(clientName || "");
  const displayName = clientName || systemInfo?.hostname || "Loading...";

  const handleSaveName = () => {
    const trimmed = editName.trim();
    onClientNameChange(trimmed);
    setIsEditingName(false);
  };

  const handleCancelEdit = () => {
    setEditName(clientName || "");
    setIsEditingName(false);
  };

  const handleClearName = () => {
    onClientNameChange("");
    setEditName("");
    setIsEditingName(false);
  };

  return (
    <div className="dashboard">
      {/* Client Identity */}
      <div className="client-identity">
        <div className="identity-row">
          {isEditingName ? (
            <div className="identity-edit">
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveName();
                  if (e.key === "Escape") handleCancelEdit();
                }}
                placeholder={systemInfo?.hostname || "Enter a name..."}
                autoFocus
                className="identity-input"
              />
              <button
                className="identity-btn save"
                onClick={handleSaveName}
                title="Save"
              >
                Save
              </button>
              {clientName && (
                <button
                  className="identity-btn clear"
                  onClick={handleClearName}
                  title="Reset to hostname"
                >
                  Reset
                </button>
              )}
              <button
                className="identity-btn cancel"
                onClick={handleCancelEdit}
                title="Cancel"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="identity-display">
              <span className="identity-name">{displayName}</span>
              {clientName &&
                systemInfo?.hostname &&
                clientName !== systemInfo.hostname && (
                  <span className="identity-hostname">
                    ({systemInfo.hostname})
                  </span>
                )}
              <button
                className="identity-btn edit"
                onClick={() => {
                  setEditName(clientName || "");
                  setIsEditingName(true);
                }}
                title="Rename this PC"
              >
                Rename
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Master Server Panel */}
      <MasterServerPanel
        isBound={isBoundToMaster}
        onUnbind={onUnbind}
        systemInfo={systemInfo}
        miners={miners}
        clientName={clientName}
      />

      {/* Main Control Section */}
      <div className="dashboard-control-section">
        <button
          className={`master-control ${anyRunning ? "stop" : "start"} ${anyLoading ? "loading" : ""}`}
          onClick={anyRunning ? onStopAll : onStartAll}
          disabled={anyLoading && !anyRunning}
          title={anyRunning ? "Stop All Mining" : "Start All Mining"}
          aria-label={anyRunning ? "Stop all mining" : "Start all mining"}
        >
          {anyLoading ? "⏳" : anyRunning ? "⏸" : "▶"}
        </button>

        {/* Devices Section */}
        <div className="devices-section">
          <h2>Miners</h2>
          <div className="devices-list">
            {miners.map((miner) => {
              // Check if this is GPU miner and no GPU detected
              const isGpuMiner = miner.deviceType === "GPU";
              const shouldDisable = isGpuMiner && !hasGpu;

              return (
                <div key={miner.id}>
                  <div
                    className={`device-row ${miner.running ? "running" : ""} ${shouldDisable ? "no-gpu" : ""}`}
                  >
                    <div className="device-main">
                      <label
                        className="toggle-switch"
                        style={{
                          pointerEvents: shouldDisable ? "none" : "auto",
                          cursor: shouldDisable ? "not-allowed" : "pointer",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={
                            shouldDisable ? false : miner.enabled !== false
                          }
                          onChange={(e) => {
                            // If disabled, don't call the callback
                            if (shouldDisable) {
                              e.preventDefault();
                              return;
                            }

                            // Let the checkbox update naturally, just call our handler
                            onToggleDevice(miner.id);
                          }}
                          disabled={shouldDisable || miner.loading}
                          tabIndex={shouldDisable ? -1 : 0}
                          style={{
                            cursor: shouldDisable ? "not-allowed" : "pointer",
                          }}
                          aria-label={`Enable ${miner.deviceType} mining`}
                          title={
                            shouldDisable
                              ? "No GPU detected"
                              : "Enable mining; disabling stops this process"
                          }
                        />
                        <span className="toggle-slider"></span>
                      </label>

                      <div className="device-info">
                        <div className="device-header-row">
                          <span className="device-type-badge">
                            {miner.deviceType}
                          </span>
                          <span className="device-name">
                            {shouldDisable ? "No GPU detected" : miner.name}
                          </span>
                        </div>
                        {shouldDisable ? (
                          <div className="device-details-compact">
                            <span className="detail-item no-gpu-text">
                              GPU mining unavailable
                            </span>
                          </div>
                        ) : (
                          miner.enabled !== false && (
                            <div className="device-details-compact">
                              <span className="detail-item">
                                {miner.type.toUpperCase()}
                              </span>
                              <span className="detail-separator">•</span>
                              <span className="detail-item">
                                {miner.activeConfig?.algorithm ||
                                  miner.config.algorithm}
                              </span>
                              <span className="detail-separator">•</span>
                              <span className="detail-item">
                                {miner.activeConfig?.coin ||
                                  miner.config.coin ||
                                  "N/A"}
                              </span>
                              {miner.deviceType === "CPU" &&
                                miner.config.threadPercentage &&
                                miner.config.threadPercentage !== 100 && (
                                  <>
                                    <span className="detail-separator">•</span>
                                    <span className="detail-item cpu-usage">
                                      {miner.config.threadPercentage}% thread
                                      budget
                                    </span>
                                  </>
                                )}
                            </div>
                          )
                        )}
                      </div>
                    </div>

                    {miner.enabled !== false && !shouldDisable && (
                      <div className="device-hashrate-compact">
                        <span className="hashrate-value">
                          {formatMinerRate(miner)}
                        </span>
                      </div>
                    )}
                    {shouldDisable && (
                      <div className="device-hashrate-compact">
                        <span className="hashrate-stopped">N/A</span>
                      </div>
                    )}
                    <div className="health-actions">
                      <button
                        disabled={
                          miner.loading ||
                          (!miner.running &&
                            !miner.restartPendingAt &&
                            (miner.enabled === false || shouldDisable))
                        }
                        onClick={() =>
                          miner.running || miner.restartPendingAt
                            ? onStop(miner.id)
                            : onStart(miner.id)
                        }
                      >
                        {miner.loading
                          ? "Working…"
                          : miner.restartPendingAt
                            ? "Cancel restart"
                            : miner.running
                              ? "Stop"
                              : "Start"}
                      </button>
                    </div>
                  </div>
                  <MinerHealth
                    miner={miner}
                    onMaintenance={onMaintenance}
                    onStop={onStop}
                    compact
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* System Stats Section */}
      <div className="dashboard-section">
        <h2>System Information</h2>
        <div className="system-grid">
          {/* OS Info */}
          <div className="system-card">
            <div className="system-icon">💻</div>
            <div className="system-info">
              <div className="system-label">Operating System</div>
              <div className="system-value">
                {systemInfo
                  ? `${systemInfo.os.distro} ${systemInfo.os.release}`
                  : "Loading..."}
              </div>
              <div className="system-subvalue">
                {systemInfo
                  ? `${systemInfo.os.platform} ${systemInfo.os.arch}`
                  : ""}
              </div>
            </div>
          </div>

          {/* CPU Info */}
          <div className="system-card">
            <div className="system-icon">🔧</div>
            <div className="system-info">
              <div className="system-label">CPU</div>
              <div className="system-value">
                {systemInfo ? systemInfo.cpu.brand : "Loading..."}
              </div>
              <div className="system-stats">
                <div className="stat">
                  <span className="stat-label">Usage:</span>
                  <span className="stat-value">
                    {systemStats
                      ? formatPercent(systemStats.cpu?.usage)
                      : "..."}
                  </span>
                </div>
                <div className="stat">
                  <span className="stat-label">Temp:</span>
                  <span className="stat-value">
                    {systemStats
                      ? formatTemp(systemStats.cpu?.temperature)
                      : "..."}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* RAM Info */}
          <div className="system-card">
            <div className="system-icon">💾</div>
            <div className="system-info">
              <div className="system-label">Memory (RAM)</div>
              <div className="system-value">
                {systemInfo
                  ? formatBytes(systemInfo.memory.total)
                  : "Loading..."}
              </div>
              <div className="system-stats">
                <div className="stat">
                  <span className="stat-label">Used:</span>
                  <span className="stat-value">
                    {systemStats
                      ? formatPercent(systemStats.memory?.usagePercent)
                      : "..."}
                  </span>
                </div>
                <div className="stat">
                  <span className="stat-label">Free:</span>
                  <span className="stat-value">
                    {systemStats
                      ? formatBytes(
                          systemStats.memory
                            ? systemStats.memory.total - systemStats.memory.used
                            : null,
                        )
                      : "..."}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* GPU Info - Support Multiple GPUs */}
          {systemStats?.gpu &&
          Array.isArray(systemStats.gpu) &&
          systemStats.gpu.length > 0 ? (
            systemStats.gpu.map((gpu, idx) => {
              const hardware = systemInfo?.gpus?.find(
                (item) => item.deviceId && item.deviceId === gpu.deviceId,
              );
              const gpuModel =
                hardware?.model || gpu.model || `${gpu.type || "GPU"} ${idx}`;
              const staticVram = hardware?.vram; // Static VRAM from system info (MB)
              return (
                <div key={`gpu-${idx}`} className="system-card">
                  <div className="system-icon">🎮</div>
                  <div className="system-info">
                    <div className="system-label">
                      GPU {systemStats.gpu.length > 1 ? idx : ""}
                    </div>
                    <div className="system-value">{gpuModel}</div>
                    <div className="system-stats">
                      {gpu.usage !== null && (
                        <div className="stat">
                          <span className="stat-label">Usage:</span>
                          <span className="stat-value">
                            {formatPercent(gpu.usage)}
                          </span>
                        </div>
                      )}
                      {gpu.temperature !== null && (
                        <div className="stat">
                          <span className="stat-label">Temp:</span>
                          <span className="stat-value">
                            {formatTemp(gpu.temperature)}
                          </span>
                        </div>
                      )}
                      {gpu.vramUsed !== null && gpu.vramTotal !== null ? (
                        <div className="stat">
                          <span className="stat-label">VRAM:</span>
                          <span className="stat-value">
                            {(gpu.vramUsed / 1024).toFixed(1)} /{" "}
                            {(gpu.vramTotal / 1024).toFixed(1)} GB
                          </span>
                        </div>
                      ) : (
                        staticVram && (
                          <div className="stat">
                            <span className="stat-label">VRAM:</span>
                            <span className="stat-value">
                              {(staticVram / 1024).toFixed(1)} GB
                            </span>
                          </div>
                        )
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="system-card">
              <div className="system-icon">🎮</div>
              <div className="system-info">
                <div className="system-label">GPU</div>
                <div className="system-value">
                  {systemInfo?.gpus?.[0]?.model ||
                    (systemInfo?.gpuDetectionStatus === "complete"
                      ? "No GPU detected"
                      : "Detecting GPU...")}
                </div>
                {systemInfo?.gpus?.[0]?.vram && (
                  <div className="system-stats">
                    <div className="stat">
                      <span className="stat-label">VRAM:</span>
                      <span className="stat-value">
                        {systemInfo.gpus[0].vram} MB
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
