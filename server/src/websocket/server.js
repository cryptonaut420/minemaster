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
    
    case 'status_update':
      await handleStatusUpdate(connectionId, data);
      break;
    
    case 'mining_update':
      await handleMiningUpdate(connectionId, data);
      break;
    
    case 'heartbeat':
      await handleHeartbeat(connectionId, data);
      break;
    
    default:
      console.warn(`[WebSocket] Unknown message type: ${data.type}`);
  }
}

async function handleRegister(connectionId, data) {
  const { name, hostname, ip, os, version, hardware } = data;
  
  // Find or create miner
  let miner = await Miner.getByConnectionId(connectionId);
  
  if (!miner) {
    // Check if miner exists by hostname/IP
    const existingMiners = await Miner.getAll();
    const existing = existingMiners.find(m => 
      (m.hostname === hostname && m.ip === ip) || 
      m.ip === ip
    );
    
    if (existing) {
      miner = await Miner.update(existing.id, {
        connectionId,
        status: 'online',
        lastSeen: new Date().toISOString()
      });
    } else {
      miner = await Miner.create({
        name,
        hostname,
        ip,
        os,
        version,
        hardware,
        connectionId,
        status: 'online'
      });
    }
  } else {
    miner = await Miner.update(miner.id, {
      connectionId,
      status: 'online',
      lastSeen: new Date().toISOString()
    });
  }
  
  // Update connection mapping
  connections.set(connectionId, { 
    ws: connections.get(connectionId).ws, 
    minerId: miner.id 
  });
  
  // Send confirmation
  sendToConnection(connectionId, {
    type: 'registered',
    miner: miner.toJSON()
  });
  
  // Broadcast to all dashboard clients
  broadcast({
    type: 'miner_connected',
    miner: miner.toJSON()
  });
  
  console.log(`[WebSocket] Miner registered: ${miner.name} (${miner.id})`);
}

async function handleStatusUpdate(connectionId, data) {
  const connection = connections.get(connectionId);
  if (!connection || !connection.minerId) return;
  
  const miner = await Miner.update(connection.minerId, {
    status: data.status || 'online',
    lastSeen: new Date().toISOString(),
    ...data.updates
  });
  
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
  
  const miner = await Miner.getById(connection.minerId);
  if (!miner) return;
  
  await miner.updateMiningState({
    type: data.minerType,
    config: data.config,
    deviceType: data.deviceType,
    algorithm: data.algorithm,
    hashrate: data.hashrate,
    uptime: data.uptime,
    status: 'mining'
  });
  
  // Record hash rate if available
  if (data.hashrate && data.deviceType && data.algorithm) {
    try {
      await HashRate.record(connection.minerId, {
        deviceType: data.deviceType,
        algorithm: data.algorithm,
        hashrate: data.hashrate
      });
    } catch (error) {
      console.error('Error recording hash rate:', error);
    }
  }
  
  // Broadcast update
  broadcast({
    type: 'mining_update',
    miner: miner.toJSON()
  });
}

async function handleHeartbeat(connectionId, data) {
  const connection = connections.get(connectionId);
  if (!connection || !connection.minerId) return;
  
  await Miner.update(connection.minerId, {
    lastSeen: new Date().toISOString()
  });
}

async function handleDisconnect(connectionId) {
  const connection = connections.get(connectionId);
  if (connection && connection.minerId) {
    // Update miner status
    const miner = await Miner.update(connection.minerId, {
      status: 'offline',
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
  broadcast,
  getConnectionCount,
  getConnectedMiners
};
