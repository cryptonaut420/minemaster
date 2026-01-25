const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const isDev = require('electron-is-dev');
const { spawn } = require('child_process');

let mainWindow;
let miners = {}; // Store active miner processes

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

  if (config.threads) {
    args.push('-t', config.threads.toString());
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
