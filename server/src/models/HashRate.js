const { getDb } = require('../db/mongodb');

class HashRate {
  static async record(minerId, data) {
    try {
      const db = getDb();
      const record = {
        minerId,
        deviceType: data.deviceType, // CPU, GPU
        algorithm: data.algorithm, // rx/0, kawpow, etc.
        hashrate: data.hashrate,
        timestamp: new Date()
      };
      
      await db.collection('hashrates').insertOne(record);
      
      // Keep only last 1000 records per miner (cleanup)
      const count = await db.collection('hashrates').countDocuments({ minerId });
      if (count > 1000) {
        const oldest = await db.collection('hashrates')
          .find({ minerId })
          .sort({ timestamp: 1 })
          .limit(count - 1000)
          .toArray();
        
        const ids = oldest.map(r => r._id);
        if (ids.length > 0) {
          await db.collection('hashrates').deleteMany({ _id: { $in: ids } });
        }
      }
      
      return record;
    } catch (error) {
      console.error('Error recording hash rate:', error);
      throw error;
    }
  }

  static async getStats(timeframe = '1h') {
    try {
      const db = getDb();
      const now = new Date();
      let startTime;
      
      switch (timeframe) {
        case '1h':
          startTime = new Date(now.getTime() - 60 * 60 * 1000);
          break;
        case '24h':
          startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          break;
        case '7d':
          startTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        default:
          startTime = new Date(now.getTime() - 60 * 60 * 1000);
      }
      
      // Aggregate hash rates by device type and algorithm
      const pipeline = [
        {
          $match: {
            timestamp: { $gte: startTime }
          }
        },
        {
          $group: {
            _id: {
              deviceType: '$deviceType',
              algorithm: '$algorithm'
            },
            avgHashrate: { $avg: '$hashrate' },
            maxHashrate: { $max: '$hashrate' },
            count: { $sum: 1 }
          }
        },
        {
          $sort: { '_id.deviceType': 1, '_id.algorithm': 1 }
        }
      ];
      
      const stats = await db.collection('hashrates').aggregate(pipeline).toArray();
      
      // Format results
      const result = {};
      stats.forEach(stat => {
        const key = `${stat._id.deviceType || 'Unknown'}_${stat._id.algorithm || 'Unknown'}`;
        result[key] = {
          deviceType: stat._id.deviceType,
          algorithm: stat._id.algorithm,
          avgHashrate: stat.avgHashrate,
          maxHashrate: stat.maxHashrate,
          sampleCount: stat.count
        };
      });
      
      return result;
    } catch (error) {
      console.error('Error getting hash rate stats:', error);
      return {};
    }
  }

  static async getByMiner(minerId, limit = 100) {
    try {
      const db = getDb();
      const records = await db.collection('hashrates')
        .find({ minerId })
        .sort({ timestamp: -1 })
        .limit(limit)
        .toArray();
      
      return records;
    } catch (error) {
      console.error('Error getting miner hash rates:', error);
      return [];
    }
  }
}

module.exports = HashRate;
