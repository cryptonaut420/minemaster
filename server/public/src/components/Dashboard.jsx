import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { minersAPI } from '../services/api';
import { useWebSocket } from '../hooks/useWebSocket';
import './Dashboard.css';

function getGpuHashrate(miner) {
  const runningGpus = (miner?.devices?.gpus || []).filter((g) => g?.running);
  const gpuRates = runningGpus
    .map((g) => (typeof g.hashrate === 'number' ? g.hashrate : null))
    .filter((h) => h && h > 0);

  if (gpuRates.length === 0) {
    if (runningGpus.length > 0 && miner?.deviceType === 'GPU' && typeof miner?.hashrate === 'number') {
      return miner.hashrate;
    }
    return 0;
  }

  // Defensive dedupe: older payloads may copy total GPU hashrate onto each GPU entry.
  if (
    gpuRates.length > 1 &&
    typeof miner?.hashrate === 'number' &&
    gpuRates.every((rate) => Math.abs(rate - miner.hashrate) < 0.0001)
  ) {
    return miner.hashrate;
  }

  return gpuRates.reduce((sum, rate) => sum + rate, 0);
}

function Dashboard() {
  const [miners, setMiners] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchMiners = useCallback(async () => {
    try {
      const response = await minersAPI.getAll();
      setMiners(response.data.miners || []);
    } catch (error) {
      console.error('Error fetching miners:', error);
    }
    setLoading(false);
  }, []);

  // Derive stats and breakdown from miners state — no separate API call needed
  const stats = useMemo(() => {
    let totalHashrate = 0;
    miners.forEach(miner => {
      if (miner.devices?.cpu?.running && miner.devices?.cpu?.hashrate) {
        totalHashrate += miner.devices.cpu.hashrate;
      }
      totalHashrate += getGpuHashrate(miner);
    });

    return {
      total: miners.length,
      online: miners.filter(m => m.status === 'online' || m.status === 'mining').length,
      mining: miners.filter(m => m.status === 'mining').length,
      offline: miners.filter(m => m.status === 'offline').length,
      totalHashrate
    };
  }, [miners]);

  const hashrateBreakdown = useMemo(() => {
    const breakdown = {};
    miners.forEach(miner => {
      if (miner.status !== 'mining') return;

      if (miner.devices?.cpu?.running && miner.devices?.cpu?.hashrate) {
        const algo = miner.devices.cpu.algorithm || 'Unknown';
        const coin = miner.devices.cpu.coin || 'Unknown';
        const key = `${coin}_${algo}_CPU`;
        if (!breakdown[key]) {
          breakdown[key] = { coin, algorithm: algo, deviceType: 'CPU', hashrate: 0, devices: 0 };
        }
        breakdown[key].hashrate += miner.devices.cpu.hashrate;
        breakdown[key].devices += 1;
      }

      if (miner.devices?.gpus && Array.isArray(miner.devices.gpus)) {
        const runningGpus = miner.devices.gpus.filter(g => g.running);
        const gpuHash = getGpuHashrate(miner);
        if (runningGpus.length > 0 && gpuHash > 0) {
          const firstGpu = runningGpus[0] || {};
          const algo = firstGpu.algorithm || miner.algorithm || 'Unknown';
          const coin = firstGpu.coin || 'Unknown';
          const key = `${coin}_${algo}_GPU`;
          if (!breakdown[key]) {
            breakdown[key] = { coin, algorithm: algo, deviceType: 'GPU', hashrate: 0, devices: 0 };
          }
          breakdown[key].hashrate += gpuHash;
          breakdown[key].devices += runningGpus.length;
        }
      }
    });
    return breakdown;
  }, [miners]);

  useEffect(() => {
    fetchMiners();
    const interval = setInterval(fetchMiners, 5000);
    return () => clearInterval(interval);
  }, [fetchMiners]);

  // Debounce rapid WebSocket-triggered refreshes to avoid hammering the API
  const wsRefreshTimerRef = React.useRef(null);
  useWebSocket(useCallback((message) => {
    if (['miner_connected', 'miner_disconnected', 'miner_status_update', 'mining_update', 'miner_device_update'].includes(message.type)) {
      if (wsRefreshTimerRef.current) clearTimeout(wsRefreshTimerRef.current);
      wsRefreshTimerRef.current = setTimeout(() => {
        wsRefreshTimerRef.current = null;
        fetchMiners();
      }, 300);
    }
  }, [fetchMiners]));

  const formatHashrate = (h) => {
    if (!h) return '0 H/s';
    if (h >= 1e12) return `${(h / 1e12).toFixed(2)} TH/s`;
    if (h >= 1e9) return `${(h / 1e9).toFixed(2)} GH/s`;
    if (h >= 1e6) return `${(h / 1e6).toFixed(2)} MH/s`;
    if (h >= 1e3) return `${(h / 1e3).toFixed(2)} KH/s`;
    return `${h.toFixed(2)} H/s`;
  };

  const getTimeAgo = (dateString) => {
    if (!dateString) return '—';
    const diff = Date.now() - new Date(dateString).getTime();
    if (isNaN(diff) || diff < 0) return '—';
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (mins > 0) return `${mins}m ago`;
    return 'Just now';
  };

  const breakdownEntries = Object.values(hashrateBreakdown).sort((a, b) => b.hashrate - a.hashrate);

  if (loading) {
    return (
      <div className="dashboard-loading">
        <div className="loading-spinner"></div>
        <p>Loading dashboard...</p>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h2>Dashboard Overview</h2>
        <p className="subtitle">Monitor your mining operation in real-time</p>
      </div>
      
      <div className="stats-grid">
        <div className="stat-card total">
          <div className="stat-icon">🖥️</div>
          <div className="stat-content">
            <div className="stat-value">{stats.total}</div>
            <div className="stat-label">Total Miners</div>
          </div>
        </div>
        
        <div className="stat-card online">
          <div className="stat-icon">🟢</div>
          <div className="stat-content">
            <div className="stat-value">{stats.online}</div>
            <div className="stat-label">Online</div>
          </div>
        </div>
        
        <div className="stat-card mining">
          <div className="stat-icon">⚡</div>
          <div className="stat-content">
            <div className="stat-value">{stats.mining}</div>
            <div className="stat-label">Mining</div>
          </div>
        </div>
        
        <div className="stat-card hashrate">
          <div className="stat-icon">📈</div>
          <div className="stat-content">
            <div className="stat-value mono">{formatHashrate(stats.totalHashrate)}</div>
            <div className="stat-label">Total Hashrate</div>
          </div>
        </div>
      </div>

      {breakdownEntries.length > 0 && (
        <div className="hashrate-breakdown">
          <h3>Hashrate by Coin & Algorithm</h3>
          <div className="breakdown-grid">
            {breakdownEntries.map((entry, idx) => (
              <div key={idx} className="breakdown-card">
                <div className="breakdown-header">
                  <span className="coin-name">{entry.coin || 'Unknown'}</span>
                  <span className="device-type-badge">{entry.deviceType || 'Unknown'}</span>
                </div>
                <div className="algorithm-row mono">{entry.algorithm || 'Unknown'}</div>
                <div className="breakdown-hashrate mono">{formatHashrate(entry.hashrate)}</div>
                <div className="breakdown-count">{entry.devices} device{entry.devices !== 1 ? 's' : ''}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="miners-section">
        <div className="section-header">
          <h3>Connected Miners</h3>
          <span className="miner-count">{miners.length} miners</span>
        </div>
        
        {miners.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📡</div>
            <h4>No miners connected</h4>
            <p>Miners will appear here when they connect to the server.</p>
            <p className="hint">Configure your client app to connect to this server.</p>
          </div>
        ) : (
          <div className="miners-table">
            <div className="table-header">
              <div className="col-name">Name</div>
              <div className="col-status">Status</div>
              <div className="col-devices">Active Devices</div>
              <div className="col-seen">Last Seen</div>
            </div>
            <div className="table-body">
              {miners.map(miner => {
                // Build active devices list
                const activeDevices = [];
                if (miner.devices?.cpu?.running) {
                  activeDevices.push({
                    type: 'CPU',
                    algo: miner.devices.cpu.algorithm,
                    hashrate: miner.devices.cpu.hashrate
                  });
                }
                if (miner.devices?.gpus && Array.isArray(miner.devices.gpus)) {
                  const runningGpus = miner.devices.gpus.filter(g => g.running);
                  if (runningGpus.length > 0) {
                    const totalGpuHashrate = getGpuHashrate(miner);
                    activeDevices.push({
                      type: `GPU (${runningGpus.length})`,
                      algo: runningGpus[0].algorithm || miner.algorithm,
                      hashrate: totalGpuHashrate
                    });
                  }
                }
                
                return (
                  <div key={miner.id} className={`table-row ${miner.status}`}>
                    <div className="col-name">
                      <span className="miner-name">{miner.name}</span>
                      <span className="miner-host">{miner.hostname}</span>
                    </div>
                    <div className="col-status">
                      <span className={`status-badge ${miner.status}`}>
                        {miner.status === 'mining' && '⚡'}
                        {miner.status === 'online' && '🟢'}
                        {miner.status === 'offline' && '⭕'}
                        {miner.status}
                      </span>
                    </div>
                    <div className="col-devices">
                      {activeDevices.length > 0 ? (
                        <div className="devices-list">
                          {activeDevices.map((device, idx) => (
                            <div key={idx} className="device-item">
                              <span className="device-type-tag">{device.type}</span>
                              <span className="device-algo mono">{device.algo || '—'}</span>
                              <span className="device-hashrate mono">{formatHashrate(device.hashrate)}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="miner-idle">No active devices</span>
                      )}
                    </div>
                    <div className="col-seen">
                      {getTimeAgo(miner.lastSeen)}
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

export default Dashboard;
