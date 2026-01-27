import React, { useState, useEffect, useRef } from 'react';
import './App.css';
import Dashboard from './components/Dashboard';
import MinerConsole from './components/MinerConsole';
import MinerConfig from './components/MinerConfig';
import NanominerConfig from './components/NanominerConfig';
import ErrorBoundary from './components/ErrorBoundary';
import NotificationContainer from './components/NotificationContainer';
import { formatHashrate, parseHashrate } from './utils/formatters';
import { validateMinerConfig } from './utils/validators';
import { addConsoleOutput } from './utils/consoleManager';
import { masterServer } from './services/masterServer';

function App() {
  // Load saved config from localStorage
  const loadSavedConfig = () => {
    try {
      const saved = localStorage.getItem('minemaster-config');
      if (saved) {
        const parsed = JSON.parse(saved);
        return parsed;
      }
    } catch (error) {
      console.error('Failed to load saved config:', error);
    }
    return null;
  };

  const savedConfig = loadSavedConfig();

  const [miners, setMiners] = useState([
    {
      id: 'xmrig-1',
      name: 'XMRig CPU Miner',
      type: 'xmrig',
      deviceType: 'CPU',
      running: false,
      enabled: true,
      loading: false,
      hashrate: null,
      startTime: null,
      config: savedConfig?.['xmrig-1'] || {
        pool: '',
        user: '',
        password: 'x',
        coin: 'XMR',
        algorithm: 'rx/0',
        threads: 0,
        threadPercentage: 100, // 100% = use all threads (0 in config)
        donateLevel: 0,
        customPath: '',
        additionalArgs: ''
      },
      output: [],
      validationErrors: []
    },
    {
      id: 'nanominer-1',
      name: 'Nanominer GPU',
      type: 'nanominer',
      deviceType: 'GPU',
      running: false,
      enabled: true,
      loading: false,
      hashrate: null,
      startTime: null,
      config: savedConfig?.['nanominer-1'] || {
        algorithm: 'ethash',
        coin: 'ETH',
        pool: '',
        user: '',
        rigName: '',
        email: '',
        gpus: [], // Empty = use all GPUs
        customPath: ''
      },
      output: [],
      validationErrors: []
    }
  ]);

  const [selectedView, setSelectedView] = useState('dashboard');
  const [selectedMiner, setSelectedMiner] = useState('xmrig-1');
  const [notifications, setNotifications] = useState([]);
  const [isBoundToMaster, setIsBoundToMaster] = useState(() => {
    // Initialize from localStorage on app start
    return localStorage.getItem('master-server-bound') === 'true';
  });
  const statusUpdateInterval = useRef(null);
  const boundStateInitialized = useRef(false);

  // Save config to localStorage whenever it changes
  useEffect(() => {
    const configToSave = {};
    miners.forEach(miner => {
      configToSave[miner.id] = miner.config;
    });
    localStorage.setItem('minemaster-config', JSON.stringify(configToSave));
  }, [miners]);

  // Check for running miners on mount only (not periodically)
  useEffect(() => {
    const checkRunningMiners = async () => {
      if (!window.electronAPI) return;
      
      try {
        const statuses = await window.electronAPI.getAllMinersStatus();
        
        setMiners(prev => prev.map(miner => {
          const status = statuses[miner.id];
          if (status && status.running) {
            console.log(`Reconnecting to running miner: ${miner.id} (PID: ${status.pid})`);
            return {
              ...miner,
              running: true,
              output: [`[Reconnected to running miner - PID: ${status.pid}]\n`, ...miner.output]
            };
          }
          return miner;
        }));
      } catch (error) {
        console.error('Failed to check running miners:', error);
      }
    };

    // Only check once on mount, output events handle the rest
    checkRunningMiners();
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (event) => {
      // Only handle if Ctrl/Cmd is pressed
      if (!event.ctrlKey && !event.metaKey) return;

      switch (event.key.toLowerCase()) {
        case 's':
          event.preventDefault();
          handleStartAll();
          break;
        case 'x':
          event.preventDefault();
          handleStopAll();
          break;
        case 'd':
          event.preventDefault();
          setSelectedView('dashboard');
          break;
        case '1':
          event.preventDefault();
          setSelectedView('xmrig-1');
          setSelectedMiner('xmrig-1');
          break;
        case '2':
          event.preventDefault();
          setSelectedView('nanominer-1');
          setSelectedMiner('nanominer-1');
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [miners]); // Include miners for handleStartAll/StopAll closures

  useEffect(() => {
    // Set up listeners for miner events
    if (window.electronAPI) {
      window.electronAPI.onMinerOutput((data) => {
        setMiners(prev => prev.map(miner => {
          if (miner.id === data.minerId) {
            // Parse hashrate from output using new utility
            const parsedHashrate = parseHashrate(data.data);
            const newHashrate = parsedHashrate || miner.hashrate;
            
            // Use console manager to prevent memory leaks
            const newOutput = addConsoleOutput(miner.output, data.data);
            
            return {
              ...miner,
              running: true,
              loading: false,
              hashrate: newHashrate,
              output: newOutput
            };
          }
          return miner;
        }));
      });

      window.electronAPI.onMinerError((data) => {
        setMiners(prev => prev.map(miner => {
          if (miner.id === data.minerId) {
            const newOutput = addConsoleOutput(miner.output, `ERROR: ${data.error}\n`);
            return {
              ...miner,
              loading: false,
              output: newOutput
            };
          }
          return miner;
        }));
        
        // Add notification for error
        addNotification(`Miner Error: ${data.error}`, 'error');
      });

      window.electronAPI.onMinerClosed((data) => {
        setMiners(prev => prev.map(miner => {
          if (miner.id === data.minerId) {
            const exitMessage = `\nMiner exited with code: ${data.code}\n`;
            const newOutput = addConsoleOutput(miner.output, exitMessage);
            const hadError = data.code !== 0;
            
            return {
              ...miner,
              running: false,
              loading: false,
              hashrate: null,
              startTime: null,
              output: newOutput
            };
          }
          return miner;
        }));
        
        // Notify if crashed
        if (data.code !== 0) {
          addNotification(`Miner crashed with exit code ${data.code}`, 'error');
        }
      });
    }
  }, []);

  // Master Server Integration - Command and Config Handlers
  useEffect(() => {
    // Only handle commands and config updates here
    // Bound/unbound is handled via Dashboard -> MasterServerPanel -> onBoundChange callback
    
    const handleConfigUpdate = (configs) => {
      console.log('[App] Received config update from server', configs);
      applyGlobalConfigs(configs, false); // Show notification for active updates
      addNotification('Configurations updated from Master Server', 'info');
    };

    const handleCommand = async (command) => {
      console.log('[App] Received command from server', command);
      
      switch (command.action) {
        case 'start':
          if (command.minerId) {
            await handleStartMiner(command.minerId);
          } else if (command.deviceType) {
            const miner = miners.find(m => m.deviceType === command.deviceType);
            if (miner) await handleStartMiner(miner.id);
          } else {
            await handleStartAll();
          }
          break;
          
        case 'stop':
          if (command.minerId) {
            await handleStopMiner(command.minerId);
          } else if (command.deviceType) {
            const miner = miners.find(m => m.deviceType === command.deviceType);
            if (miner) await handleStopMiner(miner.id);
          } else {
            await handleStopAll();
          }
          break;
          
        case 'restart':
          if (command.minerId) {
            await handleStopMiner(command.minerId);
            setTimeout(() => handleStartMiner(command.minerId), 2000);
          } else {
            await handleStopAll();
            setTimeout(handleStartAll, 2000);
          }
          break;
          
        default:
          console.warn('[App] Unknown command:', command.action);
      }
    };

    masterServer.on('configUpdate', handleConfigUpdate);
    masterServer.on('command', handleCommand);

    return () => {
      masterServer.off('configUpdate', handleConfigUpdate);
      masterServer.off('command', handleCommand);
    };
  }, [miners]); // Include miners for command handlers

  // Handle bound state changes from Dashboard
  const handleBoundStateChange = (bound, data) => {
    console.log('[App] handleBoundStateChange - bound:', bound, 'data:', data, 'initialized:', boundStateInitialized.current);
    
    // If this is the initial restore from localStorage, don't do anything
    // The state is already set in useState initializer
    if (!boundStateInitialized.current && bound && data === null) {
      console.log('[App] Initial bound state restore - skipping actions');
      boundStateInitialized.current = true;
      
      // If bound, ensure status updates are running
      if (bound && masterServer.isConnected()) {
        startStatusUpdates();
      }
      return;
    }
    
    // Mark as initialized after first call
    if (!boundStateInitialized.current) {
      boundStateInitialized.current = true;
    }
    
    // Only update state if it actually changed
    if (isBoundToMaster === bound) {
      console.log('[App] Bound state unchanged, skipping');
      return;
    }
    
    setIsBoundToMaster(bound);
    localStorage.setItem('master-server-bound', bound ? 'true' : 'false');
    
    if (bound) {
      addNotification('Bound to Master Server', 'success');
      
      // Request or apply global configs
      if (data?.configs) {
        console.log('[App] Applying configs from bind data');
        applyGlobalConfigs(data.configs, false); // Show notification for new bind
      } else {
        console.log('[App] Requesting configs from server');
        // Small delay to ensure connection is fully established
        setTimeout(() => {
          if (masterServer.isConnected()) {
            masterServer.requestConfigs();
          }
        }, 500);
      }
      
      // Start periodic status updates
      startStatusUpdates();
    } else {
      addNotification('Unbound from Master Server', 'info');
      stopStatusUpdates();
    }
  };

  // Apply global configs from master server
  const applyGlobalConfigs = (globalConfigs, silent = false) => {
    setMiners(prev => prev.map(miner => {
      const globalConfig = globalConfigs[miner.type];
      if (!globalConfig) return miner;

      // Merge global config with local config
      // Keep password, rigName, and gpus from local config
      const mergedConfig = {
        ...globalConfig,
        password: miner.config.password || globalConfig.password,
        rigName: miner.config.rigName || globalConfig.rigName,
        gpus: miner.config.gpus || []  // Preserve local GPU selection
      };

      return {
        ...miner,
        config: mergedConfig
      };
    }));

    if (!silent) {
      addNotification('Global configurations applied', 'success');
    }
  };

  // Start periodic status updates to server
  const startStatusUpdates = () => {
    stopStatusUpdates(); // Clear any existing interval
    
    const sendUpdate = async () => {
      if (!masterServer.isConnected() || !masterServer.isBound()) return;

      try {
        // Get system info
        const systemInfo = window.electronAPI ? await window.electronAPI.getSystemInfo() : null;
        
        // Collect miner statuses
        const minerStatuses = miners.map(m => ({
          id: m.id,
          type: m.type,
          deviceType: m.deviceType,
          running: m.running,
          enabled: m.enabled,
          hashrate: m.hashrate,
          algorithm: m.config.algorithm,
          coin: m.config.coin
        }));

        // Send status update
        await masterServer.sendStatusUpdate({
          systemInfo,
          miners: minerStatuses,
          mining: miners.some(m => m.running)
        });

        // Send hashrate updates for running miners
        miners.forEach(async (miner) => {
          if (miner.running && miner.hashrate) {
            await masterServer.sendHashrateUpdate({
              minerId: miner.id,
              deviceType: miner.deviceType,
              algorithm: miner.config.algorithm,
              hashrate: miner.hashrate
            });
          }
        });
      } catch (error) {
        console.error('[Master] Error sending status update:', error);
      }
    };

    // Send immediately
    sendUpdate();
    
    // Then every 10 seconds
    statusUpdateInterval.current = setInterval(sendUpdate, 10000);
  };

  // Stop periodic status updates
  const stopStatusUpdates = () => {
    if (statusUpdateInterval.current) {
      clearInterval(statusUpdateInterval.current);
      statusUpdateInterval.current = null;
    }
  };

  // Notification helper
  const addNotification = (message, type = 'info') => {
    const notification = {
      id: Date.now(),
      message,
      type, // 'info', 'success', 'warning', 'error'
      timestamp: Date.now()
    };
    
    setNotifications(prev => [...prev, notification]);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== notification.id));
    }, 5000);
  };

  const handleStartMiner = async (minerId) => {
    const miner = miners.find(m => m.id === minerId);
    if (!miner) return;

    // Prevent starting if already running or loading
    if (miner.running || miner.loading) {
      console.log(`[handleStartMiner] Miner ${minerId} is already ${miner.running ? 'running' : 'starting'}`);
      return;
    }

    // Validate configuration before starting
    const validation = validateMinerConfig(miner.type, miner.config);
    if (!validation.valid) {
      setMiners(prev => prev.map(m => 
        m.id === minerId ? { ...m, validationErrors: validation.errors } : m
      ));
      addNotification(`Configuration invalid: ${validation.errors[0]}`, 'error');
      return;
    }

    // Set loading state
    setMiners(prev => prev.map(m => 
      m.id === minerId ? { ...m, loading: true, validationErrors: [] } : m
    ));

    try {
      const result = await window.electronAPI.startMiner({
        minerId: miner.id,
        minerType: miner.type,
        config: miner.config
      });

      if (result.success) {
        setMiners(prev => prev.map(m => 
          m.id === minerId ? { 
            ...m, 
            running: true, 
            loading: false,
            startTime: Date.now(),
            output: [`Starting miner (PID: ${result.pid})...\n`] 
          } : m
        ));
        addNotification(`${miner.name} started successfully`, 'success');
      } else {
        setMiners(prev => prev.map(m => 
          m.id === minerId ? { 
            ...m, 
            loading: false,
            output: addConsoleOutput(m.output, `Failed to start: ${result.error}\n`)
          } : m
        ));
        addNotification(`Failed to start ${miner.name}: ${result.error}`, 'error');
      }
    } catch (error) {
      setMiners(prev => prev.map(m => 
        m.id === minerId ? { ...m, loading: false } : m
      ));
      addNotification(`Error starting miner: ${error.message}`, 'error');
    }
  };

  const handleStopMiner = async (minerId) => {
    const miner = miners.find(m => m.id === minerId);
    if (!miner) return;

    // Set loading state
    setMiners(prev => prev.map(m => 
      m.id === minerId ? { ...m, loading: true } : m
    ));

    try {
      addNotification(`Stopping ${miner.name}...`, 'info');
      const result = await window.electronAPI.stopMiner({ minerId });
      
      if (result.success) {
        setMiners(prev => prev.map(m => 
          m.id === minerId ? { 
            ...m, 
            running: false, 
            loading: false,
            hashrate: null,
            startTime: null
          } : m
        ));
        
        // Show different message if force killed
        const message = result.message || `${miner.name} stopped successfully`;
        const type = message.includes('force killed') ? 'warning' : 'success';
        addNotification(message, type);
      } else {
        setMiners(prev => prev.map(m => 
          m.id === minerId ? { ...m, loading: false, running: false } : m
        ));
        addNotification(`Failed to stop ${miner.name}: ${result.error || 'Unknown error'}`, 'error');
        console.error('Stop miner error:', result.error);
      }
    } catch (error) {
      setMiners(prev => prev.map(m => 
        m.id === minerId ? { ...m, loading: false, running: false } : m
      ));
      addNotification(`Error stopping miner: ${error.message}`, 'error');
      console.error('Stop miner exception:', error);
    }
  };

  const handleConfigChange = (minerId, config) => {
    setMiners(prev => prev.map(m => 
      m.id === minerId ? { ...m, config } : m
    ));
  };

  const handleClearConsole = (minerId) => {
    setMiners(prev => prev.map(m => 
      m.id === minerId ? { ...m, output: [] } : m
    ));
  };

  const handleDismissNotification = (notificationId) => {
    setNotifications(prev => prev.filter(n => n.id !== notificationId));
  };

  const handleStartAll = () => {
    miners.forEach(miner => {
      if (miner.enabled && !miner.running) {
        handleStartMiner(miner.id);
      }
    });
  };

  const handleStopAll = () => {
    miners.forEach(miner => {
      if (miner.running) {
        handleStopMiner(miner.id);
      }
    });
  };

  const handleToggleDevice = (minerId) => {
    setMiners(prev => prev.map(m =>
      m.id === minerId ? { ...m, enabled: !m.enabled } : m
    ));
  };

  const currentMiner = miners.find(m => m.id === selectedMiner);

  return (
    <ErrorBoundary>
      <div className="App">
        {/* Notification System */}
        <NotificationContainer 
          notifications={notifications}
          onDismiss={handleDismissNotification}
        />
        
        <header className="App-header">
          <h1>⛏️ MineMaster</h1>
          <p className="subtitle">Crypto Mining Manager</p>
        </header>

      <div className="App-content">
        <div className="sidebar">
          <h3>Navigation</h3>
          <div className="nav-list">
            <div
              className={`nav-item ${selectedView === 'dashboard' ? 'active' : ''}`}
              onClick={() => setSelectedView('dashboard')}
            >
              <span className="nav-icon">📊</span>
              <span className="nav-label">Dashboard</span>
            </div>
          </div>

          <h3>Miners</h3>
          <div className="miner-list">
            {miners.map(miner => (
              <div
                key={miner.id}
                className={`miner-item ${selectedView === miner.id ? 'active' : ''}`}
                onClick={() => {
                  setSelectedView(miner.id);
                  setSelectedMiner(miner.id);
                }}
              >
                <div className="miner-item-header">
                  <div className="miner-item-info">
                    <span className={`status-dot ${miner.running ? 'running' : 'stopped'}`}></span>
                    <span className="miner-name">{miner.name}</span>
                  </div>
                  <span className="device-type">{miner.deviceType}</span>
                </div>
                {miner.running && (
                  <div className="miner-hashrate">
                    {miner.hashrate ? (
                      <span className="hashrate-value">{formatHashrate(miner.hashrate)}</span>
                    ) : (
                      <span className="hashrate-calculating">Calculating...</span>
                    )}
                  </div>
                )}
                <span className="miner-type">{miner.type}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="main-content">
          {selectedView === 'dashboard' ? (
            <Dashboard
              miners={miners}
              onStartAll={handleStartAll}
              onStopAll={handleStopAll}
              onToggleDevice={handleToggleDevice}
              isBoundToMaster={isBoundToMaster}
              onBoundChange={handleBoundStateChange}
            />
          ) : (
            currentMiner && (
              <>
                {currentMiner.type === 'nanominer' ? (
                  <NanominerConfig
                    miner={currentMiner}
                    onConfigChange={(config) => handleConfigChange(currentMiner.id, config)}
                    onStart={() => handleStartMiner(currentMiner.id)}
                    onStop={() => handleStopMiner(currentMiner.id)}
                    isBoundToMaster={isBoundToMaster}
                  />
                ) : (
                  <MinerConfig
                    miner={currentMiner}
                    onConfigChange={(config) => handleConfigChange(currentMiner.id, config)}
                    onStart={() => handleStartMiner(currentMiner.id)}
                    onStop={() => handleStopMiner(currentMiner.id)}
                    isBoundToMaster={isBoundToMaster}
                  />
                )}
                
                <MinerConsole
                  minerId={currentMiner.id}
                  output={currentMiner.output}
                  running={currentMiner.running}
                  onClear={() => handleClearConsole(currentMiner.id)}
                />
              </>
            )
          )}
        </div>
      </div>
      </div>
    </ErrorBoundary>
  );
}

export default App;
