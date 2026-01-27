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
    
    // Automatically broadcast config update to all connected clients
    websocketServer.broadcast({
      type: 'config_updated',
      minerType: req.params.type,
      config: config
    });
    
    res.json({ success: true, config });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Apply config and restart all miners using this config type
router.post('/:type/apply', async (req, res) => {
  try {
    const config = await Config.get(req.params.type);
    if (!config) {
      return res.status(404).json({ success: false, error: 'Config type not found' });
    }
    
    const miners = await Miner.getAll();
    const targetMiners = miners.filter(m => 
      m.connectionId && 
      (m.status === 'online' || m.status === 'mining') && 
      m.currentMiner === req.params.type
    );
    
    if (targetMiners.length === 0) {
      return res.json({ 
        success: true, 
        message: 'No miners currently using this configuration',
        restarted: 0
      });
    }
    
    let restarted = 0;
    
    // Send restart command with new config to all miners using this type
    for (const miner of targetMiners) {
      try {
        // Send restart command with new config
        websocketServer.sendToMiner(miner.connectionId, {
          type: 'command',
          command: 'restart_with_config',
          params: {
            minerType: req.params.type,
            config: config
          }
        });
        
        restarted++;
      } catch (error) {
        console.error(`Error restarting ${miner.name}:`, error);
      }
    }
    
    res.json({ 
      success: true, 
      message: `Restarted ${restarted} miner(s) with new config`,
      restarted,
      total: targetMiners.length
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
