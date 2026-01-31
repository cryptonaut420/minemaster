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

// Apply config and restart only the relevant miners (CPU for xmrig, GPU for nanominer)
router.post('/:type/apply', async (req, res) => {
  try {
    const configType = req.params.type; // 'xmrig' or 'nanominer'
    const config = await Config.get(configType);
    if (!config) {
      return res.status(404).json({ success: false, error: 'Config type not found' });
    }
    
    // Get all bound miners
    const boundMiners = await Miner.getAllBound();
    const connectedMiners = boundMiners.filter(m => m.connectionId && (m.status === 'online' || m.status === 'mining'));
    
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
    
    // Determine which device type to restart based on config type
    const deviceType = configType === 'xmrig' ? 'CPU' : 'GPU';
    
    // Send targeted restart command to only the relevant device type
    let restartedCount = 0;
    console.log(`[Configs API] Checking ${connectedMiners.length} miners for ${deviceType} restart`);
    
    for (const miner of connectedMiners) {
      // Check if this miner has the relevant device running
      let shouldRestart = false;
      
      if (deviceType === 'CPU' && miner.devices?.cpu?.running) {
        shouldRestart = true;
        console.log(`[Configs API] Miner ${miner.name} has CPU running, will restart`);
      } else if (deviceType === 'GPU' && miner.devices?.gpus?.some(g => g.running)) {
        shouldRestart = true;
        console.log(`[Configs API] Miner ${miner.name} has GPU running, will restart`);
      } else {
        console.log(`[Configs API] Miner ${miner.name} - ${deviceType} not running, skipping`);
      }
      
      if (shouldRestart) {
        console.log(`[Configs API] Sending restart-device command to ${miner.name}`);
        const sent = await websocketServer.sendCommand(miner.id, {
          action: 'restart-device',
          deviceType: deviceType
        });
        if (sent > 0) {
          restartedCount++;
          console.log(`[Configs API] Command sent successfully`);
        } else {
          console.log(`[Configs API] Failed to send command`);
        }
      }
    }
    
    console.log(`[Configs API] Total devices restarted: ${restartedCount}`);
    
    res.json({ 
      success: true, 
      message: `${configType} config applied and ${restartedCount} ${deviceType} device(s) restarted`,
      restarted: restartedCount,
      total: connectedMiners.length,
      deviceType
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
