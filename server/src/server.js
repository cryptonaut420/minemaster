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

// Trust first proxy (nginx-proxy) so rate limiting uses real client IPs
// and req.protocol/req.hostname reflect the original request
app.set('trust proxy', 1);

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

// API Routes — rate limiters must be registered BEFORE the route handlers
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth', authRoutes);
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
  
  // Client-side routing: serve index.html for all non-API routes
  app.get('*', (req, res) => {
    // Don't serve index.html for unmatched API routes
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'Not found' });
    }
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
    
    // Start HTTP server (bind 0.0.0.0 for Docker container access)
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 MineMaster Server running on port ${PORT}`);
      console.log(`📊 Dashboard: http://0.0.0.0:${PORT}`);
      console.log(`🔌 WebSocket: ws://0.0.0.0:${PORT}`);
      if (process.env.VIRTUAL_HOST) {
        console.log(`🌐 Subdomain: https://${process.env.VIRTUAL_HOST}`);
      }
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

// Global error handlers — prevent silent crashes in production
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  // Give time for logs to flush, then exit (systemd/pm2 will restart)
  setTimeout(() => process.exit(1), 1000);
});

// Graceful shutdown — close WebSocket connections before HTTP server
function gracefulShutdown(signal) {
  console.log(`${signal} received, shutting down gracefully...`);

  // Close all WebSocket connections
  if (wss) {
    wss.clients.forEach((client) => {
      try { client.close(1001, 'Server shutting down'); } catch (_) {}
    });
  }

  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });

  // Force exit if graceful shutdown takes too long
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

module.exports = app;
