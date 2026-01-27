import React, { useState, useEffect } from 'react';
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
        addNotification(`${miner.name} stopped`, 'info');
      } else {
        setMiners(prev => prev.map(m => 
          m.id === minerId ? { ...m, loading: false } : m
        ));
        addNotification(`Failed to stop ${miner.name}`, 'error');
      }
    } catch (error) {
      setMiners(prev => prev.map(m => 
        m.id === minerId ? { ...m, loading: false } : m
      ));
      addNotification(`Error stopping miner: ${error.message}`, 'error');
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
                  />
                ) : (
                  <MinerConfig
                    miner={currentMiner}
                    onConfigChange={(config) => handleConfigChange(currentMiner.id, config)}
                    onStart={() => handleStartMiner(currentMiner.id)}
                    onStop={() => handleStopMiner(currentMiner.id)}
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
