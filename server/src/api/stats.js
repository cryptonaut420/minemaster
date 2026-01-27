const express = require('express');
const router = express.Router();
const HashRate = require('../models/HashRate');
const Miner = require('../models/Miner');

// Get hash rate statistics broken down by device type and algorithm
router.get('/hashrates', async (req, res) => {
  try {
    const timeframe = req.query.timeframe || '1h';
    const stats = await HashRate.getStats(timeframe);
    
    // Also get current miners for real-time breakdown
    const miners = await Miner.getAll();
    const currentBreakdown = {};
    
    miners.filter(m => m.status === 'mining' && m.hashrate && m.deviceType && m.algorithm).forEach(miner => {
      const key = `${miner.deviceType}_${miner.algorithm}`;
      if (!currentBreakdown[key]) {
        currentBreakdown[key] = {
          deviceType: miner.deviceType,
          algorithm: miner.algorithm,
          hashrate: 0,
          count: 0
        };
      }
      currentBreakdown[key].hashrate += miner.hashrate || 0;
      currentBreakdown[key].count += 1;
    });
    
    res.json({ 
      success: true, 
      historical: stats,
      current: currentBreakdown
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
