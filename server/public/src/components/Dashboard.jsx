import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { minersAPI } from '../services/api';
import { useWebSocket } from '../hooks/useWebSocket';
import { useToast } from '../hooks/useToast';
import ToastContainer from './ToastContainer';
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

  if (
    gpuRates.length > 1 &&
    typeof miner?.hashrate === 'number' &&
    gpuRates.every((rate) => Math.abs(rate - miner.hashrate) < 0.0001)
  ) {
    return miner.hashrate;
  }

  return gpuRates.reduce((sum, rate) => sum + rate, 0);
}

function formatHashrate(h) {
  if (!h) return '0 H/s';
  if (h >= 1e12) return `${(h / 1e12).toFixed(2)} TH/s`;
  if (h >= 1e9) return `${(h / 1e9).toFixed(2)} GH/s`;
  if (h >= 1e6) return `${(h / 1e6).toFixed(2)} MH/s`;
  if (h >= 1e3) return `${(h / 1e3).toFixed(2)} KH/s`;
  return `${h.toFixed(2)} H/s`;
}

function formatUptime(seconds) {
  if (!seconds) return '—';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function getTimeAgo(dateString) {
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
}

function Dashboard() {
  const [miners, setMiners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('name');
  const [sortDir, setSortDir] = useState('asc');
  const [expandedRows, setExpandedRows] = useState(new Set());
  const { toasts, success, error: showError, dismissToast } = useToast();

  const fetchMiners = useCallback(async () => {
    try {
      const response = await minersAPI.getAll();
      setMiners(response.data.miners || []);
    } catch (err) {
      console.error('Error fetching miners:', err);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchMiners();
    const interval = setInterval(fetchMiners, 5000);
    return () => clearInterval(interval);
  }, [fetchMiners]);

  const wsRefreshTimerRef = useRef(null);
  useWebSocket(useCallback((message) => {
    if (['miner_connected', 'miner_disconnected', 'miner_status_update', 'mining_update', 'miner_device_update'].includes(message.type)) {
      if (wsRefreshTimerRef.current) clearTimeout(wsRefreshTimerRef.current);
      wsRefreshTimerRef.current = setTimeout(() => {
        wsRefreshTimerRef.current = null;
        fetchMiners();
      }, 300);
    }
  }, [fetchMiners]));

  // Derived stats
  const stats = useMemo(() => {
    let cpuHashrate = 0;
    let gpuHashrate = 0;
    miners.forEach(miner => {
      if (miner.devices?.cpu?.running && miner.devices?.cpu?.hashrate) {
        cpuHashrate += miner.devices.cpu.hashrate;
      }
      gpuHashrate += getGpuHashrate(miner);
    });
    return {
      total: miners.length,
      online: miners.filter(m => m.status === 'online' || m.status === 'mining').length,
      mining: miners.filter(m => m.status === 'mining').length,
      offline: miners.filter(m => m.status === 'offline').length,
      cpuHashrate,
      gpuHashrate,
      totalHashrate: cpuHashrate + gpuHashrate
    };
  }, [miners]);

  // Filter + search + sort
  const filteredMiners = useMemo(() => {
    let result = miners;

    if (filter !== 'all') {
      if (filter === 'online') result = result.filter(m => m.status === 'online' || m.status === 'mining');
      else result = result.filter(m => m.status === filter);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(m =>
        (m.name || '').toLowerCase().includes(q) ||
        (m.hostname || '').toLowerCase().includes(q) ||
        (m.ip || '').toLowerCase().includes(q) ||
        (m.systemId || '').toLowerCase().includes(q) ||
        (m.os || '').toLowerCase().includes(q)
      );
    }

    result = [...result].sort((a, b) => {
      let av, bv;
      switch (sortKey) {
        case 'name': av = (a.name || '').toLowerCase(); bv = (b.name || '').toLowerCase(); break;
        case 'status': av = a.status || ''; bv = b.status || ''; break;
        case 'cpuHashrate': {
          av = a.devices?.cpu?.running ? a.devices.cpu.hashrate || 0 : 0;
          bv = b.devices?.cpu?.running ? b.devices.cpu.hashrate || 0 : 0;
          break;
        }
        case 'gpuHashrate': {
          av = getGpuHashrate(a);
          bv = getGpuHashrate(b);
          break;
        }
        case 'lastSeen': av = new Date(a.lastSeen || 0).getTime(); bv = new Date(b.lastSeen || 0).getTime(); break;
        default: av = ''; bv = '';
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    return result;
  }, [miners, filter, search, sortKey, sortDir]);

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const toggleRow = (id) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Action handlers
  const handleRestart = async (id, name) => {
    try {
      await minersAPI.restart(id);
      success(`Restart command sent to ${name}`, 3000);
    } catch (err) {
      showError(`Failed to restart ${name}: ${err.response?.data?.error || err.message}`, 5000);
    }
  };

  const handleStop = async (id, name) => {
    try {
      await minersAPI.stop(id);
      success(`Stop command sent to ${name}`, 3000);
    } catch (err) {
      showError(`Failed to stop ${name}: ${err.response?.data?.error || err.message}`, 5000);
    }
  };

  const handleStart = async (id, name) => {
    try {
      await minersAPI.start(id, {});
      success(`Start command sent to ${name}`, 3000);
    } catch (err) {
      showError(`Failed to start ${name}: ${err.response?.data?.error || err.message}`, 5000);
    }
  };

  const handleToggleCpu = async (id, name, currentEnabled) => {
    try {
      await minersAPI.toggleCpu(id, !currentEnabled);
      success(`CPU mining ${!currentEnabled ? 'enabled' : 'disabled'} on ${name}`, 3000);
      fetchMiners();
    } catch (err) {
      showError(`Failed to toggle CPU on ${name}: ${err.response?.data?.error || err.message}`, 5000);
    }
  };

  const handleToggleGpu = async (id, name, currentEnabled) => {
    try {
      await minersAPI.toggleGpu(id, !currentEnabled, null);
      success(`GPU mining ${!currentEnabled ? 'enabled' : 'disabled'} on ${name}`, 3000);
      fetchMiners();
    } catch (err) {
      showError(`Failed to toggle GPU on ${name}: ${err.response?.data?.error || err.message}`, 5000);
    }
  };

  const handleDelete = async (id, name) => {
    if (!confirm(`Remove ${name} from the system? This won't affect the actual miner.`)) return;
    try {
      await minersAPI.delete(id);
      success(`${name} removed from system`, 3000);
      fetchMiners();
    } catch (err) {
      showError(`Failed to remove ${name}: ${err.response?.data?.error || err.message}`, 5000);
    }
  };

  const SortIcon = ({ col }) => {
    if (sortKey !== col) return <span className="sort-icon muted">⇅</span>;
    return <span className="sort-icon active">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  if (loading) {
    return (
      <div className="dash-loading">
        <div className="loading-spinner"></div>
        <p>Loading dashboard...</p>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      <div className="dash-header">
        <div>
          <h2>Dashboard</h2>
          <p className="subtitle">Monitor and control your mining operation</p>
        </div>
      </div>

      {/* Stats cards */}
      <div className="stats-grid">
        <div className="stat-card total">
          <div className="stat-icon">🖥️</div>
          <div className="stat-content">
            <div className="stat-value">{stats.total}</div>
            <div className="stat-label">Total Miners</div>
          </div>
        </div>
        <div className="stat-card mining">
          <div className="stat-icon">⚡</div>
          <div className="stat-content">
            <div className="stat-value">{stats.mining}</div>
            <div className="stat-label">Mining</div>
          </div>
        </div>
        <div className="stat-card cpu-hash">
          <div className="stat-icon">🖥️</div>
          <div className="stat-content">
            <div className="stat-value mono">{formatHashrate(stats.cpuHashrate)}</div>
            <div className="stat-label">CPU Hashrate</div>
          </div>
        </div>
        <div className="stat-card gpu-hash">
          <div className="stat-icon">🎮</div>
          <div className="stat-content">
            <div className="stat-value mono">{formatHashrate(stats.gpuHashrate)}</div>
            <div className="stat-label">GPU Hashrate</div>
          </div>
        </div>
      </div>

      {/* Toolbar: search + filters */}
      <div className="toolbar">
        <div className="search-box">
          <span className="search-icon">🔍</span>
          <input
            type="text"
            placeholder="Search by name, hostname, IP, MAC..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button className="search-clear" onClick={() => setSearch('')}>✕</button>
          )}
        </div>
        <div className="filter-tabs">
          {[
            ['all', `All (${stats.total})`],
            ['online', `Online (${stats.online})`],
            ['mining', `Mining (${stats.mining})`],
            ['offline', `Offline (${stats.offline})`],
          ].map(([key, label]) => (
            <button key={key} className={filter === key ? 'active' : ''} onClick={() => setFilter(key)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Main table */}
      {filteredMiners.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📡</div>
          <h4>{miners.length === 0 ? 'No miners registered' : 'No miners match your filters'}</h4>
          <p>{miners.length === 0 ? 'Miners will appear here when they connect to the server.' : 'Try adjusting your search or filter.'}</p>
        </div>
      ) : (
        <div className="miners-table-wrap">
          <table className="miners-table">
            <thead>
              <tr>
                <th className="col-expand"></th>
                <th className="col-name sortable" onClick={() => handleSort('name')}>
                  Name <SortIcon col="name" />
                </th>
                <th className="col-status sortable" onClick={() => handleSort('status')}>
                  Status <SortIcon col="status" />
                </th>
                <th className="col-devices">Devices</th>
                <th className="col-hashrate sortable" onClick={() => handleSort('cpuHashrate')}>
                  CPU H/s <SortIcon col="cpuHashrate" />
                </th>
                <th className="col-hashrate sortable" onClick={() => handleSort('gpuHashrate')}>
                  GPU H/s <SortIcon col="gpuHashrate" />
                </th>
                <th className="col-stats">System</th>
                <th className="col-seen sortable" onClick={() => handleSort('lastSeen')}>
                  Last Seen <SortIcon col="lastSeen" />
                </th>
                <th className="col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredMiners.map(miner => {
                const isExpanded = expandedRows.has(miner.id);
                const cpuRunning = miner.devices?.cpu?.running;
                const cpuEnabled = miner.devices?.cpu?.enabled !== false;
                const gpuEnabled = miner.devices?.gpus?.some(g => g.enabled !== false) ?? true;
                const anyGpuRunning = miner.devices?.gpus?.some(g => g.running) ?? false;
                const cpuHash = cpuRunning ? miner.devices?.cpu?.hashrate || 0 : 0;
                const gpuHash = getGpuHashrate(miner);
                const isOnline = miner.status === 'online' || miner.status === 'mining';
                const hasGpus = miner.hardware?.gpus?.length > 0;

                return (
                  <React.Fragment key={miner.id}>
                    <tr className={`miner-row ${miner.status} ${isExpanded ? 'expanded' : ''}`}>
                      <td className="col-expand">
                        <button className={`expand-btn ${isExpanded ? 'open' : ''}`} onClick={() => toggleRow(miner.id)} title="Expand details">
                          ›
                        </button>
                      </td>
                      <td className="col-name">
                        <div className="name-cell">
                          <span className={`status-dot-sm ${miner.status}`}></span>
                          <div>
                            <span className="miner-name">{miner.name}</span>
                            <span className="miner-host mono">{miner.hostname}</span>
                          </div>
                        </div>
                      </td>
                      <td className="col-status">
                        <span className={`status-badge ${miner.status}`}>
                          {miner.status === 'mining' && '⚡ '}
                          {miner.status === 'online' && '🟢 '}
                          {miner.status === 'offline' && '⭕ '}
                          {miner.status}
                        </span>
                        {miner.uptime > 0 && miner.status === 'mining' && (
                          <span className="uptime-tag">{formatUptime(miner.uptime)}</span>
                        )}
                      </td>
                      <td className="col-devices">
                        <div className="device-chips">
                          {miner.hardware?.cpu && (
                            <span className={`device-chip ${cpuRunning ? 'active' : ''}`}>
                              🖥️ CPU {cpuRunning ? '⚡' : ''}
                            </span>
                          )}
                          {hasGpus && (
                            <span className={`device-chip ${anyGpuRunning ? 'active' : ''}`}>
                              🎮 GPU{miner.hardware.gpus.length > 1 ? ` ×${miner.hardware.gpus.length}` : ''} {anyGpuRunning ? '⚡' : ''}
                            </span>
                          )}
                          {!miner.hardware?.cpu && !hasGpus && <span className="text-muted">—</span>}
                        </div>
                      </td>
                      <td className="col-hashrate">
                        {cpuHash > 0 ? (
                          <span className="hashrate-val cpu mono">{formatHashrate(cpuHash)}</span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="col-hashrate">
                        {gpuHash > 0 ? (
                          <span className="hashrate-val gpu mono">{formatHashrate(gpuHash)}</span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="col-stats">
                        <div className="stats-mini">
                          {miner.stats?.cpu?.usage != null && (
                            <span className="stat-mini" title="CPU Usage">🖥️ {Math.round(miner.stats.cpu.usage)}%</span>
                          )}
                          {miner.stats?.cpu?.temperature != null && (
                            <span className="stat-mini temp" title="CPU Temp">{Math.round(miner.stats.cpu.temperature)}°C</span>
                          )}
                          {miner.stats?.memory?.usagePercent != null && (
                            <span className="stat-mini" title="RAM Usage">💾 {Math.round(miner.stats.memory.usagePercent)}%</span>
                          )}
                        </div>
                      </td>
                      <td className="col-seen">
                        {getTimeAgo(miner.lastSeen)}
                      </td>
                      <td className="col-actions">
                        {isOnline && miner.bound ? (
                          <div className="action-btns">
                            {miner.status === 'mining' ? (
                              <button
                                className="btn-sm btn-stop"
                                onClick={() => handleStop(miner.id, miner.name)}
                                title="Stop mining"
                                aria-label={`Stop mining on ${miner.name}`}
                              >
                                ■
                              </button>
                            ) : (
                              <button
                                className="btn-sm btn-start"
                                onClick={() => handleStart(miner.id, miner.name)}
                                title="Start mining"
                                aria-label={`Start mining on ${miner.name}`}
                              >
                                ▶
                              </button>
                            )}
                            <button
                              className="btn-sm btn-restart"
                              onClick={() => handleRestart(miner.id, miner.name)}
                              title="Restart miner"
                              aria-label={`Restart ${miner.name}`}
                            >
                              ↻
                            </button>
                            <button className="btn-sm btn-delete" onClick={() => handleDelete(miner.id, miner.name)} title="Remove">✕</button>
                          </div>
                        ) : (
                          <div className="action-btns">
                            <button className="btn-sm btn-delete" onClick={() => handleDelete(miner.id, miner.name)} title="Remove">✕</button>
                          </div>
                        )}
                      </td>
                    </tr>

                    {/* Expanded detail row */}
                    {isExpanded && (
                      <tr className="detail-row">
                        <td colSpan="9">
                          <div className="detail-panel">
                            {/* System info */}
                            <div className="detail-section">
                              <h4>System Info</h4>
                              <div className="detail-grid">
                                <div className="detail-item">
                                  <span className="detail-label">IP Address</span>
                                  <span className="detail-value mono">{miner.ip !== 'unknown' ? miner.ip : '—'}</span>
                                </div>
                                <div className="detail-item">
                                  <span className="detail-label">MAC Address</span>
                                  <span className="detail-value mono">{miner.systemId || '—'}</span>
                                </div>
                                <div className="detail-item">
                                  <span className="detail-label">OS</span>
                                  <span className="detail-value">{miner.os || '—'}</span>
                                </div>
                                <div className="detail-item">
                                  <span className="detail-label">Version</span>
                                  <span className="detail-value">{miner.version || '—'}</span>
                                </div>
                                {miner.hardware?.ram && (
                                  <div className="detail-item">
                                    <span className="detail-label">RAM</span>
                                    <span className="detail-value mono">
                                      {(miner.hardware.ram.total / (1024 ** 3)).toFixed(1)} GB
                                      {miner.stats?.memory?.used != null && miner.stats?.memory?.total != null && (
                                        <> ({(miner.stats.memory.used / (1024 ** 3)).toFixed(1)} used)</>
                                      )}
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Device controls */}
                            {isOnline && miner.bound && (
                              <div className="detail-section">
                                <h4>Mining Devices</h4>
                                <div className="device-controls">
                                  {/* CPU */}
                                  {miner.hardware?.cpu && (
                                    <div className={`device-control-row ${cpuRunning ? 'running' : ''}`}>
                                      <label className="toggle-switch">
                                        <input type="checkbox" checked={cpuEnabled} onChange={() => handleToggleCpu(miner.id, miner.name, cpuEnabled)} />
                                        <span className="toggle-slider"></span>
                                      </label>
                                      <div className="dc-info">
                                        <span className="dc-name">🖥️ CPU</span>
                                        <span className="dc-model mono">{miner.hardware.cpu.brand || 'CPU'} ({miner.hardware.cpu.cores || 0} cores)</span>
                                      </div>
                                      <div className="dc-stats">
                                        {cpuRunning && miner.devices?.cpu?.hashrate && (
                                          <span className="dc-hashrate mono">{formatHashrate(miner.devices.cpu.hashrate)}</span>
                                        )}
                                        {cpuRunning && miner.devices?.cpu?.algorithm && (
                                          <span className="dc-algo mono">{miner.devices.cpu.algorithm}</span>
                                        )}
                                        <span className={`dc-state ${cpuRunning ? 'active' : 'idle'}`}>
                                          {cpuRunning ? '⚡ Mining' : '⏸ Idle'}
                                        </span>
                                      </div>
                                    </div>
                                  )}

                                  {/* GPU */}
                                  {hasGpus && (
                                    <div className={`device-control-row ${anyGpuRunning ? 'running' : ''}`}>
                                      <label className="toggle-switch">
                                        <input type="checkbox" checked={gpuEnabled} onChange={() => handleToggleGpu(miner.id, miner.name, gpuEnabled)} />
                                        <span className="toggle-slider"></span>
                                      </label>
                                      <div className="dc-info">
                                        <span className="dc-name">🎮 GPU Mining{miner.hardware.gpus.length > 1 ? ` (${miner.hardware.gpus.length} GPUs)` : ''}</span>
                                        <span className="dc-model mono">
                                          {miner.hardware.gpus.map(g => g.model || g.name || 'GPU').join(', ')}
                                        </span>
                                      </div>
                                      <div className="dc-stats">
                                        {anyGpuRunning && getGpuHashrate(miner) > 0 && (
                                          <span className="dc-hashrate mono">{formatHashrate(getGpuHashrate(miner))}</span>
                                        )}
                                        {anyGpuRunning && miner.devices?.gpus?.find(g => g.algorithm) && (
                                          <span className="dc-algo mono">{miner.devices.gpus.find(g => g.algorithm)?.algorithm}</span>
                                        )}
                                        <span className={`dc-state ${anyGpuRunning ? 'active' : 'idle'}`}>
                                          {anyGpuRunning ? '⚡ Mining' : '⏸ Idle'}
                                        </span>
                                      </div>
                                    </div>
                                  )}

                                  {/* GPU detail stats */}
                                  {hasGpus && miner.stats?.gpus && miner.stats.gpus.length > 0 && (
                                    <div className="gpu-detail-stats">
                                      {miner.hardware.gpus.map((gpu, idx) => (
                                        <div key={idx} className="gpu-detail-item">
                                          <span className="gpu-detail-name mono">GPU {idx}: {gpu.model || gpu.name || 'Unknown'}</span>
                                          <div className="gpu-detail-metrics">
                                            {miner.stats.gpus[idx]?.usage != null && (
                                              <span>Usage: {Math.round(miner.stats.gpus[idx].usage)}%</span>
                                            )}
                                            {miner.stats.gpus[idx]?.temperature != null && (
                                              <span className="temp">Temp: {Math.round(miner.stats.gpus[idx].temperature)}°C</span>
                                            )}
                                            {miner.stats.gpus[idx]?.vramUsed != null && miner.stats.gpus[idx]?.vramTotal != null && (
                                              <span>VRAM: {(miner.stats.gpus[idx].vramUsed / 1024).toFixed(1)}/{(miner.stats.gpus[idx].vramTotal / 1024).toFixed(1)} GB</span>
                                            )}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* Offline/unbound hardware info */}
                            {(!isOnline || !miner.bound) && miner.hardware && (
                              <div className="detail-section">
                                <h4>Hardware</h4>
                                <div className="detail-grid">
                                  {miner.hardware.cpu && (
                                    <div className="detail-item">
                                      <span className="detail-label">CPU</span>
                                      <span className="detail-value mono">{miner.hardware.cpu.brand || 'Unknown'} ({miner.hardware.cpu.cores || 0} cores)</span>
                                    </div>
                                  )}
                                  {hasGpus && (
                                    <div className="detail-item">
                                      <span className="detail-label">GPU</span>
                                      <span className="detail-value mono">{miner.hardware.gpus.map(g => g.model || g.name || 'GPU').join(', ')}</span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default Dashboard;
