const express = require('express');
const router = express.Router();
const Config = require('../models/Config');
const Miner = require('../models/Miner');
const websocketServer = require('../websocket/server');

// Get all configs
router.get('/', async (req, res) => {
  try {
    const configs = await Config.getAll();
    res.json({ success: true, configs });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get config by type
router.get('/:type', async (req, res) => {
  try {
    const config = await Config.get(req.params.type);
    if (!config) {
      return res.status(404).json({ success: false, error: 'Config type not found' });
    }
    res.json({ success: true, config });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update config by type
router.put('/:type', async (req, res) => {
  try {
    const config = await Config.update(req.params.type, req.body);
    
    // Automatically send config update to all bound clients
    await websocketServer.sendCommand('all', {
      action: 'config-update'
    });
    
    res.json({ success: true, config });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Apply config and restart all bound miners
router.post('/:type/apply', async (req, res) => {
  try {
    const config = await Config.get(req.params.type);
    if (!config) {
      return res.status(404).json({ success: false, error: 'Config type not found' });
    }
    
    // Get all bound miners
    const boundMiners = await Miner.getAllBound();
    const connectedMiners = boundMiners.filter(m => m.connectionId && m.status === 'online');
    
    if (connectedMiners.length === 0) {
      return res.json({ 
        success: true, 
        message: 'No connected bound miners to restart',
        restarted: 0
      });
    }
    
    // Send config update to all bound miners first
    await websocketServer.sendCommand('all', {
      action: 'config-update'
    });
    
    // Then send restart command
    const restarted = await websocketServer.sendCommand('all', {
      action: 'restart'
    });
    
    res.json({ 
      success: true, 
      message: `Config applied and restart command sent to ${restarted} miner(s)`,
      restarted,
      total: connectedMiners.length
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
