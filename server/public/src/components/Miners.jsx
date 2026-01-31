import React, { useState, useEffect, useCallback } from 'react';
import { minersAPI } from '../services/api';
import { useWebSocket } from '../hooks/useWebSocket';
import { useToast } from '../hooks/useToast';
import ToastContainer from './ToastContainer';
import './Miners.css';

function Miners() {
  const [miners, setMiners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const { toasts, success, error, dismissToast } = useToast();

  const fetchMiners = useCallback(async () => {
    try {
      const response = await minersAPI.getAll();
      setMiners(response.data.miners || []);
    } catch (error) {
      // Silent fail - will retry on interval
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchMiners();
  }, [fetchMiners]);

  useWebSocket(useCallback((message) => {
    if (['miner_connected', 'miner_disconnected', 'miner_status_update', 'mining_update'].includes(message.type)) {
      fetchMiners();
    }
  }, [fetchMiners]));

  const handleRestart = async (id, name) => {
    if (!confirm(`Restart ${name}?`)) return;
    try {
      await minersAPI.restart(id);
      success(`Restart command sent to ${name}`, 3000);
    } catch (err) {
      error(`Failed to restart ${name}: ${err.response?.data?.error || err.message}`, 5000);
    }
  };

  const handleStop = async (id, name) => {
    try {
      await minersAPI.stop(id);
      success(`Stop command sent to ${name}`, 3000);
    } catch (err) {
      error(`Failed to stop ${name}: ${err.response?.data?.error || err.message}`, 5000);
    }
  };

  const handleStart = async (id, name) => {
    try {
      await minersAPI.start(id, {});
      success(`Start command sent to ${name}`, 3000);
    } catch (err) {
      error(`Failed to start ${name}: ${err.response?.data?.error || err.message}`, 5000);
    }
  };

  const handleToggleCpu = async (id, name, currentEnabled) => {
    try {
      await minersAPI.toggleCpu(id, !currentEnabled);
      success(`CPU mining ${!currentEnabled ? 'enabled' : 'disabled'} on ${name}`, 3000);
      fetchMiners();
    } catch (err) {
      error(`Failed to toggle CPU on ${name}: ${err.response?.data?.error || err.message}`, 5000);
    }
  };

  const handleToggleGpu = async (id, name, currentEnabled, gpuId = null) => {
    try {
      await minersAPI.toggleGpu(id, !currentEnabled, gpuId);
      const gpuLabel = gpuId !== null ? `GPU ${gpuId}` : 'All GPUs';
      success(`${gpuLabel} mining ${!currentEnabled ? 'enabled' : 'disabled'} on ${name}`, 3000);
      fetchMiners();
    } catch (err) {
      error(`Failed to toggle GPU on ${name}: ${err.response?.data?.error || err.message}`, 5000);
    }
  };

  const handleDelete = async (id, name) => {
    if (!confirm(`Remove ${name} from the system? This won't affect the actual miner.`)) return;
    try {
      await minersAPI.delete(id);
      success(`${name} removed from system`, 3000);
      fetchMiners();
    } catch (err) {
      error(`Failed to remove ${name}: ${err.response?.data?.error || err.message}`, 5000);
    }
  };

  const formatHashrate = (h) => {
    if (!h) return '—';
    if (h >= 1e12) return `${(h / 1e12).toFixed(2)} TH/s`;
    if (h >= 1e9) return `${(h / 1e9).toFixed(2)} GH/s`;
    if (h >= 1e6) return `${(h / 1e6).toFixed(2)} MH/s`;
    if (h >= 1e3) return `${(h / 1e3).toFixed(2)} KH/s`;
    return `${h.toFixed(2)} H/s`;
  };

  const formatUptime = (seconds) => {
    if (!seconds) return '—';
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
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

  const filteredMiners = miners.filter(m => {
    if (filter === 'all') return true;
    if (filter === 'online') return m.status === 'online' || m.status === 'mining';
    return m.status === filter;
  });

  if (loading) {
    return (
      <div className="miners-loading">
        <div className="loading-spinner"></div>
        <p>Loading miners...</p>
      </div>
    );
  }

  return (
    <div className="miners">
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      
      <div className="miners-header">
        <div className="header-left">
          <h2>Miners</h2>
          <p className="subtitle">Manage and monitor connected miners</p>
        </div>
        <div className="header-right">
          <div className="filter-tabs">
            <button 
              className={filter === 'all' ? 'active' : ''}
              onClick={() => setFilter('all')}
            >
              All ({miners.length})
            </button>
            <button 
              className={filter === 'online' ? 'active' : ''}
              onClick={() => setFilter('online')}
            >
              Online ({miners.filter(m => m.status === 'online' || m.status === 'mining').length})
            </button>
            <button 
              className={filter === 'mining' ? 'active' : ''}
              onClick={() => setFilter('mining')}
            >
              Mining ({miners.filter(m => m.status === 'mining').length})
            </button>
            <button 
              className={filter === 'offline' ? 'active' : ''}
              onClick={() => setFilter('offline')}
            >
              Offline ({miners.filter(m => m.status === 'offline').length})
            </button>
          </div>
        </div>
      </div>

      {filteredMiners.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📡</div>
          <h4>{filter === 'all' ? 'No miners registered' : `No ${filter} miners`}</h4>
          <p>
            {filter === 'all' 
              ? 'Miners will appear here when they connect to the server.'
              : 'Try changing the filter to see more miners.'}
          </p>
        </div>
      ) : (
        <div className="miners-grid">
          {filteredMiners.map(miner => (
            <div key={miner.id} className={`miner-card ${miner.status}`}>
              <div className="card-header">
                <div className="card-title">
                  <h3>{miner.name}</h3>
                  <span className={`status-indicator ${miner.status}`}></span>
                </div>
                <button
                  className="btn-remove"
                  onClick={() => handleDelete(miner.id, miner.name)}
                  title="Remove miner"
                >
                  ✕
                </button>
              </div>

              <div className="card-status">
                <span className={`status-badge ${miner.status}`}>
                  {miner.status === 'mining' && '⚡ '}
                  {miner.status === 'online' && '🟢 '}
                  {miner.status === 'offline' && '⭕ '}
                  {miner.status}
                </span>
                {miner.bound && (
                  <span className="bound-badge" title="Bound to Master">
                    🔗 Bound
                  </span>
                )}
                {miner.currentMiner && (
                  <span className="miner-type">{miner.currentMiner}</span>
                )}
              </div>

              <div className="card-body">
                <div className="info-grid">
                  <div className="info-item">
                    <span className="info-label">Hostname</span>
                    <span className="info-value mono">{miner.hostname}</span>
                  </div>
                  <div className="info-item">
                    <span className="info-label">IP Address</span>
                    <span className="info-value mono">{miner.ip !== 'unknown' ? miner.ip : '—'}</span>
                  </div>
                  <div className="info-item">
                    <span className="info-label">MAC Address</span>
                    <span className="info-value mono">{miner.systemId || '—'}</span>
                  </div>
                  <div className="info-item">
                    <span className="info-label">OS</span>
                    <span className="info-value">{miner.os}</span>
                  </div>
                  <div className="info-item">
                    <span className="info-label">Version</span>
                    <span className="info-value">{miner.version}</span>
                  </div>
                </div>
                {/* Device Controls Section */}
                {miner.bound && (miner.status === 'online' || miner.status === 'mining') && (
                  <div className="devices-section">
                    <h4 className="devices-title">Mining Devices</h4>
                    
                    {/* CPU Device */}
                    {miner.hardware?.cpu && (
                      <div className={`device-row ${miner.devices?.cpu?.running ? 'running' : ''}`}>
                        <div className="device-main">
                          <label className="toggle-switch">
                            <input
                              type="checkbox"
                              checked={miner.devices?.cpu?.enabled !== false}
                              onChange={() => handleToggleCpu(miner.id, miner.name, miner.devices?.cpu?.enabled !== false)}
                              disabled={!miner.bound || miner.status === 'offline'}
                            />
                            <span className="toggle-slider"></span>
                          </label>
                          <div className="device-info">
                            <div className="device-header-row">
                              <span className="device-icon">🖥️</span>
                              <span className="device-name">CPU</span>
                            </div>
                            <div className="device-details">
                              <span className="device-model">{miner.hardware.cpu.brand || 'CPU'} ({miner.hardware.cpu.cores || 0} cores)</span>
                              {miner.stats?.cpu && (
                                <div className="device-stats-inline">
                                  {miner.stats.cpu.usage != null && (
                                    <span className="stat-item">
                                      <span className="stat-label">Usage:</span> {Math.round(miner.stats.cpu.usage)}%
                                    </span>
                                  )}
                                  {miner.stats.cpu.temperature != null && (
                                    <span className="stat-item">
                                      <span className="stat-label">Temp:</span> {Math.round(miner.stats.cpu.temperature)}°C
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                        {miner.devices?.cpu?.enabled !== false && (
                          <div className="device-status">
                            {miner.devices?.cpu?.running && (
                              <>
                                {miner.devices?.cpu?.hashrate && (
                                  <span className="device-hashrate mono">{formatHashrate(miner.devices.cpu.hashrate)}</span>
                                )}
                                {miner.devices?.cpu?.algorithm && (
                                  <span className="device-algorithm mono">{miner.devices.cpu.algorithm}</span>
                                )}
                                {miner.uptime && (
                                  <span className="device-uptime">{formatUptime(miner.uptime)}</span>
                                )}
                              </>
                            )}
                            <span className={`device-state ${miner.devices?.cpu?.running ? 'active' : 'idle'}`}>
                              {miner.devices?.cpu?.running ? '⚡ Mining' : '⏸ Idle'}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                    
                    {/* GPU Devices - Show single toggle for ALL GPUs, but display individual GPU specs */}
                    {miner.hardware?.gpus && 
                     Array.isArray(miner.hardware.gpus) && 
                     miner.hardware.gpus.length > 0 &&
                     miner.hardware.gpus.some(gpu => gpu && (gpu.model || gpu.name) && 
                       !gpu.model?.toLowerCase().includes('no gpu') && 
                       !gpu.name?.toLowerCase().includes('no gpu')) ? (
                      <>
                        {/* Single GPU toggle that controls ALL GPUs */}
                        {(() => {
                          // Check overall GPU enabled state - true if ANY GPU is enabled
                          const gpusEnabled = miner.devices?.gpus?.some(g => g.enabled !== false) ?? true;
                          const anyGpuRunning = miner.devices?.gpus?.some(g => g.running) ?? false;
                          const hasValidGpus = miner.hardware.gpus.some(gpu => 
                            gpu && (gpu.model || gpu.name) &&
                            !gpu.model?.toLowerCase().includes('no gpu') &&
                            !gpu.name?.toLowerCase().includes('no gpu')
                          );
                          
                          return (
                            <div className={`device-row ${anyGpuRunning ? 'running' : ''}`}>
                              <div className="device-main">
                                <label className="toggle-switch">
                                  <input
                                    type="checkbox"
                                    checked={gpusEnabled}
                                    onChange={() => handleToggleGpu(miner.id, miner.name, gpusEnabled, null)}
                                    disabled={!miner.bound || miner.status === 'offline' || !hasValidGpus}
                                  />
                                  <span className="toggle-slider"></span>
                                </label>
                                <div className="device-info">
                                  <div className="device-header-row">
                                    <span className="device-icon">🎮</span>
                                    <span className="device-name">
                                      GPU Mining {miner.hardware.gpus.length > 1 ? `(${miner.hardware.gpus.length} GPUs)` : ''}
                                    </span>
                                  </div>
                                  <div className="device-details">
                                    <span className="device-model">Controls all GPU devices</span>
                                  </div>
                                </div>
                              </div>
                              {gpusEnabled && (
                                <div className="device-status">
                                  {anyGpuRunning && (
                                    <>
                                      {miner.devices?.gpus?.find(g => g.hashrate) && (
                                        <span className="device-hashrate mono">
                                          {formatHashrate(miner.devices.gpus.find(g => g.hashrate)?.hashrate)}
                                        </span>
                                      )}
                                      {miner.devices?.gpus?.find(g => g.algorithm) && (
                                        <span className="device-algorithm mono">
                                          {miner.devices.gpus.find(g => g.algorithm)?.algorithm}
                                        </span>
                                      )}
                                      {miner.uptime && (
                                        <span className="device-uptime">{formatUptime(miner.uptime)}</span>
                                      )}
                                    </>
                                  )}
                                  <span className={`device-state ${anyGpuRunning ? 'active' : 'idle'}`}>
                                    {anyGpuRunning ? '⚡ Mining' : '⏸ Idle'}
                                  </span>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                        
                        {/* Individual GPU specs for monitoring (no toggles) */}
                        <div className="gpu-specs-section">
                          <h5 className="gpu-specs-title">GPU Details</h5>
                          {miner.hardware.gpus.map((gpu, idx) => {
                            const hasGpu = gpu && 
                                           (gpu.model || gpu.name) &&
                                           !gpu.model?.toLowerCase().includes('no gpu') &&
                                           !gpu.name?.toLowerCase().includes('no gpu');
                            
                            if (!hasGpu) return null;
                            
                            return (
                              <div key={idx} className="gpu-spec-row">
                                <div className="gpu-spec-header">
                                  <span className="gpu-spec-icon">🎮</span>
                                  <span className="gpu-spec-name">GPU {idx}</span>
                                </div>
                                <div className="gpu-spec-details">
                                  <span className="gpu-spec-model">{gpu.model || gpu.name || `GPU ${idx}`}</span>
                                  {miner.stats?.gpus?.[idx] && (
                                    <div className="device-stats-inline">
                                      {miner.stats.gpus[idx].usage != null && (
                                        <span className="stat-item">
                                          <span className="stat-label">Usage:</span> {Math.round(miner.stats.gpus[idx].usage)}%
                                        </span>
                                      )}
                                      {miner.stats.gpus[idx].temperature != null && (
                                        <span className="stat-item">
                                          <span className="stat-label">Temp:</span> {Math.round(miner.stats.gpus[idx].temperature)}°C
                                        </span>
                                      )}
                                      {miner.stats.gpus[idx].vramUsed != null && miner.stats.gpus[idx].vramTotal != null && (
                                        <span className="stat-item">
                                          <span className="stat-label">VRAM:</span> {(miner.stats.gpus[idx].vramUsed / 1024).toFixed(1)}/{(miner.stats.gpus[idx].vramTotal / 1024).toFixed(1)} GB
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    ) : (
                      // No GPU detected
                      <div className="device-row no-gpu">
                        <div className="device-main">
                          <label className="toggle-switch">
                            <input
                              type="checkbox"
                              checked={false}
                              disabled={true}
                            />
                            <span className="toggle-slider"></span>
                          </label>
                          <div className="device-info">
                            <div className="device-header-row">
                              <span className="device-icon">🎮</span>
                              <span className="device-name">GPU Mining</span>
                            </div>
                            <div className="device-details">
                              <span className="device-model no-gpu-text">No GPU detected</span>
                            </div>
                          </div>
                        </div>
                        <div className="device-status">
                          <span className="device-state idle">N/A</span>
                        </div>
                      </div>
                    )}
                    
                    {/* RAM info */}
                    {miner.hardware?.ram && (
                      <div className="device-row ram-info">
                        <div className="device-info">
                          <span className="device-icon">💾</span>
                          <div className="device-details">
                            <span className="device-name">RAM</span>
                            <span className="device-model">
                              {(miner.hardware.ram.total / (1024 ** 3)).toFixed(1)} GB Total
                            </span>
                            {miner.stats?.memory && (
                              <div className="device-stats-inline">
                                {miner.stats.memory.usagePercent != null && (
                                  <span className="stat-item">
                                    <span className="stat-label">Usage:</span> {Math.round(miner.stats.memory.usagePercent)}%
                                  </span>
                                )}
                                {miner.stats.memory.used != null && miner.stats.memory.total != null && (
                                  <span className="stat-item">
                                    <span className="stat-label">Used:</span> {(miner.stats.memory.used / (1024 ** 3)).toFixed(1)}/{(miner.stats.memory.total / (1024 ** 3)).toFixed(1)} GB
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                
                {/* Show hardware info for offline/unbound miners */}
                {(!miner.bound || (miner.status !== 'online' && miner.status !== 'mining')) && 
                  miner.hardware && (miner.hardware.cpu || miner.hardware.gpus?.length > 0) && (
                  <div className="hardware-info">
                    <h4 className="hardware-title">Hardware</h4>
                    {miner.hardware.cpu && (
                      <div className="hardware-item">
                        <span className="hardware-label">CPU:</span>
                        <span className="hardware-value">
                          {miner.hardware.cpu.brand || 'Unknown CPU'} ({miner.hardware.cpu.cores || 0} cores)
                        </span>
                      </div>
                    )}
                    {miner.hardware.gpus && miner.hardware.gpus.length > 0 && (
                      <div className="hardware-item">
                        <span className="hardware-label">GPU:</span>
                        <span className="hardware-value">
                          {miner.hardware.gpus.map(gpu => gpu.model || gpu.name || 'Unknown GPU').join(', ')}
                        </span>
                      </div>
                    )}
                    {miner.hardware.ram && (
                      <div className="hardware-item">
                        <span className="hardware-label">RAM:</span>
                        <span className="hardware-value">
                          {(miner.hardware.ram.total / (1024 ** 3)).toFixed(1)} GB
                        </span>
                      </div>
                    )}
                  </div>
                )}

                <div className="last-seen">
                  Last seen: {getTimeAgo(miner.lastSeen)}
                </div>
              </div>

              {miner.bound && (miner.status === 'online' || miner.status === 'mining') && (
                <div className="card-actions">
                  {miner.status === 'mining' ? (
                    <button
                      className="btn btn-stop"
                      onClick={() => handleStop(miner.id, miner.name)}
                    >
                      ⏹ Stop
                    </button>
                  ) : (
                    <button
                      className="btn btn-start"
                      onClick={() => handleStart(miner.id, miner.name)}
                    >
                      ▶ Start
                    </button>
                  )}
                  <button
                    className="btn btn-restart"
                    onClick={() => handleRestart(miner.id, miner.name)}
                  >
                    🔄 Restart
                  </button>
                </div>
              )}
              
              {!miner.bound && (
                <div className="card-info-message">
                  Not bound to master - connect client to enable remote control
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default Miners;
