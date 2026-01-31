require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const rateLimit = require('express-rate-limit');

const { connect: connectDB, getDb } = require('./db/mongodb');
const minerRoutes = require('./api/miners');
const configRoutes = require('./api/configs');
const statsRoutes = require('./api/stats');
const authRoutes = require('./api/auth');
const websocketServer = require('./websocket/server');

const app = express();
const PORT = process.env.PORT || 3001;

// Rate limiting for login attempts
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 login requests per windowMs
  message: { error: 'Too many login attempts, please try again after 15 minutes' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true // Don't count successful logins
});

// General API rate limiter
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // Limit each IP to 100 requests per minute
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Make database available to routes
app.use((req, res, next) => {
  req.app.locals.db = getDb();
  next();
});

// API Routes
app.use('/api/auth', authRoutes);
app.post('/api/auth/login', loginLimiter); // Apply rate limiting to login
app.use('/api/miners', apiLimiter, minerRoutes);
app.use('/api/configs', apiLimiter, configRoutes);
app.use('/api/stats', apiLimiter, statsRoutes);

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
