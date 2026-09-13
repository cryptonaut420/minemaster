function createUpdateController({
  updater,
  supported = () => true,
  stopMiners,
  notify = () => {},
  releaseStarts = () => {},
}) {
  let state = { state: "idle" },
    check = null,
    installing = false;
  const set = (name, extra = {}) => {
    state = { ...state, state: name, ...extra };
    notify(state);
  };
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = false;
  updater.allowDowngrade = false;
  const listeners = {
    "checking-for-update": () => set("checking", { message: null }),
    "update-available": (info) =>
      set("available", { version: info.version, message: null }),
    "update-not-available": () => set("idle", { message: null }),
    "download-progress": (progress) =>
      set("downloading", { percent: Math.round(progress.percent) }),
    "update-downloaded": (info) =>
      set("downloaded", { version: info.version, percent: 100, message: null }),
    error: (error) => {
      const failedInstall = state.state === "installing";
      if (failedInstall) releaseStarts();
      set(
        failedInstall || state.state === "downloaded" ? "downloaded" : "error",
        {
          message: `${failedInstall ? "Install paused: " : ""}${error?.message || "Update failed"}`,
        },
      );
    },
  };
  for (const [event, listener] of Object.entries(listeners))
    updater.on(event, listener);
  async function checkForUpdates() {
    if (!supported()) {
      set("unsupported", {
        message:
          "Automatic app updates require an installed Windows build, macOS app, or Linux AppImage. Miner Repair is available separately.",
      });
      return { success: false, ...state };
    }
    if (check) return check;
    if (
      ["available", "downloading", "downloaded", "installing"].includes(
        state.state,
      )
    )
      return { success: true, ...state };
    check = (async () => {
      try {
        await updater.checkForUpdates();
        return { success: true, ...state };
      } catch (error) {
        set("error", { message: error.message });
        return { success: false, ...state };
      } finally {
        check = null;
      }
    })();
    return check;
  }
  async function install() {
    if (installing || state.state !== "downloaded")
      return {
        success: false,
        error: "No downloaded update is ready to install",
      };
    installing = true;
    set("installing", { message: null });
    try {
      await stopMiners(); // A timeout/failed stop must reject, never proceed with an uncertain stop.
      updater.quitAndInstall(true, true);
      if (state.state !== "installing")
        return { success: false, error: state.message };
      return { success: true };
    } catch (error) {
      releaseStarts();
      set("downloaded", { message: `Install paused: ${error.message}` });
      return { success: false, error: state.message };
    } finally {
      installing = false;
    }
  }
  return {
    checkForUpdates,
    install,
    getState: () => ({ ...state }),
    cleanup: () => {
      for (const [event, listener] of Object.entries(listeners))
        updater.removeListener(event, listener);
    },
  };
}
module.exports = { createUpdateController };
