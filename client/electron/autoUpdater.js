const { autoUpdater } = require('electron-updater');
const { app } = require('electron');

let mainWindow = null;
let stopAllMinersCallback = null;
let updateCheckInterval = null;
let initialCheckTimeout = null;
let retryTimeout = null;
let updateState = 'idle'; // idle | checking | available | downloading | downloaded | error

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const INITIAL_CHECK_DELAY_MS = 15 * 1000; // 15 seconds after launch
const MINER_STOP_TIMEOUT_MS = 15 * 1000; // max wait for miners to stop
const ERROR_RETRY_MS = 5 * 60 * 1000; // retry 5 minutes after a failure

function log(msg) {
  console.log(`[AutoUpdater] ${msg}`);
}

function sendToRenderer(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    mainWindow.webContents.send(channel, payload);
  } catch (_) {}
}

function setUpdateState(state, extra = {}) {
  updateState = state;
  sendToRenderer('update-status', { state, ...extra });
}

function initAutoUpdater(win, stopMinersCallback) {
  mainWindow = win;
  stopAllMinersCallback = stopMinersCallback;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;
  autoUpdater.autoRunAppAfterInstall = true;

  autoUpdater.on('checking-for-update', () => {
    log('Checking for update...');
    setUpdateState('checking');
  });

  autoUpdater.on('update-available', (info) => {
    log(`Update available: v${info.version}`);
    setUpdateState('available', { version: info.version });
  });

  autoUpdater.on('update-not-available', (info) => {
    log(`Up to date (v${info?.version || 'unknown'})`);
    setUpdateState('idle');
  });

  autoUpdater.on('download-progress', (progress) => {
    setUpdateState('downloading', {
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      total: progress.total
    });
  });

  autoUpdater.on('update-downloaded', async (info) => {
    log(`Update downloaded: v${info.version} — preparing to install`);
    setUpdateState('downloaded', { version: info.version });

    if (typeof stopAllMinersCallback === 'function') {
      try {
        log('Stopping all miners before restart...');
        await Promise.race([
          stopAllMinersCallback(),
          new Promise((resolve) => setTimeout(resolve, MINER_STOP_TIMEOUT_MS))
        ]);
        log('Miners stopped');
      } catch (_) {
        log('Miner stop failed or timed out, continuing with update');
      }
    }

    // Brief pause so the renderer can show "Restarting..." before the process exits
    await new Promise((resolve) => setTimeout(resolve, 1500));

    log('Calling quitAndInstall...');
    // silent = true (no installer UI), forceRunAfter = true (relaunch after install)
    autoUpdater.quitAndInstall(true, true);
  });

  autoUpdater.on('error', (err) => {
    const message = err?.message || 'Unknown update error';

    // "No published versions" is expected for a fresh repo with no releases yet
    if (message.includes('No published versions') || message.includes('net::ERR')) {
      log(`Update check skipped: ${message}`);
      setUpdateState('idle');
    } else {
      log(`Update error: ${message}`);
      setUpdateState('error', { message });
    }

    // Schedule a retry sooner than the normal 1-hour cycle
    scheduleRetry();
  });

  // Schedule initial check after a short delay (let app fully initialize)
  initialCheckTimeout = setTimeout(() => {
    initialCheckTimeout = null;
    checkForUpdates();
  }, INITIAL_CHECK_DELAY_MS);

  // Periodic checks
  updateCheckInterval = setInterval(() => {
    checkForUpdates();
  }, CHECK_INTERVAL_MS);
}

function checkForUpdates() {
  // Skip in dev mode — electron-updater requires a packaged app
  if (!app.isPackaged) return;

  // On Linux, electron-updater needs the APPIMAGE env var (set by the AppImage runtime).
  // If it's missing, we're running from an extracted dir or non-AppImage context — skip.
  if (process.platform === 'linux' && !process.env.APPIMAGE) return;

  // Don't trigger a new check while one is already in progress or a download is active
  if (updateState === 'checking' || updateState === 'downloading' || updateState === 'downloaded') {
    return;
  }

  try {
    autoUpdater.checkForUpdates();
  } catch (err) {
    log(`checkForUpdates threw: ${err?.message}`);
  }
}

function scheduleRetry() {
  if (retryTimeout) return; // already scheduled
  retryTimeout = setTimeout(() => {
    retryTimeout = null;
    checkForUpdates();
  }, ERROR_RETRY_MS);
}

function getUpdateState() {
  return updateState;
}

function cleanup() {
  if (updateCheckInterval) {
    clearInterval(updateCheckInterval);
    updateCheckInterval = null;
  }
  if (initialCheckTimeout) {
    clearTimeout(initialCheckTimeout);
    initialCheckTimeout = null;
  }
  if (retryTimeout) {
    clearTimeout(retryTimeout);
    retryTimeout = null;
  }
}

module.exports = {
  initAutoUpdater,
  checkForUpdates,
  getUpdateState,
  cleanup
};
