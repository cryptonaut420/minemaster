const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const isDev = require('electron-is-dev');
const { spawn, exec } = require('child_process');
const { promisify } = require('util');
const si = require('systeminformation');
const os = require('os');
const fs = require('fs');
const { initAutoUpdater, checkForUpdates, getUpdateState, cleanup: cleanupAutoUpdater } = require('./autoUpdater');

const execAsync = promisify(exec);

app.disableHardwareAcceleration();

let mainWindow;
let miners = {}; // Store active miner processes { minerId: { process, configPath, executable } }
const MAX_RENDERER_IPC_BYTES = 512 * 1024;
const MAX_LOG_READ_BYTES = 256 * 1024;

function sendToRenderer(channel, payload) {
  if (!mainWindow || !mainWindow.webContents) return;

  try {
    // Prevent oversized IPC frames by chunking very large miner output strings.
    if (channel === 'miner-output' && payload && typeof payload.data === 'string') {
      const totalBytes = Buffer.byteLength(payload.data, 'utf8');
      if (totalBytes > MAX_RENDERER_IPC_BYTES) {
        const chunkSizeChars = Math.floor(MAX_RENDERER_IPC_BYTES / 2);
        for (let i = 0; i < payload.data.length; i += chunkSizeChars) {
          mainWindow.webContents.send(channel, {
            ...payload,
            data: payload.data.slice(i, i + chunkSizeChars)
          });
        }
        return;
      }
    }

    mainWindow.webContents.send(channel, payload);
  } catch (error) {
    // Ignore transient renderer send failures
  }
}

// System info cache (persisted on disk and refreshed once per app launch)
let systemInfoCache = null;
let systemInfoCachePath = null;
let systemInfoRefreshPromise = null;
const SYSTEM_INFO_CACHE_FILENAME = 'system-info-cache.json';
const UPDATE_RESUME_FILENAME = 'update-resume-state.json';

function getUpdateResumeFilePath() {
  return path.join(app.getPath('userData'), UPDATE_RESUME_FILENAME);
}

function saveUpdateResumeState(runningMinerIds) {
  try {
    const data = { minerIds: runningMinerIds, savedAt: Date.now() };
    fs.writeFileSync(getUpdateResumeFilePath(), JSON.stringify(data), 'utf8');
  } catch (_) {}
}

function loadAndClearUpdateResumeState() {
  const filePath = getUpdateResumeFilePath();
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    fs.unlinkSync(filePath);
    const data = JSON.parse(raw);
    // Ignore stale resume files older than 10 minutes (something went wrong)
    if (data.savedAt && (Date.now() - data.savedAt) > 10 * 60 * 1000) return null;
    return data;
  } catch (_) {
    try { fs.unlinkSync(filePath); } catch (_e) {}
    return null;
  }
}

function isLikelyIntegratedGpu(gpu = {}) {
  const model = (gpu.model || '').toLowerCase();
  const vendor = (gpu.vendor || '').toLowerCase();

  // Intel GPUs are typically integrated unless explicitly Arc (discrete line).
  if (vendor.includes('intel') && !model.includes('arc')) {
    return true;
  }

  // AMD APU graphics
  if ((vendor.includes('amd') || vendor.includes('ati')) &&
      (model.includes('vega') || model.includes('radeon graphics') ||
       model.includes('raphael') || model.includes('renoir') ||
       model.includes('cezanne') || model.includes('lucienne'))) {
    return true;
  }

  // Microsoft fallback/virtual display adapter
  if (
    vendor.includes('microsoft') ||
    model.includes('basic display') ||
    model.includes('virtual') ||
    model.includes('integrated')
  ) {
    return true;
  }

  return false;
}

function mapDiscreteGpus(controllers = []) {
  return controllers
    .filter(gpu => !isLikelyIntegratedGpu(gpu))
    .filter((gpu) => !gpu.vram || gpu.vram > 512)
    .map((gpu, idx) => ({
      id: idx,
      vendor: gpu.vendor || '',
      model: gpu.model || 'Unknown GPU',
      vram: gpu.vram || null,
      bus: gpu.bus || null
    }));
}

function buildBasicSystemInfo() {
  const cpus = os.cpus();
  const cpuInfo = cpus[0] || {};

  return {
    hostname: os.hostname(),
    platform: os.platform(),
    os: {
      platform: os.platform(),
      distro: os.type(),
      release: os.release(),
      arch: os.arch(),
      hostname: os.hostname()
    },
    cpu: {
      manufacturer: '',
      brand: cpuInfo.model || 'Unknown CPU',
      cores: cpus.length,
      physicalCores: cpus.length,
      speed: cpuInfo.speed || 0
    },
    memory: {
      total: os.totalmem(),
      available: os.freemem(),
      used: os.totalmem() - os.freemem()
    },
    gpus: null,
    gpuDetectionStatus: 'pending',
    lastUpdatedAt: Date.now()
  };
}

function readSystemInfoCacheFromDisk() {
  if (!systemInfoCachePath || !fs.existsSync(systemInfoCachePath)) {
    return null;
  }

  try {
    const fileData = fs.readFileSync(systemInfoCachePath, 'utf8');
    const parsed = JSON.parse(fileData);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    return {
      ...buildBasicSystemInfo(),
      ...parsed,
      gpuDetectionStatus: parsed.gpuDetectionStatus || 'complete'
    };
  } catch (error) {
    return null;
  }
}

function writeSystemInfoCacheToDisk(cacheData) {
  if (!systemInfoCachePath || !cacheData) return;

  try {
    fs.writeFileSync(systemInfoCachePath, JSON.stringify(cacheData, null, 2), 'utf8');
  } catch (error) {
    // Silent fail - in-memory cache still works
  }
}

async function refreshSystemInfoCache() {
  if (systemInfoRefreshPromise) {
    return systemInfoRefreshPromise;
  }

  systemInfoRefreshPromise = (async () => {
    try {
      const baseInfo = systemInfoCache || buildBasicSystemInfo();
      const [osInfo, graphics] = await Promise.all([
        si.osInfo(),
        si.graphics()
      ]);

      const discreteGpus = mapDiscreteGpus((graphics && graphics.controllers) || []);
      const refreshedInfo = {
        ...baseInfo,
        os: {
          platform: osInfo.platform,
          distro: osInfo.distro,
          release: osInfo.release,
          arch: osInfo.arch
        },
        gpus: discreteGpus.length > 0 ? discreteGpus : null,
        gpuDetectionStatus: 'complete',
        lastUpdatedAt: Date.now()
      };

      systemInfoCache = refreshedInfo;
      writeSystemInfoCacheToDisk(refreshedInfo);
      return refreshedInfo;
    } catch (error) {
      // Keep existing cache if refresh fails
      return systemInfoCache;
    } finally {
      systemInfoRefreshPromise = null;
    }
  })();

  return systemInfoRefreshPromise;
}

function initializeSystemInfoCache() {
  systemInfoCachePath = path.join(app.getPath('userData'), SYSTEM_INFO_CACHE_FILENAME);
  systemInfoCache = readSystemInfoCacheFromDisk() || buildBasicSystemInfo();

  // Refresh once on startup in the background.
  setTimeout(() => {
    refreshSystemInfoCache();
  }, 1500);
}


function createWindow() {
  // Get icon path based on platform
  const iconPath = isDev
    ? path.join(__dirname, '../assets/icon.png')
    : path.join(process.resourcesPath, 'app/assets/icon.png');
  
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: iconPath,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    autoHideMenuBar: true,
    title: 'MineMaster'
  });

  const startURL = isDev
    ? 'http://localhost:3000'
    : `file://${path.join(__dirname, '../build/index.html')}`;

  mainWindow.loadURL(startURL);

  if (isDev && process.env.MINEMASTER_OPEN_DEVTOOLS === '1') {
    mainWindow.webContents.openDevTools();
  }

  // Initialize auto-updater (only runs checks in packaged builds)
  initAutoUpdater(mainWindow, stopAllMinersForUpdate);

  mainWindow.on('closed', () => {
    // Kill all running miners when window closes
    Object.entries(miners).forEach(([minerId, minerData]) => {
      const minerProcess = minerData.process;
      if (minerProcess && !minerProcess.killed) {
        const pid = minerProcess.pid;
        
        if (minerProcess._logSetupTimeout) {
          clearTimeout(minerProcess._logSetupTimeout);
        }
        if (minerProcess._logWatcher) {
          try { minerProcess._logWatcher.close(); } catch (e) {}
        }
        if (minerProcess._logPollInterval) {
          clearInterval(minerProcess._logPollInterval);
        }
        
        if (process.platform === 'win32') {
          // Windows: Use taskkill for reliable termination
          exec(`taskkill /PID ${pid} /T /F`, () => {});
        } else {
          // Linux/macOS: Use signals
          try {
            minerProcess.kill('SIGTERM'); // Graceful shutdown
          } catch (e) {}
          
          // Force kill after 3 seconds if still running
          setTimeout(() => {
            if (!minerProcess.killed) {
              try {
                minerProcess.kill('SIGKILL');
              } catch (e) {}
            }
          }, 3000);
        }
      }
    });
    mainWindow = null;
  });
}

app.on('ready', () => {
  initializeSystemInfoCache();
  createWindow();
});

app.on('window-all-closed', () => {
  // Kill all miners before quitting
  Object.values(miners).forEach(minerData => {
    const minerProcess = minerData.process;
    if (minerProcess && !minerProcess.killed) {
      const pid = minerProcess.pid;
      if (process.platform === 'win32') {
        exec(`taskkill /PID ${pid} /T /F`, () => {});
      } else {
        try { minerProcess.kill('SIGKILL'); } catch (e) {}
      }
    }
  });
  
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  // Clean up auto-updater intervals
  cleanupAutoUpdater();

  // Clear background intervals to prevent work after quit
  if (bgUpdateInterval) { clearInterval(bgUpdateInterval); bgUpdateInterval = null; }
  if (bgUpdateInitTimeout) { clearTimeout(bgUpdateInitTimeout); bgUpdateInitTimeout = null; }

  // Ensure all miners are stopped before app quits
  Object.values(miners).forEach(minerData => {
    if (minerData && minerData.process && !minerData.process.killed) {
      const pid = minerData.process.pid;
      try {
        if (process.platform === 'win32') {
          // taskkill /T kills the entire process tree (child workers, etc.)
          exec(`taskkill /PID ${pid} /T /F`, () => {});
        } else {
          minerData.process.kill('SIGKILL');
        }
      } catch (_) {}
    }
  });
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// ============================================
// AUTO-UPDATE HELPERS
// ============================================

/**
 * Gracefully stop all running miners before an auto-update restart.
 * Reuses the existing stop-miner IPC logic.
 */
async function stopAllMinersForUpdate() {
  const minerIds = Object.keys(miners);

  // Persist which miners are currently running so we can resume after update restart
  const runningIds = minerIds.filter(id => {
    const d = miners[id];
    return d && d.process && !d.process.killed;
  });
  if (runningIds.length > 0) {
    saveUpdateResumeState(runningIds);
  }

  if (minerIds.length === 0) return;

  const stopPromises = minerIds.map(async (minerId) => {
    const minerData = miners[minerId];
    if (!minerData || !minerData.process || minerData.process.killed) {
      delete miners[minerId];
      return;
    }

    const minerProcess = minerData.process;
    const pid = minerProcess.pid;

    // Clean up log file watchers / poll intervals before killing
    if (minerProcess._logSetupTimeout) {
      clearTimeout(minerProcess._logSetupTimeout);
    }
    if (minerProcess._logWatcher) {
      try { minerProcess._logWatcher.close(); } catch (_) {}
    }
    if (minerProcess._logPollInterval) {
      clearInterval(minerProcess._logPollInterval);
    }

    try {
      if (process.platform === 'win32') {
        await execAsync(`taskkill /PID ${pid} /T /F`, { timeout: 5000 }).catch(() => {});
      } else {
        try { minerProcess.kill('SIGTERM'); } catch (_) {}
        await new Promise((resolve) => setTimeout(resolve, 3000));
        if (!minerProcess.killed) {
          try { minerProcess.kill('SIGKILL'); } catch (_) {}
        }
      }
    } catch (_) {}
    delete miners[minerId];
  });

  await Promise.allSettled(stopPromises);
}

// Auto-update IPC handlers
ipcMain.handle('check-for-update', () => {
  checkForUpdates();
  return { success: true };
});

ipcMain.handle('get-update-status', () => {
  return { state: getUpdateState() };
});

ipcMain.handle('get-update-resume-state', () => {
  return loadAndClearUpdateResumeState();
});

// IPC Handlers for miner control

ipcMain.handle('start-miner', async (event, { minerId, minerType, config }) => {
  try {
    // Check if miner is already tracked and running
    const existingMiner = miners[minerId];
    if (existingMiner && existingMiner.process && !existingMiner.process.killed) {
      const existingPid = existingMiner.process.pid;
      // Check if process is actually still alive
      if (isProcessRunning(existingPid)) {
        return { success: true, pid: existingPid, message: 'Already running' };
      } else {
        delete miners[minerId];
      }
    }

    let minerProcess;

    // Function to strip ANSI color codes
    const stripAnsi = (str) => {
      return str.replace(/\x1B\[[0-9;]*[JKmsu]/g, '');
    };

    if (minerType === 'xmrig') {
      // Determine xmrig executable path based on platform (throws if not found)
      const xmrigPath = getXmrigPath(config.customPath);
      
      // Build xmrig arguments from config
      const args = buildXmrigArgs(config);

      // cwd must be the xmrig directory so it can find WinRing0x64.sys (MSR mod) on Windows
      minerProcess = spawn(xmrigPath, args, {
        cwd: path.dirname(xmrigPath),
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      });

      // Check if spawn succeeded (pid will be undefined if binary not executable)
      if (!minerProcess.pid) {
        const errorMsg = await new Promise((resolve) => {
          minerProcess.on('error', (err) => resolve(err.message));
          setTimeout(() => resolve('Failed to start miner - binary may be blocked by antivirus'), 1000);
        });
        return { success: false, error: `Failed to start xmrig: ${errorMsg}\nPath: ${xmrigPath}` };
      }

      minerProcess.stdout.on('data', (data) => {
        sendToRenderer('miner-output', {
          minerId,
          data: stripAnsi(data.toString())
        });
      });

      minerProcess.stderr.on('data', (data) => {
        sendToRenderer('miner-output', {
          minerId,
          data: stripAnsi(data.toString())
        });
      });

      minerProcess.on('error', (error) => {
        sendToRenderer('miner-error', {
          minerId,
          error: error.message
        });
        delete miners[minerId];
      });

      minerProcess.on('close', (code) => {
        sendToRenderer('miner-closed', {
          minerId,
          code
        });
        delete miners[minerId];
      });

      miners[minerId] = {
        process: minerProcess,
        executable: xmrigPath,
        type: 'xmrig'
      };

      // Wait briefly for spawn errors (e.g. ENOENT) before reporting success
      const spawnOk = await new Promise((resolve) => {
        const onError = () => resolve(false);
        minerProcess.once('error', onError);
        setTimeout(() => {
          minerProcess.removeListener('error', onError);
          resolve(true);
        }, 200);
      });

      if (!spawnOk) {
        return { success: false, error: `Failed to launch ${xmrigPath}` };
      }

      return { success: true, pid: minerProcess.pid };
    } else if (minerType === 'nanominer') {
      // Determine nanominer executable path (throws if not found)
      const nanominerPath = getNanominerPath(config.customPath);
      
      // Create config file for nanominer
      const configPath = createNanominerConfig(minerId, config);
      
      // Get nanominer directory
      const nanominerDir = path.dirname(nanominerPath);
      
      minerProcess = spawn(nanominerPath, [configPath], {
        cwd: nanominerDir,
        env: { ...process.env },
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      });

      // Check if spawn succeeded
      if (!minerProcess.pid) {
        const errorMsg = await new Promise((resolve) => {
          minerProcess.on('error', (err) => resolve(err.message));
          setTimeout(() => resolve('Failed to start miner - binary may be blocked by antivirus'), 1000);
        });
        return { success: false, error: `Failed to start nanominer: ${errorMsg}\nPath: ${nanominerPath}` };
      }

      minerProcess.stdout.on('data', (data) => {
        sendToRenderer('miner-output', {
          minerId,
          data: stripAnsi(data.toString())
        });
      });

      minerProcess.stderr.on('data', (data) => {
        sendToRenderer('miner-output', {
          minerId,
          data: stripAnsi(data.toString())
        });
      });

      const logDir = path.join(nanominerDir, 'logs');
      
      // Wait for nanominer to create log file; store timeout handle for cleanup
      const logSetupTimeout = setTimeout(() => {
        try {
          // Find the most recent log file
          if (!fs.existsSync(logDir)) {
            return;
          }
          
          const logFiles = fs.readdirSync(logDir)
            .filter(f => f.startsWith('log_'))
            .map(f => ({
              name: f,
              path: path.join(logDir, f),
              mtime: fs.statSync(path.join(logDir, f)).mtime
            }))
            .sort((a, b) => b.mtime - a.mtime);
          
          if (logFiles.length > 0) {
            const latestLog = logFiles[0].path;
            
            // Cross-platform log file watching
            let lastSize = 0;
            try {
              lastSize = fs.statSync(latestLog).size;
            } catch (e) {}
            
            // Read new content from log file
            const readNewContent = () => {
              let fd = -1;
              try {
                const stats = fs.statSync(latestLog);
                if (stats.size > lastSize) {
                  fd = fs.openSync(latestLog, 'r');
                  const bytesToRead = Math.min(stats.size - lastSize, MAX_LOG_READ_BYTES);
                  const buffer = Buffer.alloc(bytesToRead);
                  fs.readSync(fd, buffer, 0, buffer.length, lastSize);
                  
                  const output = stripAnsi(buffer.toString('utf8'));
                  if (output.trim()) {
                    sendToRenderer('miner-output', {
                      minerId,
                      data: output
                    });
                  }
                  lastSize += bytesToRead;
                }
              } catch (e) {
                // File might be locked or rotated
              } finally {
                if (fd >= 0) {
                  try { fs.closeSync(fd); } catch (_) {}
                }
              }
            };
            
            // Poll the log file every 500ms (more reliable than fs.watch on Windows)
            const logPollInterval = setInterval(readNewContent, 500);
            
            // Also try fs.watch for faster updates on Linux/macOS
            let logWatcher = null;
            try {
              logWatcher = fs.watch(latestLog, (eventType) => {
                if (eventType === 'change') {
                  readNewContent();
                }
              });
            } catch (e) {
              // fs.watch not available, using polling only
            }
            
            // Store watcher and interval so we can clean up later
            minerProcess._logWatcher = logWatcher;
            minerProcess._logPollInterval = logPollInterval;
          }
        } catch (e) {
          // Silent fail - log watching is optional
        }
      }, 2000);
      minerProcess._logSetupTimeout = logSetupTimeout;

      minerProcess.on('error', (error) => {
        clearTimeout(logSetupTimeout);
        sendToRenderer('miner-error', {
          minerId,
          error: error.message
        });
        delete miners[minerId];
      });

      minerProcess.on('close', (code) => {
        clearTimeout(logSetupTimeout);
        if (minerProcess._logWatcher) {
          try { minerProcess._logWatcher.close(); } catch (e) {}
        }
        if (minerProcess._logPollInterval) {
          clearInterval(minerProcess._logPollInterval);
        }
        
        sendToRenderer('miner-closed', {
          minerId,
          code
        });
        delete miners[minerId];
      });

      miners[minerId] = {
        process: minerProcess,
        configPath: configPath,
        executable: nanominerPath,
        type: 'nanominer'
      };

      // Wait briefly for spawn errors before reporting success
      const spawnOk = await new Promise((resolve) => {
        const onError = () => resolve(false);
        minerProcess.once('error', onError);
        setTimeout(() => {
          minerProcess.removeListener('error', onError);
          resolve(true);
        }, 200);
      });

      if (!spawnOk) {
        return { success: false, error: `Failed to launch ${nanominerPath}` };
      }

      return { success: true, pid: minerProcess.pid };
    } else {
      throw new Error(`Unsupported miner type: ${minerType}`);
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Check if process is still running
function isProcessRunning(pid) {
  try {
    process.kill(pid, 0); // Signal 0 checks if process exists without killing it
    return true;
  } catch (e) {
    return false;
  }
}

// Find all PIDs matching a process name and config path
async function findProcessPIDs(processName, configPath) {
  try {
    if (process.platform === 'win32') {
      // Windows: use tasklist (wmic is deprecated on modern Windows)
      const exeName = processName.endsWith('.exe') ? processName : `${processName}.exe`;
      const { stdout } = await execAsync(`tasklist /FI "IMAGENAME eq ${exeName}" /FO CSV /NH`, { timeout: 5000 });
      return stdout.split('\n')
        .map(line => {
          const parts = line.split(',');
          return parts.length >= 2 ? parseInt(parts[1].replace(/"/g, '').trim()) : NaN;
        })
        .filter(pid => !isNaN(pid) && pid > 0);
    } else {
      // Unix approach - find by command line containing config path
      try {
        const { stdout } = await execAsync(`pgrep -f "${configPath}"`);
        return stdout.split('\n')
          .map(line => line.trim())
          .filter(line => line && !isNaN(line))
          .map(Number);
      } catch (e) {
        // pgrep returns exit code 1 if no processes found
        return [];
      }
    }
  } catch (error) {
    return [];
  }
}

// Aggressive kill with multiple strategies
async function killMinerProcess(pid, signal = 'SIGTERM') {
  if (!pid || pid <= 0) return false;
  try {
    if (process.platform === 'win32') {
      if (signal === 'SIGKILL') {
        await execAsync(`taskkill /PID ${pid} /T /F`);
      } else {
        // Graceful: try WM_CLOSE via taskkill without /F, fall back to /F if it fails
        try {
          await execAsync(`taskkill /PID ${pid} /T`);
        } catch (e) {
          await execAsync(`taskkill /PID ${pid} /T /F`);
        }
      }
    } else {
      // Unix - try multiple approaches
      try {
        // Try process group kill first (pid must be positive for group kill)
        if (pid > 1) process.kill(-pid, signal);
      } catch (e1) {
        try {
          // Fallback to regular kill
          process.kill(pid, signal);
        } catch (e2) {
          // Last resort - use kill command
          await execAsync(`kill -${signal === 'SIGKILL' ? 9 : 15} ${pid}`);
        }
      }
    }
    return true;
  } catch (error) {
    return false;
  }
}

ipcMain.handle('stop-miner', async (event, { minerId }) => {
  try {
    const minerData = miners[minerId];
    
    if (!minerData) {
      return { success: false, error: 'Miner not found' };
    }
    
    const minerProcess = minerData.process;
    const configPath = minerData.configPath;
    const executable = minerData.executable;
    const minerType = minerData.type;
    
    if (minerProcess.killed) {
      delete miners[minerId];
      return { success: true, message: 'Miner was already stopped' };
    }
    
    const mainPID = minerProcess.pid;
    
    // Clean up log watcher and poll interval (for nanominer)
    if (minerProcess._logWatcher) {
      try {
        minerProcess._logWatcher.close();
      } catch (e) {}
    }
    if (minerProcess._logPollInterval) {
      clearInterval(minerProcess._logPollInterval);
    }
    
    // Find ALL related PIDs (in case of orphaned processes)
    const relatedPIDs = configPath ? await findProcessPIDs(minerType, configPath) : [];
    const allPIDs = [mainPID, ...relatedPIDs].filter((pid, index, self) => self.indexOf(pid) === index);
    
    // Step 1: Try graceful shutdown with SIGTERM
    for (const pid of allPIDs) {
      if (isProcessRunning(pid)) {
        await killMinerProcess(pid, 'SIGTERM');
      }
    }
    
    // Wait up to 5 seconds for graceful shutdown
    const gracefulTimeout = 5000;
    const checkInterval = 200;
    let waited = 0;
    
    while (waited < gracefulTimeout) {
      await new Promise(resolve => setTimeout(resolve, checkInterval));
      waited += checkInterval;
      
      const stillRunning = allPIDs.filter(pid => isProcessRunning(pid));
      if (stillRunning.length === 0) {
        delete miners[minerId];
        return { success: true, message: 'Miner stopped successfully' };
      }
    }
    
    // Step 2: Force kill with SIGKILL
    const stillAlive = allPIDs.filter(pid => isProcessRunning(pid));
    
    for (const pid of stillAlive) {
      await killMinerProcess(pid, 'SIGKILL');
    }
    
    // Wait up to 2 seconds for force kill
    const forceTimeout = 2000;
    waited = 0;
    
    while (waited < forceTimeout) {
      await new Promise(resolve => setTimeout(resolve, checkInterval));
      waited += checkInterval;
      
      const stillRunning = allPIDs.filter(pid => isProcessRunning(pid));
      if (stillRunning.length === 0) {
        delete miners[minerId];
        return { success: true, message: 'Miner stopped (force killed)' };
      }
    }
    
    // Step 3: Last resort - force-kill remaining known PIDs directly
    try {
      const remaining = allPIDs.filter(pid => isProcessRunning(pid));
      if (process.platform === 'win32') {
        for (const pid of remaining) {
          await execAsync(`taskkill /PID ${pid} /T /F 2>nul`).catch(() => {});
        }
      } else {
        // Only kill by config path to avoid killing other miner instances
        if (configPath) {
          await execAsync(`pkill -9 -f "${configPath}"`).catch(() => {});
        }
        for (const pid of remaining) {
          await execAsync(`kill -9 ${pid}`).catch(() => {});
        }
      }
    } catch (e) {
      // kill commands will error if no processes found
    }
    
    // Final check
    await new Promise(resolve => setTimeout(resolve, 500));
    const finalCheck = allPIDs.filter(pid => isProcessRunning(pid));
    
    if (finalCheck.length === 0) {
      delete miners[minerId];
      return { success: true, message: 'Miner stopped (pkill)' };
    }
    
    // If STILL running, give up but clean up tracking - platform-specific message
    delete miners[minerId];
    const killCmd = process.platform === 'win32' 
      ? `taskkill /F /PID ${finalCheck.join(' /PID ')}`
      : `kill -9 ${finalCheck.join(' ')}`;
    return { 
      success: false, 
      error: `Some processes still running (PIDs: ${finalCheck.join(', ')}). Try: ${killCmd}` 
    };
    
  } catch (error) {
    delete miners[minerId]; // Clean up even on error
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-miner-status', async (event, { minerId }) => {
  const minerData = miners[minerId];
  const isRunning = minerData && minerData.process && !minerData.process.killed;
  return { 
    running: isRunning,
    pid: isRunning ? minerData.process.pid : null
  };
});

ipcMain.handle('get-all-miners-status', async () => {
  const statuses = {};
  Object.keys(miners).forEach(minerId => {
    const minerData = miners[minerId];
    const isRunning = minerData && minerData.process && !minerData.process.killed;
    statuses[minerId] = {
      running: isRunning,
      pid: isRunning ? minerData.process.pid : null
    };
  });
  return statuses;
});

ipcMain.handle('get-system-info', async () => {
  if (!systemInfoCache) {
    systemInfoCache = buildBasicSystemInfo();
  }

  // Ensure one startup refresh is in progress if detection is still pending.
  if (systemInfoCache.gpuDetectionStatus !== 'complete') {
    refreshSystemInfoCache();
  }

  return systemInfoCache;
});

// Cache for slow-changing stats (updated in background)
let cachedCpuTemp = null;
let cachedGpuStats = []; // Array to support multiple GPUs
let tempUpdateInProgress = false;
let gpuUpdateInProgress = false;

// Background update for CPU temp (non-blocking) - Cross-platform
function updateCpuTempAsync() {
  if (tempUpdateInProgress) return;
  tempUpdateInProgress = true;
  
  setTimeout(async () => {
    try {
      if (process.platform === 'linux') {
        // Linux: Read directly from sysfs
        const zones = [
          '/sys/class/thermal/thermal_zone0/temp',
          '/sys/class/hwmon/hwmon0/temp1_input',
          '/sys/class/hwmon/hwmon1/temp1_input',
          '/sys/class/hwmon/hwmon2/temp1_input'
        ];
        
        for (const zone of zones) {
          try {
            if (fs.existsSync(zone)) {
              const temp = parseInt(fs.readFileSync(zone, 'utf8')) / 1000;
              cachedCpuTemp = temp;
              break;
            }
          } catch (e) {}
        }
      } else if (process.platform === 'win32') {
        // Windows: Try multiple methods for CPU temperature
        let tempFound = false;
        
        // Method 1: systeminformation library (works with Open Hardware Monitor / LibreHardwareMonitor)
        try {
          const cpuTemp = await si.cpuTemperature();
          if (cpuTemp && cpuTemp.main !== null && cpuTemp.main !== -1 && cpuTemp.main > 0) {
            cachedCpuTemp = cpuTemp.main;
            tempFound = true;
          }
        } catch (e) {}
        
        // Method 2: WMI ThermalZone (requires admin on some systems)
        if (!tempFound) {
          try {
            const { stdout } = await execAsync('wmic /namespace:\\\\root\\wmi PATH MSAcpi_ThermalZoneTemperature get CurrentTemperature 2>nul', { timeout: 3000 });
            const lines = stdout.split('\n').filter(l => l.trim() && !isNaN(l.trim()));
            if (lines.length > 0) {
              // WMI returns temp in tenths of Kelvin
              const tempKelvin = parseInt(lines[0].trim()) / 10;
              const tempCelsius = tempKelvin - 273.15;
              // Validate reasonable temperature range (10°C to 110°C)
              if (tempCelsius > 10 && tempCelsius < 110) {
                cachedCpuTemp = tempCelsius;
                tempFound = true;
              }
            }
          } catch (e2) {}
        }
        
        // Method 3: PowerShell with CIM (modern Windows)
        if (!tempFound) {
          try {
            const psCmd = 'powershell -NoProfile -Command "Get-CimInstance MSAcpi_ThermalZoneTemperature -Namespace root/wmi -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty CurrentTemperature"';
            const { stdout } = await execAsync(psCmd, { timeout: 5000 });
            const tempValue = parseInt(stdout.trim());
            if (tempValue && !isNaN(tempValue)) {
              const tempCelsius = (tempValue / 10) - 273.15;
              if (tempCelsius > 10 && tempCelsius < 110) {
                cachedCpuTemp = tempCelsius;
              }
            }
          } catch (e3) {}
        }
      } else if (process.platform === 'darwin') {
        // macOS: Use systeminformation
        try {
          const cpuTemp = await si.cpuTemperature();
          if (cpuTemp && cpuTemp.main !== null && cpuTemp.main !== -1) {
            cachedCpuTemp = cpuTemp.main;
          }
        } catch (e) {}
      }
    } catch (e) {
      // Silent fail - CPU temp not available
    } finally {
      tempUpdateInProgress = false;
    }
  }, 0);
}

// Background update for GPU info (non-blocking) - Cross-platform
function updateGpuInfoAsync() {
  if (gpuUpdateInProgress) return;
  gpuUpdateInProgress = true;
  
  setTimeout(async () => {
    try {
      const detectedGpus = [];
      
      if (process.platform === 'linux') {
        // Linux: Read AMD GPUs from sysfs
        for (let cardNum = 0; cardNum < 8; cardNum++) {
          const amdPath = `/sys/class/drm/card${cardNum}/device`;
          if (fs.existsSync(amdPath)) {
            const gpuInfo = { id: cardNum, usage: null, temperature: null, vramUsed: null, vramTotal: null, type: 'AMD' };
            
            // Try to read temp
            try {
              const hwmonPath = `${amdPath}/hwmon`;
              if (fs.existsSync(hwmonPath)) {
                const hwmons = fs.readdirSync(hwmonPath);
                if (hwmons.length > 0) {
                  const tempFile = `${hwmonPath}/${hwmons[0]}/temp1_input`;
                  if (fs.existsSync(tempFile)) {
                    gpuInfo.temperature = parseInt(fs.readFileSync(tempFile, 'utf8')) / 1000;
                  }
                }
              }
            } catch (e) {}
            
            // Try to read usage
            try {
              const usageFile = `${amdPath}/gpu_busy_percent`;
              if (fs.existsSync(usageFile)) {
                gpuInfo.usage = parseInt(fs.readFileSync(usageFile, 'utf8'));
              }
            } catch (e) {}
            
            // Try to read VRAM info
            try {
              const vramUsedFile = `${amdPath}/mem_info_vram_used`;
              const vramTotalFile = `${amdPath}/mem_info_vram_total`;
              if (fs.existsSync(vramUsedFile) && fs.existsSync(vramTotalFile)) {
                gpuInfo.vramUsed = parseInt(fs.readFileSync(vramUsedFile, 'utf8')) / (1024 * 1024); // bytes to MB
                gpuInfo.vramTotal = parseInt(fs.readFileSync(vramTotalFile, 'utf8')) / (1024 * 1024); // bytes to MB
              }
            } catch (e) {}
            
            // Only add if it has valid stats AND isn't integrated graphics (> 1GB VRAM or no VRAM info)
            const hasValidStats = gpuInfo.temperature !== null || gpuInfo.usage !== null;
            const isNotIntegrated = gpuInfo.vramTotal === null || gpuInfo.vramTotal > 1024; // > 1GB
            
            if (hasValidStats && isNotIntegrated) {
              detectedGpus.push(gpuInfo);
            }
          }
        }
      } else if (process.platform === 'win32') {
        // Windows: Use systeminformation for GPU detection
        try {
          const graphics = await si.graphics();
          if (graphics && graphics.controllers) {
            let gpuIndex = 0;
            graphics.controllers.forEach((gpu) => {
              if (isLikelyIntegratedGpu(gpu)) {
                return;
              }
              
              // Discrete GPU detected
              const vendor = (gpu.vendor || '').toLowerCase();
              const gpuInfo = {
                id: gpuIndex++,
                temperature: gpu.temperatureGpu || null,
                usage: gpu.utilizationGpu || null,
                vramUsed: gpu.memoryUsed || null,
                vramTotal: gpu.vram || null,
                type: vendor.includes('nvidia') ? 'NVIDIA' : 'AMD',
                model: gpu.model || 'Unknown GPU'
              };
              
              // Only include GPUs with >512MB VRAM (discrete GPUs)
              if (gpuInfo.vramTotal > 512) {
                detectedGpus.push(gpuInfo);
              }
            });
          }
        } catch (e) {
          // Silent fail - will try NVIDIA detection with nvidia-smi
        }
      }
      
      const hasNvidiaFromSi = detectedGpus.some(g => g.type === 'NVIDIA');

      let nvidiaSmiExe = 'nvidia-smi';
      if (process.platform === 'win32') {
        // nvidia-smi may not be on PATH on Windows; check known install locations
        const candidates = [
          path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'nvidia-smi.exe'),
          path.join(process.env.ProgramFiles || 'C:\\Program Files', 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe')
        ];
        for (const candidate of candidates) {
          if (fs.existsSync(candidate)) {
            nvidiaSmiExe = `"${candidate}"`;
            break;
          }
        }
      }

      const nullDev = process.platform === 'win32' ? 'NUL' : '/dev/null';
      const nvidiaSmiCmd = `${nvidiaSmiExe} --query-gpu=index,temperature.gpu,utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits 2>${nullDev}`;
      
      exec(nvidiaSmiCmd, { timeout: 5000 }, (error, stdout) => {
        if (!error && stdout && stdout.trim()) {
          // If si.graphics already found NVIDIA GPUs, replace them with nvidia-smi data (more accurate stats)
          if (hasNvidiaFromSi) {
            const nonNvidia = detectedGpus.filter(g => g.type !== 'NVIDIA');
            detectedGpus.length = 0;
            nonNvidia.forEach(g => detectedGpus.push(g));
          }

          const lines = stdout.trim().split('\n');
          lines.forEach(line => {
            const parts = line.split(',').map(p => p.trim());
            if (parts.length >= 5 && !isNaN(parts[0])) {
              detectedGpus.push({
                id: parseInt(parts[0]),
                temperature: parseFloat(parts[1]),
                usage: parseFloat(parts[2]),
                vramUsed: parseFloat(parts[3]),
                vramTotal: parseFloat(parts[4]),
                type: 'NVIDIA'
              });
            }
          });
        }
        
        if (detectedGpus.length > 0) {
          cachedGpuStats = detectedGpus;
        }
        
        gpuUpdateInProgress = false;
      });
      
    } catch (e) {
      gpuUpdateInProgress = false;
    }
  }, 0);
}

// Track background timers for cleanup on quit
let bgUpdateInterval = null;
let bgUpdateInitTimeout = null;

// Start background updates every 10 seconds
bgUpdateInterval = setInterval(() => {
  updateCpuTempAsync();
  updateGpuInfoAsync();
}, 10000);

// Initial update after 2 seconds
bgUpdateInitTimeout = setTimeout(() => {
  updateCpuTempAsync();
  updateGpuInfoAsync();
}, 2000);

// Cross-platform CPU usage: sample os.cpus() and compute delta between ticks.
// os.loadavg() returns [0,0,0] on Windows, so we must use tick-based measurement.
let prevCpuTimes = null;
let cachedCpuUsage = 0;

function sampleCpuUsage() {
  const cpus = os.cpus();
  const totals = { idle: 0, total: 0 };
  cpus.forEach(cpu => {
    const t = cpu.times;
    totals.idle += t.idle;
    totals.total += t.user + t.nice + t.sys + t.irq + t.idle;
  });

  if (prevCpuTimes) {
    const idleDelta = totals.idle - prevCpuTimes.idle;
    const totalDelta = totals.total - prevCpuTimes.total;
    cachedCpuUsage = totalDelta > 0 ? Math.min(((totalDelta - idleDelta) / totalDelta) * 100, 100) : 0;
  }
  prevCpuTimes = totals;
}

// Sample every 5 seconds in the background (lightweight — just reads /proc/stat or kernel counters)
setInterval(sampleCpuUsage, 5000);
setTimeout(sampleCpuUsage, 500);

ipcMain.handle('get-cpu-stats', () => {
  return {
    usage: cachedCpuUsage,
    temperature: cachedCpuTemp
  };
});

ipcMain.handle('get-memory-stats', () => {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  
  return {
    total: totalMem,
    used: totalMem - freeMem,
    usagePercent: ((totalMem - freeMem) / totalMem) * 100
  };
});

ipcMain.handle('get-gpu-stats', () => {
  return cachedGpuStats.length > 0 ? cachedGpuStats : null;
});

// Helper functions

function getMinerBinaryPath(minerType, customPath) {
  const binaryNames = {
    xmrig: process.platform === 'win32' ? 'xmrig.exe' : 'xmrig',
    nanominer: process.platform === 'win32' ? 'nanominer.exe' : 'nanominer'
  };

  const binaryName = binaryNames[minerType];
  if (!binaryName) {
    throw new Error(`Unknown miner type: ${minerType}`);
  }

  // Custom path provided by user
  if (customPath) {
    const normalized = path.normalize(customPath);
    if (fs.existsSync(normalized)) {
      return normalized;
    }
    throw new Error(
      `Custom ${minerType} path not found: ${normalized}\n` +
      `Make sure the file exists and is not blocked by antivirus.`
    );
  }

  // Bundled binary paths to check (in priority order)
  const searchPaths = [];

  // Production: process.resourcesPath/miners/<type>/binary
  if (!isDev && process.resourcesPath) {
    searchPaths.push(path.join(process.resourcesPath, 'miners', minerType, binaryName));
  }

  // Dev mode: project/miners/<type>/binary
  searchPaths.push(path.join(__dirname, '..', 'miners', minerType, binaryName));

  // Check each path
  for (const searchPath of searchPaths) {
    if (fs.existsSync(searchPath)) {
      return path.normalize(searchPath);
    }
  }

  // Nothing found - build a helpful error message
  const searchedStr = searchPaths.map(p => `  - ${p}`).join('\n');
  let errorMsg = `${binaryName} not found. Searched:\n${searchedStr}`;

  if (process.platform === 'win32') {
    errorMsg += `\n\nCommon fixes on Windows:\n` +
      `1. Windows Defender or antivirus may have quarantined ${binaryName} — add an exclusion for the MineMaster folder\n` +
      `2. Re-download: run "npm run setup" from the MineMaster directory\n` +
      `3. Or manually place ${binaryName} in the miners/${minerType}/ folder`;
  } else {
    errorMsg += `\n\nRe-download: run "npm run setup" from the MineMaster directory`;
  }

  throw new Error(errorMsg);
}

function getXmrigPath(customPath) {
  return getMinerBinaryPath('xmrig', customPath);
}

function getNanominerPath(customPath) {
  return getMinerBinaryPath('nanominer', customPath);
}

function createNanominerConfig(minerId, config) {
  // Write config to userData (writable on all platforms, even if installed to Program Files)
  const configDir = isDev
    ? path.join(__dirname, '../miners/nanominer')
    : path.join(app.getPath('userData'), 'nanominer-configs');
  
  // Ensure config directory exists
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  
  // Use a clean filename (sanitize minerId for Windows compatibility)
  const safeMinerId = minerId.replace(/[^a-zA-Z0-9-_]/g, '_');
  const configPath = path.join(configDir, `${safeMinerId}-config.ini`);
  
  // Build config content (flat format, no section headers for single coin)
  // Use Windows-style line endings on Windows for better compatibility
  const lineEnding = process.platform === 'win32' ? '\r\n' : '\n';
  let configContent = '';
  
  // Add wallet and pool info
  if (config.user) {
    configContent += `wallet = ${config.user}${lineEnding}`;
  }
  
  // Nanominer uses "coin" parameter instead of algorithm section
  if (config.coin) {
    configContent += `coin = ${config.coin}${lineEnding}`;
  } else if (config.algorithm) {
    // Fallback: try to map algorithm to coin
    const algoToCoin = {
      'kawpow': 'RVN',
      'etchash': 'ETC',
      'ethash': 'ETC',
      'autolykos2': 'ERG',
      'octopus': 'CFX',
      'randomx': 'XMR',
      'zelhash': 'FLUX',
      'beamhash': 'BEAM'
    };
    const coin = algoToCoin[config.algorithm.toLowerCase()] || config.algorithm.toUpperCase();
    configContent += `coin = ${coin}${lineEnding}`;
  }
  
  if (config.pool) {
    configContent += `pool1 = ${config.pool}${lineEnding}`;
  }
  
  // Set rig name for pool identification (default to hostname if not set)
  const rigName = config.rigName || os.hostname();
  configContent += `rigName = ${rigName}${lineEnding}`;
  
  if (config.email) {
    configContent += `email = ${config.email}${lineEnding}`;
  }
  
  // GPU selection
  if (config.gpus && config.gpus.length > 0) {
    configContent += `devices = ${config.gpus.join(',')}${lineEnding}`;
  }
  
  configContent += lineEnding;
  
  // Add global settings
  configContent += `webPort = 0${lineEnding}`; // Disable web interface to avoid port conflicts
  configContent += `watchdog = false${lineEnding}`; // Disable watchdog to prevent parent-child process spawning
  
  // Windows-specific: Add noColor to avoid ANSI issues in some terminals
  if (process.platform === 'win32') {
    configContent += `noColor = true${lineEnding}`;
  }
  
  // Write config file
  fs.writeFileSync(configPath, configContent, 'utf8');
  
  return path.normalize(configPath);
}

function buildXmrigArgs(config) {
  const args = [];

  if (config.pool) {
    args.push('-o', config.pool);
  }

  if (config.user) {
    args.push('-u', config.user);
  }

  // Password defaults to hostname (used as worker name by many pools)
  args.push('-p', config.password || os.hostname());

  if (config.algorithm) {
    args.push('-a', config.algorithm);
  }

  // Calculate threads based on percentage
  // threadPercentage: 100 = all threads (0), 50 = half threads, etc.
  if (config.threadPercentage !== undefined && config.threadPercentage !== 100) {
    const totalCpus = os.cpus().length;
    const threadsToUse = Math.max(1, Math.round(totalCpus * (config.threadPercentage / 100)));
    args.push('-t', threadsToUse.toString());
  }
  // 100% or undefined = use all threads (don't specify -t, let XMRig decide)

  if (config.donateLevel !== undefined) {
    args.push('--donate-level', config.donateLevel.toString());
  }

  // Set rig-id (worker name) for pool identification
  if (config.workerName) {
    args.push('--rig-id', config.workerName);
  } else {
    // Default to hostname if no custom worker name
    args.push('--rig-id', os.hostname());
  }

  // Add any additional arguments
  if (config.additionalArgs) {
    args.push(...config.additionalArgs.split(' ').filter(arg => arg.trim()));
  }

  return args;
}

// ============================================
// MASTER SERVER IPC HANDLERS
// ============================================

/**
 * Get MAC address of the primary network interface
 */
ipcMain.handle('get-mac-address', async () => {
  try {
    const networkInterfaces = await si.networkInterfaces();
    // Get the first interface with a valid MAC address
    const primaryInterface = networkInterfaces.find(iface => 
      iface.mac && 
      iface.mac !== '00:00:00:00:00:00' && 
      !iface.internal
    );
    
    if (primaryInterface) {
      return primaryInterface.mac;
    }
    
    // Fallback: try to get any non-loopback interface
    const anyInterface = networkInterfaces.find(iface => 
      iface.mac && 
      iface.mac !== '00:00:00:00:00:00'
    );
    
    return anyInterface ? anyInterface.mac : 'unknown-mac';
  } catch (error) {
    return 'unknown-mac';
  }
});

/**
 * Get the writable path for master-server.json
 * In production, __dirname is inside the read-only app.asar, so we use userData instead.
 * In dev mode, we use the project directory as before.
 */
function getMasterConfigPath() {
  if (isDev) {
    return path.join(__dirname, '..', 'master-server.json');
  }
  return path.join(app.getPath('userData'), 'master-server.json');
}

/**
 * Load master server configuration
 */
ipcMain.handle('load-master-config', async () => {
  const configPath = getMasterConfigPath();
  
  // Also check the bundled default (inside asar) for first-run migration
  const bundledPath = path.join(__dirname, '..', 'master-server.json');
  
  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf8');
      return JSON.parse(data);
    } else if (!isDev && fs.existsSync(bundledPath)) {
      // First run after install: copy bundled config to writable location
      const data = fs.readFileSync(bundledPath, 'utf8');
      const config = JSON.parse(data);
      try {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      } catch (e) {
        // If migration fails, still return the config
      }
      return config;
    } else {
      // Return default config
      const defaultConfig = {
        enabled: false,
        host: 'mining.ironcladtech.ca',
        port: 443,
        autoReconnect: true,
        reconnectInterval: 5000,
        heartbeatInterval: 30000
      };
      return defaultConfig;
    }
  } catch (error) {
    throw error;
  }
});

/**
 * Save master server configuration
 */
ipcMain.handle('save-master-config', async (event, config) => {
  const configPath = getMasterConfigPath();
  
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    return { success: true };
  } catch (error) {
    throw error;
  }
});
