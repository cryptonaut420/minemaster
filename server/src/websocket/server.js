const Miner = require('../models/Miner');
const HashRate = require('../models/HashRate');
const { v4: uuidv4 } = require('uuid');

let wss = null;
const connections = new Map(); // connectionId -> { ws, minerId }

function isLikelyIntegratedGpu(gpu = {}) {
  const model = (gpu.model || gpu.name || '').toLowerCase();
  const vendor = (gpu.vendor || '').toLowerCase();

  if (vendor.includes('intel') && !model.includes('arc')) return true;
  if (
    (vendor.includes('amd') || vendor.includes('ati')) &&
    (model.includes('radeon graphics') ||
      model.includes('vega') ||
      model.includes('renoir') ||
      model.includes('cezanne') ||
      model.includes('lucienne') ||
      model.includes('raphael'))
  ) {
    return true;
  }
  if (
    vendor.includes('microsoft') ||
    model.includes('basic display') ||
    model.includes('virtual') ||
    model.includes('integrated')
  ) {
    return true;
  }
  return false;
}

function normalizeGpuList(gpus = []) {
  const seen = new Set();
  return (Array.isArray(gpus) ? gpus : [])
    .filter(Boolean)
    .filter((gpu) => !isLikelyIntegratedGpu(gpu))
    .filter((gpu) => !gpu.vram || gpu.vram > 512)
    .filter((gpu) => {
      const key = `${(gpu.vendor || '').toLowerCase()}|${(gpu.model || gpu.name || '').toLowerCase()}`;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

// Stale-connection reaper interval (cleaned up on shutdown)
let staleConnectionTimer = null;
const STALE_CONNECTION_MS = 90000; // 90 seconds without a heartbeat

function initialize(webSocketServer) {
  wss = webSocketServer;
  
  wss.on('connection', (ws, req) => {
    const connectionId = uuidv4();
    const ip = req.socket.remoteAddress || 
               req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
               req.connection?.remoteAddress || 
               'unknown';
    connections.set(connectionId, { ws, minerId: null, ip, lastSeen: Date.now() });
    
    ws.send(JSON.stringify({
      type: 'connected',
      connectionId
    }));
    
    ws.on('message', async (message) => {
      try {
        const conn = connections.get(connectionId);
        if (conn) conn.lastSeen = Date.now();

        const data = JSON.parse(message);
        await handleMessage(connectionId, data);
      } catch (error) {
        sendToConnection(connectionId, {
          type: 'error',
          error: error.message
        });
      }
    });
    
    // Guard: only the first of close/error should trigger disconnect logic
    let disconnected = false;
    const safeDisconnect = async () => {
      if (disconnected) return;
      disconnected = true;
      try {
        await handleDisconnect(connectionId);
      } catch (err) {
        console.error(`[WS] Error in handleDisconnect for ${connectionId}:`, err);
        connections.delete(connectionId);
      }
    };

    ws.on('close', safeDisconnect);
    ws.on('error', safeDisconnect);
  });

  // Periodically reap stale connections whose clients silently disappeared
  staleConnectionTimer = setInterval(() => {
    const now = Date.now();
    for (const [connectionId, conn] of connections.entries()) {
      if (now - conn.lastSeen > STALE_CONNECTION_MS) {
        console.log(`[WS] Reaping stale connection ${connectionId}`);
        try { conn.ws.terminate(); } catch (_) {}
        handleDisconnect(connectionId).catch(() => connections.delete(connectionId));
      }
    }
  }, 30000);
}

async function handleMessage(connectionId, data) {
  const connection = connections.get(connectionId);
  if (!connection) {
    return;
  }
  
  switch (data.type) {
    case 'register':
      await handleRegister(connectionId, data);
      break;
    
    case 'status-update':
    case 'status_update':
      await handleStatusUpdate(connectionId, data);
      break;
    
    case 'hashrate-update':
    case 'mining_update':
      await handleMiningUpdate(connectionId, data);
      break;
    
    case 'heartbeat':
      await handleHeartbeat(connectionId, data);
      break;
    
    case 'request-configs':
      await handleRequestConfigs(connectionId, data);
      break;
    
    case 'unbound':
      await handleUnbind(connectionId, data);
      break;
    
    default:
      // Unknown message type - send pong to acknowledge
      sendToConnection(connectionId, {
        type: 'pong'
      });
  }
}

async function handleRegister(connectionId, data) {
  const {systemId, systemInfo, silent, clientName } = data.data || data;
  const Config = require('../models/Config');
  
  // Get IP from connection
  const connection = connections.get(connectionId);
  const ip = connection?.ip || 'unknown';
  
  // Find or create miner by systemId (MAC address)
  let miner = await Miner.getBySystemId(systemId);
  
  // Extract system details
  const hostname = systemInfo?.hostname || systemInfo?.os?.hostname || 'unknown';
  const platform = systemInfo?.platform || systemInfo?.os?.platform || 'unknown';
  // Get full OS name if available
  const osName = systemInfo?.os?.distro || 
                 systemInfo?.os?.release || 
                 systemInfo?.os?.name || 
                 platform;
  const cpuInfo = systemInfo?.cpu || systemInfo?.hardware?.cpu || null;
  const rawGpuInfo = systemInfo?.gpus || systemInfo?.gpu?.controllers || [];
  const gpuInfo = normalizeGpuList(rawGpuInfo);
  const memoryInfo = systemInfo?.memory || systemInfo?.mem || null;
  
  // Extract device states from client if provided
  const clientDevices = systemInfo?.devices || data.data?.devices || null;
  
  const isReconnect = !!miner; // Check if this is a reconnect
  
  // Build initial device states based on hardware
  const buildDeviceStates = (existingDevices) => {
    const devices = {
      cpu: {
        // Priority: 1) Existing DB state, 2) Client-provided state, 3) Default to enabled
        enabled: existingDevices?.cpu?.enabled !== undefined
          ? existingDevices.cpu.enabled
          : (clientDevices?.cpu?.enabled !== undefined 
              ? clientDevices.cpu.enabled 
              : true),
        running: clientDevices?.cpu?.running || false,
        hashrate: clientDevices?.cpu?.hashrate || null,
        algorithm: clientDevices?.cpu?.algorithm || null
      },
      gpus: []
    };
    
    // Build GPU states from hardware info (only if GPUs are detected)
    if (gpuInfo && gpuInfo.length > 0) {
      devices.gpus = gpuInfo.map((gpu, idx) => {
        const existingGpu = existingDevices?.gpus?.[idx];
        const clientGpu = clientDevices?.gpus?.[idx];
        return {
          id: idx,
          model: gpu.model || gpu.name || `GPU ${idx}`,
          // Priority: 1) Existing DB state, 2) Client-provided state, 3) Default to enabled
          enabled: existingGpu?.enabled !== undefined
            ? existingGpu.enabled
            : (clientGpu?.enabled !== undefined 
                ? clientGpu.enabled 
                : true),
          running: clientGpu?.running || false,
          hashrate: clientGpu?.hashrate || null,
          algorithm: clientGpu?.algorithm || null
        };
      });
    } else {
      // No GPUs detected - clear GPU devices array
      devices.gpus = [];
    }
    
    return devices;
  };
  
  if (!miner) {
    // Create new miner
    const devices = buildDeviceStates(null);
    
    // Derive status from device running states
    const isAnyRunning = devices.cpu?.running || devices.gpus?.some(g => g.running);
    
    miner = await Miner.create({
      systemId,
      name: clientName || (hostname !== 'unknown' ? hostname : `Miner-${systemId.substring(0, 8)}`),
      hostname,
      ip: ip,
      os: osName,
      version: '1.0.0',
      hardware: {
        cpu: cpuInfo,
        gpus: gpuInfo,
        ram: memoryInfo
      },
      devices,
      systemInfo,
      connectionId,
      status: isAnyRunning ? 'mining' : 'online',
      mining: isAnyRunning,
      bound: true // Automatically bind when registering
    });
    
  } else {
    // Update existing miner
    
    // Update device states (preserve enabled settings, update running states)
    const updatedDevices = buildDeviceStates(miner.devices);
    
    // Derive status from device running states instead of always resetting to 'online'
    const isAnyRunning = updatedDevices.cpu?.running || updatedDevices.gpus?.some(g => g.running);
    
    const updateData = {
      connectionId,
      status: isAnyRunning ? 'mining' : 'online',
      mining: isAnyRunning,
      bound: true,
      systemInfo,
      lastSeen: new Date().toISOString(),
      ip: ip // Update IP address
    };
    
    // Update hostname (always track the real hostname)
    if (hostname !== 'unknown') {
      updateData.hostname = hostname;
    }
    
    // Use clientName as display name if provided, otherwise use hostname
    if (clientName) {
      updateData.name = clientName;
    } else if (hostname !== 'unknown') {
      updateData.name = hostname;
    }
    
    // Update OS if available
    if (osName !== 'unknown') {
      updateData.os = osName;
    }
    
    // Update hardware info
    updateData.hardware = {
      cpu: cpuInfo || miner.hardware?.cpu,
      gpus: gpuInfo.length > 0 ? gpuInfo : (miner.hardware?.gpus || []),
      ram: memoryInfo || miner.hardware?.ram
    };
    
    updateData.devices = updatedDevices;
    
    const updatedMiner = await Miner.update(miner.id, updateData);
    
    if (!updatedMiner) {
      sendToConnection(connectionId, {
        type: 'error',
        error: 'Failed to update miner'
      });
      return;
    }
    
    miner = updatedMiner;
  }
  
  // Update connection mapping (preserve existing ws and ip)
  const existingConn = connections.get(connectionId);
  if (!existingConn) return; // Connection disappeared during async registration
  connections.set(connectionId, { 
    ...existingConn,
    minerId: miner.id,
    systemId
  });
  
  // Get global configs
  const configs = await Config.getAll();
  
  // Only send 'registered' for silent auto-reconnects
  // If silent is false, it's an explicit bind action, so always send 'bound'
  if (silent) {
    sendToConnection(connectionId, {
      type: 'registered',
      data: {
        miner: miner.toJSON(),
        configs
      }
    });
  } else {
    // For explicit binds (user clicked Bind button), always send 'bound'
    sendToConnection(connectionId, {
      type: 'bound',
      data: {
        miner: miner.toJSON(),
        configs
      }
    });
  }
  
  // Broadcast to all dashboard clients
  broadcast({
    type: 'miner_connected',
    miner: miner.toJSON()
  });
}

async function handleStatusUpdate(connectionId, data) {
  const connection = connections.get(connectionId);
  if (!connection || !connection.minerId) return;
  
  const statusData = data.data || data;
  const updateData = {
    lastSeen: new Date().toISOString()
  };
  
  // Update display name from client
  if (statusData.clientName) {
    // Client has a custom name set
    updateData.name = statusData.clientName;
  } else if (statusData.clientName !== undefined) {
    // Client explicitly sent empty clientName - revert to hostname
    const hostname = statusData.systemInfo?.hostname || statusData.systemInfo?.os?.hostname;
    if (hostname && hostname !== 'unknown') {
      updateData.name = hostname;
    }
  }
  
  // Get current miner data to preserve device enabled settings
  const currentMiner = await Miner.getById(connection.minerId);
  
  if (statusData.systemInfo) {
    updateData.systemInfo = statusData.systemInfo;
    updateData.hardware = {
      cpu: statusData.systemInfo.cpu || null,
      gpus: normalizeGpuList(statusData.systemInfo.gpus || []),
      ram: statusData.systemInfo.memory || null
    };
  }
  
  // Update system stats (CPU/GPU usage, RAM, temps) - ALWAYS update if provided
  if (statusData.stats !== undefined) {
    // Store stats exactly as received from client
    updateData.stats = statusData.stats;
  }
  
  // Update device states from client status
  if (statusData.devices) {
    const devices = {
      cpu: {
        // Preserve existing enabled state if not provided by client
        enabled: statusData.devices.cpu?.enabled !== undefined 
          ? statusData.devices.cpu.enabled 
          : (currentMiner?.devices?.cpu?.enabled ?? true),
        running: statusData.devices.cpu?.running || false,
        hashrate: statusData.devices.cpu?.hashrate !== undefined ? statusData.devices.cpu?.hashrate : null,
        algorithm: statusData.devices.cpu?.algorithm || null
      },
      gpus: []
    };
    
    // Update GPU states (only if GPUs are detected)
    if (statusData.devices.gpus && Array.isArray(statusData.devices.gpus) && statusData.devices.gpus.length > 0) {
      devices.gpus = statusData.devices.gpus.map((gpu, idx) => {
        const existingGpu = currentMiner?.devices?.gpus?.[idx];
        return {
          id: idx,
          model: gpu.model || existingGpu?.model || `GPU ${idx}`,
          // Preserve existing enabled state if not provided by client
          // All GPUs should have the same enabled state (controlled by nanominer on/off)
          enabled: gpu.enabled !== undefined 
            ? gpu.enabled 
            : (existingGpu?.enabled ?? true),
          running: gpu.running || false,
          hashrate: gpu.hashrate !== undefined ? gpu.hashrate : null,
          algorithm: gpu.algorithm || null
        };
      });
    } else {
      // No GPUs detected - preserve existing GPU device states if they exist
      devices.gpus = currentMiner?.devices?.gpus || [];
    }
    
    updateData.devices = devices;
  }
  
  if (statusData.miners) {
    // Update mining status based on client miners (legacy format)
    const anyMining = statusData.miners.some(m => m.running);
    updateData.mining = anyMining;
    updateData.status = anyMining ? 'mining' : 'online';
    
    // Prefer GPU aggregate hashrate when GPU miner is running.
    // This prevents CPU-first ordering from intermittently overriding GPU display.
    const runningGpuMiner = statusData.miners.find(
      (m) => m.running && m.deviceType === 'GPU' && m.hashrate
    );
    const runningCpuMiner = statusData.miners.find(
      (m) => m.running && m.deviceType === 'CPU' && m.hashrate
    );
    const preferredMiner = runningGpuMiner || runningCpuMiner || null;

    if (preferredMiner) {
      updateData.hashrate = preferredMiner.hashrate;
      updateData.algorithm = preferredMiner.algorithm;
      updateData.deviceType = preferredMiner.deviceType;
      updateData.currentMiner = preferredMiner.type;
    } else if (!anyMining) {
      // No miners running - explicitly clear hashrate and related fields
      updateData.hashrate = null;
      updateData.algorithm = null;
      updateData.deviceType = null;
      updateData.currentMiner = null;
    }
    
    // Also update device states from miners array if devices not provided directly
    if (!statusData.devices) {
      const cpuMiner = statusData.miners.find(m => m.type === 'xmrig');
      const gpuMiner = statusData.miners.find(m => m.type === 'nanominer');
      
      const devices = currentMiner?.devices || { cpu: { enabled: true }, gpus: [] };
      
      if (cpuMiner) {
        devices.cpu = {
          // Sync enabled state from client if provided
          enabled: cpuMiner.enabled !== undefined ? cpuMiner.enabled : (devices.cpu?.enabled !== false),
          running: cpuMiner.running || false,
          hashrate: cpuMiner.hashrate !== undefined ? cpuMiner.hashrate : null,
          algorithm: cpuMiner.algorithm || null
        };
      }
      
      if (gpuMiner) {
        // Sync enabled state from client if provided
        const gpuEnabled = gpuMiner.enabled !== undefined ? gpuMiner.enabled : true;
        
        // Only update GPU states if GPUs are actually detected in hardware
        if (updateData.hardware?.gpus && updateData.hardware.gpus.length > 0) {
          if (gpuMiner.running) {
            // Mark all GPUs as running if nanominer is running
            devices.gpus = (devices.gpus || []).map(gpu => ({
              ...gpu,
              enabled: gpuEnabled,
              running: true,
              // GPU miner hashrate is aggregate; avoid writing full total to each GPU entry.
              hashrate: null,
              algorithm: gpuMiner.algorithm || null
            }));
          } else {
            devices.gpus = (devices.gpus || []).map(gpu => ({
              ...gpu,
              enabled: gpuEnabled,
              running: false,
              hashrate: null,
              algorithm: null
            }));
          }
        } else {
          // No GPUs detected - clear GPU devices array
          devices.gpus = [];
        }
      } else if (!updateData.hardware?.gpus || updateData.hardware.gpus.length === 0) {
        // No GPU miner and no GPUs detected - clear GPU devices
        devices.gpus = [];
      }
      
      updateData.devices = devices;
    }
  }
  
  // Determine overall status from device states
  const devices = updateData.devices || currentMiner?.devices;
  if (devices) {
    const cpuRunning = devices.cpu?.running;
    const anyGpuRunning = devices.gpus?.some(g => g.running);
    const newMiningState = cpuRunning || anyGpuRunning;
    
    // Track mining start time for uptime calculation
    if (newMiningState && !currentMiner?.mining) {
      // Mining just started
      updateData.miningStartTime = new Date().toISOString();
    } else if (!newMiningState && currentMiner?.mining) {
      // Mining just stopped
      updateData.miningStartTime = null;
      updateData.uptime = 0;
    }
    
    updateData.mining = newMiningState;
    updateData.status = newMiningState ? 'mining' : 'online';
  }
  
  const miner = await Miner.update(connection.minerId, updateData);
  
  if (miner) {
    // Broadcast update
    broadcast({
      type: 'miner_status_update',
      miner: miner.toJSON()
    });
  }
}

async function handleMiningUpdate(connectionId, data) {
  const connection = connections.get(connectionId);
  if (!connection || !connection.minerId) return;
  
  const rawData = data.data || data;
  
  // The client wraps hashrate data inside a 'hashrate' property:
  // { systemId, hashrate: { minerId, deviceType, algorithm, hashrate }, timestamp }
  // Unwrap the nested structure if present
  const hashData = (rawData.hashrate && typeof rawData.hashrate === 'object' && rawData.hashrate.deviceType)
    ? rawData.hashrate
    : rawData;
  
  // Record hash rate if available
  if (hashData.hashrate && hashData.deviceType && hashData.algorithm) {
    try {
      await HashRate.record(connection.minerId, {
        deviceType: hashData.deviceType,
        algorithm: hashData.algorithm,
        hashrate: hashData.hashrate
      });
      
      const currentMiner = await Miner.getById(connection.minerId);
      const updateData = {
        mining: true,
        status: 'mining',
        lastSeen: new Date().toISOString()
      };
      
      // Set mining start time if not already set
      if (!currentMiner?.miningStartTime) {
        updateData.miningStartTime = new Date().toISOString();
      }
      
      // Write hashrate into the correct device entry so the dashboard
      // can always read it from devices.cpu.hashrate / devices.gpus[].hashrate
      // without depending on the top-level hashrate + deviceType combo.
      if (currentMiner?.devices) {
        const devices = JSON.parse(JSON.stringify(currentMiner.devices));
        
        if (hashData.deviceType === 'CPU' && devices.cpu) {
          devices.cpu.hashrate = hashData.hashrate;
          devices.cpu.algorithm = hashData.algorithm;
          devices.cpu.running = true;
        } else if (hashData.deviceType === 'GPU' && devices.gpus?.length > 0) {
          // Place aggregate hashrate on first GPU entry
          devices.gpus = devices.gpus.map((gpu, idx) => ({
            ...gpu,
            hashrate: idx === 0 ? hashData.hashrate : gpu.hashrate,
            algorithm: hashData.algorithm,
            running: true
          }));
        }
        
        updateData.devices = devices;
      }
      
      // Keep top-level fields for backward compatibility
      updateData.hashrate = hashData.hashrate;
      updateData.algorithm = hashData.algorithm;
      updateData.deviceType = hashData.deviceType;
      
      const miner = await Miner.update(connection.minerId, updateData);
      
      // Broadcast update to dashboard clients
      if (miner) {
        broadcast({
          type: 'miner_status_update',
          miner: miner.toJSON()
        });
      }
    } catch (error) {
      // Silent fail - status updates will correct this
    }
  }
}

async function handleHeartbeat(connectionId, data) {
  const connection = connections.get(connectionId);
  if (!connection || !connection.minerId) return;
  
  await Miner.update(connection.minerId, {
    lastSeen: new Date().toISOString()
  });
  
  // Send pong response
  sendToConnection(connectionId, {
    type: 'pong'
  });
}

async function handleRequestConfigs(connectionId, data) {
  const connection = connections.get(connectionId);
  if (!connection || !connection.minerId) {
    return;
  }
  
  const Config = require('../models/Config');
  const configs = await Config.getAll();
  
  sendToConnection(connectionId, {
    type: 'config-update',
    data: configs
  });
}

async function handleUnbind(connectionId, data) {
  const connection = connections.get(connectionId);
  if (!connection || !connection.minerId) return;
  
  const miner = await Miner.getById(connection.minerId);
  if (miner) {
    await miner.unbind();
    
    sendToConnection(connectionId, {
      type: 'unbound'
    });
    
    // Broadcast to dashboard
    broadcast({
      type: 'miner_unbound',
      miner: miner.toJSON()
    });
  }
}

async function handleDisconnect(connectionId) {
  const connection = connections.get(connectionId);
  if (connection && connection.minerId) {
    // Update miner status (but keep bound state)
    const miner = await Miner.update(connection.minerId, {
      status: 'offline',
      mining: false,
      connectionId: null
    });
    
    if (miner) {
      // Broadcast disconnect
      broadcast({
        type: 'miner_disconnected',
        miner: miner.toJSON()
      });
    }
  }
  
  connections.delete(connectionId);
}

// Send command to specific miner(s)
async function sendCommand(minerIds, command) {
  const Config = require('../models/Config');
  let sent = 0;
  
  // If minerIds is 'all', send to all bound miners
  if (minerIds === 'all') {
    const boundMiners = await Miner.getAllBound();
    minerIds = boundMiners.map(m => m.id);
  }
  
  // Ensure minerIds is an array
  if (!Array.isArray(minerIds)) {
    minerIds = [minerIds];
  }
  
  for (const minerId of minerIds) {
    const miner = await Miner.getById(minerId);
    if (!miner || !miner.connectionId) {
      continue;
    }
    
    // If command is config update, include configs
    if (command.action === 'config-update') {
      const configs = await Config.getAll();
      const success = sendToConnection(miner.connectionId, {
        type: 'config-update',
        data: configs
      });
      if (success) sent++;
    } else if (command.action === 'device-enable' || command.action === 'device-disable') {
      // Send device enable/disable command with current device states
      const success = sendToConnection(miner.connectionId, {
        type: 'command',
        data: {
          ...command,
          devices: miner.devices // Include current device states
        }
      });
      if (success) sent++;
    } else {
      const success = sendToConnection(miner.connectionId, {
        type: 'command',
        data: command
      });
      if (success) sent++;
    }
  }
  
  return sent;
}

function sendToConnection(connectionId, message) {
  const connection = connections.get(connectionId);
  if (connection && connection.ws.readyState === 1) { // WebSocket.OPEN
    try {
      connection.ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      return false;
    }
  }
  return false;
}

function sendToMiner(connectionId, message) {
  return sendToConnection(connectionId, message);
}

function broadcast(message) {
  if (!wss) return;
  
  const data = JSON.stringify(message);
  let sent = 0;
  
  wss.clients.forEach((client) => {
    if (client.readyState === 1) { // WebSocket.OPEN
      try {
        client.send(data);
        sent++;
      } catch (error) {
        // Silent fail - client may have disconnected
      }
    }
  });
  
  return sent;
}

function getConnectionCount() {
  return connections.size;
}

async function getConnectedMiners() {
  const miners = await Miner.getAll();
  return miners.filter(m => m.connectionId && (m.status === 'online' || m.status === 'mining'));
}

function shutdown() {
  if (staleConnectionTimer) {
    clearInterval(staleConnectionTimer);
    staleConnectionTimer = null;
  }
}

module.exports = {
  initialize,
  shutdown,
  sendToMiner,
  sendToConnection,
  sendCommand,
  broadcast,
  getConnectionCount,
  getConnectedMiners
};
