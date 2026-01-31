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
    this.listeners = {
      connected: [],
      disconnected: [],
      bound: [],
      unbound: [],
      configUpdate: [],
      command: [],
      error: []
    };
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

    const url = `ws://${this.config.host}:${this.config.port}`;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
          this.connected = true;
          this.emit('connected');
          this.startHeartbeat();
          resolve();
        };

        this.ws.onclose = () => {
          const wasBound = this.bound;
          this.connected = false;
          this.bound = false;
          this.emit('disconnected');
          this.stopHeartbeat();
          
          // Auto-reconnect if enabled
          if (this.config?.autoReconnect && wasBound) {
            this.scheduleReconnect();
          }
        };

        this.ws.onerror = (error) => {
          this.emit('error', error);
          reject(error);
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };
      } catch (error) {
        reject(error);
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
    }

    const interval = this.config?.reconnectInterval || 5000;
    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect();
        // After reconnecting, we need to re-register
        // This will be handled by MasterServerPanel's auto-reconnect logic
        // which calls bind() with silent=true
      } catch (err) {
        // Schedule another attempt if still enabled
        if (this.config?.autoReconnect) {
          this.scheduleReconnect();
        }
      }
    }, interval);
  }

  /**
   * Start heartbeat
   */
  startHeartbeat() {
    this.stopHeartbeat();
    const interval = this.config?.heartbeatInterval || 30000;
    
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: 'heartbeat' });
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

    this.ws.send(JSON.stringify(message));
    return true;
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
  async bind(systemInfo, silent = false, devices = null) {
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
    const systemId = await getSystemId();
    
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
      const systemId = await getSystemId();
      
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
   * Send status update to server
   */
  async sendStatusUpdate(status) {
    const systemId = await getSystemId();
    
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
    const systemId = await getSystemId();
    
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
