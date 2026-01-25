import React, { useState, useEffect } from 'react';
import './App.css';
import Dashboard from './components/Dashboard';
import MinerConsole from './components/MinerConsole';
import MinerConfig from './components/MinerConfig';
import NanominerConfig from './components/NanominerConfig';
import { formatHashrate } from './utils/hashrate';

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
      hashrate: null,
      config: savedConfig?.['xmrig-1'] || {
        pool: '',
        user: '',
        password: 'x',
        algorithm: 'rx/0',
        threads: 0,
        threadPercentage: 100, // 100% = use all threads (0 in config)
        donateLevel: 0,
        customPath: '',
        additionalArgs: ''
      },
      output: []
    },
    {
      id: 'nanominer-1',
      name: 'Nanominer GPU',
      type: 'nanominer',
      deviceType: 'GPU',
      running: false,
      enabled: true,
      hashrate: null,
      config: savedConfig?.['nanominer-1'] || {
        algorithm: 'ethash',
        pool: '',
        user: '',
        rigName: '',
        email: '',
        gpus: [], // Empty = use all GPUs
        customPath: ''
      },
      output: []
    }
  ]);

  const [selectedView, setSelectedView] = useState('dashboard');
  const [selectedMiner, setSelectedMiner] = useState('xmrig-1');

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

  useEffect(() => {
    // Set up listeners for miner events
    if (window.electronAPI) {
      window.electronAPI.onMinerOutput((data) => {
        setMiners(prev => prev.map(miner => {
          if (miner.id === data.minerId) {
            // Parse hashrate from output
            let newHashrate = miner.hashrate;
            
            // XMRig format: "speed 10s/60s/15m ... H/s"
            const xmrigPattern = /([\d.]+)\s*(H\/s|kH\/s|KH\/s|MH\/s|GH\/s|TH\/s)/i;
            
            // Nanominer format: "Total: 25.5 Mh/s" or "GPU0: 12.3 Mh/s"
            const nanominerPattern = /Total:\s*([\d.]+)\s*(H\/s|kH\/s|KH\/s|MH\/s|Mh\/s|GH\/s|TH\/s)/i;
            
            let match = data.data.match(xmrigPattern) || data.data.match(nanominerPattern);
            
            if (match) {
              const value = parseFloat(match[1]);
              const unit = match[2].toLowerCase();
              
              // Convert to base H/s for storage
              let baseHashrate = value;
              switch (unit) {
                case 'kh/s':
                  baseHashrate = value * 1000;
                  break;
                case 'mh/s':
                  baseHashrate = value * 1000000;
                  break;
                case 'gh/s':
                  baseHashrate = value * 1000000000;
                  break;
                case 'th/s':
                  baseHashrate = value * 1000000000000;
                  break;
              }
              
              newHashrate = baseHashrate;
            }
            
            return {
              ...miner,
              running: true,
              hashrate: newHashrate,
              output: [...miner.output, data.data]
            };
          }
          return miner;
        }));
      });

      window.electronAPI.onMinerError((data) => {
        setMiners(prev => prev.map(miner => {
          if (miner.id === data.minerId) {
            return {
              ...miner,
              output: [...miner.output, `ERROR: ${data.error}\n`]
            };
          }
          return miner;
        }));
      });

      window.electronAPI.onMinerClosed((data) => {
        setMiners(prev => prev.map(miner => {
          if (miner.id === data.minerId) {
            return {
              ...miner,
              running: false,
              hashrate: null,
              output: [...miner.output, `\nMiner exited with code: ${data.code}\n`]
            };
          }
          return miner;
        }));
      });
    }
  }, []);

  const handleStartMiner = async (minerId) => {
    const miner = miners.find(m => m.id === minerId);
    if (!miner) return;

    const result = await window.electronAPI.startMiner({
      minerId: miner.id,
      minerType: miner.type,
      config: miner.config
    });

    if (result.success) {
      setMiners(prev => prev.map(m => 
        m.id === minerId ? { ...m, running: true, output: [`Starting miner (PID: ${result.pid})...\n`] } : m
      ));
    } else {
      setMiners(prev => prev.map(m => 
        m.id === minerId ? { ...m, output: [...m.output, `Failed to start: ${result.error}\n`] } : m
      ));
    }
  };

  const handleStopMiner = async (minerId) => {
    const result = await window.electronAPI.stopMiner({ minerId });
    
    if (result.success) {
      setMiners(prev => prev.map(m => 
        m.id === minerId ? { ...m, running: false } : m
      ));
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
    <div className="App">
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
  );
}

export default App;
