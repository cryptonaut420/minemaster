const { getDb } = require('../db/mongodb');

class HashRate {
  // TTL index on the hashrates collection handles automatic 7-day expiry
  static async record(minerId, data) {
    try {
      const db = getDb();
      const record = {
        minerId,
        deviceType: data.deviceType,
        algorithm: data.algorithm,
        hashrate: data.hashrate,
        timestamp: new Date()
      };
      
      await db.collection('hashrates').insertOne(record);
      
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

  /**
   * Get time-series hashrate data for graphing (hourly buckets).
   * Returns array of { hour, total, cpu, gpu } for the last 7 days.
   */
  static async getTimeSeries(timeframe = '7d') {
    try {
      const db = getDb();
      const now = new Date();
      let startTime;
      switch (timeframe) {
        case '24h':
          startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          break;
        case '7d':
        default:
          startTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
      }

      const pipeline = [
        { $match: { timestamp: { $gte: startTime } } },
        {
          $group: {
            _id: {
              y: { $year: '$timestamp' },
              m: { $month: '$timestamp' },
              d: { $dayOfMonth: '$timestamp' },
              h: { $hour: '$timestamp' },
              deviceType: '$deviceType'
            },
            avgHashrate: { $avg: '$hashrate' },
            count: { $sum: 1 }
          }
        },
        { $sort: { '_id.y': 1, '_id.m': 1, '_id.d': 1, '_id.h': 1 } }
      ];

      const results = await db.collection('hashrates').aggregate(pipeline).toArray();

      const byHour = new Map();
      results.forEach((r) => {
        const { y, m, d, h } = r._id;
        const hourKey = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00.000Z`;
        if (!byHour.has(hourKey)) {
          byHour.set(hourKey, { hour: hourKey, total: 0, cpu: 0, gpu: 0 });
        }
        const entry = byHour.get(hourKey);
        const rate = r.avgHashrate || 0;
        if (r._id.deviceType === 'CPU') {
          entry.cpu = rate;
        } else if (r._id.deviceType === 'GPU') {
          entry.gpu = rate;
        }
        entry.total = entry.cpu + entry.gpu;
      });

      const sorted = Array.from(byHour.values()).sort((a, b) => a.hour.localeCompare(b.hour));
      return sorted;
    } catch (error) {
      console.error('Error getting hashrate time series:', error);
      return [];
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
