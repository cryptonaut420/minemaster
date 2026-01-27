const express = require('express');
const router = express.Router();
const Miner = require('../models/Miner');
const websocketServer = require('../websocket/server');

// Get all miners
router.get('/', async (req, res) => {
  try {
    const miners = await Miner.getAll();
    res.json({ success: true, miners: miners.map(m => m.toJSON()) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get miner by ID
router.get('/:id', async (req, res) => {
  try {
    const miner = await Miner.getById(req.params.id);
    if (!miner) {
      return res.status(404).json({ success: false, error: 'Miner not found' });
    }
    res.json({ success: true, miner: miner.toJSON() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Register a new miner
router.post('/', async (req, res) => {
  try {
    const { name, hostname, ip, os, version, hardware } = req.body;
    
    // Check if miner already exists by hostname/IP
    const existingMiners = await Miner.getAll();
    const existing = existingMiners.find(m => 
      (m.hostname === hostname && m.ip === ip) || 
      m.ip === ip
    );
    
    if (existing) {
      // Update existing miner
      const updated = await Miner.update(existing.id, {
        name: name || existing.name,
        hostname: hostname || existing.hostname,
        ip: ip || existing.ip,
        os: os || existing.os,
        version: version || existing.version,
        hardware: hardware || existing.hardware,
        status: 'online',
        lastSeen: new Date().toISOString()
      });
      
      return res.json({ success: true, miner: updated.toJSON(), isNew: false });
    }
    
    // Create new miner
    const miner = await Miner.create({
      name,
      hostname,
      ip,
      os,
      version,
      hardware,
      status: 'online'
    });
    
    // Broadcast to all connected clients
    websocketServer.broadcast({
      type: 'miner_registered',
      miner: miner.toJSON()
    });
    
    res.json({ success: true, miner: miner.toJSON(), isNew: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update miner
router.put('/:id', async (req, res) => {
  try {
    const miner = await Miner.update(req.params.id, req.body);
    if (!miner) {
      return res.status(404).json({ success: false, error: 'Miner not found' });
    }
    
    // Broadcast update
    websocketServer.broadcast({
      type: 'miner_updated',
      miner: miner.toJSON()
    });
    
    res.json({ success: true, miner: miner.toJSON() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete miner
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await Miner.delete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Miner not found' });
    }
    
    // Broadcast deletion
    websocketServer.broadcast({
      type: 'miner_deleted',
      minerId: req.params.id
    });
    
    res.json({ success: true, message: 'Miner deleted' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Send command to miner (via WebSocket)
router.post('/:id/command', async (req, res) => {
  try {
    const miner = await Miner.getById(req.params.id);
    if (!miner) {
      return res.status(404).json({ success: false, error: 'Miner not found' });
    }
    
    if (!miner.connectionId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Miner is not connected' 
      });
    }
    
    const { command, params } = req.body;
    
    // Send command via WebSocket
    const sent = websocketServer.sendToMiner(miner.connectionId, {
      type: 'command',
      command,
      params
    });
    
    if (!sent) {
      return res.status(400).json({ 
        success: false, 
        error: 'Failed to send command to miner' 
      });
    }
    
    res.json({ success: true, message: 'Command sent' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Restart miner
router.post('/:id/restart', async (req, res) => {
  try {
    const miner = await Miner.getById(req.params.id);
    if (!miner) {
      return res.status(404).json({ success: false, error: 'Miner not found' });
    }
    
    if (!miner.bound) {
      return res.status(400).json({ 
        success: false, 
        error: 'Miner is not bound to master server' 
      });
    }
    
    if (!miner.connectionId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Miner is not connected' 
      });
    }
    
    // Send restart command
    const sent = await websocketServer.sendCommand(miner.id, {
      action: 'restart'
    });
    
    if (sent === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Failed to send command to miner' 
      });
    }
    
    res.json({ success: true, message: 'Restart command sent' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Stop miner
router.post('/:id/stop', async (req, res) => {
  try {
    const miner = await Miner.getById(req.params.id);
    if (!miner) {
      return res.status(404).json({ success: false, error: 'Miner not found' });
    }
    
    if (!miner.bound) {
      return res.status(400).json({ 
        success: false, 
        error: 'Miner is not bound to master server' 
      });
    }
    
    if (!miner.connectionId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Miner is not connected' 
      });
    }
    
    // Send stop command
    const sent = await websocketServer.sendCommand(miner.id, {
      action: 'stop'
    });
    
    if (sent === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Failed to send command to miner' 
      });
    }
    
    res.json({ success: true, message: 'Stop command sent' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Start miner with config
router.post('/:id/start', async (req, res) => {
  try {
    const miner = await Miner.getById(req.params.id);
    if (!miner) {
      return res.status(404).json({ success: false, error: 'Miner not found' });
    }
    
    if (!miner.bound) {
      return res.status(400).json({ 
        success: false, 
        error: 'Miner is not bound to master server' 
      });
    }
    
    if (!miner.connectionId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Miner is not connected' 
      });
    }
    
    // Send start command
    const sent = await websocketServer.sendCommand(miner.id, {
      action: 'start',
      deviceType: req.body.deviceType // optional
    });
    
    if (sent === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Failed to send command to miner' 
      });
    }
    
    res.json({ success: true, message: 'Start command sent' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
