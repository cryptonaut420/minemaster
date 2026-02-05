import React, { useState, useEffect, useCallback } from 'react';
import { minersAPI } from '../services/api';
import { useWebSocket } from '../hooks/useWebSocket';
import './Dashboard.css';

const API_BASE = window.location.hostname === 'localhost' ? 'http://localhost:3001/api' : '/api';

function Dashboard() {
  const [stats, setStats] = useState({
    total: 0,
    online: 0,
    mining: 0,
    offline: 0,
    totalHashrate: 0
  });
  const [hashrateBreakdown, setHashrateBreakdown] = useState({});
  const [miners, setMiners] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchMiners = useCallback(async () => {
    try {
      const response = await minersAPI.getAll();
      const minersData = response.data.miners || [];
      setMiners(minersData);
      
      // Calculate total hashrate from all devices across all miners
      let totalHashrate = 0;
      minersData.forEach(miner => {
        // Add CPU hashrate if mining
        if (miner.devices?.cpu?.running && miner.devices?.cpu?.hashrate) {
          totalHashrate += miner.devices.cpu.hashrate;
        }
        // Add all GPU hashrates if mining
        if (miner.devices?.gpus && Array.isArray(miner.devices.gpus)) {
          miner.devices.gpus.forEach(gpu => {
            if (gpu.running && gpu.hashrate) {
              totalHashrate += gpu.hashrate;
            }
          });
        }
      });
      
      const newStats = {
        total: minersData.length,
        online: minersData.filter(m => m.status === 'online' || m.status === 'mining').length,
        mining: minersData.filter(m => m.status === 'mining').length,
        offline: minersData.filter(m => m.status === 'offline').length,
        totalHashrate
      };
      setStats(newStats);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching miners:', error);
      setLoading(false);
    }
  }, []);

  const fetchHashrateStats = useCallback(async () => {
    try {
      // Calculate hashrate breakdown from current miners by coin + algorithm
      const response = await minersAPI.getAll();
      const minersData = response.data.miners || [];
      const breakdown = {};
      
      minersData.forEach(miner => {
        if (miner.status !== 'mining') return;
        
        // Process CPU mining
        if (miner.devices?.cpu?.running && miner.devices?.cpu?.hashrate) {
          const algo = miner.devices.cpu.algorithm || 'Unknown';
          const coin = miner.devices.cpu.coin || 'Unknown';
          const key = `${coin}_${algo}_CPU`;
          
          if (!breakdown[key]) {
            breakdown[key] = {
              coin,
              algorithm: algo,
              deviceType: 'CPU',
              hashrate: 0,
              devices: 0
            };
          }
          breakdown[key].hashrate += miner.devices.cpu.hashrate;
          breakdown[key].devices += 1;
        }
        
        // Process GPU mining
        if (miner.devices?.gpus && Array.isArray(miner.devices.gpus)) {
          const runningGpus = miner.devices.gpus.filter(g => g.running && g.hashrate);
          if (runningGpus.length > 0) {
            const firstGpu = runningGpus[0];
            const algo = firstGpu.algorithm || 'Unknown';
            const coin = firstGpu.coin || 'Unknown';
            const key = `${coin}_${algo}_GPU`;
            
            if (!breakdown[key]) {
              breakdown[key] = {
                coin,
                algorithm: algo,
                deviceType: 'GPU',
                hashrate: 0,
                devices: 0
              };
            }
            
            // Sum hashrate from all running GPUs on this miner
            runningGpus.forEach(gpu => {
              breakdown[key].hashrate += gpu.hashrate;
            });
            breakdown[key].devices += runningGpus.length;
          }
        }
      });
      
      setHashrateBreakdown(breakdown);
    } catch (error) {
      // Silent fail - will retry on interval
    }
  }, []);

  useEffect(() => {
    fetchMiners();
    fetchHashrateStats();
    const interval = setInterval(() => {
      fetchMiners();
      fetchHashrateStats();
    }, 5000); // Refresh every 5 seconds
    return () => clearInterval(interval);
  }, [fetchMiners, fetchHashrateStats]);

  useWebSocket(useCallback((message) => {
    if (['miner_connected', 'miner_disconnected', 'miner_status_update', 'mining_update', 'miner_device_update'].includes(message.type)) {
      fetchMiners();
      fetchHashrateStats();
    }
  }, [fetchMiners, fetchHashrateStats]));

  const formatHashrate = (h) => {
    if (!h) return '0 H/s';
    if (h >= 1e12) return `${(h / 1e12).toFixed(2)} TH/s`;
    if (h >= 1e9) return `${(h / 1e9).toFixed(2)} GH/s`;
    if (h >= 1e6) return `${(h / 1e6).toFixed(2)} MH/s`;
    if (h >= 1e3) return `${(h / 1e3).toFixed(2)} KH/s`;
    return `${h.toFixed(2)} H/s`;
  };

  const getTimeAgo = (dateString) => {
    const diff = Date.now() - new Date(dateString).getTime();
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
                    const totalGpuHashrate = runningGpus.reduce((sum, g) => sum + (g.hashrate || 0), 0);
                    activeDevices.push({
                      type: `GPU (${runningGpus.length})`,
                      algo: runningGpus[0].algorithm,
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
