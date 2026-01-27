# Development Guide

Guide for developers who want to contribute to or extend MineMaster.

## 📋 Table of Contents

1. [Development Environment Setup](#development-environment-setup)
2. [Project Structure](#project-structure)
3. [Building & Running](#building--running)
4. [Code Architecture](#code-architecture)
5. [Adding Features](#adding-features)
6. [Testing](#testing)
7. [Contributing](#contributing)

## 🛠️ Development Environment Setup

### Prerequisites

- **Node.js**: v16.x or higher
- **npm**: v7.x or higher
- **Git**: Latest version
- **Code Editor**: VS Code recommended

### Initial Setup

```bash
# Clone repository
git clone <repository-url>
cd minemaster/client

# Install dependencies
npm install --legacy-peer-deps

# Download miner binaries
npm run setup

# Start development server
npm start
```

### VS Code Extensions (Recommended)

- **ESLint**: JavaScript linting
- **Prettier**: Code formatting
- **React Developer Tools**: React debugging
- **Electron Debug**: Electron debugging

### Directory Structure

```
client/
├── electron/               # Electron main process
│   ├── main.js            # Main process entry point
│   └── preload.js         # Preload script (IPC bridge)
├── src/                   # React application
│   ├── components/        # React components
│   ├── hooks/            # Custom React hooks
│   ├── utils/            # Utility functions
│   ├── App.js            # Root component
│   └── index.js          # React entry point
├── public/               # Static assets
├── scripts/              # Build/setup scripts
│   ├── download-miners.js    # Miner download script
│   └── generate-mining-config.js  # Wallet generator
├── miners/               # Miner binaries (gitignored)
│   ├── xmrig/
│   └── nanominer/
└── package.json          # Project configuration
```

## 🏗️ Project Structure

### Electron Main Process (`electron/main.js`)

Responsibilities:
- Window management
- Miner process spawning and control
- System information gathering
- IPC handler implementation

Key sections:
```javascript
// Window creation
function createWindow() { ... }

// Miner control handlers
ipcMain.handle('start-miner', async (event, config) => { ... })
ipcMain.handle('stop-miner', async (event, config) => { ... })

// System monitoring handlers
ipcMain.handle('get-system-info', async () => { ... })
ipcMain.handle('get-cpu-stats', () => { ... })
```

### React Application (`src/`)

**Component Hierarchy**:
```
App (state management)
├── Dashboard
│   ├── Master controls
│   ├── Miner cards
│   └── System info cards
└── Miner Views
    ├── MinerConfig / NanominerConfig
    └── MinerConsole
```

**State Management**:
- Local React state (useState)
- localStorage for persistence
- No external state management library

**Key Hooks**:
```javascript
// Custom hooks in src/hooks/useSystemInfo.js
useSystemInfo()   // Hardware info (cached)
useSystemStats()  // Real-time stats
useGpuList()      // GPU detection
```

## 🔨 Building & Running

### Development Mode

```bash
# Start React dev server + Electron
npm start

# React runs on http://localhost:3000
# Electron loads from dev server
# Hot reload enabled
# DevTools open by default
```

### Production Build

```bash
# Build React app
npm run build

# Package Electron app (current platform)
npm run build:electron

# Package for all platforms
npm run build:all
```

**Output**:
- Linux: `dist/MineMaster-x.x.x.AppImage`, `dist/minemaster_x.x.x_amd64.deb`
- Windows: `dist/MineMaster-Setup-x.x.x.exe`
- macOS: `dist/MineMaster-x.x.x.dmg`

### Manual Testing

```bash
# Test miner download
npm run setup

# Generate test wallets
npm run generate-config

# Clean build
rm -rf build dist node_modules
npm install --legacy-peer-deps
npm run build
```

## 🏛️ Code Architecture

### IPC Communication Pattern

**Renderer → Main (Request)**:
```javascript
// src/components/MinerConfig.js
const result = await window.electronAPI.startMiner({
  minerId: 'xmrig-1',
  minerType: 'xmrig',
  config: { ... }
});
```

**Main → Renderer (Event)**:
```javascript
// electron/main.js
mainWindow.webContents.send('miner-output', {
  minerId: 'xmrig-1',
  data: 'Output line...'
});

// src/App.js
window.electronAPI.onMinerOutput((data) => {
  // Handle output
});
```

### Process Management

**Spawning a Miner**:
```javascript
// electron/main.js
const minerProcess = spawn(xmrigPath, args);

// Capture output
minerProcess.stdout.on('data', (data) => {
  mainWindow.webContents.send('miner-output', {
    minerId,
    data: stripAnsi(data.toString())
  });
});

// Handle exit
minerProcess.on('close', (code) => {
  mainWindow.webContents.send('miner-closed', {
    minerId,
    code
  });
});
```

**Graceful Shutdown**:
```javascript
// Try SIGTERM first (graceful)
minerProcess.kill('SIGTERM');

// Force kill after timeout
setTimeout(() => {
  if (!minerProcess.killed) {
    minerProcess.kill('SIGKILL');
  }
}, 3000);
```

### System Monitoring Strategy

**Problem**: System calls are slow (blocking)

**Solution**: Background polling with caching

```javascript
// Cache variables
let cachedCpuTemp = null;
let cachedGpuStats = [];

// Background update (async, non-blocking)
setInterval(() => {
  updateCpuTempAsync();
  updateGpuInfoAsync();
}, 10000);

// IPC handler (returns cached, instant)
ipcMain.handle('get-cpu-stats', () => {
  return { usage: cpuUsage, temperature: cachedCpuTemp };
});
```

### React Component Patterns

**Functional Components with Hooks**:
```javascript
function MinerConfig({ miner, onConfigChange, onStart, onStop }) {
  // Use custom hooks
  const systemInfo = useSystemInfo();
  
  // Local state
  const [loading, setLoading] = useState(false);
  
  // Event handlers
  const handleStart = async () => {
    setLoading(true);
    await onStart();
    setLoading(false);
  };
  
  return (
    // JSX
  );
}
```

**Custom Hook Pattern**:
```javascript
// src/hooks/useSystemInfo.js
export function useSystemInfo() {
  const [systemInfo, setSystemInfo] = useState(() => {
    // Initialize from cache
    const cached = localStorage.getItem('system-info-cache');
    return cached ? JSON.parse(cached) : null;
  });
  
  useEffect(() => {
    // Fetch and cache
    const fetchInfo = async () => {
      const info = await window.electronAPI.getSystemInfo();
      setSystemInfo(info);
      localStorage.setItem('system-info-cache', JSON.stringify(info));
    };
    
    if (!systemInfo) fetchInfo();
  }, []);
  
  return systemInfo;
}
```

## ✨ Adding Features

### Adding a New Miner

**1. Update download script** (`scripts/download-miners.js`):
```javascript
const MINERS = {
  // ... existing miners
  newminer: {
    version: '1.0.0',
    linux: {
      url: 'https://github.com/example/newminer/releases/...',
      archive: 'newminer-linux.tar.gz',
      extractedDir: 'newminer-1.0.0',
      binary: 'newminer'
    },
    // ... other platforms
  }
};
```

**2. Add miner support in main process** (`electron/main.js`):
```javascript
ipcMain.handle('start-miner', async (event, { minerId, minerType, config }) => {
  // ... existing code
  
  if (minerType === 'newminer') {
    const minerPath = getNewMinerPath(config.customPath);
    const args = buildNewMinerArgs(config);
    minerProcess = spawn(minerPath, args);
    
    // Handle output/events
    // ...
  }
});
```

**3. Create configuration component** (`src/components/NewMinerConfig.js`):
```javascript
import React from 'react';

function NewMinerConfig({ miner, onConfigChange, onStart, onStop }) {
  // Form fields for miner-specific config
  return (
    <div className="miner-config">
      {/* Config UI */}
    </div>
  );
}

export default NewMinerConfig;
```

**4. Update App.js**:
```javascript
// Add to initial miners state
const [miners, setMiners] = useState([
  // ... existing miners
  {
    id: 'newminer-1',
    name: 'New Miner',
    type: 'newminer',
    deviceType: 'CPU' or 'GPU',
    running: false,
    config: { /* defaults */ }
  }
]);

// Add to conditional render
{currentMiner.type === 'newminer' ? (
  <NewMinerConfig miner={currentMiner} ... />
) : (
  // ... existing code
)}
```

### Adding System Metrics

**1. Implement metric collection** (`electron/main.js`):
```javascript
// Background update function
function updateNewMetricAsync() {
  if (updateInProgress) return;
  updateInProgress = true;
  
  setTimeout(() => {
    try {
      // Read metric (e.g., from /sys on Linux)
      const value = fs.readFileSync('/sys/path/to/metric', 'utf8');
      cachedMetric = parseFloat(value);
    } catch (e) {
      console.error('Failed to read metric:', e);
    } finally {
      updateInProgress = false;
    }
  }, 0);
}

// Add to polling interval
setInterval(() => {
  updateNewMetricAsync();
}, 10000);

// IPC handler
ipcMain.handle('get-new-metric', () => {
  return cachedMetric;
});
```

**2. Expose via preload** (`electron/preload.js`):
```javascript
contextBridge.exposeInMainWorld('electronAPI', {
  // ... existing methods
  getNewMetric: () => ipcRenderer.invoke('get-new-metric')
});
```

**3. Create React hook** (`src/hooks/useNewMetric.js`):
```javascript
import { useState, useEffect } from 'react';

export function useNewMetric() {
  const [metric, setMetric] = useState(null);
  
  useEffect(() => {
    const interval = setInterval(async () => {
      const value = await window.electronAPI.getNewMetric();
      setMetric(value);
    }, 3000);
    
    return () => clearInterval(interval);
  }, []);
  
  return metric;
}
```

**4. Use in component**:
```javascript
import { useNewMetric } from '../hooks/useNewMetric';

function Dashboard() {
  const newMetric = useNewMetric();
  
  return (
    <div>Metric: {newMetric}</div>
  );
}
```

### Adding UI Components

**Component Guidelines**:
- Functional components with hooks
- Props for configuration, callbacks for events
- CSS modules or scoped styles
- Reusable where possible

**Example**:
```javascript
// src/components/HashRateCard.js
import React from 'react';
import './HashRateCard.css';
import { formatHashrate } from '../utils/hashrate';

function HashRateCard({ hashrate, label }) {
  return (
    <div className="hashrate-card">
      <div className="hashrate-label">{label}</div>
      <div className="hashrate-value">
        {hashrate ? formatHashrate(hashrate) : 'N/A'}
      </div>
    </div>
  );
}

export default HashRateCard;
```

## 🧪 Testing

### Manual Testing Checklist

**Miner Control**:
- [ ] XMRig starts successfully
- [ ] Nanominer starts successfully
- [ ] Miners stop cleanly
- [ ] Multiple miners can run simultaneously
- [ ] Miner output appears in console
- [ ] Hashrate is detected and displayed

**Configuration**:
- [ ] Settings persist after restart
- [ ] Invalid config shows error
- [ ] Config changes apply correctly

**System Monitoring**:
- [ ] CPU stats display correctly
- [ ] RAM stats display correctly
- [ ] GPU detection works (if GPU present)
- [ ] GPU stats update in real-time
- [ ] Temperature readings accurate

**UI/UX**:
- [ ] Dashboard layout responsive
- [ ] Navigation works smoothly
- [ ] Console scrolls correctly
- [ ] No visual glitches

### Platform Testing

Test on:
- [ ] Linux (Ubuntu 22.04+)
- [ ] Windows 10/11
- [ ] macOS (if applicable)

### Performance Testing

Monitor:
- App memory usage (<200 MB idle)
- CPU usage (<1% idle, excluding miners)
- IPC response time (<10ms)
- System stats update rate (3-second intervals)

## 🤝 Contributing

### Code Style

**JavaScript/React**:
- Use ES6+ features
- Functional components with hooks
- Descriptive variable names
- Comments for complex logic

**Example**:
```javascript
// Good
const calculateHashrate = (shares, time) => {
  return shares / time * 1000;
};

// Avoid
const calc = (s, t) => s / t * 1000;
```

### Git Workflow

```bash
# Create feature branch
git checkout -b feature/new-feature

# Make changes
git add .
git commit -m "Add new feature: description"

# Push to remote
git push origin feature/new-feature

# Create pull request on GitHub
```

### Commit Messages

Follow conventional commits:
```
feat: Add Nanominer GPU mining support
fix: Resolve hashrate parsing issue for XMRig
docs: Update installation guide
refactor: Simplify system monitoring code
perf: Optimize GPU stats polling
```

### Pull Request Guidelines

1. **Description**: Explain what and why
2. **Testing**: List how you tested
3. **Screenshots**: For UI changes
4. **Breaking Changes**: Clearly mark any
5. **Documentation**: Update relevant docs

### Code Review Process

1. Submit PR with clear description
2. Wait for automated checks (if any)
3. Respond to reviewer feedback
4. Make requested changes
5. Get approval and merge

## 📚 Resources

### Electron
- [Electron Docs](https://www.electronjs.org/docs)
- [IPC Tutorial](https://www.electronjs.org/docs/latest/tutorial/ipc)
- [Security Best Practices](https://www.electronjs.org/docs/latest/tutorial/security)

### React
- [React Docs](https://react.dev/)
- [Hooks Reference](https://react.dev/reference/react)
- [React DevTools](https://react.dev/learn/react-developer-tools)

### Mining Software
- [XMRig Docs](https://xmrig.com/docs)
- [Nanominer GitHub](https://github.com/nanopool/nanominer)

### System Information
- [systeminformation](https://systeminformation.io/)
- [Linux /sys filesystem](https://www.kernel.org/doc/Documentation/filesystems/sysfs.txt)

## 🐛 Debugging

### Enable Verbose Logging

```javascript
// electron/main.js
console.log('[DEBUG] Message');
console.error('[ERROR] Message');
```

### Inspect IPC Messages

```javascript
// Add logging in preload.js
contextBridge.exposeInMainWorld('electronAPI', {
  startMiner: (config) => {
    console.log('[IPC] startMiner called with:', config);
    return ipcRenderer.invoke('start-miner', config);
  }
});
```

### React DevTools

1. Open DevTools (F12)
2. Components tab shows React tree
3. Inspect component props/state
4. Profile performance

### Electron DevTools

- Already open in development mode
- Console for renderer process
- Network tab for resource loading
- Sources for debugging

---

**Happy Coding!**

**Last Updated**: January 2026
