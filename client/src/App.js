import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import './App.css';
import Dashboard from './components/Dashboard';
import MinerConsole from './components/MinerConsole';
import MinerConfig from './components/MinerConfig';
import NanominerConfig from './components/NanominerConfig';
import ErrorBoundary from './components/ErrorBoundary';
import NotificationContainer from './components/NotificationContainer';
import { formatHashrate } from './utils/formatters';
import { validateMinerConfig } from './utils/validators';
import { addConsoleOutput } from './utils/consoleManager';
import { masterServer } from './services/masterServer';
import versionInfo from './version.json';
import { createLineBuffer, parseAggregate, parseShares, parseProcessDetails, processSnapshot } from './utils/telemetry';
import { createCommandRunner } from './utils/commandRunner';

function App() {
  const lineBuffers = useRef({});
  const commandRunnerRef = useRef(null);
  const controlRef = useRef({});
  const statusBusy = useRef(false);
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

  const [miners, setMinersState] = useState([
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
  const [updateStatus, setUpdateStatus] = useState({ state: 'idle' });
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
  const notificationIdRef = useRef(0);
  const sendImmediateStatusUpdateRef = useRef(null); // Ref for latest status update function
  const startStatusUpdatesRef = useRef(null); // Ref for latest start function
  const stopStatusUpdatesRef = useRef(null); // Ref for latest stop function
  
  // IPC, logs, and commands share a synchronous snapshot; React renders that same state.
  const setMiners = useCallback(update => {
    const next = typeof update === 'function' ? update(minersRef.current) : update;
    minersRef.current = next;
    setMinersState(next);
  }, []);

  // Keep clientName ref in sync
  useEffect(() => {
    clientNameRef.current = clientName;
    if (clientName) {
      localStorage.setItem('minemaster-client-name', clientName);
    } else {
      localStorage.removeItem('minemaster-client-name');
    }
  }, [clientName]);

  // Derive stable fingerprints so localStorage writes only fire when config/enabled actually change
  const configFingerprint = useMemo(() => {
    const obj = {};
    miners.forEach(m => { obj[m.id] = m.config; });
    return JSON.stringify(obj);
  }, [miners]);

  const enabledFingerprint = useMemo(() => {
    const obj = {};
    miners.forEach(m => { obj[m.id] = { enabled: m.enabled !== false }; });
    return JSON.stringify(obj);
  }, [miners]);

  // Save config to localStorage only when configs actually change
  useEffect(() => {
    localStorage.setItem('minemaster-config', configFingerprint);
  }, [configFingerprint]);

  // Persist miner enabled/disabled states only when toggle state changes
  useEffect(() => {
    localStorage.setItem('minemaster-miner-state', enabledFingerprint);
  }, [enabledFingerprint]);

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
              pid: status.pid, startTime: status.startedAt || null, activeConfig: status.activeConfig || null,
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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // After an auto-update restart, resume any miners that were running before the update.
  useEffect(() => {
    if (!window.electronAPI?.getUpdateResumeState) return;

    let cancelled = false;

    const resumeAfterUpdate = async () => {
      try {
        const resumeState = await window.electronAPI.getUpdateResumeState();
        if (cancelled || !resumeState?.minerIds?.length) return;

        addNotification('Resuming mining after update...', 'info');

        // Small delay to let the app fully initialize and configs load from localStorage
        await new Promise(r => setTimeout(r, 5000));
        if (cancelled) return;

        for (const minerId of resumeState.minerIds) {
          const miner = minersRef.current.find(m => m.id === minerId);
          if (miner && miner.enabled !== false && !miner.running) {
            await handleStartMiner(minerId);
          }
        }
      } catch (_) {}
    };

    resumeAfterUpdate();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // IPC listener cleanup; runs once on mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const cleanups = [];

    if (window.electronAPI) {
      cleanups.push(window.electronAPI.onMinerOutput((data) => {
        const read = lineBuffers.current[data.minerId] ||= createLineBuffer();
        const lines = read(data.data);
        let observation = null, shares = null, details = {};
        for (const line of lines) {
          const rate = parseAggregate(line); if (rate !== null) observation = { hashrate: rate, hashrateObservedAt: new Date().toISOString() };
          shares = parseShares(line) || shares;
          Object.assign(details, parseProcessDetails(line));
          masterServer.queueLog(data.minerId, line, /error|failed|fatal/i.test(line) ? 'error' : 'info');
        }
        setMiners(prev => prev.map(miner => miner.id === data.minerId ? {
          ...miner, ...details, ...(observation || {}), ...(shares ? { shares } : {}), output: addConsoleOutput(miner.output, data.data)
        } : miner));
      }));

      cleanups.push(window.electronAPI.onMinerError((data) => {
        masterServer.queueLog(data.minerId, data.error, 'error');
        masterServer.reportEvent('process-error', { processId: data.minerId, error: data.error });
        setMiners(prev => prev.map(miner => {
          if (miner.id === data.minerId) {
            const newOutput = addConsoleOutput(miner.output, `ERROR: ${data.error}\n`);
            return {
              ...miner,
              loading: false,
              error: data.error,
              output: newOutput
            };
          }
          return miner;
        }));
        
        // Add notification for error
        addNotification(`Miner Error: ${data.error}`, 'error');
      }));

      cleanups.push(window.electronAPI.onMinerClosed((data) => {
        delete lineBuffers.current[data.minerId];
        const unexpected = !data.expected && !stoppingMinersRef.current.has(data.minerId);
        masterServer.reportEvent('process-exit', { processId: data.minerId, code: data.code, signal: data.signal, unexpected });
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
              pid: null,
              error: unexpected ? `Process exited unexpectedly (${data.code ?? data.signal ?? 'unknown'})` : null,
              output: newOutput
            };
          }
          return miner;
        }));
        
        const isAbnormalCrash = unexpected;
        if (isAbnormalCrash && !stoppingMinersRef.current.has(data.minerId)) {
          const miner = minersRef.current.find(m => m.id === data.minerId);
          const minerName = miner?.name || 'Miner';
          addNotification(`${minerName} crashed unexpectedly (exit code ${data.code})`, 'error');
        }
        stoppingMinersRef.current.delete(data.minerId);
      }));

      // Auto-update status listener
      cleanups.push(window.electronAPI.onUpdateStatus((status) => {
        setUpdateStatus(status);
      }));
    }

    return () => cleanups.forEach(fn => { try { fn && fn(); } catch (_) {} });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Acknowledged commands run through one serialized queue per mining process.
  useEffect(() => {
    const runner = createCommandRunner({
      getMiners: () => minersRef.current,
      start: id => controlRef.current.start(id, true),
      stop: id => controlRef.current.stop(id, true),
      enable: (id, enabled) => controlRef.current.patch(id, { enabled }),
      applyConfigs: (configs, scope) => controlRef.current.apply(configs, true, scope),
      report: result => { masterServer.send({ type: 'command-result', data: result }); sendImmediateStatusUpdateRef.current?.(); },
      storage: localStorage
    });
    commandRunnerRef.current = runner;
    const onCommand = command => runner.execute(command);
    const onCancel = data => runner.cancel(data.id);
    const onConfig = configs => controlRef.current.apply(configs, true);
    masterServer.on('command', onCommand);
    masterServer.on('commandCancel', onCancel);
    masterServer.on('configUpdate', onConfig);
    return () => { runner.dispose(); masterServer.off('command', onCommand); masterServer.off('commandCancel', onCancel); masterServer.off('configUpdate', onConfig); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
  const patchMiner = (id, patch) => {
    minersRef.current = minersRef.current.map(m => m.id === id ? { ...m, ...patch } : m);
    setMiners(minersRef.current);
  };

  const applyGlobalConfigs = (globalConfigs, silent = false, scope = 'ALL') => {
    const next = minersRef.current.map(miner => {
      const globalConfig = globalConfigs?.[miner.type];
      if (!globalConfig || (scope !== 'ALL' && scope !== miner.deviceType)) return miner;
      const localKeys = ['password', 'rigName', 'gpus', 'customPath', 'donateLevel', 'email'];
      const local = Object.fromEntries(localKeys.filter(k => miner.config[k] !== undefined && miner.config[k] !== '').map(k => [k, miner.config[k]]));
      const config = { ...miner.config, ...globalConfig, ...local };
      return { ...miner, config, localOverrides: Object.keys(local).filter(k => JSON.stringify(local[k]) !== JSON.stringify(globalConfig[k])) };
    });
    minersRef.current = next; setMiners(next);
    if (!silent) addNotification('Desired configurations received; running processes keep their launch configuration until restarted', 'info');
  };

  // Helper to send immediate status update
  const sendImmediateStatusUpdate = async () => {
    if (!masterServer.isBound() || statusBusy.current) return;
    statusBusy.current = true;
    try {
      const [systemInfo, cpu, memory, gpus] = window.electronAPI ? await Promise.all([
        window.electronAPI.getSystemInfo().catch(() => null), window.electronAPI.getCpuStats().catch(() => null),
        window.electronAPI.getMemoryStats().catch(() => null), window.electronAPI.getGpuStats().catch(() => null)
      ]) : [null, null, null, null];
      await masterServer.sendStatusUpdate({
        systemInfo,
        stats: { observedAt: new Date().toISOString(), cpu, memory: memory ? { ...memory, usage: memory.usagePercent } : null,
          gpus: (gpus || []).map(g => ({ ...g, memoryUsed: g.memoryUsed ?? (g.vramUsed == null ? null : g.vramUsed * 1024 * 1024), memoryTotal: g.memoryTotal ?? (g.vramTotal == null ? null : g.vramTotal * 1024 * 1024) })) },
        processes: minersRef.current.map(m => processSnapshot(m)), clientName: clientNameRef.current || ''
      });
      masterServer.flushLogs();
    } catch (error) { console.warn('Status report failed:', error.message); }
    finally { statusBusy.current = false; }
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
  // Connection lifecycle is intentionally initialized once on app mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
              // Keep null unless explicit per-GPU hashrate is available.
              hashrate: null,
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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ============================================================
  // Reactive status sync - push updates immediately when mining state changes
  // This ensures server stays in sync even outside the 5-second interval
  // ============================================================
  const miningStateFingerprint = useMemo(() =>
    miners.map(m => `${m.id}:${m.running}:${m.enabled}:${m.hashrate ? 1 : 0}`).join('|'),
    [miners]
  );

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
      id: ++notificationIdRef.current,
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

  const handleStartMiner = async (minerId, remote = false) => {
    if (!remote) commandRunnerRef.current?.cancelProcess(minerId);
    const miner = minersRef.current.find(m => m.id === minerId);
    if (!miner) return { success: false, error: 'Unknown miner' };
    if (miner.enabled === false) return { success: false, error: 'Process is disabled' };
    if (miner.running) return { success: true, pid: miner.pid, alreadyRunning: true };
    if (miner.loading) return { success: false, error: 'Process operation already pending' };
    const validation = validateMinerConfig(miner.type, miner.config);
    if (!validation.valid) { patchMiner(minerId, { validationErrors: validation.errors }); addNotification(validation.errors[0], 'error'); return { success: false, error: validation.errors.join('; ') }; }
    patchMiner(minerId, { loading: true, validationErrors: [] });
    try {
      const activeConfig = { ...miner.config };
      const result = await window.electronAPI.startMiner({ minerId, minerType: miner.type, config: activeConfig });
      if (!result.success) throw Error(result.error || 'Start failed');
      delete lineBuffers.current[minerId];
      patchMiner(minerId, { running: true, loading: false, error: null, pid: result.pid, activeConfig: result.activeConfig || activeConfig, startTime: result.startedAt || Date.now(), hashrate: null, hashrateObservedAt: null, shares: null, pool: null, output: [`Started process (PID ${result.pid})\n`] });
      masterServer.reportEvent('process-started', { processId: minerId, pid: result.pid, appliedConfigVersion: activeConfig.version || null });
      addNotification(`${miner.name} started`, 'success'); sendImmediateStatusUpdateRef.current?.();
      return result;
    } catch (error) { patchMiner(minerId, { loading: false, error: error.message }); addNotification(`Start failed: ${error.message}`, 'error'); return { success: false, error: error.message }; }
  };

  const handleStopMiner = async (minerId, remote = false) => {
    if (!remote) commandRunnerRef.current?.cancelProcess(minerId);
    const miner = minersRef.current.find(m => m.id === minerId);
    if (!miner) return { success: false, error: 'Unknown miner' };
    stoppingMinersRef.current.add(minerId);
    patchMiner(minerId, { loading: true });
    try {
      const result = await window.electronAPI.stopMiner({ minerId });
      if (!result.success) throw Error(result.error || 'Stop could not be confirmed');
      patchMiner(minerId, { running: false, loading: false, hashrate: null, hashrateObservedAt: null, startTime: null, pid: null, error: null });
      addNotification(`${miner.name} stopped`, 'success'); sendImmediateStatusUpdateRef.current?.();
      return result;
    } catch (error) { patchMiner(minerId, { loading: false, error: error.message }); addNotification(`Stop failed: ${error.message}`, 'error'); return { success: false, error: error.message }; }
    finally { stoppingMinersRef.current.delete(minerId); }
  };
  controlRef.current = { start: handleStartMiner, stop: handleStopMiner, patch: patchMiner, apply: applyGlobalConfigs };

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
          <div className="header-main">
            <h1>⛏️ MineMaster</h1>
            <p className="subtitle">Crypto Mining Manager</p>
          </div>
          <div className="header-right">
            {updateStatus.state === 'downloading' && (
              <div className="update-indicator downloading">
                <span className="update-spinner"></span>
                Updating... {updateStatus.percent || 0}%
              </div>
            )}
            {updateStatus.state === 'downloaded' && (
              <div className="update-indicator restarting">
                <span className="update-spinner"></span>
                Restarting...
              </div>
            )}
            {updateStatus.state === 'available' && (
              <div className="update-indicator available">
                <span className="update-spinner"></span>
                Preparing update v{updateStatus.version}...
              </div>
            )}
            {updateStatus.state === 'error' && (
              <div className="update-indicator update-error">
                Update failed — retrying soon
              </div>
            )}
            <div className="app-version" title={`Base ${versionInfo.baseVersion} | Build ${versionInfo.buildMetadata}`}>
              v{versionInfo.displayVersion}
            </div>
          </div>
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
