const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGO_HOST = process.env.MONGO_HOST || 'localhost';
const MONGO_PORT = process.env.MONGO_PORT || 27017;
const MONGO_USERNAME = process.env.MONGO_USERNAME || '';
const MONGO_PASSWORD = process.env.MONGO_PASSWORD || '';
const MONGO_DB_NAME = process.env.MONGO_DB_NAME || 'minemaster';

// Build connection string
let mongoUrl;
if (MONGO_USERNAME && MONGO_PASSWORD) {
  mongoUrl = `mongodb://${MONGO_USERNAME}:${MONGO_PASSWORD}@${MONGO_HOST}:${MONGO_PORT}/${MONGO_DB_NAME}?authSource=admin`;
} else {
  mongoUrl = `mongodb://${MONGO_HOST}:${MONGO_PORT}/${MONGO_DB_NAME}`;
}

let client = null;
let db = null;

async function connect() {
  if (db) {
    return db;
  }

  try {
    client = new MongoClient(mongoUrl, {
      serverSelectionTimeoutMS: 5000,
    });

    await client.connect();
    db = client.db(MONGO_DB_NAME);
    
    console.log(`✅ Connected to MongoDB: ${MONGO_HOST}:${MONGO_PORT}/${MONGO_DB_NAME}`);
    
    // Create indexes
    await createIndexes();
    
    return db;
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    throw error;
  }
}

async function createIndexes() {
  if (!db) return;
  
  try {
    // Miners collection indexes
    await db.collection('miners').createIndex({ systemId: 1 }, { unique: true, sparse: true });
    await db.collection('miners').createIndex({ connectionId: 1 }, { unique: true, sparse: true });
    await db.collection('miners').createIndex({ hostname: 1, ip: 1 });
    await db.collection('miners').createIndex({ status: 1 });
    await db.collection('miners').createIndex({ bound: 1 });
    await db.collection('miners').createIndex({ lastSeen: 1 });
    
    // Hash rates collection indexes
    await db.collection('hashrates').createIndex({ minerId: 1, timestamp: -1 });
    await db.collection('hashrates').createIndex({ timestamp: -1 }, { expireAfterSeconds: 86400 * 7 }); // 7 days TTL
    
    console.log('✅ MongoDB indexes created');
  } catch (error) {
    console.error('Error creating indexes:', error);
  }
}

async function disconnect() {
  if (client) {
    await client.close();
    client = null;
    db = null;
    console.log('MongoDB disconnected');
  }
}

function getDb() {
  if (!db) {
    throw new Error('Database not connected. Call connect() first.');
  }
  return db;
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  await disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await disconnect();
  process.exit(0);
});

module.exports = {
  connect,
  disconnect,
  getDb
};
