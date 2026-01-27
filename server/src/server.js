require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');

const { connect: connectDB } = require('./db/mongodb');
const minerRoutes = require('./api/miners');
const configRoutes = require('./api/configs');
const statsRoutes = require('./api/stats');
const websocketServer = require('./websocket/server');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API Routes
app.use('/api/miners', minerRoutes);
app.use('/api/configs', configRoutes);
app.use('/api/stats', statsRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve static files from React app in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../public/build')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/build/index.html'));
  });
}

// Create HTTP server
const server = http.createServer(app);

// Setup WebSocket server
const wss = new WebSocket.Server({ server });
websocketServer.initialize(wss);

// Start server
async function startServer() {
  try {
    // Connect to MongoDB
    await connectDB();
    
    // Start HTTP server
    server.listen(PORT, () => {
      console.log(`🚀 MineMaster Server running on http://localhost:${PORT}`);
      console.log(`📊 Dashboard: http://localhost:${PORT}`);
      console.log(`🔌 WebSocket: ws://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

module.exports = app;
