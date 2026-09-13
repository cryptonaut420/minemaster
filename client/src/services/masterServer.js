/**
 * Master Server Connection Service
 * Handles WebSocket connection and communication with the MineMaster server
 */

import versionInfo from "../version.json";
import { getSystemId } from "../utils/systemId";

class MasterServerService {
  constructor() {
    this.ws = null;
    this.config = null;
    this.connected = false;
    this.bound = false;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this._cachedSystemId = null;
    this.reconnectAttempts = 0;
    this.maxReconnectDelay = 30000;
    this.baseReconnectDelay = 2000;
    this._connecting = false;
    this.listeners = {
      connected: [],
      disconnected: [],
      bound: [],
      registered: [],
      unbound: [],
      configUpdate: [],
      command: [],
      commandCancel: [],
      error: [],
    };
    this.bootId = window.crypto?.randomUUID?.() || String(Date.now());
    this.logQueue = [];
    this.logSequence = 0;
    this.maxMessageBytes = 1024 * 1024;
  }

  /**
   * Load master server configuration
   */
  async loadConfig() {
    if (!window.electron) {
      throw new Error("Electron API not available");
    }

    try {
      const config = await window.electron.invoke("load-master-config");
      this.config = config;
      return config;
    } catch (error) {
      throw new Error("Failed to load master server config");
    }
  }

  /**
   * Save master server configuration
   */
  async saveConfig(config) {
    if (!window.electron) {
      throw new Error("Electron API not available");
    }

    try {
      await window.electron.invoke("save-master-config", config);
      this.config = config;
    } catch (error) {
      throw new Error("Failed to save master server config");
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
      throw new Error("Master server connection is disabled");
    }

    // Don't create a new connection if already connected or connecting
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    // Guard against concurrent connect calls
    if (this._connecting) {
      return;
    }

    // Clean up any previous dead socket
    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) {}
      this.ws = null;
    }

    this._connecting = true;

    // Use wss:// for port 443 (HTTPS/TLS via nginx-proxy), ws:// for local dev
    const secure = Number(this.config.port) === 443;
    const protocol = secure ? "wss" : "ws";
    const url = secure
      ? `${protocol}://${this.config.host}`
      : `${protocol}://${this.config.host}:${this.config.port}`;

    return new Promise((resolve, reject) => {
      let resolved = false;

      try {
        const socket = new WebSocket(url);
        this.ws = socket;

        // Connection timeout — if we don't connect within 10 seconds, give up this attempt
        const connectTimeout = setTimeout(() => {
          if (this.ws !== socket) {
            if (!resolved) {
              resolved = true;
              reject(new Error("Connection superseded"));
            }
            return;
          }
          if (!resolved) {
            resolved = true;
            this._connecting = false;
            try {
              this.ws.close();
            } catch (e) {}
            const err = new Error("Connection timeout");
            this.emit("error", err);
            // Schedule reconnect on timeout
            if (this.config?.autoReconnect) {
              this.scheduleReconnect();
            }
            reject(err);
          }
        }, 10000);

        socket.onopen = () => {
          if (this.ws !== socket) return;
          clearTimeout(connectTimeout);
          this._connecting = false;
          this.connected = true;
          this.reconnectAttempts = 0;
          this.cancelReconnect();
          this.lastServerMessage = Date.now();
          this.emit("connected");
          this.startHeartbeat();
          if (!resolved) {
            resolved = true;
            resolve();
          }
        };

        socket.onclose = () => {
          clearTimeout(connectTimeout);
          if (this.ws !== socket) {
            if (!resolved) {
              resolved = true;
              reject(new Error("Connection superseded"));
            }
            return;
          }
          this._connecting = false;
          const wasConnected = this.connected;
          this.connected = false;
          this.bound = false;
          this.stopHeartbeat();

          if (wasConnected) {
            this.emit("disconnected");
          }

          if (this.config?.enabled && this.config?.autoReconnect) {
            this.scheduleReconnect();
          }

          // Reject the initial connect promise if it hasn't resolved yet
          if (!resolved) {
            resolved = true;
            reject(new Error("Connection closed"));
          }
        };

        socket.onerror = (error) => {
          if (this.ws !== socket) return;
          this.emit("error", error);
        };

        socket.onmessage = (event) => {
          if (this.ws !== socket) return;
          this.lastServerMessage = Date.now();
          if (
            typeof event.data === "string" &&
            event.data.length <= this.maxMessageBytes
          )
            this.handleMessage(event.data);
        };
      } catch (error) {
        this._connecting = false;
        if (this.config?.enabled && this.config?.autoReconnect)
          this.scheduleReconnect();
        if (!resolved) {
          resolved = true;
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
    this.cancelReconnect();
    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) {}
      this.ws = null;
    }
    this.connected = false;
    this.bound = false;
    this._connecting = false;
    this.emit("disconnected");
    this.reconnectAttempts = 0;
  }

  /**
   * Cancel any pending reconnect
   */
  cancelReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * Schedule reconnection with exponential backoff + jitter
   */
  scheduleReconnect() {
    this.cancelReconnect();

    // Exponential backoff: 2s, 4s, 8s, 16s, 30s (capped)
    const delay = Math.min(
      this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectDelay,
    );
    // Add jitter (±25%) to prevent thundering herd
    const jitter = delay * (0.75 + Math.random() * 0.5);

    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connect();
      } catch (err) {
        // connect() failure triggers onclose which calls scheduleReconnect
      }
    }, jitter);
  }

  /**
   * Start heartbeat
   */
  startHeartbeat() {
    this.stopHeartbeat();
    const interval = Math.max(
      5000,
      Math.min(30000, Number(this.config?.heartbeatInterval) || 30000),
    );

    this.heartbeatTimer = setInterval(() => {
      if (
        Date.now() - this.lastServerMessage > 90000 ||
        !this.send({ type: "heartbeat" })
      ) {
        this.stopHeartbeat();
        if (this.ws) {
          try {
            this.ws.close();
          } catch (e) {}
        }
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
    if (
      !this.ws ||
      this.ws.readyState !== WebSocket.OPEN ||
      this.ws.bufferedAmount > this.maxMessageBytes
    ) {
      return false;
    }

    try {
      const serialized = JSON.stringify(message);
      const messageBytes = new TextEncoder().encode(serialized).byteLength;
      if (messageBytes > this.maxMessageBytes) {
        this.emit(
          "error",
          new Error(`Outbound message too large: ${messageBytes} bytes`),
        );
        return false;
      }

      this.ws.send(serialized);
      return true;
    } catch (error) {
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
        case "connected":
          // Server sends connection confirmation with connectionId
          break;
        case "bound":
          this.bound = true;
          this.emit("bound", message.data);
          break;
        case "registered":
          // Silent registration acknowledgment (reconnect)
          this.bound = true;
          this.emit("registered", message.data);
          break;
        case "unbound":
          this.bound = false;
          this.emit("unbound");
          break;
        case "config-update":
          this.emit("configUpdate", message.data);
          break;
        case "command-cancel":
          this.emit("commandCancel", message.data);
          break;
        case "command":
          this.emit("command", message.data);
          break;
        case "error":
          this.emit("error", new Error(message.error));
          break;
        case "pong":
        case "miner_status_update":
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
      protocolVersion: 2,
      version: versionInfo.displayVersion,
      bootId: this.bootId,
      capabilities: {
        commandResults: true,
        processHashrate: true,
        logs: true,
        sensorHistory: true,
        perGpuControl: false,
        minerMaintenance: true,
        appUpdates: true,
        cpuEngines:
          window.electronAPI?.platform === "darwin"
            ? ["xmrig"]
            : ["xmrig", "nanominer"],
      },
      systemInfo,
      silent, // For silent re-registration on reconnect
      timestamp: Date.now(),
    };

    // Include device states if provided (so server knows current enabled states)
    if (devices) {
      registrationData.devices = devices;
    }

    // Include custom client name (overrides hostname on server, empty string = use hostname)
    if (clientName !== null && clientName !== undefined) {
      registrationData.clientName = clientName;
    }

    if (!this.send({ type: "register", data: registrationData })) {
      throw new Error(
        "Failed to send registration — connection may have dropped",
      );
    }

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
        type: "unbound",
        data: {
          systemId,
        },
      });
    }

    // Then disconnect
    this.disconnect();

    // Emit unbound event
    this.bound = false;
    this.emit("unbound");
  }

  /**
   * Request global configs from server
   */
  requestConfigs() {
    this.send({
      type: "request-configs",
    });
  }

  /**
   * Get systemId with in-memory caching (avoids repeated localStorage reads on every update cycle)
   */
  async getCachedSystemId() {
    if (this._cachedSystemId) return this._cachedSystemId;
    const id = await getSystemId();
    if (id && id !== "unknown-mac") {
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
      type: "status-update",
      data: {
        systemId,
        ...status,
        protocolVersion: 2,
        timestamp: Date.now(),
      },
    });
  }

  /**
   * Send hashrate update to server
   */
  async sendHashrateUpdate(hashrate) {
    const systemId = await this.getCachedSystemId();

    this.send({
      type: "hashrate-update",
      data: {
        systemId,
        hashrate,
        timestamp: Date.now(),
      },
    });
  }

  queueLog(processId, message, level = "info") {
    if (this.logQueue.length >= 500) {
      this.logQueue.shift();
      this.droppedLogs = (this.droppedLogs || 0) + 1;
    }
    this.logQueue.push({
      processId,
      message: String(message).slice(0, 4000),
      level,
      observedAt: new Date().toISOString(),
      sequence: ++this.logSequence,
    });
  }

  flushLogs() {
    if (!this.bound) return;
    if (this.droppedLogs) {
      const dropped = this.droppedLogs;
      this.droppedLogs = 0;
      this.queueLog(
        "agent",
        `${dropped} log lines dropped while the buffer was full`,
        "warning",
      );
    }
    const entries = this.logQueue.slice(0, 100);
    if (entries.length && this.send({ type: "logs", data: { entries } }))
      this.logQueue.splice(0, entries.length);
  }

  reportEvent(kind, details) {
    if (this.bound) this.send({ type: "event", data: { kind, details } });
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
      this.listeners[event] = this.listeners[event].filter(
        (cb) => cb !== callback,
      );
    }
  }

  /**
   * Emit event
   */
  emit(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach((callback) => {
        try {
          Promise.resolve(callback(data)).catch((error) => {
            if (event !== "error") this.emit("error", error);
          });
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
    return this.connected && this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Check if bound
   */
  isBound() {
    return this.bound && this.isConnected();
  }
}

// Export singleton instance
export const masterServer = new MasterServerService();
