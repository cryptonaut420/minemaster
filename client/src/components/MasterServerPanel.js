import React, { useState, useEffect, useRef } from 'react';
import { masterServer } from '../services/masterServer';
import './MasterServerPanel.css';

// MasterServerPanel is a UI-only component for bind/unbind actions and settings.
// All connection lifecycle management (connect, auto-reconnect, re-register, status updates)
// is handled in App.js so it persists across route/view changes.
function MasterServerPanel({ isBound, onUnbind, systemInfo, miners, clientName }) {
  const [config, setConfig] = useState(null);
  const [isBinding, setIsBinding] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [error, setError] = useState(null);
  const bindTimeoutRef = useRef(null);
  
  // Use refs to get current data in async handlers
  const minersRef = useRef(miners);
  const systemInfoRef = useRef(systemInfo);
  
  useEffect(() => {
    minersRef.current = miners;
  }, [miners]);
  
  useEffect(() => {
    systemInfoRef.current = systemInfo;
  }, [systemInfo]);

  // Load config on mount
  useEffect(() => {
    const init = async () => {
      await loadConfig();
    };
    init();
  }, []);

  // Clear binding state when bound status changes from App.js
  useEffect(() => {
    if (isBound) {
      setIsBinding(false);
      setError(null);
    }
  }, [isBound]);

  // Helper function to build device states from miners
  const getDeviceStatesFromMiners = () => {
    const currentMiners = minersRef.current;
    const currentSystemInfo = systemInfoRef.current;
    
    if (!currentMiners || currentMiners.length === 0) return null;
    
    const cpuMiner = currentMiners.find(m => m.deviceType === 'CPU');
    const gpuMiner = currentMiners.find(m => m.deviceType === 'GPU');
    
    return {
      cpu: {
        enabled: cpuMiner?.enabled !== false,
        running: cpuMiner?.running || false,
        hashrate: cpuMiner?.hashrate || null,
        algorithm: cpuMiner?.config?.algorithm || null
      },
      gpus: currentSystemInfo?.gpus && Array.isArray(currentSystemInfo.gpus)
        ? currentSystemInfo.gpus.map((gpu, idx) => ({
            id: idx,
            model: gpu.model || `GPU ${idx}`,
            enabled: gpuMiner?.enabled !== false,
            running: gpuMiner?.running || false,
            hashrate: gpuMiner?.hashrate || null,
            algorithm: gpuMiner?.config?.algorithm || null
          }))
        : []
    };
  };

  const loadConfig = async () => {
    try {
      const cfg = await masterServer.loadConfig();
      setConfig(cfg);
      return cfg;
    } catch (error) {
      setError('Failed to load configuration');
      return null;
    }
  };

  const handleBind = async () => {
    if (!config || !config.host || !config.port) {
      setError('Please configure host and port in settings first');
      return;
    }

    // Clear any existing timeout
    if (bindTimeoutRef.current) {
      clearTimeout(bindTimeoutRef.current);
    }

    setIsBinding(true);
    setError(null);
    
    // Set a timeout to prevent infinite "Binding..." state
    bindTimeoutRef.current = setTimeout(() => {
      setIsBinding(prev => {
        if (prev) {
          setError('Bind timeout - server did not respond. Please check your connection and try again.');
          return false;
        }
        return prev;
      });
      bindTimeoutRef.current = null;
    }, 10000); // 10 second timeout
    
    try {
      // Get fresh system info if not available
      let sysInfo = systemInfoRef.current;
      if (!sysInfo && window.electronAPI) {
        sysInfo = await window.electronAPI.getSystemInfo();
      }
      
      // Get current device states from miners
      const devices = getDeviceStatesFromMiners();
      
      if (!config.enabled) {
        const updatedConfig = { ...config, enabled: true };
        setConfig(updatedConfig);
        await masterServer.saveConfig(updatedConfig);
      }
      
      // Connect and bind - App.js will catch the 'bound' event
      await masterServer.bind(sysInfo, false, devices, clientName || null);
      
      if (bindTimeoutRef.current) {
        clearTimeout(bindTimeoutRef.current);
        bindTimeoutRef.current = null;
      }
      // Note: isBinding will be cleared when isBound prop changes (via useEffect above)
    } catch (err) {
      if (bindTimeoutRef.current) {
        clearTimeout(bindTimeoutRef.current);
        bindTimeoutRef.current = null;
      }
      setError(err.message || 'Failed to bind to master server');
      setIsBinding(false);
    }
  };

  const handleUnbind = async () => {
    setIsBinding(true);
    setError(null);
    
    try {
      // Call the unbind handler from App.js
      if (onUnbind) {
        await onUnbind();
      }
      setIsBinding(false);
    } catch (err) {
      setError(err.message || 'Failed to unbind');
      setIsBinding(false);
    }
  };

  const handleSaveSettings = async () => {
    try {
      await masterServer.saveConfig(config);
      setShowSettings(false);
      setError(null);
    } catch (err) {
      setError('Failed to save settings');
    }
  };

  if (!config) {
    return <div className="master-server-panel loading">Loading...</div>;
  }

  return (
    <div className={`master-server-panel ${isBound ? 'bound' : ''}`}>
      <div className="panel-header">
        <div className="panel-title">
          <span className="panel-icon">🔗</span>
          <h3>Master Server</h3>
          <div className={`status-indicator ${isBound ? 'bound' : 'unbound'}`}>
            {isBound ? '● Bound' : '○ Unbound'}
          </div>
        </div>
        <button 
          className="settings-btn" 
          onClick={() => setShowSettings(!showSettings)}
          title="Settings"
        >
          ⚙️
        </button>
      </div>

      {error && (
        <div className="panel-error">
          <span className="error-icon">⚠️</span>
          {error}
        </div>
      )}

      {showSettings ? (
        <div className="panel-settings">
          <div className="setting-group">
            <label>Host</label>
            <input
              type="text"
              value={config.host}
              onChange={(e) => setConfig({ ...config, host: e.target.value })}
              placeholder="localhost"
            />
          </div>
          <div className="setting-group">
            <label>Port</label>
            <input
              type="number"
              value={config.port}
              onChange={(e) => setConfig({ ...config, port: parseInt(e.target.value) || 0 })}
              placeholder="3001"
            />
          </div>
          <div className="setting-group checkbox">
            <label>
              <input
                type="checkbox"
                checked={config.autoReconnect}
                onChange={(e) => setConfig({ ...config, autoReconnect: e.target.checked })}
              />
              Auto-reconnect
            </label>
          </div>
          <div className="setting-actions">
            <button onClick={handleSaveSettings} className="btn btn-primary">
              Save
            </button>
            <button onClick={() => setShowSettings(false)} className="btn btn-secondary">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="panel-content">
          <div className="bind-status">
            {isBound ? (
              <>
                <div className="bound-indicator">
                  <span className="bound-icon">✓</span>
                  <span>Bound to Master</span>
                </div>
                <p className="bind-info">
                  This client is managed by the master server. Most settings are controlled remotely.
                </p>
              </>
            ) : (
              <p className="bind-info">
                Bind to allow remote management and monitoring from the master server.
              </p>
            )}
          </div>

          <div className="panel-actions">
            {!isBound ? (
              <button
                className="btn btn-bind"
                onClick={handleBind}
                disabled={isBinding || !config?.host || !config?.port}
              >
                {isBinding ? '⏳ Binding...' : '🔗 Bind to Master'}
              </button>
            ) : (
              <button
                className="btn btn-unbind"
                onClick={handleUnbind}
                disabled={isBinding}
              >
                {isBinding ? '⏳ Unbinding...' : '🔓 Unbind'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default MasterServerPanel;
