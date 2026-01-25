import React, { useState, useEffect } from 'react';
import './Dashboard.css';
import { formatHashrate } from '../utils/hashrate';

function Dashboard({ miners, onStartAll, onStopAll, onToggleDevice }) {
  const [systemInfo, setSystemInfo] = useState(null);
  const [systemStats, setSystemStats] = useState(null);

  useEffect(() => {
    // Load system info once
    const loadSystemInfo = async () => {
      if (window.electronAPI) {
        const info = await window.electronAPI.getSystemInfo();
        setSystemInfo(info);
      }
    };
    loadSystemInfo();
  }, []);

  useEffect(() => {
    // Update system stats every 2 seconds
    const updateStats = async () => {
      if (window.electronAPI) {
        const stats = await window.electronAPI.getSystemStats();
        setSystemStats(stats);
      }
    };

    updateStats();
    const interval = setInterval(updateStats, 2000);
    return () => clearInterval(interval);
  }, []);

  const anyRunning = miners.some(m => m.running);
  const enabledMiners = miners.filter(m => m.enabled !== false);

  const formatBytes = (bytes) => {
    if (!bytes) return 'N/A';
    const gb = bytes / (1024 ** 3);
    return `${gb.toFixed(1)} GB`;
  };

  const formatTemp = (temp) => {
    if (temp === null || temp === undefined) return 'N/A';
    return `${Math.round(temp)}°C`;
  };

  return (
    <div className="dashboard">
      {/* Main Control Section */}
      <div className="dashboard-control-section">
        <button
          className={`master-control ${anyRunning ? 'stop' : 'start'}`}
          onClick={anyRunning ? onStopAll : onStartAll}
          title={anyRunning ? 'Stop All Mining' : 'Start All Mining'}
        >
          {anyRunning ? '⏸' : '▶'}
        </button>

        {/* Devices Section */}
        <div className="devices-section">
          <h2>Mining Devices</h2>
          <div className="devices-list">
            {miners.map(miner => (
              <div key={miner.id} className={`device-row ${miner.running ? 'running' : ''}`}>
                <div className="device-main">
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={miner.enabled !== false}
                      onChange={() => onToggleDevice(miner.id)}
                    />
                    <span className="toggle-slider"></span>
                  </label>
                  
                  <div className="device-info">
                    <div className="device-header-row">
                      <span className="device-type-badge">{miner.deviceType}</span>
                      <span className="device-name">{miner.name}</span>
                    </div>
                    {miner.enabled !== false && (
                      <div className="device-details-compact">
                        <span className="detail-item">{miner.type.toUpperCase()}</span>
                        <span className="detail-separator">•</span>
                        <span className="detail-item">{miner.config.algorithm}</span>
                        <span className="detail-separator">•</span>
                        <span className="detail-item">XMR</span>
                      </div>
                    )}
                  </div>
                </div>
                
                {miner.enabled !== false && (
                  <div className="device-hashrate-compact">
                    {miner.running ? (
                      miner.hashrate ? (
                        <span className="hashrate-value">{formatHashrate(miner.hashrate)}</span>
                      ) : (
                        <span className="hashrate-calculating">Calculating...</span>
                      )
                    ) : (
                      <span className="hashrate-stopped">Stopped</span>
                    )}
                  </div>
                )}
              </div>
            ))}
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
                {systemInfo ? `${systemInfo.os.distro} ${systemInfo.os.release}` : 'Loading...'}
              </div>
              <div className="system-subvalue">
                {systemInfo ? `${systemInfo.os.platform} ${systemInfo.os.arch}` : ''}
              </div>
            </div>
          </div>

          {/* CPU Info */}
          <div className="system-card">
            <div className="system-icon">🔧</div>
            <div className="system-info">
              <div className="system-label">CPU</div>
              <div className="system-value">
                {systemInfo ? systemInfo.cpu.brand : 'Loading...'}
              </div>
              <div className="system-stats">
                <div className="stat">
                  <span className="stat-label">Usage:</span>
                  <span className="stat-value">
                    {systemStats ? `${systemStats.cpu.usage.toFixed(1)}%` : '...'}
                  </span>
                </div>
                <div className="stat">
                  <span className="stat-label">Temp:</span>
                  <span className="stat-value">
                    {systemStats ? formatTemp(systemStats.cpu.temperature) : '...'}
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
                {systemInfo ? formatBytes(systemInfo.memory.total) : 'Loading...'}
              </div>
              <div className="system-stats">
                <div className="stat">
                  <span className="stat-label">Used:</span>
                  <span className="stat-value">
                    {systemStats ? `${systemStats.memory.usagePercent.toFixed(1)}%` : '...'}
                  </span>
                </div>
                <div className="stat">
                  <span className="stat-label">Free:</span>
                  <span className="stat-value">
                    {systemStats ? formatBytes(systemStats.memory.total - systemStats.memory.used) : '...'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* GPU Info */}
          <div className="system-card">
            <div className="system-icon">🎮</div>
            <div className="system-info">
              <div className="system-label">GPU</div>
              <div className="system-value">
                {systemInfo?.gpu ? systemInfo.gpu.model : 'No GPU detected'}
              </div>
              {systemStats?.gpu && (
                <div className="system-stats">
                  {systemStats.gpu.usage !== null && (
                    <div className="stat">
                      <span className="stat-label">Usage:</span>
                      <span className="stat-value">
                        {systemStats.gpu.usage.toFixed(1)}%
                      </span>
                    </div>
                  )}
                  {systemStats.gpu.temperature !== null && (
                    <div className="stat">
                      <span className="stat-label">Temp:</span>
                      <span className="stat-value">
                        {formatTemp(systemStats.gpu.temperature)}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
