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
  
  // Listeners for miner events
  onMinerOutput: (callback) => {
    ipcRenderer.on('miner-output', (event, data) => callback(data));
  },
  onMinerError: (callback) => {
    ipcRenderer.on('miner-error', (event, data) => callback(data));
  },
  onMinerClosed: (callback) => {
    ipcRenderer.on('miner-closed', (event, data) => callback(data));
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
  
  // Listeners for miner events
  onMinerOutput: (callback) => {
    ipcRenderer.on('miner-output', (event, data) => callback(data));
  },
  onMinerError: (callback) => {
    ipcRenderer.on('miner-error', (event, data) => callback(data));
  },
  onMinerClosed: (callback) => {
    ipcRenderer.on('miner-closed', (event, data) => callback(data));
  }
});
