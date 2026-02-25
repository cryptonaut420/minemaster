const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electron', {
  invoke: (channel, data) => ipcRenderer.invoke(channel, data),
  
  // Legacy methods (kept for backward compatibility)
  startMiner: (config) => ipcRenderer.invoke('start-miner', config),
  stopMiner: (config) => ipcRenderer.invoke('stop-miner', config),
  getMinerStatus: (config) => ipcRenderer.invoke('get-miner-status', config),
  getAllMinersStatus: () => ipcRenderer.invoke('get-all-miners-status'),
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
  getCpuStats: () => ipcRenderer.invoke('get-cpu-stats'),
  getMemoryStats: () => ipcRenderer.invoke('get-memory-stats'),
  getGpuStats: () => ipcRenderer.invoke('get-gpu-stats'),
  
  // Listeners for miner events (return cleanup function)
  onMinerOutput: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('miner-output', handler);
    return () => ipcRenderer.removeListener('miner-output', handler);
  },
  onMinerError: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('miner-error', handler);
    return () => ipcRenderer.removeListener('miner-error', handler);
  },
  onMinerClosed: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('miner-closed', handler);
    return () => ipcRenderer.removeListener('miner-closed', handler);
  }
});

// Also expose as electronAPI for backward compatibility
contextBridge.exposeInMainWorld('electronAPI', {
  startMiner: (config) => ipcRenderer.invoke('start-miner', config),
  stopMiner: (config) => ipcRenderer.invoke('stop-miner', config),
  getMinerStatus: (config) => ipcRenderer.invoke('get-miner-status', config),
  getAllMinersStatus: () => ipcRenderer.invoke('get-all-miners-status'),
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
  getCpuStats: () => ipcRenderer.invoke('get-cpu-stats'),
  getMemoryStats: () => ipcRenderer.invoke('get-memory-stats'),
  getGpuStats: () => ipcRenderer.invoke('get-gpu-stats'),
  
  // Listeners for miner events (return cleanup function)
  onMinerOutput: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('miner-output', handler);
    return () => ipcRenderer.removeListener('miner-output', handler);
  },
  onMinerError: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('miner-error', handler);
    return () => ipcRenderer.removeListener('miner-error', handler);
  },
  onMinerClosed: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('miner-closed', handler);
    return () => ipcRenderer.removeListener('miner-closed', handler);
  }
});
