import React, { useState, useEffect, useRef } from 'react';
import { masterServer } from '../services/masterServer';
import './MasterServerPanel.css';

function MasterServerPanel({ onBoundChange, systemInfo }) {
  const [config, setConfig] = useState(null);
  const [isBound, setIsBound] = useState(false);
  const [isBinding, setIsBinding] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [error, setError] = useState(null);
  const bindTimeoutRef = useRef(null);

  // Handler for auto-reconnect (when connection is restored)
  const handleAutoReconnect = async () => {
    const wasBound = localStorage.getItem('master-server-bound') === 'true';
    if (wasBound) {
      console.log('[MasterServerPanel] Auto-reconnected, re-registering...');
      // Get system info and send silent register
      let sysInfo = systemInfo;
      if (!sysInfo && window.electronAPI) {
        sysInfo = await window.electronAPI.getSystemInfo();
      }
      if (sysInfo) {
        try {
          await masterServer.bind(sysInfo, true); // silent = true for reconnect
        } catch (err) {
          console.error('[MasterServerPanel] Auto-re-registration failed:', err);
        }
      }
    }
  };

  useEffect(() => {
    const init = async () => {
      const cfg = await loadConfig();
      
      // Setup event listeners
      masterServer.on('connected', handleAutoReconnect);
      masterServer.on('bound', handleBound);
      masterServer.on('unbound', handleUnbound);
      masterServer.on('error', handleError);
      
      // Restore UI state from localStorage
      const wasBound = localStorage.getItem('master-server-bound') === 'true';
      if (wasBound && cfg?.enabled) {
        console.log('[MasterServerPanel] Restoring bound state from localStorage');
        setIsBound(true);
        // Auto-reconnect and re-register if was bound
        try {
          await masterServer.connect();
          // Get system info and send silent register
          let sysInfo = systemInfo;
          if (!sysInfo && window.electronAPI) {
            sysInfo = await window.electronAPI.getSystemInfo();
          }
          if (sysInfo) {
            await masterServer.bind(sysInfo, true); // silent = true for reconnect
          }
        } catch (err) {
          console.error('[MasterServerPanel] Auto-reconnect failed:', err);
        }
      }
    };
    
    init();

    return () => {
      masterServer.off('connected', handleAutoReconnect);
      masterServer.off('bound', handleBound);
      masterServer.off('unbound', handleUnbound);
      masterServer.off('error', handleError);
    };
  }, []);

  const loadConfig = async () => {
    try {
      const cfg = await masterServer.loadConfig();
      setConfig(cfg);
      return cfg;
    } catch (error) {
      console.error('Error loading config:', error);
      setError('Failed to load configuration');
      return null;
    }
  };

  const handleBound = (data) => {
    console.log('[MasterServerPanel] handleBound called with data:', data);
    
    // Clear bind timeout if it exists
    if (bindTimeoutRef.current) {
      clearTimeout(bindTimeoutRef.current);
      bindTimeoutRef.current = null;
    }
    
    setIsBound(true);
    setIsBinding(false);
    setError(null);
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
    setIsBinding(false);
    localStorage.removeItem('master-server-bound');
    if (onBoundChange) onBoundChange(false);
  };

  const handleError = (err) => {
    setError(err.message || 'Connection error');
    setIsBinding(false);
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
      let sysInfo = systemInfo;
      if (!sysInfo && window.electronAPI) {
        sysInfo = await window.electronAPI.getSystemInfo();
      }
      
      // Bind will handle connection + registration
      await masterServer.bind(sysInfo);
      // Note: handleBound will be called via event listener, which will clear isBinding
      if (bindTimeoutRef.current) {
        clearTimeout(bindTimeoutRef.current);
        bindTimeoutRef.current = null;
      }
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
      // Unbind will handle unregistration + disconnection
      await masterServer.unbind();
      // Note: handleUnbound will be called via event listener
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

  const handleToggleEnabled = async () => {
    const newConfig = { ...config, enabled: !config.enabled };
    setConfig(newConfig);
    
    try {
      await masterServer.saveConfig(newConfig);
      
      // If disabling, unbind (which will disconnect)
      if (!newConfig.enabled && isBound) {
        await handleUnbind();
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
