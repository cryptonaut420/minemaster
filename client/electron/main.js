const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const isDev = require('electron-is-dev');
const { spawn, exec } = require('child_process');
const { promisify } = require('util');
const si = require('systeminformation');
const os = require('os');
const fs = require('fs');

const execAsync = promisify(exec);

let mainWindow;
let miners = {}; // Store active miner processes { minerId: { process, configPath, executable } }

// Cache for system info (fetched once on startup)
let systemInfoCache = null;


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

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    // Kill all running miners when window closes
    console.log('Window closing - stopping all miners...');
    Object.entries(miners).forEach(([minerId, minerData]) => {
      const minerProcess = minerData.process;
      if (minerProcess && !minerProcess.killed) {
        const pid = minerProcess.pid;
        console.log(`Stopping miner: ${minerId} (PID: ${pid})`);
        
        // Clean up log watchers
        if (minerProcess._logWatcher) {
          try { minerProcess._logWatcher.close(); } catch (e) {}
        }
        if (minerProcess._logPollInterval) {
          clearInterval(minerProcess._logPollInterval);
        }
        
        if (process.platform === 'win32') {
          // Windows: Use taskkill for reliable termination
          exec(`taskkill /PID ${pid} /T /F`, (err) => {
            if (err) console.error(`Failed to kill PID ${pid}:`, err.message);
          });
        } else {
          // Linux/macOS: Use signals
          try {
            minerProcess.kill('SIGTERM'); // Graceful shutdown
          } catch (e) {}
          
          // Force kill after 3 seconds if still running
          setTimeout(() => {
            if (!minerProcess.killed) {
              console.log(`Force killing miner: ${minerId}`);
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

app.on('ready', createWindow);

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
  // Ensure all miners are stopped before app quits
  console.log('App quitting - stopping all miners...');
  Object.values(miners).forEach(minerData => {
    if (minerData && minerData.process && !minerData.process.killed) {
      try {
        minerData.process.kill('SIGKILL');
      } catch (error) {
        console.error('Error killing miner:', error);
      }
    }
  });
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// IPC Handlers for miner control

ipcMain.handle('start-miner', async (event, { minerId, minerType, config }) => {
  try {
    console.log(`[start-miner] Called for ${minerId} (type: ${minerType})`);
    
    // Check if miner is already tracked and running
    const existingMiner = miners[minerId];
    if (existingMiner && existingMiner.process && !existingMiner.process.killed) {
      const existingPid = existingMiner.process.pid;
      // Check if process is actually still alive
      if (isProcessRunning(existingPid)) {
        console.log(`[start-miner] Miner ${minerId} already running (PID: ${existingPid}), returning existing`);
        return { success: true, pid: existingPid, message: 'Already running' };
      } else {
        console.log(`[start-miner] Miner ${minerId} was tracked but process ${existingPid} is dead, cleaning up...`);
        delete miners[minerId];
      }
    }

    let minerProcess;

    if (minerType === 'xmrig') {
      // Determine xmrig executable path based on platform
      const xmrigPath = getXmrigPath(config.customPath);
      
      // Build xmrig arguments from config
      const args = buildXmrigArgs(config);

      // Spawn with detached process group for proper cleanup
      minerProcess = spawn(xmrigPath, args, {
        detached: false, // Keep attached to parent but in own process group
        stdio: ['ignore', 'pipe', 'pipe']
      });

      // Function to strip ANSI color codes
      const stripAnsi = (str) => {
        return str.replace(/\x1B\[[0-9;]*[JKmsu]/g, '');
      };

      // Send stdout to renderer (strip color codes)
      minerProcess.stdout.on('data', (data) => {
        mainWindow.webContents.send('miner-output', {
          minerId,
          data: stripAnsi(data.toString())
        });
      });

      // Send stderr to renderer (strip color codes)
      minerProcess.stderr.on('data', (data) => {
        mainWindow.webContents.send('miner-output', {
          minerId,
          data: stripAnsi(data.toString())
        });
      });

      minerProcess.on('error', (error) => {
        mainWindow.webContents.send('miner-error', {
          minerId,
          error: error.message
        });
      });

      minerProcess.on('close', (code) => {
        mainWindow.webContents.send('miner-closed', {
          minerId,
          code
        });
        delete miners[minerId];
      });

      // Store process with metadata for robust killing
      miners[minerId] = {
        process: minerProcess,
        executable: xmrigPath,
        type: 'xmrig'
      };

      return { success: true, pid: minerProcess.pid };
    } else if (minerType === 'nanominer') {
      // Determine nanominer executable path
      const nanominerPath = getNanominerPath(config.customPath);
      
      // Create config file for nanominer
      const configPath = createNanominerConfig(minerId, config);
      
      // Get nanominer directory
      const nanominerDir = path.dirname(nanominerPath);
      
      console.log(`[nanominer] Starting from: ${nanominerDir}`);
      console.log(`[nanominer] Executable: ${nanominerPath}`);
      console.log(`[nanominer] Config: ${configPath}`);
      
      // Nanominer needs to run from its own directory
      // Run directly without stdbuf wrapper to maintain proper process control
      minerProcess = spawn(nanominerPath, [configPath], {
        cwd: nanominerDir,
        env: { ...process.env },
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      // Function to strip ANSI color codes
      const stripAnsi = (str) => {
        return str.replace(/\x1B\[[0-9;]*[JKmsu]/g, '');
      };

      // Send stdout to renderer
      minerProcess.stdout.on('data', (data) => {
        const output = stripAnsi(data.toString());
        console.log(`[nanominer stdout]: ${output}`);
        mainWindow.webContents.send('miner-output', {
          minerId,
          data: output
        });
      });

      // Send stderr to renderer
      minerProcess.stderr.on('data', (data) => {
        const output = stripAnsi(data.toString());
        console.log(`[nanominer stderr]: ${output}`);
        mainWindow.webContents.send('miner-output', {
          minerId,
          data: output
        });
      });

      // Nanominer parent process doesn't output to stdout/stderr
      // The child process writes to log files instead
      // Watch the log file to get real-time output (cross-platform)
      const logDir = path.join(nanominerDir, 'logs');
      
      // Wait a moment for nanominer to create the log file
      setTimeout(() => {
        try {
          // Find the most recent log file
          if (!fs.existsSync(logDir)) {
            console.log('[nanominer] Log directory not found yet');
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
            console.log(`[nanominer] Watching log file: ${latestLog}`);
            
            // Cross-platform log file watching
            let lastSize = 0;
            try {
              lastSize = fs.statSync(latestLog).size;
            } catch (e) {}
            
            // Read new content from log file
            const readNewContent = () => {
              try {
                const stats = fs.statSync(latestLog);
                if (stats.size > lastSize) {
                  const fd = fs.openSync(latestLog, 'r');
                  const buffer = Buffer.alloc(stats.size - lastSize);
                  fs.readSync(fd, buffer, 0, buffer.length, lastSize);
                  fs.closeSync(fd);
                  
                  const output = stripAnsi(buffer.toString('utf8'));
                  if (output.trim()) {
                    console.log(`[nanominer log]: ${output}`);
                    mainWindow.webContents.send('miner-output', {
                      minerId,
                      data: output
                    });
                  }
                  lastSize = stats.size;
                }
              } catch (e) {
                // File might be locked or rotated
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
              console.log('[nanominer] fs.watch not available, using polling only');
            }
            
            // Store watcher and interval so we can clean up later
            minerProcess._logWatcher = logWatcher;
            minerProcess._logPollInterval = logPollInterval;
          }
        } catch (e) {
          console.error('[nanominer] Failed to watch log file:', e);
        }
      }, 2000); // Wait 2 seconds for log file to be created

      minerProcess.on('error', (error) => {
        console.error(`[nanominer error]:`, error);
        mainWindow.webContents.send('miner-error', {
          minerId,
          error: error.message
        });
      });

      minerProcess.on('close', (code) => {
        console.log(`[nanominer] Process closed with code: ${code}`);
        
        // Clean up log watcher and poll interval
        if (minerProcess._logWatcher) {
          try {
            minerProcess._logWatcher.close();
          } catch (e) {
            console.error('[nanominer] Failed to close log watcher:', e);
          }
        }
        if (minerProcess._logPollInterval) {
          clearInterval(minerProcess._logPollInterval);
        }
        
        mainWindow.webContents.send('miner-closed', {
          minerId,
          code
        });
        delete miners[minerId];
      });

      // Store process with metadata for robust killing
      miners[minerId] = {
        process: minerProcess,
        configPath: configPath,
        executable: nanominerPath,
        type: 'nanominer'
      };

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
      // Windows approach
      const { stdout } = await execAsync(`wmic process where "name='${processName}'" get ProcessId`);
      return stdout.split('\n')
        .map(line => line.trim())
        .filter(line => line && !isNaN(line))
        .map(Number);
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
    console.error('Error finding process PIDs:', error.message);
    return [];
  }
}

// Aggressive kill with multiple strategies
async function killMinerProcess(pid, signal = 'SIGTERM') {
  try {
    if (process.platform === 'win32') {
      // Windows
      if (signal === 'SIGKILL') {
        await execAsync(`taskkill /PID ${pid} /T /F`);
      } else {
        await execAsync(`taskkill /PID ${pid} /T`);
      }
    } else {
      // Unix - try multiple approaches
      try {
        // Try process group kill first
        process.kill(-pid, signal);
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
    console.error(`Failed to kill PID ${pid}:`, error.message);
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
    console.log(`[stop-miner] Stopping ${minerType} ${minerId} (Main PID: ${mainPID})`);
    console.log(`[stop-miner] Config: ${configPath}`);
    
    // Clean up log watcher and poll interval (for nanominer)
    if (minerProcess._logWatcher) {
      try {
        minerProcess._logWatcher.close();
        console.log(`[stop-miner] Closed log watcher`);
      } catch (e) {
        console.error('[stop-miner] Failed to close log watcher:', e);
      }
    }
    if (minerProcess._logPollInterval) {
      clearInterval(minerProcess._logPollInterval);
      console.log(`[stop-miner] Cleared log poll interval`);
    }
    
    // Find ALL related PIDs (in case of orphaned processes)
    const relatedPIDs = configPath ? await findProcessPIDs(minerType, configPath) : [];
    const allPIDs = [mainPID, ...relatedPIDs].filter((pid, index, self) => self.indexOf(pid) === index);
    
    console.log(`[stop-miner] Found PIDs to kill: ${allPIDs.join(', ')}`);
    
    // Step 1: Try graceful shutdown with SIGTERM
    console.log(`[stop-miner] Sending SIGTERM...`);
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
        console.log(`[stop-miner] All processes stopped gracefully`);
        delete miners[minerId];
        return { success: true, message: 'Miner stopped successfully' };
      }
    }
    
    // Step 2: Force kill with SIGKILL
    console.log(`[stop-miner] Graceful shutdown failed, sending SIGKILL...`);
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
        console.log(`[stop-miner] All processes force killed successfully`);
        delete miners[minerId];
        return { success: true, message: 'Miner stopped (force killed)' };
      }
    }
    
    // Step 3: Last resort - platform-specific process kill by name
    console.log(`[stop-miner] Direct kill failed, trying system kill...`);
    try {
      if (process.platform === 'win32') {
        // Windows: Use taskkill by image name
        const exeName = minerType === 'xmrig' ? 'xmrig.exe' : 'nanominer.exe';
        await execAsync(`taskkill /F /IM ${exeName} 2>nul`);
      } else {
        // Linux/macOS: Use pkill
        if (configPath) {
          await execAsync(`pkill -9 -f "${configPath}"`);
        }
        await execAsync(`pkill -9 ${minerType}`);
      }
    } catch (e) {
      // kill commands will error if no processes found, that's okay
    }
    
    // Final check
    await new Promise(resolve => setTimeout(resolve, 500));
    const finalCheck = allPIDs.filter(pid => isProcessRunning(pid));
    
    if (finalCheck.length === 0) {
      console.log(`[stop-miner] Successfully killed with pkill`);
      delete miners[minerId];
      return { success: true, message: 'Miner stopped (pkill)' };
    }
    
    // If STILL running, give up but clean up tracking
    console.error(`[stop-miner] Failed to kill all processes. Still running: ${finalCheck.join(', ')}`);
    delete miners[minerId];
    return { 
      success: false, 
      error: `Some processes still running (PIDs: ${finalCheck.join(', ')}). Try: sudo kill -9 ${finalCheck.join(' ')}` 
    };
    
  } catch (error) {
    console.error('[stop-miner] Error:', error);
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

// System info handlers - fetch once, cache forever (specs don't change)
let systemInfoFetched = false;

ipcMain.handle('get-system-info', async () => {
  // Return cached if available
  if (systemInfoCache) return systemInfoCache;
  
  try {
    // Get basic info from Node.js (instant)
    const cpus = os.cpus();
    const cpuInfo = cpus[0] || {};
    
    const basicInfo = {
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
      gpus: null
    };

    systemInfoCache = basicInfo;

    // Fetch detailed info in background only once
    if (!systemInfoFetched) {
      systemInfoFetched = true;
      setTimeout(async () => {
        try {
          console.log('[System Info] Fetching detailed GPU info...');
          const [osInfo, graphics] = await Promise.all([
            si.osInfo(),
            si.graphics()
          ]);
          
          console.log('[System Info] GPU controllers:', graphics.controllers.length);
          
          // Map all GPUs (filter out integrated graphics)
          const gpus = graphics.controllers
            .filter(gpu => {
              // Filter out integrated graphics
              const model = (gpu.model || '').toLowerCase();
              const vendor = (gpu.vendor || '').toLowerCase();
              
              // Skip Intel integrated graphics
              if (vendor.includes('intel') && (model.includes('uhd') || model.includes('iris'))) {
                return false;
              }
              
              // Skip AMD APU graphics (Vega, Radeon Graphics without model number)
              if ((vendor.includes('amd') || vendor.includes('ati')) && 
                  (model.includes('vega') || model.includes('radeon graphics') || 
                   model.includes('raphael') || model.includes('renoir'))) {
                return false;
              }
              
              return true;
            })
            .map((gpu, idx) => {
              console.log(`[System Info] GPU ${idx}:`, gpu.model, `(${gpu.vram} MB)`);
              return {
                id: idx,
                vendor: gpu.vendor,
                model: gpu.model,
                vram: gpu.vram,
                bus: gpu.bus
              };
            });
          
          systemInfoCache = {
            ...basicInfo,
            os: {
              platform: osInfo.platform,
              distro: osInfo.distro,
              release: osInfo.release,
              arch: osInfo.arch
            },
            gpus: gpus.length > 0 ? gpus : null
          };
          
          console.log('[System Info] Cache updated with GPUs:', systemInfoCache.gpus);
        } catch (e) {
          console.error('Failed to fetch detailed system info:', e);
        }
      }, 2000);
    }

    return basicInfo;
  } catch (error) {
    console.error('Failed to get system info:', error);
    return null;
  }
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
          '/sys/class/hwmon/hwmon1/temp1_input'
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
        // Windows: Use systeminformation library
        try {
          const cpuTemp = await si.cpuTemperature();
          if (cpuTemp && cpuTemp.main !== null && cpuTemp.main !== -1) {
            cachedCpuTemp = cpuTemp.main;
          }
        } catch (e) {
          // Try WMI as fallback (requires admin or specific hardware support)
          try {
            const { stdout } = await execAsync('wmic /namespace:\\\\root\\wmi PATH MSAcpi_ThermalZoneTemperature get CurrentTemperature 2>nul');
            const lines = stdout.split('\n').filter(l => l.trim() && !isNaN(l.trim()));
            if (lines.length > 0) {
              // WMI returns temp in tenths of Kelvin
              const tempKelvin = parseInt(lines[0].trim()) / 10;
              cachedCpuTemp = tempKelvin - 273.15;
            }
          } catch (e2) {
            // Temperature monitoring not available on this Windows system
          }
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
      console.error('Failed to read CPU temp:', e);
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
      console.log('[GPU Detection] Starting...');
      const detectedGpus = [];
      
      if (process.platform === 'linux') {
        // Linux: Read AMD GPUs from sysfs
        for (let cardNum = 0; cardNum < 8; cardNum++) {
          const amdPath = `/sys/class/drm/card${cardNum}/device`;
          if (fs.existsSync(amdPath)) {
            console.log(`[GPU Detection] Found AMD GPU at card${cardNum}`);
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
              console.log(`[GPU Detection] AMD GPU ${cardNum} cached:`, gpuInfo);
            } else if (hasValidStats) {
              console.log(`[GPU Detection] AMD GPU ${cardNum} skipped (integrated graphics):`, gpuInfo);
            }
          }
        }
      } else if (process.platform === 'win32') {
        // Windows: Use systeminformation for AMD GPUs
        try {
          const graphics = await si.graphics();
          if (graphics && graphics.controllers) {
            graphics.controllers.forEach((gpu, idx) => {
              // Skip integrated graphics
              const model = (gpu.model || '').toLowerCase();
              const vendor = (gpu.vendor || '').toLowerCase();
              
              if (vendor.includes('intel') && (model.includes('uhd') || model.includes('iris'))) {
                return;
              }
              if ((vendor.includes('amd') || vendor.includes('ati')) && 
                  (model.includes('vega') || model.includes('radeon graphics') || 
                   model.includes('raphael') || model.includes('renoir'))) {
                return;
              }
              
              // AMD discrete GPU - systeminformation provides limited stats on Windows
              if ((vendor.includes('amd') || vendor.includes('ati')) && !vendor.includes('nvidia')) {
                const gpuInfo = {
                  id: idx,
                  temperature: gpu.temperatureGpu || null,
                  usage: gpu.utilizationGpu || null,
                  vramUsed: gpu.memoryUsed || null,
                  vramTotal: gpu.vram || null,
                  type: 'AMD'
                };
                
                if (gpuInfo.vramTotal > 1024) { // Only discrete GPUs with >1GB VRAM
                  detectedGpus.push(gpuInfo);
                  console.log(`[GPU Detection] AMD GPU ${idx} (Windows):`, gpuInfo);
                }
              }
            });
          }
        } catch (e) {
          console.error('[GPU Detection] Windows AMD detection failed:', e);
        }
      }
      
      // Try NVIDIA GPUs using nvidia-smi (works on Linux, Windows, and macOS with NVIDIA drivers)
      const nvidiaSmiCmd = process.platform === 'win32' 
        ? 'nvidia-smi --query-gpu=index,temperature.gpu,utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits 2>nul'
        : 'nvidia-smi --query-gpu=index,temperature.gpu,utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits 2>/dev/null';
      
      exec(nvidiaSmiCmd, (error, stdout) => {
        if (!error && stdout && stdout.trim()) {
          console.log('[GPU Detection] nvidia-smi output:', stdout);
          const lines = stdout.trim().split('\n');
          lines.forEach(line => {
            const parts = line.split(',').map(p => p.trim());
            console.log('[GPU Detection] Parsed parts:', parts);
            if (parts.length >= 5 && !isNaN(parts[0])) {
              const gpuInfo = {
                id: parseInt(parts[0]),
                temperature: parseFloat(parts[1]),
                usage: parseFloat(parts[2]),
                vramUsed: parseFloat(parts[3]), // Already in MB from nvidia-smi
                vramTotal: parseFloat(parts[4]), // Already in MB from nvidia-smi
                type: 'NVIDIA'
              };
              detectedGpus.push(gpuInfo);
              console.log(`[GPU Detection] NVIDIA GPU ${gpuInfo.id} cached - VRAM: ${gpuInfo.vramUsed}MB / ${gpuInfo.vramTotal}MB`);
            }
          });
        }
        
        if (detectedGpus.length > 0) {
          cachedGpuStats = detectedGpus;
          console.log(`[GPU Detection] Total ${detectedGpus.length} GPU(s) cached`);
        } else {
          console.log('[GPU Detection] No discrete GPUs found');
        }
        
        gpuUpdateInProgress = false;
      });
      
    } catch (e) {
      console.error('[GPU Detection] Error:', e);
      gpuUpdateInProgress = false;
    }
  }, 0);
}

// Start background updates every 10 seconds
setInterval(() => {
  updateCpuTempAsync();
  updateGpuInfoAsync();
}, 10000);

// Initial update after 2 seconds
setTimeout(() => {
  updateCpuTempAsync();
  updateGpuInfoAsync();
}, 2000);

// Split into separate handlers to identify which is slow
ipcMain.handle('get-cpu-stats', () => {
  const t0 = performance.now();
  
  const numCpus = os.cpus().length;
  const loadAvg = os.loadavg();
  const cpuUsage = loadAvg[0] / numCpus * 100;
  
  const result = {
    usage: Math.min(cpuUsage, 100),
    temperature: cachedCpuTemp
  };
  
  const elapsed = (performance.now() - t0).toFixed(3);
  console.log(`[CPU] ${elapsed}ms (temp: ${cachedCpuTemp ? cachedCpuTemp.toFixed(1) : 'N/A'})`);
  return result;
});

ipcMain.handle('get-memory-stats', () => {
  const t0 = performance.now();
  
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  
  const result = {
    total: totalMem,
    used: totalMem - freeMem,
    usagePercent: ((totalMem - freeMem) / totalMem) * 100
  };
  
  const elapsed = (performance.now() - t0).toFixed(3);
  console.log(`[MEMORY] ${elapsed}ms`);
  return result;
});

ipcMain.handle('get-gpu-stats', () => {
  const t0 = performance.now();
  
  const elapsed = (performance.now() - t0).toFixed(3);
  console.log(`[GPU] ${elapsed}ms (${cachedGpuStats.length} GPU(s))`);
  return cachedGpuStats.length > 0 ? cachedGpuStats : null;
});

// Helper functions

function getXmrigPath(customPath) {
  if (customPath) {
    return customPath;
  }

  // Determine binary name based on platform
  const binaryName = process.platform === 'win32' ? 'xmrig.exe' : 'xmrig';

  // Default to bundled xmrig in miners folder
  const bundledXmrigPath = isDev
    ? path.join(__dirname, '../miners/xmrig', binaryName)
    : path.join(process.resourcesPath, 'miners/xmrig', binaryName);

  // Check if bundled version exists, otherwise fall back to system PATH
  if (fs.existsSync(bundledXmrigPath)) {
    return bundledXmrigPath;
  }

  // Fallback to system PATH
  return binaryName;
}

function getNanominerPath(customPath) {
  if (customPath) {
    return customPath;
  }

  // Determine binary name based on platform
  const binaryName = process.platform === 'win32' ? 'nanominer.exe' : 'nanominer';

  // Default to bundled nanominer in miners folder
  const bundledNanominerPath = isDev
    ? path.join(__dirname, '../miners/nanominer', binaryName)
    : path.join(process.resourcesPath, 'miners/nanominer', binaryName);

  // Check if bundled version exists
  if (fs.existsSync(bundledNanominerPath)) {
    return bundledNanominerPath;
  }

  // Fallback to miners folder (dev mode)
  return path.join(__dirname, '../miners/nanominer', binaryName);
}

function createNanominerConfig(minerId, config) {
  // Create a config.ini file for nanominer
  const configDir = isDev
    ? path.join(__dirname, '../miners/nanominer')
    : path.join(process.resourcesPath, 'miners/nanominer');
  
  const configPath = path.join(configDir, `${minerId}-config.ini`);
  
  // Build config content (flat format, no section headers for single coin)
  let configContent = '';
  
  // Add wallet and pool info
  if (config.user) {
    configContent += `wallet = ${config.user}\n`;
  }
  
  // Nanominer uses "coin" parameter instead of algorithm section
  if (config.coin) {
    configContent += `coin = ${config.coin}\n`;
  } else if (config.algorithm) {
    // Fallback: try to map algorithm to coin
    const algoToCoin = {
      'kawpow': 'RVN',
      'etchash': 'ETC',
      'ethash': 'ETC',
      'autolykos2': 'ERG',
      'octopus': 'CFX',
      'randomx': 'XMR'
    };
    const coin = algoToCoin[config.algorithm.toLowerCase()] || config.algorithm.toUpperCase();
    configContent += `coin = ${coin}\n`;
  }
  
  if (config.pool) {
    configContent += `pool1 = ${config.pool}\n`;
  }
  
  if (config.rigName) {
    configContent += `rigName = ${config.rigName}\n`;
  }
  
  if (config.email) {
    configContent += `email = ${config.email}\n`;
  }
  
  // GPU selection
  if (config.gpus && config.gpus.length > 0) {
    configContent += `devices = ${config.gpus.join(',')}\n`;
  }
  
  configContent += `\n`;
  
  // Add global settings
  configContent += `webPort = 0\n`; // Disable web interface to avoid port conflicts
  configContent += `watchdog = false\n`; // Disable watchdog to prevent parent-child process spawning
  
  // Write config file
  fs.writeFileSync(configPath, configContent, 'utf8');
  console.log(`[nanominer] Config created: ${configPath}`);
  console.log(`[nanominer] Config content:\n${configContent}`);
  
  return configPath;
}

function buildXmrigArgs(config) {
  const args = [];

  if (config.pool) {
    args.push('-o', config.pool);
  }

  if (config.user) {
    args.push('-u', config.user);
  }

  if (config.password) {
    args.push('-p', config.password);
  }

  if (config.algorithm) {
    args.push('-a', config.algorithm);
  }

  // Calculate threads based on percentage
  // threadPercentage: 100 = all threads (0), 50 = half threads, etc.
  if (config.threadPercentage !== undefined && config.threadPercentage !== 100) {
    const totalCpus = os.cpus().length;
    const threadsToUse = Math.max(1, Math.round(totalCpus * (config.threadPercentage / 100)));
    args.push('-t', threadsToUse.toString());
    console.log(`[XMRig] Using ${threadsToUse}/${totalCpus} threads (${config.threadPercentage}%)`);
  } else {
    // 100% or undefined = use all threads (don't specify -t, let XMRig decide)
    console.log('[XMRig] Using all available threads (auto)');
  }

  if (config.donateLevel !== undefined) {
    args.push('--donate-level', config.donateLevel.toString());
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
    console.error('Error getting MAC address:', error);
    return 'unknown-mac';
  }
});

/**
 * Load master server configuration
 */
ipcMain.handle('load-master-config', async () => {
  const configPath = path.join(__dirname, '..', 'master-server.json');
  
  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf8');
      return JSON.parse(data);
    } else {
      // Return default config
      const defaultConfig = {
        enabled: false,
        host: 'localhost',
        port: 3001,
        autoReconnect: true,
        reconnectInterval: 5000,
        heartbeatInterval: 30000
      };
      return defaultConfig;
    }
  } catch (error) {
    console.error('Error loading master server config:', error);
    throw error;
  }
});

/**
 * Save master server configuration
 */
ipcMain.handle('save-master-config', async (event, config) => {
  const configPath = path.join(__dirname, '..', 'master-server.json');
  
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log('Master server config saved:', config);
    return { success: true };
  } catch (error) {
    console.error('Error saving master server config:', error);
    throw error;
  }
});
