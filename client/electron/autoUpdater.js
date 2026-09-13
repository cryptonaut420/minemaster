const { autoUpdater } = require("electron-updater");
const { app } = require("electron");
const fs = require("fs");
const path = require("path");
const { createUpdateController } = require("./updateController");
let mainWindow, controller, initialTimer, interval;
function initAutoUpdater(win, stopMiners, releaseStarts, record = () => {}) {
  mainWindow = win;
  if (controller) return;
  controller = createUpdateController({
    updater: autoUpdater,
    stopMiners,
    releaseStarts,
    supported: () =>
      app.isPackaged &&
      (process.platform !== "linux" || !!process.env.APPIMAGE) &&
      (process.platform !== "win32" ||
        fs.existsSync(
          path.join(
            path.dirname(app.getPath("exe")),
            "Uninstall MineMaster.exe",
          ),
        )),
    notify: (status) => {
      record(status);
      if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send("update-status", status);
    },
  });
  initialTimer = setTimeout(() => controller?.checkForUpdates(), 15000);
  interval = setInterval(() => controller?.checkForUpdates(), 60 * 60 * 1000);
}
function cleanup() {
  clearTimeout(initialTimer);
  clearInterval(interval);
  controller?.cleanup();
  controller = null;
}
module.exports = {
  initAutoUpdater,
  checkForUpdates: () => controller?.checkForUpdates(),
  getUpdateState: () => controller?.getState() || { state: "idle" },
  installUpdate: () => controller?.install(),
  cancelInstall: () => controller?.cancelInstall(),
  cleanup,
};
