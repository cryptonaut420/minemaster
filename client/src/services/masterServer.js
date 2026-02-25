/**
 * Master Server Connection Service
 * Handles WebSocket connection and communication with the MineMaster server
 */

import { getSystemId } from '../utils/systemId';

class MasterServerService {
  constructor() {
    this.ws = null;
    this.config = null;
    this.connected = false;
    this.bound = false;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this._cachedSystemId = null;
    this.listeners = {
      connected: [],
      disconnected: [],
      bound: [],
      registered: [],
      unbound: [],
      configUpdate: [],
      command: [],
      error: []
    };
    this.maxMessageBytes = 1024 * 1024;
    this.reconnectAttempts = 0;
    this.maxReconnectInterval = 60000;
  }

  /**
   * Load master server configuration
   */
  async loadConfig() {
    if (!window.electron) {
      throw new Error('Electron API not available');
    }

    try {
      const config = await window.electron.invoke('load-master-config');
      this.config = config;
      return config;
    } catch (error) {
      throw new Error('Failed to load master server config');
    }
  }

  /**
   * Save master server configuration
   */
  async saveConfig(config) {
    if (!window.electron) {
      throw new Error('Electron API not available');
    }

    try {
      await window.electron.invoke('save-master-config', config);
      this.config = config;
    } catch (error) {
      throw new Error('Failed to save master server config');
    }
  }

  /**
   * Connect to master server
   */
  async connect() {
    if (!this.config) {
      await this.loadConfig();
    }

    if (!this.config.enabled) {
      throw new Error('Master server connection is disabled');
    }

    // Don't create a new connection if already connected or connecting
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    // Use wss:// for port 443 (HTTPS/TLS via nginx-proxy), ws:// for local dev
    const secure = this.config.port === 443;
    const protocol = secure ? 'wss' : 'ws';
    const url = secure
      ? `${protocol}://${this.config.host}`
      : `${protocol}://${this.config.host}:${this.config.port}`;

    return new Promise((resolve, reject) => {
      let settled = false;

      // Timeout if connection takes too long
      const connectTimeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          try { this.ws?.close(); } catch (_) {}
          reject(new Error('Connection timeout'));
        }
      }, 15000);

      try {
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
          if (settled) return;
          settled = true;
          clearTimeout(connectTimeout);
          this.connected = true;
          this.reconnectAttempts = 0;
          this.emit('connected');
          this.startHeartbeat();
          resolve();
        };

        this.ws.onclose = () => {
          clearTimeout(connectTimeout);
          const wasBound = this.bound;
          this.connected = false;
          this.bound = false;
          this.emit('disconnected');
          this.stopHeartbeat();
          
          if (this.config?.autoReconnect && wasBound) {
            this.scheduleReconnect();
          }
        };

        this.ws.onerror = (error) => {
          // Only reject the connect promise; onclose handles reconnect logic
          if (!settled) {
            settled = true;
            clearTimeout(connectTimeout);
            reject(error);
          }
          this.emit('error', error);
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };
      } catch (error) {
        clearTimeout(connectTimeout);
        if (!settled) {
          settled = true;
          reject(error);
        }
      }
    });
  }

  /**
   * Disconnect from master server
   */
  disconnect() {
    // Disable auto-reconnect
    if (this.config) {
      this.config.enabled = false;
    }
    
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.bound = false;
  }

  /**
   * Schedule reconnection attempt (for auto-reconnect when bound)
   */
  scheduleReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Don't reconnect if explicitly disabled
    if (!this.config?.enabled || !this.config?.autoReconnect) return;

    const baseInterval = this.config?.reconnectInterval || 5000;
    const backoff = Math.min(baseInterval * Math.pow(2, this.reconnectAttempts), this.maxReconnectInterval);
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connect();
      } catch (err) {
        if (this.config?.autoReconnect && this.config?.enabled) {
          this.scheduleReconnect();
        }
      }
    }, backoff);
  }

  /**
   * Start heartbeat
   */
  startHeartbeat() {
    this.stopHeartbeat();
    const interval = this.config?.heartbeatInterval || 30000;
    
    this.heartbeatTimer = setInterval(() => {
      if (this.bound) {
        this.send({ type: 'heartbeat' });
      }
    }, interval);
  }

  /**
   * Stop heartbeat
   */
  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Send message to server
   */
  send(message) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    try {
      const serialized = JSON.stringify(message);
      const messageBytes = new TextEncoder().encode(serialized).byteLength;
      if (messageBytes > this.maxMessageBytes) {
        this.emit('error', new Error(`Outbound message too large: ${messageBytes} bytes`));
        return false;
      }

      this.ws.send(serialized);
      return true;
    } catch (error) {
      this.emit('error', error);
      return false;
    }
  }

  /**
   * Handle incoming message
   */
  handleMessage(data) {
    try {
      const message = JSON.parse(data);

      switch (message.type) {
        case 'connected':
          // Server sends connection confirmation with connectionId
          break;
        case 'bound':
          this.bound = true;
          this.emit('bound', message.data);
          break;
        case 'registered':
          // Silent registration acknowledgment (reconnect)
          this.bound = true;
          this.emit('registered', message.data);
          break;
        case 'unbound':
          this.bound = false;
          this.emit('unbound');
          break;
        case 'config-update':
          this.emit('configUpdate', message.data);
          break;
        case 'command':
          this.emit('command', message.data);
          break;
        case 'error':
          this.emit('error', new Error(message.error));
          break;
        case 'pong':
        case 'miner_status_update':
          // Heartbeat response / status broadcast - ignore
          break;
        default:
          // Unknown message types - ignore silently
          break;
      }
    } catch (error) {
      // Silently ignore parse errors
    }
  }

  /**
   * Bind this client to the master server (connects + registers)
   */
  async bind(systemInfo, silent = false, devices = null, clientName = null) {
    // First ensure we're connected
    if (!this.connected) {
      if (!this.config) {
        await this.loadConfig();
      }
      
      if (!this.config.enabled) {
        // Enable connection
        this.config.enabled = true;
        await this.saveConfig(this.config);
      }
      
      // Connect to server
      await this.connect();
    }
    
    // Now register/bind
    const systemId = await this.getCachedSystemId();
    
    const registrationData = {
      systemId,
      systemInfo,
      silent, // For silent re-registration on reconnect
      timestamp: Date.now()
    };
    
    // Include device states if provided (so server knows current enabled states)
    if (devices) {
      registrationData.devices = devices;
    }
    
    // Include custom client name (overrides hostname on server, empty string = use hostname)
    if (clientName !== null && clientName !== undefined) {
      registrationData.clientName = clientName;
    }
    
    this.send({
      type: 'register',
      data: registrationData
    });
    
    // Note: bound event will be emitted when server responds
  }

  /**
   * Unbind this client from the master server (unregisters + disconnects)
   */
  async unbind() {
    // First unregister if bound
    if (this.bound) {
      const systemId = await this.getCachedSystemId();
      
      this.send({
        type: 'unbound',
        data: {
          systemId
        }
      });
    }
    
    // Then disconnect
    this.disconnect();
    
    // Emit unbound event
    this.bound = false;
    this.emit('unbound');
  }

  /**
   * Request global configs from server
   */
  requestConfigs() {
    this.send({
      type: 'request-configs'
    });
  }

  /**
   * Get systemId with in-memory caching (avoids repeated localStorage reads on every update cycle)
   */
  async getCachedSystemId() {
    if (this._cachedSystemId) return this._cachedSystemId;
    const id = await getSystemId();
    if (id && id !== 'unknown-mac') {
      this._cachedSystemId = id;
    }
    return id;
  }

  /**
   * Send status update to server
   */
  async sendStatusUpdate(status) {
    const systemId = await this.getCachedSystemId();
    
    this.send({
      type: 'status-update',
      data: {
        systemId,
        ...status,
        timestamp: Date.now()
      }
    });
  }

  /**
   * Send hashrate update to server
   */
  async sendHashrateUpdate(hashrate) {
    const systemId = await this.getCachedSystemId();
    
    this.send({
      type: 'hashrate-update',
      data: {
        systemId,
        hashrate,
        timestamp: Date.now()
      }
    });
  }

  /**
   * Add event listener
   */
  on(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event].push(callback);
    }
  }

  /**
   * Remove event listener
   */
  off(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    }
  }

  /**
   * Emit event
   */
  emit(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          // Silent fail - listener errors should not break the service
        }
      });
    }
  }

  /**
   * Check if connected
   */
  isConnected() {
    return this.connected;
  }

  /**
   * Check if bound
   */
  isBound() {
    return this.bound;
  }
}

// Export singleton instance
export const masterServer = new MasterServerService();
