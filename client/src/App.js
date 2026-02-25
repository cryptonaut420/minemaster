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
      // Silently fail - will use defaults
    }
    return null;
  };

  // Load saved miner state (enabled/disabled toggles)
  const loadSavedMinerState = () => {
    try {
      const saved = localStorage.getItem('minemaster-miner-state');
      if (saved) {
        const parsed = JSON.parse(saved);
        return parsed && typeof parsed === 'object' ? parsed : null;
      }
    } catch (error) {
      // Silently fail - will use defaults
    }
    return null;
  };

  const savedConfig = loadSavedConfig();
  const savedMinerState = loadSavedMinerState();

  const [miners, setMiners] = useState([
    {
      id: 'xmrig-1',
      name: 'XMRig CPU Miner',
      type: 'xmrig',
      deviceType: 'CPU',
      running: false,
      enabled: savedMinerState?.['xmrig-1']?.enabled !== false,
      loading: false,
      hashrate: null,
      startTime: null,
      config: savedConfig?.['xmrig-1'] || {
        pool: '',
        user: '',
        password: '',
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
      enabled: savedMinerState?.['nanominer-1']?.enabled !== false,
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
  const [clientName, setClientName] = useState(() => {
    return localStorage.getItem('minemaster-client-name') || '';
  });
  const clientNameRef = useRef(clientName);
  const statusUpdateInterval = useRef(null);
  const minersRef = useRef(miners); // Keep a ref to always have latest miners
  const stoppingMinersRef = useRef(new Set()); // Track miners being intentionally stopped
  const sendImmediateStatusUpdateRef = useRef(null); // Ref for latest status update function
  const startStatusUpdatesRef = useRef(null); // Ref for latest start function
  const stopStatusUpdatesRef = useRef(null); // Ref for latest stop function
  
  // Update ref whenever miners changes
  useEffect(() => {
    minersRef.current = miners;
  }, [miners]);

  // Keep clientName ref in sync
  useEffect(() => {
    clientNameRef.current = clientName;
    if (clientName) {
      localStorage.setItem('minemaster-client-name', clientName);
    } else {
      localStorage.removeItem('minemaster-client-name');
    }
  }, [clientName]);

  // Save config to localStorage whenever it changes
  useEffect(() => {
    const configToSave = {};
    miners.forEach(miner => {
      configToSave[miner.id] = miner.config;
    });
    localStorage.setItem('minemaster-config', JSON.stringify(configToSave));
  }, [miners]);

  // Persist miner enabled/disabled states independently from miner config
  useEffect(() => {
    const stateToSave = {};
    miners.forEach(miner => {
      stateToSave[miner.id] = {
        enabled: miner.enabled !== false
      };
    });
    localStorage.setItem('minemaster-miner-state', JSON.stringify(stateToSave));
  }, [miners]);

  // Check for running miners and GPU detection on mount only (not periodically)
  useEffect(() => {
    const checkRunningMiners = async () => {
      if (!window.electronAPI) return;
      
      try {
        const statuses = await window.electronAPI.getAllMinersStatus();
        const systemInfo = await window.electronAPI.getSystemInfo();
        
        // Only treat as "no GPU" when detection is definitively complete.
        const hasGpu = systemInfo?.gpus && Array.isArray(systemInfo.gpus) && systemInfo.gpus.length > 0;
        const gpuDetectionComplete = systemInfo?.gpuDetectionStatus === 'complete';
        
        setMiners(prev => prev.map(miner => {
          const status = statuses[miner.id];
          let updatedMiner = { ...miner };
          
          // Reconnect to running miners
          if (status && status.running) {
            updatedMiner = {
              ...updatedMiner,
              running: true,
              output: [`[Reconnected to running miner - PID: ${status.pid}]\n`, ...miner.output]
            };
          }
          
          // Disable GPU miner only after a definitive "no GPU" result.
          if (miner.deviceType === 'GPU' && gpuDetectionComplete && !hasGpu) {
            updatedMiner = {
              ...updatedMiner,
              enabled: false
            };
          }
          
          return updatedMiner;
        }));
      } catch (error) {
        // Silent fail on initial check - miner state will be updated via events
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
            const exitMessage = `\nMiner exited with code: ${data.code ?? 'null'}\n`;
            const newOutput = addConsoleOutput(miner.output, exitMessage);
            
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
        
        // Only show crash notifications for genuinely unusual exit codes
        // Normal/expected exit codes that should NOT trigger notifications:
        // null/undefined = process killed/terminated, 0 = clean exit
        // 130 = Ctrl+C (SIGINT), 143 = SIGTERM, 137 = SIGKILL, 1 = general error but often from manual stop
        const normalExitCodes = [null, undefined, 0, 1, 130, 143, 137];
        const isAbnormalCrash = data.code !== null && 
                                data.code !== undefined && 
                                !normalExitCodes.includes(data.code) &&
                                data.code > 1;
        
        if (isAbnormalCrash) {
          const miner = minersRef.current.find(m => m.id === data.minerId);
          const minerName = miner?.name || 'Miner';
          addNotification(`${minerName} crashed unexpectedly (exit code ${data.code})`, 'error');
        }
      });
    }
  }, []);

  // Master Server Integration - Command and Config Handlers
  useEffect(() => {
    // Only handle commands and config updates here
    // Bound/unbound is handled via Dashboard -> MasterServerPanel -> onBoundChange callback
    
    const handleConfigUpdate = (configs) => {
      applyGlobalConfigs(configs, false); // Show notification for active updates
      addNotification('Configurations updated from Master Server', 'info');
    };

    const handleCommand = async (command) => {
      
      // Use ref to get latest miners state (avoid stale closure)
      const currentMiners = minersRef.current;
      
      switch (command.action) {
        case 'start':
          if (command.minerId) {
            await handleStartMiner(command.minerId);
          } else if (command.deviceType) {
            const miner = currentMiners.find(m => m.deviceType === command.deviceType);
            if (miner) await handleStartMiner(miner.id);
          } else {
            // Start all ENABLED miners only
            for (const miner of currentMiners) {
              if (miner.enabled !== false && !miner.running) {
                await handleStartMiner(miner.id);
              }
            }
          }
          break;
          
        case 'stop':
          if (command.minerId) {
            await handleStopMiner(command.minerId);
          } else if (command.deviceType) {
            const miner = currentMiners.find(m => m.deviceType === command.deviceType);
            if (miner) await handleStopMiner(miner.id);
          } else {
            // Stop all running miners
            for (const miner of currentMiners) {
              if (miner.running) {
                await handleStopMiner(miner.id);
              }
            }
          }
          break;
          
        case 'restart':
          if (command.minerId) {
            stoppingMinersRef.current.add(command.minerId);
            await handleStopMiner(command.minerId);
            setTimeout(() => handleStartMiner(command.minerId), 2000);
          } else {
            // Stop all, then start all enabled
            for (const miner of currentMiners) {
              if (miner.running) {
                stoppingMinersRef.current.add(miner.id);
                await handleStopMiner(miner.id);
              }
            }
            setTimeout(async () => {
              const latestMiners = minersRef.current;
              for (const miner of latestMiners) {
                if (miner.enabled !== false && !miner.running) {
                  await handleStartMiner(miner.id);
                }
              }
            }, 2000);
          }
          break;
        
        case 'restart-device':
          {
            // Restart only specific device type (CPU or GPU)
            const deviceType = command.deviceType; // 'CPU' or 'GPU'
            const targetMiner = currentMiners.find(m => m.deviceType === deviceType);
            
            if (targetMiner && targetMiner.running) {
              const minerId = targetMiner.id; // Capture ID for closure
              stoppingMinersRef.current.add(minerId);
              await handleStopMiner(minerId);
              
              // Restart after 2 seconds if still enabled
              setTimeout(async () => {
                const latestMiners = minersRef.current;
                const currentMiner = latestMiners.find(m => m.id === minerId);
                if (currentMiner && currentMiner.enabled !== false) {
                  await handleStartMiner(minerId);
                  addNotification(`${deviceType} mining restarted with new configuration`, 'success');
                }
              }, 2000);
            } else if (targetMiner && !targetMiner.running) {
              addNotification(`${deviceType} configuration updated`, 'info');
            }
          }
          break;
        
        // Device enable/disable commands (from server toggle switches)
        case 'device-enable':
          {
            if (command.deviceType === 'cpu') {
              const cpuMiner = currentMiners.find(m => m.deviceType === 'CPU');
              if (cpuMiner) {
                setMiners(prev => prev.map(m => 
                  m.id === cpuMiner.id ? { ...m, enabled: true } : m
                ));
                addNotification('CPU mining enabled (remote command)', 'info');
              }
            } else if (command.deviceType === 'gpu') {
              const gpuMiner = currentMiners.find(m => m.deviceType === 'GPU');
              if (gpuMiner) {
                setMiners(prev => prev.map(m => 
                  m.id === gpuMiner.id ? { ...m, enabled: true } : m
                ));
                addNotification('GPU mining enabled (remote command)', 'info');
              }
            }
          }
          break;
          
        case 'device-disable':
          {
            if (command.deviceType === 'cpu') {
              const cpuMiner = currentMiners.find(m => m.deviceType === 'CPU');
              if (cpuMiner) {
                setMiners(prev => prev.map(m => 
                  m.id === cpuMiner.id ? { ...m, enabled: false } : m
                ));
                // Stop mining if running
                if (cpuMiner.running) {
                  addNotification('CPU mining disabled and stopped (remote command)', 'info');
                  await handleStopMiner(cpuMiner.id);
                } else {
                  addNotification('CPU mining disabled (remote command)', 'info');
                }
              }
            } else if (command.deviceType === 'gpu') {
              const gpuMiner = currentMiners.find(m => m.deviceType === 'GPU');
              if (gpuMiner) {
                setMiners(prev => prev.map(m => 
                  m.id === gpuMiner.id ? { ...m, enabled: false } : m
                ));
                // Stop mining if running
                if (gpuMiner.running) {
                  addNotification('GPU mining disabled and stopped (remote command)', 'info');
                  await handleStopMiner(gpuMiner.id);
                } else {
                  addNotification('GPU mining disabled (remote command)', 'info');
                }
              }
            }
          }
          break;
        
        // Device-specific start/stop commands (legacy, for direct control)
        case 'start-cpu':
          {
            const cpuMiner = currentMiners.find(m => m.deviceType === 'CPU');
            if (cpuMiner && cpuMiner.enabled !== false && !cpuMiner.running) {
              addNotification('Starting CPU mining (remote command)', 'info');
              await handleStartMiner(cpuMiner.id);
            }
          }
          break;
          
        case 'stop-cpu':
          {
            const cpuMiner = currentMiners.find(m => m.deviceType === 'CPU');
            if (cpuMiner && cpuMiner.running) {
              addNotification('Stopping CPU mining (remote command)', 'info');
              await handleStopMiner(cpuMiner.id);
            }
          }
          break;
          
        case 'start-gpu':
          {
            const gpuMiner = currentMiners.find(m => m.deviceType === 'GPU');
            if (gpuMiner && gpuMiner.enabled !== false && !gpuMiner.running) {
              addNotification('Starting GPU mining (remote command)', 'info');
              await handleStartMiner(gpuMiner.id);
            }
          }
          break;
          
        case 'stop-gpu':
          {
            const gpuMiner = currentMiners.find(m => m.deviceType === 'GPU');
            if (gpuMiner && gpuMiner.running) {
              addNotification('Stopping GPU mining (remote command)', 'info');
              await handleStopMiner(gpuMiner.id);
            }
          }
          break;
          
        default:
          // Unknown command - ignore silently
      }
    };

    masterServer.on('configUpdate', handleConfigUpdate);
    masterServer.on('command', handleCommand);

    return () => {
      masterServer.off('configUpdate', handleConfigUpdate);
      masterServer.off('command', handleCommand);
    };
  }, [miners]); // Include miners for command handlers

  // Handle explicit unbind from MasterServerPanel UI
  const handleUnbindFromUI = async () => {
    try {
      await masterServer.unbind();
      // 'unbound' event will be caught by the connection management effect below
    } catch (err) {
      addNotification(`Failed to unbind: ${err.message}`, 'error');
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

  // Helper to send immediate status update
  const sendImmediateStatusUpdate = async () => {
    if (!masterServer.isBound()) return;
    
    try {
      // Get system info and stats
      const [systemInfo, cpuStats, memoryStats, gpuStats] = window.electronAPI 
        ? await Promise.all([
            window.electronAPI.getSystemInfo(),
            window.electronAPI.getCpuStats().catch(() => null),
            window.electronAPI.getMemoryStats().catch(() => null),
            window.electronAPI.getGpuStats().catch(() => null)
          ])
        : [null, null, null, null];
      
      // Build stats object for server
      const stats = {
        cpu: cpuStats ? {
          usage: cpuStats.usage ?? null,
          temperature: cpuStats.temperature ?? null
        } : { usage: null, temperature: null },
        memory: memoryStats ? {
          used: memoryStats.used ?? null,
          total: memoryStats.total ?? null,
          usagePercent: memoryStats.usagePercent ?? null
        } : { used: null, total: null, usagePercent: null },
        gpus: gpuStats && Array.isArray(gpuStats) && gpuStats.length > 0 ? gpuStats.map(gpu => ({
          usage: gpu.usage ?? null,
          temperature: gpu.temperature ?? null,
          vramUsed: gpu.vramUsed ?? null,
          vramTotal: gpu.vramTotal ?? null
        })) : []
      };
      
      // Find CPU and GPU miners - use latest state from ref
      const currentMiners = minersRef.current;
      const cpuMiner = currentMiners.find(m => m.deviceType === 'CPU');
      const gpuMiner = currentMiners.find(m => m.deviceType === 'GPU');
      
      // Build device states for the server
      const devices = {
        cpu: {
          enabled: cpuMiner?.enabled !== false,
          running: cpuMiner?.running || false,
          hashrate: cpuMiner?.running ? cpuMiner.hashrate : null,
          algorithm: cpuMiner?.config?.algorithm || null
        },
        gpus: []
      };
      
      // Add GPU states if available
      if (systemInfo?.gpus && Array.isArray(systemInfo.gpus) && systemInfo.gpus.length > 0) {
        devices.gpus = systemInfo.gpus.map((gpu, idx) => ({
          id: idx,
          model: gpu.model || gpu.name || `GPU ${idx}`,
          enabled: gpuMiner?.enabled !== false,
          running: gpuMiner?.running || false,
          hashrate: gpuMiner?.running ? gpuMiner.hashrate : null,
          algorithm: gpuMiner?.config?.algorithm || null
        }));
      }
      
      // Collect miner statuses
      const minerStatuses = currentMiners.map(m => ({
        id: m.id,
        type: m.type,
        deviceType: m.deviceType,
        running: m.running,
        enabled: m.enabled !== false,
        hashrate: m.running ? m.hashrate : null,
        algorithm: m.config.algorithm,
        coin: m.config.coin
      }));

      // Send status update (include custom name if set)
      await masterServer.sendStatusUpdate({
        systemInfo,
        stats,
        miners: minerStatuses,
        devices,
        mining: currentMiners.some(m => m.running),
        clientName: clientNameRef.current || ''
      });

      // Send hashrate updates for running miners
      currentMiners.forEach(async (miner) => {
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
      // Silent fail - status updates are periodic anyway
    }
  };

  // Keep refs updated to the latest function versions (avoids stale closures in intervals/effects)
  sendImmediateStatusUpdateRef.current = sendImmediateStatusUpdate;

  // Start periodic status updates to server
  const startStatusUpdates = () => {
    stopStatusUpdates(); // Clear any existing interval
    
    // Send immediately via ref (always latest)
    sendImmediateStatusUpdateRef.current?.();
    
    // Use ref wrapper so the interval always calls the latest function version
    statusUpdateInterval.current = setInterval(() => {
      sendImmediateStatusUpdateRef.current?.();
    }, 5000);
  };

  // Stop periodic status updates
  const stopStatusUpdates = () => {
    if (statusUpdateInterval.current) {
      clearInterval(statusUpdateInterval.current);
      statusUpdateInterval.current = null;
    }
  };

  // Keep refs updated for use inside useEffects
  startStatusUpdatesRef.current = startStatusUpdates;
  stopStatusUpdatesRef.current = stopStatusUpdates;

  // ============================================================
  // Master Server Connection Management (global, persists across all views)
  // This runs at the App level so it never unmounts when navigating between views
  // ============================================================
  useEffect(() => {
    // Build device states from current miners for server registration
    const getDeviceStatesForServer = async () => {
      const currentMiners = minersRef.current;
      const cpuMiner = currentMiners.find(m => m.deviceType === 'CPU');
      const gpuMiner = currentMiners.find(m => m.deviceType === 'GPU');
      
      let sysInfo = null;
      if (window.electronAPI) {
        sysInfo = await window.electronAPI.getSystemInfo();
      }
      
      const devices = {
        cpu: {
          enabled: cpuMiner?.enabled !== false,
          running: cpuMiner?.running || false,
          hashrate: cpuMiner?.hashrate || null,
          algorithm: cpuMiner?.config?.algorithm || null
        },
        gpus: sysInfo?.gpus && Array.isArray(sysInfo.gpus)
          ? sysInfo.gpus.map((gpu, idx) => ({
              id: idx,
              model: gpu.model || `GPU ${idx}`,
              enabled: gpuMiner?.enabled !== false,
              running: gpuMiner?.running || false,
              hashrate: gpuMiner?.hashrate || null,
              algorithm: gpuMiner?.config?.algorithm || null
            }))
          : []
      };
      
      return { devices, systemInfo: sysInfo };
    };

    // Handle WebSocket reconnection - re-register if was previously bound
    const handleConnected = async () => {
      const wasBound = localStorage.getItem('master-server-bound') === 'true';
      if (wasBound) {
        try {
          const { devices, systemInfo } = await getDeviceStatesForServer();
          if (systemInfo) {
            const name = localStorage.getItem('minemaster-client-name') || '';
            await masterServer.bind(systemInfo, true, devices, name); // silent = true for reconnect
          }
        } catch (err) {
          // Silent fail - will retry on next reconnect
        }
      }
    };

    // Handle successful bind (explicit user action from MasterServerPanel)
    const handleBound = (data) => {
      setIsBoundToMaster(true);
      localStorage.setItem('master-server-bound', 'true');
      addNotification('Bound to Master Server', 'success');
      
      // Apply global configs if provided
      if (data?.configs) {
        applyGlobalConfigs(data.configs, false);
      } else {
        setTimeout(() => {
          if (masterServer.isBound()) {
            masterServer.requestConfigs();
          }
        }, 500);
      }
      
      startStatusUpdatesRef.current?.();
    };

    // Handle silent re-registration (auto-reconnect)
    const handleRegistered = (data) => {
      setIsBoundToMaster(true);
      localStorage.setItem('master-server-bound', 'true');
      
      // Apply configs if provided with registration
      if (data?.configs) {
        applyGlobalConfigs(data.configs, true); // silent
      }
      
      startStatusUpdatesRef.current?.();
    };

    // Handle unbound (from user action or server)
    const handleUnbound = () => {
      setIsBoundToMaster(false);
      localStorage.removeItem('master-server-bound');
      addNotification('Unbound from Master Server', 'info');
      stopStatusUpdatesRef.current?.();
    };

    masterServer.on('connected', handleConnected);
    masterServer.on('bound', handleBound);
    masterServer.on('registered', handleRegistered);
    masterServer.on('unbound', handleUnbound);

    // Initial connection on app start if was previously bound
    const initConnection = async () => {
      const wasBound = localStorage.getItem('master-server-bound') === 'true';
      if (wasBound) {
        try {
          const config = await masterServer.loadConfig();
          if (config?.enabled) {
            await masterServer.connect();
            // 'connected' handler will fire and handle registration
          }
        } catch (err) {
          // Silent fail - user can manually rebind from MasterServerPanel
        }
      }
    };

    initConnection();

    return () => {
      masterServer.off('connected', handleConnected);
      masterServer.off('bound', handleBound);
      masterServer.off('registered', handleRegistered);
      masterServer.off('unbound', handleUnbound);
      stopStatusUpdatesRef.current?.();
    };
  }, []); // Run once on mount - persists for entire app lifecycle

  // ============================================================
  // Reactive status sync - push updates immediately when mining state changes
  // This ensures server stays in sync even outside the 5-second interval
  // ============================================================
  const miningStateFingerprint = miners.map(m => 
    `${m.id}:${m.running}:${m.enabled}:${m.hashrate ? 1 : 0}`
  ).join('|');

  useEffect(() => {
    if (!masterServer.isBound()) return;
    
    // Debounce slightly to batch rapid state changes
    const timer = setTimeout(() => {
      sendImmediateStatusUpdateRef.current?.();
    }, 500);
    
    return () => clearTimeout(timer);
  }, [miningStateFingerprint]); // eslint-disable-line react-hooks/exhaustive-deps

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
    // Use ref to get latest miners state (avoid stale closure)
    const currentMiners = minersRef.current;
    const miner = currentMiners.find(m => m.id === minerId);
    if (!miner) return;

    // Prevent starting if disabled
    if (miner.enabled === false) {
      addNotification(`${miner.name} is disabled. Enable it first.`, 'warning');
      return;
    }

    // Prevent starting if already running or loading
    if (miner.running || miner.loading) {
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
        
        // Send immediate status update to master server
        setTimeout(() => sendImmediateStatusUpdateRef.current?.(), 500);
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
        
        // Send immediate status update to master server
        setTimeout(() => sendImmediateStatusUpdateRef.current?.(), 500);
      } else {
        setMiners(prev => prev.map(m => 
          m.id === minerId ? { ...m, loading: false, running: false } : m
        ));
        addNotification(`Failed to stop ${miner.name}: ${result.error || 'Unknown error'}`, 'error');
      }
    } catch (error) {
      setMiners(prev => prev.map(m => 
        m.id === minerId ? { ...m, loading: false, running: false } : m
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

  const handleToggleDevice = async (minerId) => {
    const miner = miners.find(m => m.id === minerId);
    if (!miner) return;
    
    // Calculate new enabled state
    const newEnabledState = !miner.enabled;
    
    // Optimistic UI update - update immediately for responsive feel
    setMiners(prev => prev.map(m =>
      m.id === minerId ? { ...m, enabled: newEnabledState } : m
    ));
    
    // Send immediate status update to master server after toggle
    setTimeout(() => sendImmediateStatusUpdateRef.current?.(), 100);
    
    // Prevent enabling GPU if no GPU detected (validate async in background)
    if (miner.deviceType === 'GPU' && newEnabledState) {
      if (!window.electronAPI) {
        addNotification('Cannot enable GPU: System info unavailable', 'error');
        // Revert the optimistic update
        setMiners(prev => prev.map(m =>
          m.id === minerId ? { ...m, enabled: false } : m
        ));
        return;
      }
      
      try {
        const systemInfo = await window.electronAPI.getSystemInfo();
        
        const hasGpu = systemInfo?.gpus &&
                       Array.isArray(systemInfo.gpus) &&
                       systemInfo.gpus.length > 0 &&
                       systemInfo.gpus.some(gpu => {
                         if (!gpu) return false;
                         const model = (gpu.model || gpu.name || '').toLowerCase();
                         return model &&
                                !model.includes('no gpu') &&
                                !model.includes('detected') &&
                                model.trim().length > 0;
                       });
        const gpuDetectionComplete = systemInfo?.gpuDetectionStatus === 'complete';
        
        if (gpuDetectionComplete && !hasGpu) {
          // No GPU detected - revert the optimistic update
          addNotification('Cannot enable GPU mining: No GPU detected', 'warning');
          setMiners(prev => prev.map(m =>
            m.id === minerId ? { ...m, enabled: false } : m
          ));
          return;
        }
      } catch (error) {
        addNotification('Error validating GPU status', 'error');
        // Revert on error
        setMiners(prev => prev.map(m =>
          m.id === minerId ? { ...m, enabled: false } : m
        ));
        return;
      }
    }
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
              onUnbind={handleUnbindFromUI}
              clientName={clientName}
              onClientNameChange={setClientName}
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
                    defaultWorkerName={clientName}
                  />
                ) : (
                  <MinerConfig
                    miner={currentMiner}
                    onConfigChange={(config) => handleConfigChange(currentMiner.id, config)}
                    onStart={() => handleStartMiner(currentMiner.id)}
                    onStop={() => handleStopMiner(currentMiner.id)}
                    isBoundToMaster={isBoundToMaster}
                    defaultWorkerName={clientName}
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
