import React from 'react';
import './SystemInfoCard.css';

function SystemInfoCard({ systemInfo, systemStats }) {
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
    <div className="system-info-cards">
      {/* CPU Card */}
      <div className="sys-card">
        <div className="sys-icon">🖥️</div>
        <div className="sys-details">
          <div className="sys-label">CPU</div>
          <div className="sys-value">{systemInfo?.cpu?.brand || 'Loading...'}</div>
          <div className="sys-stats">
            {systemStats?.cpu && (
              <>
                <span className="sys-stat">
                  <span className="sys-stat-label">Usage:</span>
                  <span className="sys-stat-value">{systemStats.cpu.usage.toFixed(1)}%</span>
                </span>
                {systemStats.cpu.temperature && (
                  <span className="sys-stat">
                    <span className="sys-stat-label">Temp:</span>
                    <span className="sys-stat-value">{formatTemp(systemStats.cpu.temperature)}</span>
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* RAM Card */}
      <div className="sys-card">
        <div className="sys-icon">💾</div>
        <div className="sys-details">
          <div className="sys-label">RAM</div>
          <div className="sys-value">{systemInfo ? formatBytes(systemInfo.memory.total) : 'Loading...'}</div>
          <div className="sys-stats">
            {systemStats?.memory && (
              <>
                <span className="sys-stat">
                  <span className="sys-stat-label">Used:</span>
                  <span className="sys-stat-value">{formatBytes(systemStats.memory.used)}</span>
                </span>
                <span className="sys-stat">
                  <span className="sys-stat-label">Free:</span>
                  <span className="sys-stat-value">{formatBytes(systemStats.memory.total - systemStats.memory.used)}</span>
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default SystemInfoCard;
