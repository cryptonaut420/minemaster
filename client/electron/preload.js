const { contextBridge, ipcRenderer } = require('electron');

// Allowed IPC channels — prevents renderer from calling arbitrary handlers
const ALLOWED_INVOKE_CHANNELS = [
  'start-miner',
  'stop-miner',
  'get-miner-status',
  'get-all-miners-status',
  'get-system-info',
  'get-cpu-stats',
  'get-memory-stats',
  'get-gpu-stats',
  'get-mac-address',
  'load-master-config',
  'save-master-config',
  'check-for-update',
  'get-update-status',
  'get-update-resume-state'
];

function safeInvoke(channel, data) {
  if (!ALLOWED_INVOKE_CHANNELS.includes(channel)) {
    return Promise.reject(new Error(`IPC channel not allowed: ${channel}`));
  }
  return ipcRenderer.invoke(channel, data);
}

function createListenerFactory(channel) {
  return (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, data) => callback(data);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  };
}

const api = {
  invoke: safeInvoke,
  startMiner: (config) => safeInvoke('start-miner', config),
  stopMiner: (config) => safeInvoke('stop-miner', config),
  getMinerStatus: (config) => safeInvoke('get-miner-status', config),
  getAllMinersStatus: () => safeInvoke('get-all-miners-status'),
  getSystemInfo: () => safeInvoke('get-system-info'),
  getCpuStats: () => safeInvoke('get-cpu-stats'),
  getMemoryStats: () => safeInvoke('get-memory-stats'),
  getGpuStats: () => safeInvoke('get-gpu-stats'),
  onMinerOutput: createListenerFactory('miner-output'),
  onMinerError: createListenerFactory('miner-error'),
  onMinerClosed: createListenerFactory('miner-closed'),
  // Auto-update
  checkForUpdate: () => safeInvoke('check-for-update'),
  getUpdateStatus: () => safeInvoke('get-update-status'),
  getUpdateResumeState: () => safeInvoke('get-update-resume-state'),
  onUpdateStatus: createListenerFactory('update-status')
};

// Expose as both 'electron' and 'electronAPI' for backward compatibility
contextBridge.exposeInMainWorld('electron', api);
contextBridge.exposeInMainWorld('electronAPI', api);
