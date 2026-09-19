const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const path = require("path");
const isDev = require("electron-is-dev");
const { exec } = require("child_process");
const si = require("systeminformation");
const os = require("os");
const fs = require("fs");
const {
  initAutoUpdater,
  checkForUpdates,
  getUpdateState,
  installUpdate,
  cancelInstall,
  cleanup: cleanupAutoUpdater,
} = require("./autoUpdater");

app.disableHardwareAcceleration();

let mainWindow;
let processManager;
let diagnosticLog;
let appImageBackup;
const log = (event, details) => diagnosticLog?.record(event, details);
process.on("uncaughtExceptionMonitor", (error) =>
  log("uncaught-exception", { message: error.message, stack: error.stack }),
);
const { createRuntime } = require("./mining/runtime");
const { createProcessManager } = require("./mining/processManager");
const { targetName } = require("./mining/install");
const MAX_RENDERER_IPC_BYTES = 512 * 1024;

function sendToRenderer(channel, payload) {
  if (["miner-error", "miner-closed"].includes(channel)) log(channel, payload);
  if (!mainWindow || !mainWindow.webContents) return;

  try {
    // Prevent oversized IPC frames by chunking very large miner output strings.
    if (
      channel === "miner-output" &&
      payload &&
      typeof payload.data === "string"
    ) {
      const totalBytes = Buffer.byteLength(payload.data, "utf8");
      if (totalBytes > MAX_RENDERER_IPC_BYTES) {
        const chunkSizeChars = Math.floor(MAX_RENDERER_IPC_BYTES / 2);
        for (let i = 0; i < payload.data.length; i += chunkSizeChars) {
          mainWindow.webContents.send(channel, {
            ...payload,
            data: payload.data.slice(i, i + chunkSizeChars),
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
const SYSTEM_INFO_CACHE_FILENAME = "system-info-cache.json";
const { createResumeStore } = require("./updateResume");
let resumeStore;
const getResumeStore = () =>
  (resumeStore ||= createResumeStore({
    userData: app.getPath("userData"),
    version: app.getVersion(),
  }));

const {
  integrated: isLikelyIntegratedGpu,
  identity: gpuIdentity,
  pci,
} = require("./hardware");

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
      hostname: os.hostname(),
    },
    cpu: {
      manufacturer: "",
      brand: cpuInfo.model || "Unknown CPU",
      cores: cpus.length,
      physicalCores: null,
      speed: cpuInfo.speed || 0,
    },
    memory: {
      total: os.totalmem(),
      available: os.freemem(),
      used: os.totalmem() - os.freemem(),
    },
    gpus: null,
    gpuDetectionStatus: "pending",
    lastUpdatedAt: Date.now(),
  };
}

function readSystemInfoCacheFromDisk() {
  if (!systemInfoCachePath || !fs.existsSync(systemInfoCachePath)) {
    return null;
  }

  try {
    const fileData = fs.readFileSync(systemInfoCachePath, "utf8");
    const parsed = JSON.parse(fileData);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    return {
      ...buildBasicSystemInfo(),
      ...parsed,
      gpuDetectionStatus: parsed.gpuDetectionStatus || "complete",
    };
  } catch (error) {
    return null;
  }
}

function writeSystemInfoCacheToDisk(cacheData) {
  if (!systemInfoCachePath || !cacheData) return;

  try {
    fs.writeFileSync(
      systemInfoCachePath,
      JSON.stringify(cacheData, null, 2),
      "utf8",
    );
  } catch (error) {
    // Silent fail - in-memory cache still works
  }
}

function boundedProbe(promise, timeoutMs = 15000) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(Error("Sensor probe timed out")),
        timeoutMs,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}
async function refreshSystemInfoCache() {
  if (systemInfoRefreshPromise) {
    return systemInfoRefreshPromise;
  }

  systemInfoRefreshPromise = (async () => {
    try {
      const baseInfo = systemInfoCache || buildBasicSystemInfo();
      const results = await Promise.allSettled([
        boundedProbe(si.osInfo()),
        boundedProbe(si.graphics()),
        boundedProbe(si.cpu()),
      ]);
      results.forEach((result, index) => {
        if (result.status === "rejected")
          log("system-probe-failed", {
            provider: ["os", "graphics", "cpu"][index],
            message: result.reason?.message,
          });
      });
      const refreshedInfo = require("./systemSnapshot").mergeSystemSnapshot(
        baseInfo,
        results,
      );

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
  systemInfoCachePath = path.join(
    app.getPath("userData"),
    SYSTEM_INFO_CACHE_FILENAME,
  );
  systemInfoCache = readSystemInfoCacheFromDisk() || buildBasicSystemInfo();

  // Refresh once on startup in the background.
  setTimeout(() => {
    refreshSystemInfoCache();
  }, 1500);
}

function createWindow() {
  // Get icon path based on platform
  const iconPath = isDev
    ? path.join(__dirname, "../assets/icon.png")
    : path.join(__dirname, "../assets/icon.png");

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: iconPath,
    webPreferences: {
      nodeIntegration: false,
      backgroundThrottling: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
    autoHideMenuBar: true,
    title: "MineMaster",
  });

  const startURL = isDev
    ? "http://localhost:3000"
    : `file://${path.join(__dirname, "../build/index.html")}`;

  if (isDev) mainWindow.loadURL(startURL);
  else mainWindow.loadFile(path.join(__dirname, "../build/index.html"));
  let rendererRestarts = [];
  mainWindow.webContents.on("did-fail-load", (_event, code, description) =>
    log("renderer-load-failed", { code, description }),
  );
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    log("renderer-gone", details);
    if (details.reason !== "crashed" || quitPending) return;
    rendererRestarts = rendererRestarts.filter(
      (at) => at > Date.now() - 300000,
    );
    if (rendererRestarts.length >= 2) return;
    rendererRestarts.push(Date.now());
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed() && !quitPending)
        mainWindow.reload();
    }, 1000);
  });

  if (isDev && process.env.MINEMASTER_OPEN_DEVTOOLS === "1") {
    mainWindow.webContents.openDevTools();
  }

  // Initialize auto-updater (only runs checks in packaged builds)
  initAutoUpdater(
    mainWindow,
    stopAllMinersForUpdate,
    () => {
      processManager.allowStarts();
      appImageBackup
        ?.restore()
        .catch((error) =>
          log("appimage-restore-failed", { message: error.message }),
        );
      // A failed installer must not cause mining to resume on a later ordinary launch.
      try {
        getResumeStore().clear();
      } catch (_) {}
    },
    (status) => log("application-update", status),
  );

  mainWindow.on("close", (event) => {
    if (!quitConfirmed) {
      event.preventDefault();
      requestQuit();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

let quitConfirmed = false,
  quitPending = false;
async function requestQuit() {
  if (quitPending) return;
  quitPending = true;
  try {
    await processManager.stopAll();
    quitConfirmed = true;
    cleanupAutoUpdater();
    app.quit();
  } catch (error) {
    await dialog.showMessageBox(mainWindow, {
      type: "error",
      title: "Mining is still running",
      message: error.message,
      detail: "MineMaster will stay open so you can retry Stop.",
    });
  } finally {
    quitPending = false;
  }
}
// Multiple windows must never launch duplicate mining processes for the same rig.
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
  app.whenReady().then(async () => {
    diagnosticLog = require("./diagnosticLog").createDiagnosticLog(
      path.join(app.getPath("userData"), "logs"),
    );
    log("application-start", {
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
    });
    appImageBackup = require("./appImageBackup").createAppImageBackup({
      userData: app.getPath("userData"),
      appImage: process.platform === "linux" ? process.env.APPIMAGE : null,
      version: app.getVersion(),
    });
    await appImageBackup
      .complete()
      .catch((error) =>
        log("appimage-backup-cleanup-failed", { message: error.message }),
      );
    initializeSystemInfoCache();
    const runtime = createRuntime({
      userData: app.getPath("userData"),
      hostname: os.hostname(),
      bundledRoot: isDev
        ? path.join(
            __dirname,
            "..",
            "miners",
            targetName(process.platform, process.arch),
          )
        : path.join(process.resourcesPath, "miners"),
    });
    processManager = createProcessManager({ runtime, emit: sendToRenderer });
    createWindow();
    // First installation copies verified bundled files only; it never launches a miner or downloads in a loop.
    for (const [id, type] of [
      ["xmrig-1", "xmrig"],
      ["nanominer-1", "nanominer"],
    ]) {
      try {
        await processManager.prepareEngine(type);
      } catch (_) {}
      await processManager.diagnose(id, type);
    }
  });
}
app.on("before-quit", (event) => {
  if (!quitConfirmed && processManager) {
    event.preventDefault();
    requestQuit();
  }
});
app.on("window-all-closed", () => app.quit());
app.on("activate", () => {
  if (!mainWindow && processManager) createWindow();
});

async function stopAllMinersForUpdate(targetVersion) {
  await appImageBackup?.prepare(targetVersion);
  const ids = await processManager.stopAll();
  try {
    getResumeStore().save(ids, targetVersion);
  } catch (error) {
    processManager.allowStarts();
    throw error;
  }
}
ipcMain.handle("open-diagnostic-folder", async () => {
  await diagnosticLog?.flush();
  const error = await shell.openPath(
    path.join(app.getPath("userData"), "logs"),
  );
  if (error) throw Error(error);
  return { success: true };
});
ipcMain.handle("check-for-update", () => checkForUpdates());
ipcMain.handle("get-update-status", () => getUpdateState());
ipcMain.handle("install-update", (_event, targetVersion) =>
  installUpdate(targetVersion),
);
ipcMain.handle("cancel-update-install", () => cancelInstall());
ipcMain.handle("get-update-resume-state", () => getResumeStore().take());
ipcMain.handle("start-miner", (_event, request) =>
  processManager.start(request),
);
ipcMain.handle("stop-miner", (_event, request) => processManager.stop(request));
ipcMain.handle("get-miner-status", (_event, { minerId }) =>
  processManager.snapshot(minerId),
);
ipcMain.handle("get-all-miners-status", () => processManager.snapshots());
ipcMain.handle(
  "diagnose-miner",
  (_event, { minerId, minerType, customPath, includeWindows }) =>
    processManager.diagnose(minerId, minerType, customPath, {
      includeWindows: includeWindows === true,
    }),
);
ipcMain.handle("repair-miner", (_event, { minerId, minerType, customPath }) =>
  processManager.repair(minerId, minerType, customPath),
);
ipcMain.handle("open-protection-history", () =>
  shell.openExternal(
    "https://support.microsoft.com/en-us/windows/security/windows-security/protection-history-in-the-windows-security-app",
  ),
);
ipcMain.handle("open-file-review", () =>
  shell.openExternal("https://www.microsoft.com/en-us/wdsi/filesubmission"),
);

ipcMain.handle("get-system-info", async () => {
  if (!systemInfoCache) {
    systemInfoCache = buildBasicSystemInfo();
  }

  // Ensure one startup refresh is in progress if detection is still pending.
  if (
    systemInfoCache.gpuDetectionStatus !== "complete" ||
    Date.now() - (systemInfoCache.lastUpdatedAt || 0) > 60000
  ) {
    refreshSystemInfoCache();
  }

  return systemInfoCache;
});

// Cache for slow-changing stats (updated in background)
let cachedCpuTemp = null;
let cpuTempObservedAt = null,
  gpuObservedAt = null,
  cpuUsageObservedAt = null;
let cachedGpuStats = []; // Array to support multiple GPUs
let tempUpdateInProgress = false;
let gpuUpdateInProgress = false;

// Background update for CPU temp (non-blocking) - Cross-platform
function updateCpuTempAsync() {
  if (tempUpdateInProgress) return;
  tempUpdateInProgress = true;
  (async () => {
    let temperature = null;
    try {
      if (process.platform === "linux") {
        const values = [];
        for (const name of fs.readdirSync("/sys/class/hwmon")) {
          const dir = `/sys/class/hwmon/${name}`;
          let driver = "";
          try {
            driver = fs.readFileSync(`${dir}/name`, "utf8").trim();
          } catch (_) {}
          if (!["coretemp", "k10temp", "zenpower"].includes(driver)) continue;
          for (const file of fs
            .readdirSync(dir)
            .filter((f) => /^temp\d+_input$/.test(f))) {
            const value =
              Number(fs.readFileSync(`${dir}/${file}`, "utf8")) / 1000;
            if (Number.isFinite(value) && value > 0 && value < 150)
              values.push(value);
          }
        }
        if (values.length) temperature = Math.max(...values);
      } else {
        const value = (await boundedProbe(si.cpuTemperature())).main;
        if (Number.isFinite(value) && value > 0 && value < 150)
          temperature = value;
      }
    } catch (_) {}
    cachedCpuTemp = temperature;
    cpuTempObservedAt = Date.now();
    tempUpdateInProgress = false;
  })();
}

// Background update for GPU info (non-blocking) - Cross-platform
function updateGpuInfoAsync() {
  if (gpuUpdateInProgress) return;
  gpuUpdateInProgress = true;

  setTimeout(async () => {
    try {
      const detectedGpus = [];

      if (process.platform === "linux") {
        // Linux: Read AMD GPUs from sysfs
        for (const card of fs
          .readdirSync("/sys/class/drm")
          .filter((name) => /^card\d+$/.test(name))) {
          const cardNum = Number(card.slice(4));
          const amdPath = `/sys/class/drm/card${cardNum}/device`;
          if (
            fs.existsSync(amdPath) &&
            fs.readFileSync(`${amdPath}/vendor`, "utf8").trim() === "0x1002"
          ) {
            const gpuInfo = {
              deviceId: `pci:${pci(path.basename(fs.realpathSync(amdPath)))}`,
              observedAt: new Date().toISOString(),
              id: cardNum,
              usage: null,
              temperature: null,
              vramUsed: null,
              vramTotal: null,
              type: "AMD",
            };

            // Try to read temp
            try {
              const hwmonPath = `${amdPath}/hwmon`;
              if (fs.existsSync(hwmonPath)) {
                const hwmons = fs.readdirSync(hwmonPath);
                if (hwmons.length > 0) {
                  const powerFile = `${hwmonPath}/${hwmons[0]}/power1_average`;
                  if (fs.existsSync(powerFile))
                    gpuInfo.powerWatts =
                      Number(fs.readFileSync(powerFile, "utf8")) / 1000000;
                  const tempFile = `${hwmonPath}/${hwmons[0]}/temp1_input`;
                  if (fs.existsSync(tempFile)) {
                    gpuInfo.temperature =
                      parseInt(fs.readFileSync(tempFile, "utf8")) / 1000;
                  }
                }
              }
            } catch (e) {}

            // Try to read usage
            try {
              const usageFile = `${amdPath}/gpu_busy_percent`;
              if (fs.existsSync(usageFile)) {
                gpuInfo.usage = parseInt(fs.readFileSync(usageFile, "utf8"));
              }
            } catch (e) {}

            // Try to read VRAM info
            try {
              const vramUsedFile = `${amdPath}/mem_info_vram_used`;
              const vramTotalFile = `${amdPath}/mem_info_vram_total`;
              if (fs.existsSync(vramUsedFile) && fs.existsSync(vramTotalFile)) {
                gpuInfo.vramUsed =
                  parseInt(fs.readFileSync(vramUsedFile, "utf8")) /
                  (1024 * 1024); // bytes to MB
                gpuInfo.vramTotal =
                  parseInt(fs.readFileSync(vramTotalFile, "utf8")) /
                  (1024 * 1024); // bytes to MB
              }
            } catch (e) {}

            // Only add if it has valid stats AND isn't integrated graphics (> 1GB VRAM or no VRAM info)
            const hasValidStats =
              gpuInfo.temperature !== null || gpuInfo.usage !== null;
            const isNotIntegrated =
              gpuInfo.vramTotal === null || gpuInfo.vramTotal > 1024; // > 1GB

            if (hasValidStats && isNotIntegrated) {
              detectedGpus.push(gpuInfo);
            }
          }
        }
      } else if (process.platform === "win32") {
        // Windows: Use systeminformation for GPU detection
        try {
          const graphics = await boundedProbe(si.graphics());
          if (graphics && graphics.controllers) {
            let gpuIndex = 0;
            graphics.controllers.forEach((gpu) => {
              if (isLikelyIntegratedGpu(gpu)) {
                return;
              }

              // Discrete GPU detected
              const vendor = (gpu.vendor || "").toLowerCase();
              const gpuInfo = {
                deviceId: gpuIdentity(gpu, gpuIndex),
                observedAt: new Date().toISOString(),
                id: gpuIndex++,
                temperature: gpu.temperatureGpu ?? null,
                usage: gpu.utilizationGpu ?? null,
                vramUsed: gpu.memoryUsed ?? null,
                vramTotal: gpu.vram ?? null,
                type: vendor.includes("nvidia") ? "NVIDIA" : "AMD",
                model: gpu.model || "Unknown GPU",
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

      const hasNvidiaFromSi = detectedGpus.some((g) => g.type === "NVIDIA");

      let nvidiaSmiExe = "nvidia-smi";
      if (process.platform === "win32") {
        // nvidia-smi may not be on PATH on Windows; check known install locations
        const candidates = [
          path.join(
            process.env.SystemRoot || "C:\\Windows",
            "System32",
            "nvidia-smi.exe",
          ),
          path.join(
            process.env.ProgramFiles || "C:\\Program Files",
            "NVIDIA Corporation",
            "NVSMI",
            "nvidia-smi.exe",
          ),
        ];
        for (const candidate of candidates) {
          if (fs.existsSync(candidate)) {
            nvidiaSmiExe = `"${candidate}"`;
            break;
          }
        }
      }

      const nullDev = process.platform === "win32" ? "NUL" : "/dev/null";
      const nvidiaSmiCmd = `${nvidiaSmiExe} --query-gpu=index,temperature.gpu,utilization.gpu,memory.used,memory.total,pci.bus_id,uuid,power.draw --format=csv,noheader,nounits 2>${nullDev}`;

      exec(nvidiaSmiCmd, { timeout: 5000 }, (error, stdout) => {
        if (!error && stdout && stdout.trim()) {
          // If si.graphics already found NVIDIA GPUs, replace them with nvidia-smi data (more accurate stats)
          if (hasNvidiaFromSi) {
            const nonNvidia = detectedGpus.filter((g) => g.type !== "NVIDIA");
            detectedGpus.length = 0;
            nonNvidia.forEach((g) => detectedGpus.push(g));
          }

          const lines = stdout.trim().split("\n");
          lines.forEach((line) => {
            const parts = line.split(",").map((p) => p.trim());
            if (parts.length >= 5 && !isNaN(parts[0])) {
              detectedGpus.push({
                id: parseInt(parts[0]),
                deviceId: `pci:${pci(parts[5])}`,
                uuid: parts[6],
                observedAt: new Date().toISOString(),
                powerWatts: Number.isFinite(parseFloat(parts[7]))
                  ? parseFloat(parts[7])
                  : null,
                temperature: parseFloat(parts[1]),
                usage: parseFloat(parts[2]),
                vramUsed: parseFloat(parts[3]),
                vramTotal: parseFloat(parts[4]),
                type: "NVIDIA",
              });
            }
          });
        }

        cachedGpuStats = detectedGpus;
        gpuObservedAt = Date.now();

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
let cachedCpuUsage = null;

function sampleCpuUsage() {
  const cpus = os.cpus();
  const totals = { idle: 0, total: 0 };
  cpus.forEach((cpu) => {
    const t = cpu.times;
    totals.idle += t.idle;
    totals.total += t.user + t.nice + t.sys + t.irq + t.idle;
  });

  if (prevCpuTimes) {
    const idleDelta = totals.idle - prevCpuTimes.idle;
    const totalDelta = totals.total - prevCpuTimes.total;
    cpuUsageObservedAt = Date.now();
    cachedCpuUsage =
      totalDelta > 0
        ? Math.min(((totalDelta - idleDelta) / totalDelta) * 100, 100)
        : 0;
  }
  prevCpuTimes = totals;
}

// Sample every 5 seconds in the background (lightweight — just reads /proc/stat or kernel counters)
let cpuSampleInterval = setInterval(sampleCpuUsage, 5000);
let cpuSampleInitTimeout = setTimeout(sampleCpuUsage, 500);

ipcMain.handle("get-cpu-stats", () => {
  return {
    observedAt: cpuUsageObservedAt,
    temperatureObservedAt: cpuTempObservedAt,
    usage: Date.now() - cpuUsageObservedAt <= 30000 ? cachedCpuUsage : null,
    temperature: Date.now() - cpuTempObservedAt <= 30000 ? cachedCpuTemp : null,
  };
});

ipcMain.handle("get-memory-stats", () => {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();

  return {
    total: totalMem,
    used: totalMem - freeMem,
    usagePercent: ((totalMem - freeMem) / totalMem) * 100,
  };
});

ipcMain.handle("get-gpu-stats", () => {
  return Date.now() - gpuObservedAt <= 30000 ? cachedGpuStats : [];
});

// ============================================
// MASTER SERVER IPC HANDLERS
// ============================================

/**
 * Get MAC address of the primary network interface
 */
ipcMain.handle("get-mac-address", async () => {
  try {
    const networkInterfaces = await si.networkInterfaces();
    // Get the first interface with a valid MAC address
    const primaryInterface = networkInterfaces.find(
      (iface) =>
        iface.mac && iface.mac !== "00:00:00:00:00:00" && !iface.internal,
    );

    if (primaryInterface) {
      return primaryInterface.mac;
    }

    // Fallback: try to get any non-loopback interface
    const anyInterface = networkInterfaces.find(
      (iface) => iface.mac && iface.mac !== "00:00:00:00:00:00",
    );

    return anyInterface ? anyInterface.mac : "unknown-mac";
  } catch (error) {
    return "unknown-mac";
  }
});

/**
 * Get the writable path for master-server.json
 * In production, __dirname is inside the read-only app.asar, so we use userData instead.
 * In dev mode, we use the project directory as before.
 */
function getMasterConfigPath() {
  if (isDev) {
    return path.join(__dirname, "..", "master-server.json");
  }
  return path.join(app.getPath("userData"), "master-server.json");
}

/**
 * Load master server configuration
 */
ipcMain.handle("load-master-config", async () => {
  const configPath = getMasterConfigPath();

  // Also check the bundled default (inside asar) for first-run migration
  const bundledPath = path.join(__dirname, "..", "master-server.json");

  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, "utf8");
      return JSON.parse(data);
    } else if (!isDev && fs.existsSync(bundledPath)) {
      // First run after install: copy bundled config to writable location
      const data = fs.readFileSync(bundledPath, "utf8");
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
        host: "mining.ironcladtech.ca",
        port: 443,
        autoReconnect: true,
        reconnectInterval: 5000,
        heartbeatInterval: 30000,
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
ipcMain.handle("save-master-config", async (event, config) => {
  const configPath = getMasterConfigPath();

  try {
    fs.writeFileSync(`${configPath}.tmp`, JSON.stringify(config, null, 2));
    fs.renameSync(`${configPath}.tmp`, configPath);
    return { success: true };
  } catch (error) {
    throw error;
  }
});
