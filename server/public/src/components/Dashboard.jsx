import React, { useState, useEffect, useCallback } from 'react';
import { minersAPI } from '../services/api';
import { useWebSocket } from '../hooks/useWebSocket';
import './Dashboard.css';

const API_BASE = process.env.NODE_ENV === 'production' ? '/api' : 'http://localhost:3001/api';

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
      
      const newStats = {
        total: minersData.length,
        online: minersData.filter(m => m.status === 'online' || m.status === 'mining').length,
        mining: minersData.filter(m => m.status === 'mining').length,
        offline: minersData.filter(m => m.status === 'offline').length,
        totalHashrate: minersData.reduce((sum, m) => sum + (m.hashrate || 0), 0)
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
      const response = await fetch(`${API_BASE}/stats/hashrates?timeframe=1h`);
      const data = await response.json();
      if (data.success) {
        setHashrateBreakdown(data.current || {});
      }
    } catch (error) {
      console.error('Error fetching hashrate stats:', error);
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
    if (['miner_connected', 'miner_disconnected', 'miner_status_update', 'mining_update'].includes(message.type)) {
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
        
        <div className="stat-card offline">
          <div className="stat-icon">⭕</div>
          <div className="stat-content">
            <div className="stat-value">{stats.offline}</div>
            <div className="stat-label">Offline</div>
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
          <h3>Hashrate by Device Type & Algorithm</h3>
          <div className="breakdown-grid">
            {breakdownEntries.map((entry, idx) => (
              <div key={idx} className="breakdown-card">
                <div className="breakdown-header">
                  <span className="device-type">{entry.deviceType || 'Unknown'}</span>
                  <span className="algorithm mono">{entry.algorithm || 'Unknown'}</span>
                </div>
                <div className="breakdown-hashrate mono">{formatHashrate(entry.hashrate)}</div>
                <div className="breakdown-count">{entry.count} miner{entry.count !== 1 ? 's' : ''}</div>
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
              <div className="col-device">Device</div>
              <div className="col-algo">Algorithm</div>
              <div className="col-hashrate">Hashrate</div>
              <div className="col-seen">Last Seen</div>
            </div>
            <div className="table-body">
              {miners.map(miner => (
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
                  <div className="col-device">
                    {miner.deviceType ? (
                      <span className="device-type">{miner.deviceType}</span>
                    ) : (
                      <span className="miner-idle">—</span>
                    )}
                  </div>
                  <div className="col-algo">
                    {miner.algorithm ? (
                      <span className="algorithm mono">{miner.algorithm}</span>
                    ) : (
                      <span className="miner-idle">—</span>
                    )}
                  </div>
                  <div className="col-hashrate mono">
                    {miner.hashrate ? formatHashrate(miner.hashrate) : '—'}
                  </div>
                  <div className="col-seen">
                    {getTimeAgo(miner.lastSeen)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default Dashboard;
