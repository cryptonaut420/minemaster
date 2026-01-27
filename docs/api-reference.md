# API Reference

Technical reference for MineMaster's IPC (Inter-Process Communication) API.

## 📡 Overview

MineMaster uses Electron's IPC mechanism for communication between the renderer process (React UI) and the main process (Node.js backend). The API is exposed through `window.electronAPI`.

## 🔌 API Surface

### Miner Control

#### `startMiner(config)`

Starts a miner process with the given configuration.

**Parameters**:
```typescript
{
  minerId: string,      // Unique miner identifier (e.g., 'xmrig-1')
  minerType: string,    // Miner type: 'xmrig' | 'nanominer'
  config: MinerConfig   // Miner-specific configuration
}
```

**Returns**: `Promise<StartMinerResult>`
```typescript
{
  success: boolean,
  pid?: number,         // Process ID if successful
  error?: string        // Error message if failed
}
```

**Example**:
```javascript
const result = await window.electronAPI.startMiner({
  minerId: 'xmrig-1',
  minerType: 'xmrig',
  config: {
    pool: 'pool.supportxmr.com:3333',
    user: '4ABC123...',
    password: 'x',
    algorithm: 'rx/0',
    threadPercentage: 100,
    donateLevel: 0
  }
});

if (result.success) {
  console.log('Miner started with PID:', result.pid);
} else {
  console.error('Failed to start:', result.error);
}
```

#### `stopMiner(config)`

Stops a running miner process.

**Parameters**:
```typescript
{
  minerId: string      // Miner identifier to stop
}
```

**Returns**: `Promise<StopMinerResult>`
```typescript
{
  success: boolean,
  error?: string
}
```

**Example**:
```javascript
const result = await window.electronAPI.stopMiner({
  minerId: 'xmrig-1'
});
```

#### `getMinerStatus(config)`

Checks if a specific miner is currently running.

**Parameters**:
```typescript
{
  minerId: string
}
```

**Returns**: `Promise<MinerStatus>`
```typescript
{
  running: boolean,
  pid: number | null
}
```

**Example**:
```javascript
const status = await window.electronAPI.getMinerStatus({
  minerId: 'xmrig-1'
});

console.log('Running:', status.running);
console.log('PID:', status.pid);
```

#### `getAllMinersStatus()`

Gets status of all miners.

**Parameters**: None

**Returns**: `Promise<Record<string, MinerStatus>>`
```typescript
{
  'xmrig-1': { running: true, pid: 12345 },
  'nanominer-1': { running: false, pid: null }
}
```

**Example**:
```javascript
const statuses = await window.electronAPI.getAllMinersStatus();
Object.entries(statuses).forEach(([minerId, status]) => {
  console.log(`${minerId}: ${status.running ? 'Running' : 'Stopped'}`);
});
```

### System Information

#### `getSystemInfo()`

Retrieves static system hardware information (cached, fast).

**Parameters**: None

**Returns**: `Promise<SystemInfo>`
```typescript
{
  os: {
    platform: string,    // 'linux' | 'win32' | 'darwin'
    distro: string,      // e.g., 'Ubuntu', 'Windows 10'
    release: string,     // Version number
    arch: string         // 'x64' | 'arm64'
  },
  cpu: {
    manufacturer: string,
    brand: string,       // e.g., 'AMD Ryzen 9 5950X'
    cores: number,       // Total logical cores
    physicalCores: number,
    speed: number        // MHz
  },
  memory: {
    total: number,       // Bytes
    available: number,   // Bytes
    used: number         // Bytes
  },
  gpus: Array<{
    id: number,
    vendor: string,      // 'AMD' | 'NVIDIA' | 'Intel'
    model: string,       // GPU model name
    vram: number,        // MB
    bus: string          // PCI bus info
  }> | null
}
```

**Example**:
```javascript
const info = await window.electronAPI.getSystemInfo();
console.log('CPU:', info.cpu.brand);
console.log('RAM:', (info.memory.total / (1024**3)).toFixed(1), 'GB');
if (info.gpus) {
  info.gpus.forEach(gpu => {
    console.log(`GPU ${gpu.id}: ${gpu.model} (${gpu.vram}MB)`);
  });
}
```

**Note**: This data is cached for performance. First call may be slower, subsequent calls return instantly.

### System Statistics

#### `getCpuStats()`

Gets real-time CPU usage and temperature.

**Parameters**: None

**Returns**: `Promise<CpuStats>`
```typescript
{
  usage: number,           // Percentage (0-100)
  temperature: number | null  // Celsius
}
```

**Example**:
```javascript
const cpu = await window.electronAPI.getCpuStats();
console.log(`CPU Usage: ${cpu.usage.toFixed(1)}%`);
if (cpu.temperature) {
  console.log(`CPU Temp: ${cpu.temperature.toFixed(1)}°C`);
}
```

#### `getMemoryStats()`

Gets real-time memory usage.

**Parameters**: None

**Returns**: `Promise<MemoryStats>`
```typescript
{
  total: number,          // Bytes
  used: number,           // Bytes
  usagePercent: number    // Percentage (0-100)
}
```

**Example**:
```javascript
const memory = await window.electronAPI.getMemoryStats();
const usedGB = (memory.used / (1024**3)).toFixed(1);
const totalGB = (memory.total / (1024**3)).toFixed(1);
console.log(`RAM: ${usedGB} / ${totalGB} GB (${memory.usagePercent.toFixed(1)}%)`);
```

#### `getGpuStats()`

Gets real-time GPU statistics for all detected GPUs.

**Parameters**: None

**Returns**: `Promise<Array<GpuStats> | null>`
```typescript
Array<{
  id: number,
  type: 'AMD' | 'NVIDIA',
  usage: number | null,      // Percentage (0-100)
  temperature: number | null, // Celsius
  vramUsed: number | null,   // MB
  vramTotal: number | null   // MB
}>
```

**Example**:
```javascript
const gpus = await window.electronAPI.getGpuStats();
if (gpus) {
  gpus.forEach(gpu => {
    console.log(`GPU ${gpu.id} (${gpu.type})`);
    if (gpu.usage !== null) console.log(`  Usage: ${gpu.usage.toFixed(1)}%`);
    if (gpu.temperature !== null) console.log(`  Temp: ${gpu.temperature.toFixed(1)}°C`);
    if (gpu.vramUsed !== null && gpu.vramTotal !== null) {
      console.log(`  VRAM: ${(gpu.vramUsed/1024).toFixed(1)} / ${(gpu.vramTotal/1024).toFixed(1)} GB`);
    }
  });
} else {
  console.log('No GPUs detected');
}
```

**Note**: Returns `null` if no GPUs are detected. Individual stats may be `null` if unavailable.

### Event Listeners

#### `onMinerOutput(callback)`

Subscribes to miner stdout/stderr output.

**Parameters**:
```typescript
callback: (data: MinerOutputEvent) => void
```

**Event Data**:
```typescript
{
  minerId: string,
  data: string    // Output line(s) from miner
}
```

**Example**:
```javascript
window.electronAPI.onMinerOutput((event) => {
  console.log(`[${event.minerId}] ${event.data}`);
  
  // Parse hashrate
  const hashrateMatch = event.data.match(/([\d.]+)\s*(H\/s|kH\/s|MH\/s)/i);
  if (hashrateMatch) {
    console.log('Hashrate detected:', hashrateMatch[0]);
  }
});
```

**Note**: Output is already stripped of ANSI color codes.

#### `onMinerError(callback)`

Subscribes to miner error events.

**Parameters**:
```typescript
callback: (data: MinerErrorEvent) => void
```

**Event Data**:
```typescript
{
  minerId: string,
  error: string    // Error message
}
```

**Example**:
```javascript
window.electronAPI.onMinerError((event) => {
  console.error(`[${event.minerId}] ERROR: ${event.error}`);
  // Show notification to user
  alert(`Miner ${event.minerId} encountered an error: ${event.error}`);
});
```

#### `onMinerClosed(callback)`

Subscribes to miner process exit events.

**Parameters**:
```typescript
callback: (data: MinerClosedEvent) => void
```

**Event Data**:
```typescript
{
  minerId: string,
  code: number    // Exit code (0 = clean exit)
}
```

**Example**:
```javascript
window.electronAPI.onMinerClosed((event) => {
  if (event.code === 0) {
    console.log(`[${event.minerId}] Exited cleanly`);
  } else {
    console.error(`[${event.minerId}] Crashed with code ${event.code}`);
  }
});
```

## 📝 Type Definitions

### MinerConfig (XMRig)

```typescript
interface XMRigConfig {
  pool: string;              // Pool URL (e.g., 'pool.example.com:3333')
  user: string;              // Wallet address
  password: string;          // Pool password (usually 'x')
  coin: string;              // Coin symbol (e.g., 'XMR')
  algorithm: string;         // Algorithm (e.g., 'rx/0')
  threads?: number;          // Number of threads (0 = auto)
  threadPercentage: number;  // CPU usage 10-100 (%)
  donateLevel: number;       // Donation level 0-5 (%)
  customPath?: string;       // Custom miner binary path
  additionalArgs?: string;   // Extra CLI arguments
}
```

### MinerConfig (Nanominer)

```typescript
interface NanominerConfig {
  algorithm: string;         // Algorithm (e.g., 'kawpow', 'ethash')
  coin: string;              // Coin symbol (e.g., 'RVN', 'ETC')
  pool: string;              // Pool URL
  user: string;              // Wallet address
  rigName?: string;          // Worker name (optional)
  email?: string;            // Email (optional, for some pools)
  gpus: number[];            // GPU indices to use (empty = all)
  gpu0Power?: number;        // Power limit for GPU 0 (50-100%)
  gpu1Power?: number;        // Power limit for GPU 1 (50-100%)
  // ... gpuNPower for each GPU
  customPath?: string;       // Custom miner binary path
}
```

## 🔧 Implementation Details

### Security Model

The API uses Electron's `contextBridge` for secure IPC:

```javascript
// preload.js
contextBridge.exposeInMainWorld('electronAPI', {
  startMiner: (config) => ipcRenderer.invoke('start-miner', config),
  // ... other methods
});
```

This prevents:
- Direct Node.js access from renderer
- Arbitrary code execution
- Filesystem access without validation

### Performance Optimization

**System Information**:
- Cached in memory after first fetch
- TTL: 24 hours (hardware doesn't change frequently)
- Async background update for GPU models

**System Statistics**:
- Background polling every 10 seconds
- IPC handlers return cached values (instant)
- No blocking syscalls in critical path

**Pattern**:
```javascript
// Background update (non-blocking)
setInterval(() => {
  updateCpuTempAsync();
  updateGpuInfoAsync();
}, 10000);

// Handler returns cached data (fast)
ipcMain.handle('get-cpu-stats', () => {
  return { usage: cachedCpuUsage, temperature: cachedCpuTemp };
});
```

### Error Handling

All IPC methods return structured error responses:

```javascript
{
  success: false,
  error: 'Detailed error message'
}
```

Never throws exceptions across IPC boundary. Always check `success` field.

### Miner Process Management

**Lifecycle**:
1. `spawn()` - Creates child process
2. Capture stdout/stderr
3. Send output to renderer via IPC
4. On exit, clean up resources

**Cleanup on App Exit**:
```javascript
// Graceful shutdown
minerProcess.kill('SIGTERM');

// Force kill after timeout
setTimeout(() => {
  if (!minerProcess.killed) {
    minerProcess.kill('SIGKILL');
  }
}, 3000);
```

## 🧪 Testing the API

### Using DevTools Console

Open DevTools (Ctrl+Shift+I / Cmd+Option+I) and test API:

```javascript
// Check API is available
console.log(window.electronAPI);

// Get system info
window.electronAPI.getSystemInfo().then(console.log);

// Get CPU stats
window.electronAPI.getCpuStats().then(console.log);

// Start a test miner (careful - this actually starts mining!)
window.electronAPI.startMiner({
  minerId: 'test-1',
  minerType: 'xmrig',
  config: {
    pool: 'pool.supportxmr.com:3333',
    user: 'YOUR_WALLET',
    password: 'x',
    algorithm: 'rx/0',
    threadPercentage: 10  // Low usage for testing
  }
}).then(console.log);

// Stop it
window.electronAPI.stopMiner({ minerId: 'test-1' }).then(console.log);
```

### React Hook Example

```javascript
import { useState, useEffect } from 'react';

function useGpuStats() {
  const [gpuStats, setGpuStats] = useState(null);
  
  useEffect(() => {
    const interval = setInterval(async () => {
      const stats = await window.electronAPI.getGpuStats();
      setGpuStats(stats);
    }, 3000);
    
    return () => clearInterval(interval);
  }, []);
  
  return gpuStats;
}

// Usage in component
function MyComponent() {
  const gpuStats = useGpuStats();
  
  return (
    <div>
      {gpuStats?.map(gpu => (
        <div key={gpu.id}>
          GPU {gpu.id}: {gpu.temperature}°C
        </div>
      ))}
    </div>
  );
}
```

## 🔮 Future API Additions

Planned but not yet implemented:

- `saveMinerProfile(name, config)` - Save named profiles
- `loadMinerProfile(name)` - Load saved profiles
- `getMinerProfiles()` - List all saved profiles
- `getHashrateHistory(minerId, duration)` - Historical hashrate data
- `getPoolStats(poolUrl, wallet)` - Fetch pool API data
- `setNotificationPreferences(prefs)` - Configure alerts

---

**Last Updated**: January 2026
**API Version**: 1.0.0
