import React, { useState, useEffect } from 'react';
import './Dashboard.css';
import { formatHashrate, formatBytes, formatTemp, formatPercent } from '../utils/formatters';
import MasterServerPanel from './MasterServerPanel';

function Dashboard({ miners, onStartAll, onStopAll, onToggleDevice, isBoundToMaster, onBoundChange }) {
  const [systemInfo, setSystemInfo] = useState(() => {
    // Try to load from sessionStorage first
    const cached = sessionStorage.getItem('minemaster-system-info');
    return cached ? JSON.parse(cached) : null;
  });
  const [systemStats, setSystemStats] = useState(null);

  useEffect(() => {
    // Load system info initially and re-fetch after 3 seconds to get GPU model
    const loadSystemInfo = async () => {
      if (window.electronAPI) {
        const info = await window.electronAPI.getSystemInfo();
        setSystemInfo(info);
        // Cache in sessionStorage
        if (info) {
          sessionStorage.setItem('minemaster-system-info', JSON.stringify(info));
        }
      }
    };
    
    // Load immediately from cache/API
    const cached = sessionStorage.getItem('minemaster-system-info');
    if (cached) {
      setSystemInfo(JSON.parse(cached));
    } else {
      loadSystemInfo();
    }
    
    // Re-fetch after 3 seconds to get GPU model (which is fetched async in backend)
    const refetchTimeout = setTimeout(loadSystemInfo, 3000);
    
    return () => clearTimeout(refetchTimeout);
  }, []);

  useEffect(() => {
    // Call each stat separately (all are now fast!)
    let mounted = true;
    
    const updateStats = async () => {
      if (!mounted || !window.electronAPI) return;
      
      try {
        // Get all stats in parallel
        const [cpu, memory, gpu] = await Promise.all([
          window.electronAPI.getCpuStats(),
          window.electronAPI.getMemoryStats(),
          window.electronAPI.getGpuStats()
        ]);
        
        if (mounted) {
          setSystemStats({ cpu, memory, gpu });
        }
      } catch (e) {
        console.error('Stats update error:', e);
      }
    };

    // Initial update after 2 seconds (let background tasks initialize)
    const initialTimeout = setTimeout(updateStats, 2000);
    
    // Then every 3 seconds (fast and smooth)
    const interval = setInterval(updateStats, 3000);
    
    return () => {
      mounted = false;
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
  }, []);

  const anyRunning = miners.some(m => m.running);
  const anyLoading = miners.some(m => m.loading);
  const enabledMiners = miners.filter(m => m.enabled !== false);

  return (
    <div className="dashboard">
      {/* Master Server Panel */}
      <MasterServerPanel 
        systemInfo={systemInfo} 
        onBoundChange={onBoundChange}
      />
      
      {/* Main Control Section */}
      <div className="dashboard-control-section">
        <button
          className={`master-control ${anyRunning ? 'stop' : 'start'} ${anyLoading ? 'loading' : ''}`}
          onClick={anyRunning ? onStopAll : onStartAll}
          disabled={anyLoading}
          title={anyRunning ? 'Stop All Mining (Ctrl+X)' : 'Start All Mining (Ctrl+S)'}
        >
          {anyLoading ? '⏳' : (anyRunning ? '⏸' : '▶')}
        </button>

        {/* Devices Section */}
        <div className="devices-section">
          <h2>Miners</h2>
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
                        <span className="detail-item">{miner.config.coin || 'N/A'}</span>
                        {miner.deviceType === 'CPU' && miner.config.threadPercentage && miner.config.threadPercentage !== 100 && (
                          <>
                            <span className="detail-separator">•</span>
                            <span className="detail-item cpu-usage">{miner.config.threadPercentage}% CPU</span>
                          </>
                        )}
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
                    {systemStats ? formatPercent(systemStats.cpu.usage) : '...'}
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
                    {systemStats ? formatPercent(systemStats.memory.usagePercent) : '...'}
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

          {/* GPU Info - Support Multiple GPUs */}
          {systemStats?.gpu && Array.isArray(systemStats.gpu) && systemStats.gpu.length > 0 ? (
            systemStats.gpu.map((gpu, idx) => {
              const gpuModel = systemInfo?.gpus?.[idx]?.model || `${gpu.type || 'GPU'} ${idx}`;
              const staticVram = systemInfo?.gpus?.[idx]?.vram; // Static VRAM from system info (MB)
              return (
                <div key={`gpu-${idx}`} className="system-card">
                  <div className="system-icon">🎮</div>
                  <div className="system-info">
                    <div className="system-label">GPU {systemStats.gpu.length > 1 ? idx : ''}</div>
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
                      {(gpu.vramUsed !== null && gpu.vramTotal !== null) ? (
                        <div className="stat">
                          <span className="stat-label">VRAM:</span>
                          <span className="stat-value">
                            {(gpu.vramUsed / 1024).toFixed(1)} / {(gpu.vramTotal / 1024).toFixed(1)} GB
                          </span>
                        </div>
                      ) : staticVram && (
                        <div className="stat">
                          <span className="stat-label">VRAM:</span>
                          <span className="stat-value">
                            {(staticVram / 1024).toFixed(1)} GB
                          </span>
                        </div>
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
                  {systemInfo?.gpus?.[0]?.model || 'No GPU detected'}
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
