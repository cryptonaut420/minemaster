function createUpdateController({
  updater,
  supported = () => true,
  stopMiners,
  notify = () => {},
  releaseStarts = () => {},
  now = Date.now,
  downloadIdleMs = 5 * 60 * 1000,
  downloadMaxMs = 2 * 60 * 60 * 1000,
  schedule = setInterval,
  unschedule = clearInterval,
}) {
  let state = { state: "idle", updatedAt: new Date(now()).toISOString() },
    check = null,
    attempt = null,
    downloaded = null,
    disposed = false;
  let transfer = null;
  let lastProgressAt = now(),
    transferred = 0;
  const watchDownload = (result) => {
    if (!result?.downloadPromise) return;
    const current = {
      token: result.cancellationToken,
      startedAt: now(),
      canceled: false,
    };
    transfer = current;
    lastProgressAt = now();
    transferred = 0;
    current.timer = schedule(() => {
      if (disposed || current.canceled || state.state === "downloaded") return;
      if (
        now() - lastProgressAt < downloadIdleMs &&
        now() - current.startedAt < downloadMaxMs
      )
        return;
      current.canceled = true;
      fail(
        Error(
          "Update download timed out. Mining is unaffected. The next scheduled check can retry after cancellation completes; restart MineMaster if cancellation remains stuck.",
        ),
      );
      // Keep ownership until upstream settles: never race two downloads or
      // accept a late completion from a timed-out transfer as installable.
      try {
        current.token?.cancel();
      } catch (_) {
        /* retain timeout diagnostic */
      }
    }, 30000);
    current.timer?.unref?.();
    const finish = () => {
      unschedule(current.timer);
      if (transfer === current) transfer = null;
    };
    Promise.resolve(result.downloadPromise).then(
      () => {
        if (
          !current.canceled &&
          ["available", "downloading"].includes(state.state)
        )
          fail(
            Error(
              "Update download ended without a verified completion. The next scheduled check will retry.",
            ),
          );
        finish();
      },
      (error) => {
        if (!current.canceled) fail(error);
        finish();
      },
    );
  };
  const getState = () => ({ ...state, supported: supported() });
  const set = (name, extra = {}) => {
    if (disposed) return;
    state = {
      ...state,
      state: name,
      ...extra,
      updatedAt: new Date(now()).toISOString(),
    };
    try {
      notify(getState());
    } catch (_) {
      // A closing renderer or failed diagnostic sink must not interrupt update
      // ownership, cancellation, or the release of blocked mining controls.
    }
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
      if (!attempt && !transfer?.canceled) {
        if (
          Number.isFinite(progress.transferred) &&
          progress.transferred > transferred
        ) {
          transferred = progress.transferred;
          lastProgressAt = now();
        }
        set("downloading", {
          percent: Math.max(
            0,
            Math.min(100, Math.round(progress.percent || 0)),
          ),
        });
      }
    },
    "update-downloaded": (info) => {
      if (!attempt && !transfer?.canceled) {
        downloaded = {
          version: info.version,
          percent: 100,
          message: null,
        };
        set("downloaded", downloaded);
      }
    },
    error: (error) => {
      if (!transfer?.canceled) fail(error);
    },
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
    if (transfer)
      return Promise.resolve({ success: !transfer.canceled, ...getState() });
    if (["available", "downloading", "installing"].includes(state.state))
      return Promise.resolve({ success: true, ...getState() });
    // Assign the promise before calling upstream, including synchronous throws.
    check = Promise.resolve().then(async () => {
      try {
        const result = await updater.checkForUpdates();
        // Upstream returns the background download separately. Always observe its rejection.
        watchDownload(result);
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
  async function install(targetVersion) {
    // Validate in the native owner, atomically with claiming the install attempt.
    // A renderer's earlier status read can race a completed background download.
    if (targetVersion !== undefined && targetVersion !== state.version)
      return {
        success: false,
        error:
          "The requested update is no longer downloaded. Check update status again.",
      };
    if (
      disposed ||
      !supported() ||
      attempt ||
      check ||
      transfer ||
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
      if (transfer) {
        unschedule(transfer.timer);
        const wasCanceled = transfer.canceled;
        transfer.canceled = true;
        try {
          if (!wasCanceled) transfer.token?.cancel();
        } catch (_) {
          /* shutting down */
        }
      }
      for (const [event, listener] of Object.entries(listeners))
        updater.removeListener(event, listener);
    },
  };
}
module.exports = { createUpdateController };
