# Client-Server Binding Guide

This guide explains how to connect MineMaster clients to a central Master Server for remote management and monitoring.

## Overview

MineMaster supports a client-server architecture that allows you to:

- Centrally manage multiple mining rigs from a single dashboard
- Monitor hashrates and system info across all miners in real-time
- Apply global mining configurations to all connected clients
- Send remote commands (start, stop, restart) to individual or all miners
- Track historical hashrate data and performance

## Architecture

### Components

1. **MineMaster Client**: The local Electron app running on each mining rig
2. **MineMaster Server**: The central management server with web dashboard
3. **WebSocket Connection**: Real-time bi-directional communication between clients and server

### How It Works

- Each client has a unique System ID (MAC address)
- Clients can operate independently or bind to a Master Server
- When bound, clients receive global mining configs from the server
- Server can send commands to bound clients (start, stop, restart)
- Clients send periodic status and hashrate updates to the server

## Setup

### Server Setup

1. **Install Dependencies**
   ```bash
   cd /var/www/Ironclad/minemaster/server
   npm install
   ```

2. **Configure Environment**
   ```bash
   cp env.example .env
   ```
   
   Edit `.env` and set your MongoDB connection details:
   ```env
   MONGO_HOST=localhost
   MONGO_PORT=27017
   MONGO_USER=your_username
   MONGO_PASSWORD=your_password
   MONGO_DB=minemaster
   PORT=3001
   ```

3. **Start Server**
   ```bash
   npm start
   ```

4. **Access Dashboard**
   Open browser to `http://your-server:3001`

### Client Setup

1. **Configure Master Server Connection**
   
   Edit `/var/www/Ironclad/minemaster/client/master-server.json`:
   ```json
   {
     "enabled": false,
     "host": "your-server-ip",
     "port": 3001,
     "autoReconnect": true,
     "reconnectInterval": 5000,
     "heartbeatInterval": 30000
   }
   ```

2. **Start MineMaster Client**
   ```bash
   cd /var/www/Ironclad/minemaster/client
   npm start
   ```

3. **Bind to Master**
   - In the client app, you'll see a "Master Server" panel at the top of the Dashboard
   - Click "Connect & Enable" to connect to the server
   - Click "Bind to Master" to register this client with the server
   - Once bound, the client will automatically sync configs from the server

## Using the System

### Client Side

#### Independent Mode
- Default mode - client operates without server connection
- Full access to all configuration options
- Mine locally with your own settings

#### Bound Mode
- Client is connected and bound to Master Server
- Most configuration options are disabled (controlled by server)
- **Password** (XMRig) and **Rig Name** (Nanominer) can still be edited locally
- Mining configs are automatically synced from the server
- Server can send remote commands to start/stop/restart mining

#### Binding/Unbinding

**To Bind:**
1. Configure `master-server.json` with your server details
2. In the Dashboard, click "Connect & Enable"
3. Click "Bind to Master"
4. Your client is now registered and managed by the server

**To Unbind:**
1. Click "Unbind" in the Master Server panel
2. Client returns to independent mode
3. All config options become editable again

### Server Side

#### Dashboard Overview
- View all registered miners
- See online/offline status in real-time
- Monitor total hashrate across all miners
- Hashrate breakdown by device type (CPU/GPU) and algorithm

#### Miner Management
- Start/stop/restart individual miners remotely
- View detailed system information for each miner
- Remove miners from the registry
- See bound vs. unbound status

#### Global Configurations
- Configure XMRig settings (pool, algorithm, CPU usage, etc.)
- Configure Nanominer settings (pool, algorithm, wallet, etc.)
- Changes are automatically propagated to all bound clients
- "Save" - Updates config only
- "Save & Restart Miners" - Updates config and restarts all bound miners

## Configuration Propagation

### How It Works

1. Admin edits global config in server dashboard
2. Server broadcasts config update to all bound clients via WebSocket
3. Clients receive update and merge with local config
4. Local password/rigName fields are preserved
5. New config is applied to miners

### Auto-Sync Behavior

- Bound clients check for config updates on connection
- Config updates are pushed in real-time when saved
- Clients automatically reconnect if connection is lost (if `autoReconnect: true`)

## Remote Commands

The server can send the following commands to bound clients:

### Start Mining
- **Action**: `start`
- **Description**: Starts all enabled miners on the client
- **Optional**: Can specify `deviceType` (CPU or GPU)

### Stop Mining
- **Action**: `stop`
- **Description**: Stops all running miners on the client

### Restart Mining
- **Action**: `restart`
- **Description**: Stops and restarts all running miners (applies new config)

### Config Update
- **Action**: `config-update`
- **Description**: Pushes latest global configs to client

## Data Collection

### Status Updates
Clients send status updates to the server every 10 seconds, including:
- System information (CPU, RAM, GPU)
- Mining status (running/stopped)
- Current miner configurations
- Enabled devices

### Hashrate Tracking
Clients send hashrate updates for running miners, including:
- Miner ID and device type
- Current algorithm
- Real-time hashrate value
- Timestamp

This data is stored in MongoDB and used for:
- Historical hashrate graphs
- Performance monitoring
- Hashrate breakdown by device/algorithm

## Security Considerations

### Current Implementation
- WebSocket connections use standard `ws://` protocol
- No authentication required for client-server connection
- Master server should be on a trusted private network

### Recommendations
1. Run server on a private network or VPN
2. Use firewall rules to restrict access to port 3001
3. For internet-facing deployments, consider:
   - Implementing WebSocket authentication
   - Using `wss://` (WebSocket Secure)
   - Setting up reverse proxy with SSL (nginx/apache)

## Troubleshooting

### Client Won't Connect

**Check:**
- Server is running (`curl http://your-server:3001`)
- `master-server.json` has correct host and port
- Firewall allows outbound connections on port 3001
- Network connectivity between client and server

**Solution:**
- Check server logs for connection attempts
- Verify network configuration
- Test with `telnet your-server 3001`

### Config Not Syncing

**Check:**
- Client is bound (shows "Bound to Master" in UI)
- WebSocket connection is active (status shows "Connected")
- Server dashboard shows client as "online"

**Solution:**
- Click "Unbind" then "Bind to Master" again
- Restart client application
- Check server logs for errors

### Commands Not Executing

**Check:**
- Client is bound and online
- Miner configs are valid (pool, wallet addresses set)
- Client has necessary permissions to run miners

**Solution:**
- Check client console for error messages
- Verify miner binaries exist and are executable
- Test starting miner locally first

### Miner Shows "Not Bound"

**Check:**
- Client needs to explicitly bind to server
- Connection alone is not enough - binding is a separate action

**Solution:**
- In client app, click "Bind to Master" button
- Check that binding completed successfully
- Verify in server dashboard that miner shows bound status

## API Endpoints

The server exposes the following REST API endpoints:

### Miners
- `GET /api/miners` - Get all registered miners
- `GET /api/miners/:id` - Get specific miner
- `POST /api/miners/:id/start` - Start mining on miner
- `POST /api/miners/:id/stop` - Stop mining on miner
- `POST /api/miners/:id/restart` - Restart mining on miner
- `DELETE /api/miners/:id` - Remove miner from registry

### Configs
- `GET /api/configs` - Get all global configs
- `GET /api/configs/:type` - Get config by type (xmrig, nanominer)
- `PUT /api/configs/:type` - Update global config
- `POST /api/configs/:type/apply` - Apply config and restart miners

### Stats
- `GET /api/stats` - Get aggregated statistics
- `GET /api/stats/hashrate` - Get hashrate breakdown

## Database Schema

### Miners Collection
```javascript
{
  id: String,
  systemId: String,           // MAC address
  name: String,
  hostname: String,
  ip: String,
  os: String,
  status: String,             // online, offline, mining
  bound: Boolean,             // Bound to master
  mining: Boolean,            // Currently mining
  currentMiner: String,       // xmrig, nanominer
  algorithm: String,
  deviceType: String,         // CPU, GPU
  hashrate: Number,
  systemInfo: Object,
  hardware: {
    cpu: Object,
    gpus: Array,
    ram: Object
  },
  connectionId: String,
  lastSeen: Date,
  createdAt: Date,
  updatedAt: Date
}
```

### HashRates Collection
```javascript
{
  minerId: String,
  deviceType: String,
  algorithm: String,
  hashrate: Number,
  timestamp: Date,
  expiresAt: Date             // TTL index (30 days)
}
```

### Configs Collection
```javascript
{
  type: String,               // xmrig, nanominer
  [config fields],            // Varies by miner type
  updatedAt: Date
}
```

## Best Practices

1. **Keep Server Updated**: Regularly update server software and dependencies
2. **Monitor Logs**: Check server and client logs for issues
3. **Backup Database**: Regular backups of MongoDB data
4. **Network Stability**: Ensure reliable network connection between clients and server
5. **Test Changes**: Test config changes on a single miner before applying to all
6. **Unique Rig Names**: Use descriptive, unique rig names for easy identification
7. **Regular Monitoring**: Check dashboard regularly for offline miners or performance issues

## Future Enhancements

Potential features for future releases:
- WebSocket authentication and encryption
- Role-based access control for dashboard
- Historical performance charts
- Email/SMS alerts for offline miners or low hashrate
- Bulk operations (start/stop groups of miners)
- Scheduled mining (mine during off-peak hours)
- Profitability switching
- Pool failover configuration
