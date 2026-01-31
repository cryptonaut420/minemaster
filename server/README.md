# MineMaster Server

Centralized mining management server with REST API and web dashboard for monitoring and controlling multiple mining clients.

## Features

- **📊 Dashboard** - Real-time overview of all connected miners
- **💻 Miners Management** - View, control, and monitor individual miners
- **⚙️ Global Configurations** - Set pool, wallet, and algorithm settings for XMRig and Nanominer
- **🔄 Real-time Updates** - WebSocket-based live status updates
- **🔗 Auto-sync** - Clients automatically receive configuration updates

## Installation

```bash
cd server

# Install server dependencies
npm install

# Install dashboard dependencies
cd public
npm install
```

## Running

### Development Mode

```bash
# Terminal 1: Start API server
npm run dev

# Terminal 2: Start dashboard (Vite)
cd public
npm run dev
```

- **API Server**: http://localhost:3001
- **Dashboard Dev**: http://localhost:3002

### Production Mode

```bash
# Build dashboard
cd public
npm run build
cd ..

# Start server
NODE_ENV=production npm start
```

Server runs on http://localhost:3001 (serves both API and built dashboard)

## Global Configuration Options

### XMRig (CPU Mining)

| Field | Description |
|-------|-------------|
| `coin` | Cryptocurrency symbol (e.g., XMR) |
| `algorithm` | Mining algorithm (rx/0, rx/wow, rx/arq, cn/r, cn/half, ghostrider) |
| `pool` | Pool address with port |
| `user` | Wallet address |
| `password` | Pool password (usually 'x') |
| `threadPercentage` | CPU usage percentage (10-100%) |
| `additionalArgs` | Extra command line arguments |

### Nanominer (GPU Mining)

| Field | Description |
|-------|-------------|
| `coin` | Cryptocurrency symbol (e.g., RVN) |
| `algorithm` | Mining algorithm (ethash, etchash, kawpow, autolykos, conflux, ton, kaspa, karlsenhash, nexa) |
| `pool` | Pool address with port |
| `user` | Wallet address |
| `rigName` | Worker/rig identifier |

*Note: GPU selection is configured on each client individually.*

## API Endpoints

### Miners

- `GET /api/miners` - List all registered miners
- `GET /api/miners/:id` - Get miner details
- `POST /api/miners` - Register a new miner
- `PUT /api/miners/:id` - Update miner
- `DELETE /api/miners/:id` - Remove miner
- `POST /api/miners/:id/restart` - Restart miner
- `POST /api/miners/:id/stop` - Stop mining
- `POST /api/miners/:id/start` - Start mining with config

### Configs

- `GET /api/configs` - Get all global configs
- `GET /api/configs/:type` - Get config for miner type
- `PUT /api/configs/:type` - Update config (auto-broadcasts to clients)
- `POST /api/configs/:type/apply` - Apply config and restart all miners using it

## WebSocket Events

### From Server

- `connected` - Connection established
- `config_updated` - Global config was updated
- `command` - Command from server (start, stop, restart, restart_with_config)

### From Client

- `register` - Register miner with server
- `status_update` - Update miner status
- `mining_update` - Update mining statistics
- `heartbeat` - Keep-alive ping

## Authentication

The server includes a built-in authentication system:

### First-Time Setup
1. Navigate to the dashboard
2. Create your admin account on the registration screen
3. Only one admin account can exist

### Features
- JWT-based authentication (7-day token expiration)
- Rate limiting: 5 login attempts per 15 minutes
- API rate limiting: 100 requests per minute
- bcrypt password hashing

### Password Reset
```bash
cd server
node scripts/reset-password.js admin@example.com NewPassword123
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3001 | Server port |
| `NODE_ENV` | development | Environment mode |
| `JWT_SECRET` | (auto-generated) | JWT signing key - set for production |
| `MONGO_HOST` | localhost | MongoDB host |
| `MONGO_PORT` | 27017 | MongoDB port |
| `MONGO_DB_NAME` | minemaster | Database name |

## Data Storage

Uses MongoDB for persistent storage:
- `miners` collection - Registered miners
- `configs` collection - Global configurations  
- `admins` collection - Admin users
- `hashrates` collection - Historical hashrate data
