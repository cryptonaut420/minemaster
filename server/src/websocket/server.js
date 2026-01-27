const Miner = require('../models/Miner');
const HashRate = require('../models/HashRate');
const { v4: uuidv4 } = require('uuid');

let wss = null;
const connections = new Map(); // connectionId -> { ws, minerId }

function initialize(webSocketServer) {
  wss = webSocketServer;
  
  wss.on('connection', (ws, req) => {
    const connectionId = uuidv4();
    console.log(`[WebSocket] New connection: ${connectionId}`);
    
    connections.set(connectionId, { ws, minerId: null });
    
    // Send connection ID to client
    ws.send(JSON.stringify({
      type: 'connected',
      connectionId
    }));
    
    // Handle messages from client
    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message);
        await handleMessage(connectionId, data);
      } catch (error) {
        console.error('[WebSocket] Error handling message:', error);
        sendToConnection(connectionId, {
          type: 'error',
          error: error.message
        });
      }
    });
    
    // Handle disconnect
    ws.on('close', async () => {
      console.log(`[WebSocket] Connection closed: ${connectionId}`);
      await handleDisconnect(connectionId);
    });
    
    // Handle errors
    ws.on('error', async (error) => {
      console.error(`[WebSocket] Error on connection ${connectionId}:`, error);
      await handleDisconnect(connectionId);
    });
  });
}

async function handleMessage(connectionId, data) {
  const connection = connections.get(connectionId);
  if (!connection) {
    console.error(`[WebSocket] Connection not found: ${connectionId}`);
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
      console.warn(`[WebSocket] Unknown message type: ${data.type}`);
      sendToConnection(connectionId, {
        type: 'pong'
      });
  }
}

async function handleRegister(connectionId, data) {
  const {systemId, systemInfo, silent } = data.data || data;
  const Config = require('../models/Config');
  
  console.log('[WebSocket] Registration data:', { systemId, silent });
  
  // Find or create miner by systemId (MAC address)
  let miner = await Miner.getBySystemId(systemId);
  
  // Extract system details
  const hostname = systemInfo?.hostname || systemInfo?.os?.hostname || 'unknown';
  const platform = systemInfo?.platform || systemInfo?.os?.platform || 'unknown';
  const cpuInfo = systemInfo?.cpu || systemInfo?.hardware?.cpu || null;
  const gpuInfo = systemInfo?.gpus || systemInfo?.gpu?.controllers || [];
  const memoryInfo = systemInfo?.memory || systemInfo?.mem || null;
  
  const isReconnect = !!miner; // Check if this is a reconnect
  
  if (!miner) {
    // Create new miner
    miner = await Miner.create({
      systemId,
      name: hostname !== 'unknown' ? hostname : `Miner-${systemId.substring(0, 8)}`,
      hostname,
      ip: 'unknown', // Will be updated from connection
      os: platform,
      version: '1.0.0',
      hardware: {
        cpu: cpuInfo,
        gpus: gpuInfo,
        ram: memoryInfo
      },
      systemInfo,
      connectionId,
      status: 'online',
      bound: true // Automatically bind when registering
    });
    
    console.log(`[WebSocket] New miner registered: ${miner.name} (${systemId})`);
  } else {
    // Update existing miner
    console.log(`[WebSocket] Found existing miner:`, miner.id, miner.name);
    
    const updateData = {
      connectionId,
      status: 'online',
      bound: true,
      systemInfo,
      lastSeen: new Date().toISOString()
    };
    
    // Update hostname if available
    if (hostname !== 'unknown') {
      updateData.hostname = hostname;
      updateData.name = hostname;
    }
    
    // Update OS if available
    if (platform !== 'unknown') {
      updateData.os = platform;
    }
    
    // Update hardware info
    updateData.hardware = {
      cpu: cpuInfo || miner.hardware?.cpu,
      gpus: gpuInfo.length > 0 ? gpuInfo : (miner.hardware?.gpus || []),
      ram: memoryInfo || miner.hardware?.ram
    };
    
    console.log(`[WebSocket] Updating miner ${miner.id} with connectionId:`, connectionId);
    const updatedMiner = await Miner.update(miner.id, updateData);
    
    if (!updatedMiner) {
      console.error(`[WebSocket] Failed to update miner ${systemId} (id: ${miner.id})`);
      console.error(`[WebSocket] Update returned null/undefined`);
      sendToConnection(connectionId, {
        type: 'error',
        error: 'Failed to update miner'
      });
      return;
    }
    
    miner = updatedMiner;
    console.log(`[WebSocket] Miner reconnected: ${miner.name} (${systemId})`);
  }
  
  // Update connection mapping
  connections.set(connectionId, { 
    ws: connections.get(connectionId).ws, 
    minerId: miner.id,
    systemId
  });
  
  // Get global configs
  const configs = await Config.getAll();
  
  // For silent reconnects, send simple ack without triggering client-side bind event
  if (silent || isReconnect) {
    sendToConnection(connectionId, {
      type: 'registered',
      data: {
        miner: miner.toJSON(),
        configs
      }
    });
    console.log(`[WebSocket] Silent registration complete for ${miner.name}`);
  } else {
    // For new binds, send full bound response
    sendToConnection(connectionId, {
      type: 'bound',
      data: {
        miner: miner.toJSON(),
        configs
      }
    });
    console.log(`[WebSocket] New bind complete for ${miner.name}`);
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
  
  if (statusData.systemInfo) {
    updateData.systemInfo = statusData.systemInfo;
    updateData.hardware = {
      cpu: statusData.systemInfo.cpu || null,
      gpus: statusData.systemInfo.gpus || [],
      ram: statusData.systemInfo.memory || null
    };
  }
  
  if (statusData.miners) {
    // Update mining status based on client miners
    const anyMining = statusData.miners.some(m => m.running);
    updateData.mining = anyMining;
    updateData.status = anyMining ? 'mining' : 'online';
    
    // Update hashrate from running miners
    const runningMiner = statusData.miners.find(m => m.running && m.hashrate);
    if (runningMiner) {
      updateData.hashrate = runningMiner.hashrate;
      updateData.algorithm = runningMiner.algorithm;
      updateData.deviceType = runningMiner.deviceType;
      updateData.currentMiner = runningMiner.type;
    }
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
  
  const hashData = data.data || data;
  
  // Record hash rate if available
  if (hashData.hashrate && hashData.deviceType && hashData.algorithm) {
    try {
      await HashRate.record(connection.minerId, {
        deviceType: hashData.deviceType,
        algorithm: hashData.algorithm,
        hashrate: hashData.hashrate
      });
      
      // Update miner's current hashrate
      await Miner.update(connection.minerId, {
        hashrate: hashData.hashrate,
        algorithm: hashData.algorithm,
        deviceType: hashData.deviceType,
        mining: true,
        status: 'mining',
        lastSeen: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error recording hash rate:', error);
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
    console.warn('[WebSocket] Config request from unregistered connection');
    return;
  }
  
  const Config = require('../models/Config');
  const configs = await Config.getAll();
  
  sendToConnection(connectionId, {
    type: 'config-update',
    data: configs
  });
  
  console.log(`[WebSocket] Sent configs to miner ${connection.minerId}`);
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
    
    console.log(`[WebSocket] Miner unbound: ${miner.name}`);
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
      console.warn(`[WebSocket] Cannot send command: miner ${minerId} not connected`);
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
      console.error(`[WebSocket] Error sending to ${connectionId}:`, error);
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
        console.error('[WebSocket] Error broadcasting:', error);
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
  return miners.filter(m => m.connectionId && m.status === 'online');
}

module.exports = {
  initialize,
  sendToMiner,
  sendToConnection,
  sendCommand,
  broadcast,
  getConnectionCount,
  getConnectedMiners
};
