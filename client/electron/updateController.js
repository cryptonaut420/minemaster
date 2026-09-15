function createUpdateController({
  updater,
  supported = () => true,
  stopMiners,
  notify = () => {},
  releaseStarts = () => {},
  now = Date.now,
}) {
  let state = { state: "idle", updatedAt: new Date(now()).toISOString() },
    check = null,
    attempt = null,
    downloaded = null,
    disposed = false;
  const getState = () => ({ ...state, supported: supported() });
  const set = (name, extra = {}) => {
    if (disposed) return;
    state = {
      ...state,
      state: name,
      ...extra,
      updatedAt: new Date(now()).toISOString(),
    };
    notify(getState());
  };
  const fail = (error) => {
    if (disposed) return;
    const message = error?.message || "Update failed";
    if (attempt) {
      attempt.error = message;
      // Keep starts blocked until the outstanding stop/save operation settles.
      if (attempt.phase === "handoff") {
        releaseStarts();
        attempt = null;
      }
      set("downloaded", { message: `Install paused: ${message}` });
    } else
      set(downloaded ? "downloaded" : "error", {
        ...(downloaded || {}),
        message,
      });
  };
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = false;
  updater.allowDowngrade = false;
  const listeners = {
    "checking-for-update": () => {
      if (!attempt)
        set(downloaded ? "downloaded" : "checking", {
          message: null,
          checkedAt: new Date(now()).toISOString(),
        });
    },
    "update-available": (info) => {
      if (!attempt) {
        if (downloaded?.version !== info.version) downloaded = null;
        set("available", { version: info.version, percent: 0, message: null });
      }
    },
    "update-not-available": () => {
      if (!attempt)
        set(downloaded ? "downloaded" : "idle", {
          version: null,
          percent: null,
          ...(downloaded || {}),
          message: null,
        });
    },
    "download-progress": (progress) => {
      if (!attempt)
        set("downloading", {
          percent: Math.max(
            0,
            Math.min(100, Math.round(progress.percent || 0)),
          ),
        });
    },
    "update-downloaded": (info) => {
      if (!attempt) {
        downloaded = {
          version: info.version,
          percent: 100,
          message: null,
        };
        set("downloaded", downloaded);
      }
    },
    error: fail,
  };
  for (const [event, listener] of Object.entries(listeners))
    updater.on(event, listener);
  function checkForUpdates() {
    if (disposed)
      return Promise.resolve({ success: false, error: "Updater closed" });
    if (!supported()) {
      set("unsupported", {
        message:
          "Automatic app updates require an installed Windows build, macOS app, or Linux AppImage. Miner Repair is available separately.",
      });
      return Promise.resolve({ success: false, ...getState() });
    }
    if (check) return check;
    if (["available", "downloading", "installing"].includes(state.state))
      return Promise.resolve({ success: true, ...getState() });
    // Assign the promise before calling upstream, including synchronous throws.
    check = Promise.resolve().then(async () => {
      try {
        const result = await updater.checkForUpdates();
        // Upstream returns the background download separately. Always observe its rejection.
        result?.downloadPromise?.catch(fail);
        return {
          success: !["error", "unsupported"].includes(state.state),
          ...getState(),
        };
      } catch (error) {
        fail(error);
        return { success: false, ...getState() };
      } finally {
        check = null;
      }
    });
    return check;
  }
  async function install() {
    if (
      disposed ||
      !supported() ||
      attempt ||
      check ||
      state.state !== "downloaded"
    )
      return {
        success: false,
        error: "No supported downloaded update is ready to install",
      };
    const current = { phase: "preparing", error: null };
    attempt = current;
    set("installing", { message: null });
    try {
      await stopMiners(state.version);
      if (disposed || current.error || attempt !== current)
        throw Error(current.error || "Installation canceled");
      current.phase = "handoff";
      updater.quitAndInstall(true, true);
      if (current.error) throw Error(current.error);
      return {
        success: true,
        phase: "installer-handoff",
        version: state.version,
      };
    } catch (error) {
      if (attempt === current) {
        releaseStarts();
        attempt = null;
      }
      set("downloaded", { message: `Install paused: ${error.message}` });
      return { success: false, error: error.message };
    }
  }
  return {
    checkForUpdates,
    install,
    getState,
    cancelInstall: () => {
      if (!attempt || attempt.phase !== "preparing")
        return {
          success: false,
          error: "Installer handoff cannot be canceled",
        };
      fail(Error("Installation canceled before handoff"));
      return { success: true };
    },
    cleanup: () => {
      disposed = true;
      for (const [event, listener] of Object.entries(listeners))
        updater.removeListener(event, listener);
    },
  };
}
module.exports = { createUpdateController };
