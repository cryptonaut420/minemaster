# Architecture Overview

This document primarily describes the desktop client. Paths in the desktop sections are relative to `client/`. The complete current backend/admin contract is in [backend-admin.md](backend-admin.md); open correctness issues and proposed architecture changes are in the [operational audit](audits/backend-admin-2026-09-12/README.md).

## Central backend and admin

The project also has `server/src/` (Express, MongoDB, WebSocket) and `server/public/src/` (React/Vite admin). The desktop renderer sends five-second status reports with original rate observation timestamps. Backend commands travel through the desktop service, a cancelable process queue, and Electron IPC, then return acknowledged results.

The admin and API use the same telemetry summary and hashrate integration services. Physical GPUs and mining processes have separate identities. MongoDB stores snapshots, assigned/desired configuration versions, command histories, raw rates/sensors/logs/events, incidents, and one-minute rate integrals. Raw retention defaults to seven days; rollups and commands retain 90 days.

Connection ownership and per-rig serialization prevent stale sessions from overwriting replacements. The connection registry belongs to one backend process; multi-replica operation requires additional coordination. Observers receive incremental updates; agents do not receive fleet broadcasts. See the [implementation report](audits/backend-admin-2026-09-12/implementation.md) for validation and hardware limitations.

## 🏗️ High-Level Architecture

MineMaster follows a typical Electron application architecture with three main components:

```
┌─────────────────────────────────────────────────────────────┐
│                     MineMaster Desktop App                   │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─────────────────┐         ┌────────────────────────┐    │
│  │  React Frontend │◄───────►│  Electron Main Process │    │
│  │   (Renderer)    │   IPC   │    (Node.js Backend)   │    │
│  └─────────────────┘         └────────────────────────┘    │
│         │                              │                     │
│         │                              │ spawn/manage        │
│         │                              ▼                     │
│         │                     ┌──────────────────┐          │
│         │                     │  Miner Processes │          │
│         │                     │  • XMRig (CPU)   │          │
│         │                     │  • Nanominer(GPU)│          │
│         │                     └──────────────────┘          │
│         │                              │                     │
│         │                              │ reads               │
│         │                              ▼                     │
│         │                     ┌──────────────────┐          │
│         └────────────────────►│ System Resources │          │
│           (display stats)     │  • CPU/GPU/RAM   │          │
│                               │  • Temperature   │          │
│                               └──────────────────┘          │
└─────────────────────────────────────────────────────────────┘
```

## 📦 Component Structure

### 1. **Electron Main Process** (`electron/main.js`)

The main process is the heart of the application, running in Node.js and responsible for:

#### Process Management
- Spawning and managing miner processes (XMRig, Nanominer)
- Capturing stdout/stderr from miners
- Graceful shutdown and cleanup
- Process lifecycle management

#### System Monitoring
- CPU usage and temperature monitoring
- RAM usage tracking
- GPU detection (AMD/NVIDIA)
- GPU temperature, usage, and VRAM monitoring
- Background polling with caching for performance

#### IPC Communication
- Handles requests from the renderer process
- Sends miner output and system stats to frontend
- Provides API for miner control (start/stop/status)

#### Key Features
```javascript
// IPC Handlers
- start-miner: Launch a miner with configuration
- stop-miner: Terminate a running miner
- get-miner-status: Check if miner is running
- get-system-info: Fetch system hardware info (cached)
- get-cpu-stats: Real-time CPU metrics
- get-memory-stats: Real-time RAM metrics
- get-gpu-stats: Real-time GPU metrics
```

### 2. **Electron Preload** (`electron/preload.js`)

The preload script bridges the main and renderer processes with security:

- Exposes safe IPC methods via `contextBridge`
- Prevents direct Node.js access from renderer
- Provides typed API for React components

```javascript
window.electronAPI = {
  startMiner: (config) => ipcRenderer.invoke('start-miner', config),
  stopMiner: (config) => ipcRenderer.invoke('stop-miner', config),
  // ... other methods
  onMinerOutput: (callback) => ipcRenderer.on('miner-output', callback)
}
```

### 3. **React Frontend** (`src/`)

Single-page application with component-based architecture:

```
src/
├── App.js                    # Root component, state management
├── components/
│   ├── Dashboard.js          # Overview with all miners & system info
│   ├── MinerConfig.js        # XMRig configuration UI
│   ├── NanominerConfig.js    # Nanominer configuration UI
│   ├── MinerConsole.js       # Real-time output display
│   └── SystemInfoCard.js     # Reusable system info widget
├── hooks/
│   └── useSystemInfo.js      # Custom hooks for system data
└── utils/
    └── formatters.js         # Hashrate parsing and formatting utilities
```

#### Component Hierarchy
```
App
├── Dashboard (view="dashboard")
│   ├── Master Control (Start/Stop All)
│   ├── Miners List
│   └── System Info Cards
└── Miner View (view=minerId)
    ├── MinerConfig / NanominerConfig
    └── MinerConsole
```

## 🔄 Data Flow

### 1. Starting a Miner

```
User Click "Start" 
    ↓
React Component (MinerConfig)
    ↓
window.electronAPI.startMiner(config)
    ↓
IPC: 'start-miner' → Main Process
    ↓
Main Process spawns miner binary
    ↓
Miner stdout/stderr captured
    ↓
IPC: 'miner-output' → Renderer
    ↓
React updates output state
    ↓
MinerConsole displays output
```

### 2. System Monitoring

```
Component Mount
    ↓
useEffect() hook
    ↓
setInterval (every 3 seconds)
    ↓
window.electronAPI.getCpuStats()
window.electronAPI.getMemoryStats()
window.electronAPI.getGpuStats()
    ↓
Main Process reads /sys files (Linux) or OS APIs
    ↓
Returns cached data (non-blocking)
    ↓
React updates state
    ↓
Dashboard/SystemInfoCard re-renders
```

## 🗄️ State Management

### Global State (App.js)
```javascript
const [miners, setMiners] = useState([
  {
    id: 'xmrig-1',
    name: 'XMRig CPU Miner',
    type: 'xmrig',
    running: false,
    hashrate: null,
    config: { ... },
    output: []
  },
  // ... more miners
])
```

### Local Storage
- **Miner Configurations**: Persisted as `minemaster-config`
- **System Info**: Cached as `minemaster-system-info` (24-hour TTL)
- **System Stats**: Cached as `minemaster-system-stats-last` (30-second TTL)

### Session Storage
- System info (fallback cache)

## 🔧 Mining Process Management

### XMRig (CPU Mining)

**Launch Command**:
```bash
./xmrig -o pool.address:3333 -u wallet_address -p x -a rx/0 -t 8
```

**Configuration Flow**:
1. User fills form in `MinerConfig.js`
2. Config sent via IPC to main process
3. Main process builds CLI arguments
4. Spawns XMRig with `child_process.spawn()`
5. Captures stdout/stderr for hashrate parsing

### Nanominer (GPU Mining)

**Launch Command**:
```bash
cd miners/nanominer
./nanominer miner-id-config.ini
```

**Configuration Flow**:
1. User configures in `NanominerConfig.js`
2. Config sent to main process
3. Main process generates `config.ini` file
4. Spawns Nanominer with config file path
5. Parses output for hashrate and stats

## 📡 IPC Communication Protocol

### Request/Response Pattern
```javascript
// Renderer → Main (invoke)
const result = await window.electronAPI.startMiner({
  minerId: 'xmrig-1',
  minerType: 'xmrig',
  config: { ... }
})
// Returns: { success: true, pid: 12345 }
```

### Event Stream Pattern
```javascript
// Main → Renderer (send)
mainWindow.webContents.send('miner-output', {
  minerId: 'xmrig-1',
  data: 'speed 10s/60s/15m 1234.5 H/s\n'
})

// Renderer listens
window.electronAPI.onMinerOutput((data) => {
  console.log(data.minerId, data.data)
})
```

## 🖥️ System Monitoring Implementation

### Linux Platform

**CPU Temperature**:
```javascript
// Read from thermal zones
/sys/class/thermal/thermal_zone0/temp
/sys/class/hwmon/hwmon0/temp1_input
```

**AMD GPU Stats**:
```javascript
// Per-GPU readings
/sys/class/drm/card0/device/gpu_busy_percent
/sys/class/drm/card0/device/hwmon/hwmon*/temp1_input
/sys/class/drm/card0/device/mem_info_vram_used
/sys/class/drm/card0/device/mem_info_vram_total
```

**NVIDIA GPU Stats**:
```bash
nvidia-smi --query-gpu=index,temperature.gpu,utilization.gpu,memory.used,memory.total \
           --format=csv,noheader,nounits
```

### Background Update Strategy

To avoid blocking the UI:
1. Stats are cached in memory
2. Background intervals update cache every 10 seconds
3. IPC handlers return cached values instantly
4. No slow syscalls in critical path

```javascript
// Non-blocking pattern
ipcMain.handle('get-gpu-stats', () => {
  return cachedGpuStats; // Instant return
});

// Background update
setInterval(() => {
  updateGpuInfoAsync(); // Async, non-blocking
}, 10000);
```

## 🎨 UI/UX Design Patterns

### Component Patterns

**Smart vs Dumb Components**:
- **Smart**: `App.js`, `Dashboard.js` - Manage state and logic
- **Dumb**: `MinerConsole.js`, `SystemInfoCard.js` - Pure presentation

**Custom Hooks**:
```javascript
// Reusable system info logic
const systemInfo = useSystemInfo();
const systemStats = useSystemStats();
const gpuList = useGpuList();
```

### Performance Optimizations

1. **Memoization**: Heavy computations cached
2. **Throttling**: Stats update every 3 seconds, not every render
3. **Lazy Loading**: GPU info fetched only when needed
4. **Virtual Scrolling**: Console output uses auto-scroll with threshold

## 🔒 Security Considerations

### Context Isolation
- **Enabled**: `contextIsolation: true`
- **Node Integration**: Disabled in renderer
- **Preload Script**: Only exposes necessary APIs

### Process Sandboxing
- Miner processes run as child processes
- No direct file system access from renderer
- All file operations go through main process

### Sensitive Data
- Wallet addresses stored in localStorage (encrypted storage recommended for production)
- Private keys NEVER stored in app (generated wallets are saved to external JSON files)

## 📊 Performance Characteristics

### Memory Usage
- **Electron App**: ~100-150 MB
- **XMRig Miner**: ~50-100 MB
- **Nanominer**: ~100-200 MB per GPU

### CPU Usage (When Mining)
- **App Overhead**: <1% CPU
- **XMRig**: Configurable (10-100% of CPU threads)
- **System Monitoring**: <0.1% CPU (cached reads)

### Startup Time
- **App Launch**: 2-3 seconds
- **Miner Binary Download**: One-time, ~5-30 seconds per miner
- **First Mining Start**: <1 second

## 🧪 Testing Strategy

### Manual Testing
- Cross-platform testing on Linux, Windows, macOS
- Test with different GPU vendors (AMD, NVIDIA)
- Test with various mining pools and coins

### Automated Testing (Future)
- Unit tests for utility functions
- Integration tests for IPC communication
- E2E tests for critical user flows

## 🚀 Build & Deployment

### Development
```bash
npm start
# Runs React dev server + Electron
```

### Production Build
```bash
npm run build          # Build React
npm run build:electron # Package Electron app
```

### Distribution
- **Linux**: AppImage, .deb
- **Windows**: NSIS installer
- **macOS**: .dmg

## 🔮 Future Architecture Enhancements

### Planned Improvements
1. **Multi-instance Support**: Run multiple configs per miner type
2. **Remote Monitoring**: Optional web dashboard
3. **Auto-tuning**: Automatic performance optimization
4. **Profit Switching**: Auto-switch to most profitable coin
5. **Mining Scheduler**: Time-based mining schedules

### Scalability Considerations
- Support for 8+ GPUs
- Mining farm management
- Centralized configuration management

---

**Document Version**: 1.0
**Last Updated**: January 2026
