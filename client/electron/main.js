const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const isDev = require('electron-is-dev');
const { spawn } = require('child_process');
const si = require('systeminformation');
const os = require('os');
const fs = require('fs');

let mainWindow;
let miners = {}; // Store active miner processes

// Cache for system info (fetched once on startup)
let systemInfoCache = null;


function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
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
    Object.entries(miners).forEach(([minerId, minerProcess]) => {
      if (minerProcess && !minerProcess.killed) {
        console.log(`Stopping miner: ${minerId} (PID: ${minerProcess.pid})`);
        minerProcess.kill('SIGTERM'); // Graceful shutdown
        
        // Force kill after 3 seconds if still running
        setTimeout(() => {
          if (!minerProcess.killed) {
            console.log(`Force killing miner: ${minerId}`);
            minerProcess.kill('SIGKILL');
          }
        }, 3000);
      }
    });
    mainWindow = null;
  });
}

app.on('ready', createWindow);

app.on('window-all-closed', () => {
  // Kill all miners before quitting
  Object.values(miners).forEach(minerProcess => {
    if (minerProcess && !minerProcess.killed) {
      minerProcess.kill('SIGKILL');
    }
  });
  
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  // Ensure all miners are stopped before app quits
  console.log('App quitting - stopping all miners...');
  Object.values(miners).forEach(minerProcess => {
    if (minerProcess && !minerProcess.killed) {
      try {
        minerProcess.kill('SIGKILL');
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
    // Stop existing miner if running
    if (miners[minerId] && !miners[minerId].killed) {
      miners[minerId].kill();
    }

    let minerProcess;

    if (minerType === 'xmrig') {
      // Determine xmrig executable path based on platform
      const xmrigPath = getXmrigPath(config.customPath);
      
      // Build xmrig arguments from config
      const args = buildXmrigArgs(config);

      minerProcess = spawn(xmrigPath, args);

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
      });
    } else if (minerType === 'nanominer') {
      // Determine nanominer executable path
      const nanominerPath = getNanominerPath(config.customPath);
      
      // Create config file for nanominer
      const configPath = createNanominerConfig(minerId, config);
      
      // Nanominer uses config file, no CLI args needed
      minerProcess = spawn(nanominerPath, [configPath]);

      // Function to strip ANSI color codes
      const stripAnsi = (str) => {
        return str.replace(/\x1B\[[0-9;]*[JKmsu]/g, '');
      };

      // Send stdout to renderer
      minerProcess.stdout.on('data', (data) => {
        mainWindow.webContents.send('miner-output', {
          minerId,
          data: stripAnsi(data.toString())
        });
      });

      // Send stderr to renderer
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

      miners[minerId] = minerProcess;

      return { success: true, pid: minerProcess.pid };
    } else {
      throw new Error(`Unsupported miner type: ${minerType}`);
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('stop-miner', async (event, { minerId }) => {
  try {
    if (miners[minerId] && !miners[minerId].killed) {
      miners[minerId].kill();
      delete miners[minerId];
      return { success: true };
    }
    return { success: false, error: 'Miner not found or already stopped' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-miner-status', async (event, { minerId }) => {
  const isRunning = miners[minerId] && !miners[minerId].killed;
  return { 
    running: isRunning,
    pid: isRunning ? miners[minerId].pid : null
  };
});

ipcMain.handle('get-all-miners-status', async () => {
  const statuses = {};
  Object.keys(miners).forEach(minerId => {
    const isRunning = miners[minerId] && !miners[minerId].killed;
    statuses[minerId] = {
      running: isRunning,
      pid: isRunning ? miners[minerId].pid : null
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
      os: {
        platform: os.platform(),
        distro: os.type(),
        release: os.release(),
        arch: os.arch()
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

// Background update for CPU temp (non-blocking)
function updateCpuTempAsync() {
  if (tempUpdateInProgress || process.platform !== 'linux') return;
  tempUpdateInProgress = true;
  
  setTimeout(() => {
    try {
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
    } catch (e) {
      console.error('Failed to read CPU temp:', e);
    } finally {
      tempUpdateInProgress = false;
    }
  }, 0);
}

// Background update for GPU info (non-blocking)
function updateGpuInfoAsync() {
  if (gpuUpdateInProgress || process.platform !== 'linux') return;
  gpuUpdateInProgress = true;
  
  setTimeout(() => {
    try {
      console.log('[GPU Detection] Starting...');
      const detectedGpus = [];
      
      // Try AMD GPUs (check card0, card1, card2, etc.)
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
      
      // Try NVIDIA GPUs (with VRAM info)
      const { exec } = require('child_process');
      exec('nvidia-smi --query-gpu=index,temperature.gpu,utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits', (error, stdout) => {
        if (!error && stdout) {
          console.log('[GPU Detection] nvidia-smi output:', stdout);
          const lines = stdout.trim().split('\n');
          lines.forEach(line => {
            const parts = line.split(',').map(p => p.trim());
            console.log('[GPU Detection] Parsed parts:', parts);
            if (parts.length >= 5) {
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
          
          if (detectedGpus.length > 0) {
            cachedGpuStats = detectedGpus;
          }
        } else if (detectedGpus.length === 0) {
          console.log('[GPU Detection] No GPUs found');
        } else {
          // We have AMD GPUs already
          cachedGpuStats = detectedGpus;
        }
      });
      
    } catch (e) {
      console.error('[GPU Detection] Error:', e);
    } finally {
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

  // Default to bundled xmrig in miners folder
  const bundledXmrigPath = isDev
    ? path.join(__dirname, '../miners/xmrig/xmrig')
    : path.join(process.resourcesPath, 'miners/xmrig/xmrig');

  // Check if bundled version exists, otherwise fall back to system PATH
  const fs = require('fs');
  if (fs.existsSync(bundledXmrigPath)) {
    return bundledXmrigPath;
  }

  // Fallback paths for xmrig
  if (process.platform === 'win32') {
    return 'xmrig.exe';
  } else {
    return 'xmrig'; // Linux/Mac (from PATH)
  }
}

function getNanominerPath(customPath) {
  if (customPath) {
    return customPath;
  }

  // Default to bundled nanominer in miners folder
  const bundledNanominerPath = isDev
    ? path.join(__dirname, '../miners/nanominer/nanominer')
    : path.join(process.resourcesPath, 'miners/nanominer/nanominer');

  // Check if bundled version exists
  if (fs.existsSync(bundledNanominerPath)) {
    return bundledNanominerPath;
  }

  // Fallback paths for nanominer
  if (process.platform === 'win32') {
    return path.join(__dirname, '../miners/nanominer/nanominer.exe');
  } else {
    return path.join(__dirname, '../miners/nanominer/nanominer');
  }
}

function createNanominerConfig(minerId, config) {
  // Create a config.ini file for nanominer
  const configDir = isDev
    ? path.join(__dirname, '../miners/nanominer')
    : path.join(process.resourcesPath, 'miners/nanominer');
  
  const configPath = path.join(configDir, `${minerId}-config.ini`);
  
  // Build config content
  let configContent = '';
  
  // Add wallet and pool info
  if (config.algorithm && config.user && config.pool) {
    configContent += `[${config.algorithm}]\n`;
    configContent += `wallet = ${config.user}\n`;
    configContent += `pool1 = ${config.pool}\n`;
    
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
    
    // Add power limits for each GPU
    if (config.gpus && config.gpus.length > 0) {
      config.gpus.forEach(gpuIdx => {
        const powerLimit = config[`gpu${gpuIdx}Power`];
        if (powerLimit && powerLimit !== 100) {
          configContent += `gpu${gpuIdx}PowerLimit = ${powerLimit}\n`;
        }
      });
    }
    
    configContent += `\n`;
  }
  
  // Write config file
  fs.writeFileSync(configPath, configContent, 'utf8');
  console.log(`[nanominer] Config created: ${configPath}`);
  
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
