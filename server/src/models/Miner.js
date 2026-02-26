const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/mongodb');

class Miner {
  constructor(data) {
    this.id = data.id || uuidv4();
    this.systemId = data.systemId || null; // MAC address
    this.name = data.name || `Miner-${this.id.substring(0, 8)}`;
    this.hostname = data.hostname || 'unknown';
    this.ip = data.ip || 'unknown';
    this.os = data.os || 'unknown';
    this.version = data.version || '1.0.0';
    this.status = data.status || 'offline'; // online, offline, mining, error
    this.bound = data.bound !== undefined ? data.bound : false; // Bound to master
    this.lastSeen = data.lastSeen || new Date().toISOString();
    this.createdAt = data.createdAt || new Date().toISOString();
    this.updatedAt = data.updatedAt || new Date().toISOString();
    
    // Current mining state
    this.currentMiner = data.currentMiner || null; // xmrig, nanominer, etc.
    this.currentConfig = data.currentConfig || null;
    this.deviceType = data.deviceType || null; // CPU, GPU
    this.algorithm = data.algorithm || null; // rx/0, kawpow, etc.
    this.hashrate = data.hashrate || null;
    this.miningStartTime = data.miningStartTime || null; // ISO timestamp when mining started
    this.uptime = data.uptime || 0; // seconds (calculated from miningStartTime)
    this.mining = data.mining !== undefined ? data.mining : false; // Is currently mining
    
    // Device states - tracks individual device status for remote control
    this.devices = data.devices || {
      cpu: {
        enabled: true,      // Whether CPU mining is enabled/allowed
        running: false,     // Whether CPU miner is currently running
        hashrate: null,     // Current hashrate
        algorithm: null     // Current algorithm
      },
      gpus: []              // Array of GPU states: { id, enabled, running, hashrate, algorithm }
    };
    
    // Hardware info
    this.hardware = data.hardware || {
      cpu: null,
      gpus: [],
      ram: null
    };
    
    // Detailed system info from client
    this.systemInfo = data.systemInfo || null;
    
    // System stats (CPU/GPU usage, RAM, temps) - updated from client status updates
    // Preserve stats exactly as they come from the database/client
    this.stats = data.stats || null;
    
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

  static async getBySystemId(systemId) {
    try {
      const db = getDb();
      const miner = await db.collection('miners').findOne({ systemId });
      return miner ? new Miner(miner) : null;
    } catch (error) {
      console.error('Error getting miner by system ID:', error);
      return null;
    }
  }

  static async getAllBound() {
    try {
      const db = getDb();
      const miners = await db.collection('miners').find({ bound: true }).toArray();
      return miners.map(m => new Miner(m));
    } catch (error) {
      console.error('Error getting bound miners:', error);
      return [];
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
      
      // MongoDB driver v6+ returns the doc directly; v4 wraps it in { value: doc }
      const updatedDoc = result?.value ?? result;
      
      if (!updatedDoc || !updatedDoc.id) {
        return null;
      }
      
      return new Miner(updatedDoc);
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

  async bind() {
    return Miner.update(this.id, { bound: true });
  }

  async unbind() {
    return Miner.update(this.id, { bound: false });
  }

  toJSON() {
    // Calculate uptime if currently mining
    let calculatedUptime = this.uptime;
    if (this.mining && this.miningStartTime) {
      const startTime = new Date(this.miningStartTime);
      const now = new Date();
      calculatedUptime = Math.floor((now - startTime) / 1000); // seconds
    }
    
    return {
      id: this.id,
      systemId: this.systemId,
      name: this.name,
      hostname: this.hostname,
      ip: this.ip,
      os: this.os,
      version: this.version,
      status: this.status,
      bound: this.bound,
      lastSeen: this.lastSeen,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      currentMiner: this.currentMiner,
      currentConfig: this.currentConfig,
      deviceType: this.deviceType,
      algorithm: this.algorithm,
      hashrate: this.hashrate,
      miningStartTime: this.miningStartTime,
      uptime: calculatedUptime,
      mining: this.mining,
      devices: this.devices,
      hardware: this.hardware,
      systemInfo: this.systemInfo,
      stats: this.stats,
      connectionId: this.connectionId
    };
  }
}

module.exports = Miner;
