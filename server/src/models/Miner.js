const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/mongodb');

class Miner {
  constructor(data) {
    this.id = data.id || uuidv4();
    this.name = data.name || `Miner-${this.id.substring(0, 8)}`;
    this.hostname = data.hostname || 'unknown';
    this.ip = data.ip || 'unknown';
    this.os = data.os || 'unknown';
    this.version = data.version || '1.0.0';
    this.status = data.status || 'offline'; // online, offline, mining, error
    this.lastSeen = data.lastSeen || new Date().toISOString();
    this.createdAt = data.createdAt || new Date().toISOString();
    this.updatedAt = data.updatedAt || new Date().toISOString();
    
    // Current mining state
    this.currentMiner = data.currentMiner || null; // xmrig, nanominer, etc.
    this.currentConfig = data.currentConfig || null;
    this.deviceType = data.deviceType || null; // CPU, GPU
    this.algorithm = data.algorithm || null; // rx/0, kawpow, etc.
    this.hashrate = data.hashrate || null;
    this.uptime = data.uptime || 0; // seconds
    
    // Hardware info
    this.hardware = data.hardware || {
      cpu: null,
      gpus: [],
      ram: null
    };
    
    // Connection info
    this.connectionId = data.connectionId || null; // WebSocket connection ID
  }

  static async getAll() {
    try {
      const db = getDb();
      const miners = await db.collection('miners').find({}).toArray();
      return miners.map(m => new Miner(m));
    } catch (error) {
      console.error('Error reading miners:', error);
      return [];
    }
  }

  static async getById(id) {
    try {
      const db = getDb();
      const miner = await db.collection('miners').findOne({ id });
      return miner ? new Miner(miner) : null;
    } catch (error) {
      console.error('Error getting miner by ID:', error);
      return null;
    }
  }

  static async getByConnectionId(connectionId) {
    try {
      const db = getDb();
      const miner = await db.collection('miners').findOne({ connectionId });
      return miner ? new Miner(miner) : null;
    } catch (error) {
      console.error('Error getting miner by connection ID:', error);
      return null;
    }
  }

  static async create(data) {
    try {
      const miner = new Miner(data);
      const db = getDb();
      await db.collection('miners').insertOne(miner.toJSON());
      return miner;
    } catch (error) {
      console.error('Error creating miner:', error);
      throw error;
    }
  }

  static async update(id, updates) {
    try {
      const db = getDb();
      const updateData = {
        ...updates,
        updatedAt: new Date().toISOString()
      };
      
      const result = await db.collection('miners').findOneAndUpdate(
        { id },
        { $set: updateData },
        { returnDocument: 'after' }
      );
      
      return result.value ? new Miner(result.value) : null;
    } catch (error) {
      console.error('Error updating miner:', error);
      throw error;
    }
  }

  static async delete(id) {
    try {
      const db = getDb();
      const result = await db.collection('miners').deleteOne({ id });
      
      // Also delete associated hash rates
      await db.collection('hashrates').deleteMany({ minerId: id });
      
      return result.deletedCount > 0;
    } catch (error) {
      console.error('Error deleting miner:', error);
      throw error;
    }
  }

  async updateStatus(status) {
    return Miner.update(this.id, { status, lastSeen: new Date().toISOString() });
  }

  async updateMiningState(state) {
    return Miner.update(this.id, {
      currentMiner: state.type,
      currentConfig: state.config,
      deviceType: state.deviceType,
      algorithm: state.algorithm,
      hashrate: state.hashrate,
      uptime: state.uptime || this.uptime,
      status: state.status || 'mining',
      lastSeen: new Date().toISOString()
    });
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      hostname: this.hostname,
      ip: this.ip,
      os: this.os,
      version: this.version,
      status: this.status,
      lastSeen: this.lastSeen,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      currentMiner: this.currentMiner,
      currentConfig: this.currentConfig,
      deviceType: this.deviceType,
      algorithm: this.algorithm,
      hashrate: this.hashrate,
      uptime: this.uptime,
      hardware: this.hardware,
      connectionId: this.connectionId
    };
  }
}

module.exports = Miner;
