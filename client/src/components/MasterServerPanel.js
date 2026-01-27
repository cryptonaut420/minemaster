import React, { useState, useEffect } from 'react';
import { masterServer } from '../services/masterServer';
import './MasterServerPanel.css';

function MasterServerPanel({ onBoundChange, systemInfo }) {
  const [config, setConfig] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isBound, setIsBound] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const init = async () => {
      const cfg = await loadConfig();
      
      // Setup event listeners
      masterServer.on('connected', handleConnected);
      masterServer.on('disconnected', handleDisconnected);
      masterServer.on('bound', handleBound);
      masterServer.on('unbound', handleUnbound);
      masterServer.on('error', handleError);
      
      // Restore UI state from localStorage
      const wasBound = localStorage.getItem('master-server-bound') === 'true';
      if (wasBound && cfg?.enabled) {
        console.log('[MasterServerPanel] Restoring UI bound state from localStorage');
        setIsBound(true);
        // Don't call onBoundChange here - App already initialized from localStorage
      }
    };
    
    init();

    return () => {
      masterServer.off('connected', handleConnected);
      masterServer.off('disconnected', handleDisconnected);
      masterServer.off('bound', handleBound);
      masterServer.off('unbound', handleUnbound);
      masterServer.off('error', handleError);
    };
  }, []);

  const loadConfig = async () => {
    try {
      const cfg = await masterServer.loadConfig();
      setConfig(cfg);
      
      // Auto-connect if enabled
      if (cfg.enabled) {
        handleConnect();
      }
      
      return cfg;
    } catch (error) {
      console.error('Error loading config:', error);
      setError('Failed to load configuration');
      return null;
    }
  };

  const handleConnected = async () => {
    setIsConnected(true);
    setIsConnecting(false);
    setError(null);
    
    // If was previously bound, silently re-register with server
    // Don't trigger full bind flow to avoid notification spam
    const wasBound = localStorage.getItem('master-server-bound') === 'true';
    if (wasBound) {
      console.log('[MasterServerPanel] Silently re-registering on reconnect');
      
      // Get system info and send silent register
      let sysInfo = systemInfo;
      if (!sysInfo && window.electronAPI) {
        sysInfo = await window.electronAPI.getSystemInfo();
      }
      
      if (sysInfo) {
        try {
          const systemId = await window.electronAPI.getSystemId();
          masterServer.send({
            type: 'register',
            data: {
              systemId,
              systemInfo: sysInfo,
              silent: true, // Tell server this is a reconnect
              timestamp: Date.now()
            }
          });
          console.log('[MasterServerPanel] Silent re-registration sent');
        } catch (err) {
          console.error('[MasterServerPanel] Silent re-registration failed:', err);
        }
      }
    }
  };

  const handleDisconnected = () => {
    setIsConnected(false);
    setIsConnecting(false);
    setIsBound(false);
    if (onBoundChange) onBoundChange(false);
  };

  const handleBound = (data) => {
    console.log('[MasterServerPanel] handleBound called with data:', data);
    setIsBound(true);
    localStorage.setItem('master-server-bound', 'true');
    if (onBoundChange) {
      console.log('[MasterServerPanel] Calling onBoundChange(true, data)');
      onBoundChange(true, data);
    } else {
      console.warn('[MasterServerPanel] onBoundChange callback not provided!');
    }
  };

  const handleUnbound = () => {
    setIsBound(false);
    localStorage.removeItem('master-server-bound');
    if (onBoundChange) onBoundChange(false);
  };

  const handleError = (err) => {
    setError(err.message || 'Connection error');
    setIsConnecting(false);
  };

  const handleConnect = async () => {
    setIsConnecting(true);
    setError(null);
    
    try {
      await masterServer.connect();
    } catch (err) {
      setError(err.message || 'Failed to connect');
      setIsConnecting(false);
    }
  };

  const handleDisconnect = () => {
    masterServer.disconnect();
    setIsConnected(false);
    setIsBound(false);
    if (onBoundChange) onBoundChange(false);
  };

  const handleBind = async () => {
    if (!isConnected) {
      setError('Not connected to master server');
      return;
    }

    try {
      // Get fresh system info if not available
      let sysInfo = systemInfo;
      if (!sysInfo && window.electronAPI) {
        sysInfo = await window.electronAPI.getSystemInfo();
      }
      
      await masterServer.bind(sysInfo);
      localStorage.setItem('master-server-bound', 'true');
    } catch (err) {
      setError(err.message || 'Failed to bind');
    }
  };

  const handleUnbind = async () => {
    try {
      await masterServer.unbind();
      localStorage.removeItem('master-server-bound');
    } catch (err) {
      setError(err.message || 'Failed to unbind');
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

  const handleToggleEnabled = async () => {
    const newConfig = { ...config, enabled: !config.enabled };
    setConfig(newConfig);
    
    try {
      await masterServer.saveConfig(newConfig);
      
      if (newConfig.enabled) {
        handleConnect();
      } else {
        handleDisconnect();
      }
    } catch (err) {
      setError('Failed to update settings');
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
          <div className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}>
            {isConnected ? '● Connected' : '○ Disconnected'}
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
              onChange={(e) => setConfig({ ...config, port: parseInt(e.target.value) })}
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
                Connect and bind to allow remote management and monitoring.
              </p>
            )}
          </div>

          <div className="panel-actions">
            {!isConnected ? (
              <button
                className="btn btn-connect"
                onClick={handleToggleEnabled}
                disabled={isConnecting}
              >
                {isConnecting ? 'Connecting...' : '🔌 Connect & Enable'}
              </button>
            ) : !isBound ? (
              <>
                <button
                  className="btn btn-bind"
                  onClick={handleBind}
                >
                  🔗 Bind to Master
                </button>
                <button
                  className="btn btn-disconnect"
                  onClick={handleToggleEnabled}
                >
                  Disconnect
                </button>
              </>
            ) : (
              <button
                className="btn btn-unbind"
                onClick={handleUnbind}
              >
                🔓 Unbind
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default MasterServerPanel;
