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
      console.error('Error loading master server config:', error);
      throw error;
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
      console.error('Error saving master server config:', error);
      throw error;
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
    console.log(`Connecting to master server: ${url}`);

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
          console.log('Connected to master server');
          this.connected = true;
          this.emit('connected');
          this.startHeartbeat();
          resolve();
        };

        this.ws.onclose = () => {
          console.log('Disconnected from master server');
          this.connected = false;
          this.bound = false;
          this.emit('disconnected');
          this.stopHeartbeat();
          
          // Auto-reconnect if enabled
          if (this.config?.autoReconnect) {
            this.scheduleReconnect();
          }
        };

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
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
    this.config.enabled = false;
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
   * Schedule reconnection attempt
   */
  scheduleReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    const interval = this.config?.reconnectInterval || 5000;
    this.reconnectTimer = setTimeout(() => {
      console.log('Attempting to reconnect to master server...');
      this.connect().catch(err => {
        console.error('Reconnection failed:', err);
      });
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
      console.warn('WebSocket not connected');
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
      console.log('Received message from server:', message);

      switch (message.type) {
        case 'connected':
          // Server sends connection confirmation with connectionId
          console.log('Connection confirmed by server:', message.connectionId);
          break;
        case 'bound':
          this.bound = true;
          this.emit('bound', message.data);
          break;
        case 'registered':
          // Silent registration acknowledgment (reconnect)
          // Update internal state but don't emit bound event to avoid notification spam
          this.bound = true;
          console.log('Silently registered/reconnected to server');
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
          console.error('Server error:', message.error);
          this.emit('error', new Error(message.error));
          break;
        case 'pong':
          // Heartbeat response
          break;
        default:
          console.warn('Unknown message type:', message.type);
      }
    } catch (error) {
      console.error('Error parsing message:', error);
    }
  }

  /**
   * Register/bind this client to the master server
   */
  async bind(systemInfo) {
    const systemId = await getSystemId();
    
    this.send({
      type: 'register',
      data: {
        systemId,
        systemInfo,
        timestamp: Date.now()
      }
    });
  }

  /**
   * Unbind this client from the master server
   */
  async unbind() {
    const systemId = await getSystemId();
    
    this.send({
      type: 'unbound',
      data: {
        systemId
      }
    });

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
          console.error(`Error in ${event} listener:`, error);
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
