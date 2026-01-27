const { getDb } = require('../db/mongodb');

// Default configs matching client app exactly
const DEFAULT_CONFIGS = {
  xmrig: {
    coin: '',
    algorithm: 'rx/0',
    pool: '',
    user: '',
    password: 'x',
    threadPercentage: 100,
    additionalArgs: ''
  },
  nanominer: {
    coin: '',
    algorithm: 'kawpow',
    pool: '',
    user: '',
    rigName: ''
  }
};

class Config {
  static async getAll() {
    try {
      const db = getDb();
      const configs = await db.collection('configs').findOne({ _id: 'global' });
      
      if (!configs) {
        // Initialize with defaults
        await db.collection('configs').insertOne({
          _id: 'global',
          ...DEFAULT_CONFIGS,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
        return DEFAULT_CONFIGS;
      }
      
      // Remove MongoDB _id and metadata
      const { _id, createdAt, updatedAt, ...configData } = configs;
      
      // Ensure all config types exist
      const result = { ...DEFAULT_CONFIGS };
      for (const type of Object.keys(DEFAULT_CONFIGS)) {
        if (configData[type]) {
          result[type] = { ...DEFAULT_CONFIGS[type], ...configData[type] };
        }
      }
      
      return result;
    } catch (error) {
      console.error('Error reading configs:', error);
      return DEFAULT_CONFIGS;
    }
  }

  static async get(type) {
    const configs = await Config.getAll();
    return configs[type] || null;
  }

  static async update(type, config) {
    try {
      const db = getDb();
      const updateData = {
        [`${type}.updatedAt`]: new Date().toISOString()
      };
      
      // Update each field in the config
      for (const [key, value] of Object.entries(config)) {
        updateData[`${type}.${key}`] = value;
      }
      
      await db.collection('configs').updateOne(
        { _id: 'global' },
        { 
          $set: updateData,
          $setOnInsert: {
            createdAt: new Date().toISOString()
          }
        },
        { upsert: true }
      );
      
      const updated = await Config.get(type);
      return updated;
    } catch (error) {
      console.error('Error updating config:', error);
      throw error;
    }
  }
}

module.exports = Config;
