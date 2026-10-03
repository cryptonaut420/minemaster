const { spawn, execFile } = require("child_process");
const { promisify } = require("util");
const { randomUUID } = require("crypto");
const { describeError } = require("./runtime");
const { followLog } = require("./logTail");
const { monitorKrig } = require("./krigMonitor");
const { engineFor } = require("../../src/utils/miningConfig");
const runFile = promisify(execFile);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const lifecycleDiagnostic = (diagnostic) =>
  [
    "PROCESS_EXIT",
    "PROCESS_EXIT_PENDING",
    "PROCESS_STOP_FAILED",
    "UNTRACKED_MINER",
    "EXTERNAL_STOP_FAILED",
    "PROCESS_INVENTORY_UNAVAILABLE",
    "CRASH_RETRY",
  ].includes(diagnostic?.code) ||
  (diagnostic?.status === "unavailable" &&
    ["launch", "shutdown", "process ownership"].includes(diagnostic.stage));
function isProcessRunning(pid) {
  if (!Number.isInteger(pid) || pid < 2) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}
async function signalProcess(child, force) {
  if (process.platform === "win32") {
    await runFile(
      "taskkill.exe",
      ["/PID", String(child.pid), "/T", ...(force ? ["/F"] : [])],
      { timeout: 5000, windowsHide: true },
    );
  } else {
    // POSIX miners are spawned in their own process group, so descendants are owned too.
    try {
      process.kill(-child.pid, force ? "SIGKILL" : "SIGTERM");
    } catch (e) {
      if (e.code !== "ESRCH") throw e;
      child.kill(force ? "SIGKILL" : "SIGTERM");
    }
  }
}
function createProcessManager({
  runtime,
  emit = () => {},
  record = () => {},
  spawnProcess = spawn,
  alive = isProcessRunning,
  signal = signalProcess,
  wait = delay,
  startWaitMs = 500,
  stopPolls = 25,
  schedule = setTimeout,
  unschedule = clearTimeout,
  now = Date.now,
  tailLog = followLog,
  monitorStats = monitorKrig,
  externalProcesses = { find: async () => [], stop: async () => {} },
} = {}) {
  const entries = new Map(),
    queues = new Map(),
    engineQueues = new Map(),
    generations = new Map(),
    diagnostics = new Map();
  const retryTimers = new Map(),
    restartHistory = new Map();
  let closing = false;
  const audit = (event, details) => {
    // Diagnostics must never block mining control, including async logger failures.
    try {
      Promise.resolve(record(event, details)).catch(() => {});
    } catch (_) {}
  };
  const cancelRetry = (id) => {
    if (retryTimers.has(id)) {
      unschedule(retryTimers.get(id).timer);
      retryTimers.delete(id);
    }
  };
  const valid = (id, type) => {
    if (!/^[\w-]{1,80}$/.test(id || "")) throw Error("Invalid miner identity");
    if (type && !["xmrig", "nanominer", "srbminer", "krig"].includes(type))
      throw Error("Unsupported miner type");
  };
  const running = (entry) =>
    !!entry &&
    entry.process.exitCode == null &&
    entry.process.signalCode == null &&
    alive(entry.process.pid);
  const unsettledExit = (entry) => entry?.exited && !entry?.outputClosed;
  const exitPendingMessage =
    "Miner process exited but its output handles remain open. A miner-owned restart or descendant may still be running. Check the local process tree before starting, repairing or updating; MineMaster will not assume everything stopped.";
  const waitForOutputClose = async (entry, id) => {
    // Descendants can outlive the parent during this Stop, not only before it.
    // Reclaim only identities verified by the native managed-process matcher.
    if (unsettledExit(entry))
      await externalProcesses.stop(id, entry.process.pid);
    for (let i = 0; i < stopPolls && unsettledExit(entry); i++) await wait(200);
    if (unsettledExit(entry)) return false;
    if (entry?.finalizing) await entry.finalizing;
    return true;
  };
  const snapshot = (id) => {
    const entry = entries.get(id),
      live = running(entry);
    return {
      running: live,
      pid: live ? entry.process.pid : null,
      runId: entry?.runId || null,
      startedAt: live ? entry.startedAt : null,
      activeConfig: live ? entry.activeConfig : null,
      engine: live ? entry.engine : null,
      effectiveSettings: live ? entry.effectiveSettings : null,
      diagnostic: diagnostics.get(id) || null,
      restartPendingAt: retryTimers.get(id)?.at || null,
      error:
        diagnostics.get(id)?.status === "unavailable"
          ? diagnostics.get(id).message
          : null,
    };
  };
  function enqueue(id, action, queue = queues) {
    const next = (queue.get(id) || Promise.resolve())
      .catch(() => {})
      .then(action);
    queue.set(id, next);
    next
      .finally(() => {
        if (queue.get(id) === next) queue.delete(id);
      })
      .catch(() => {});
    return next;
  }
  async function start({ minerId: id, minerType: type, config }) {
    try {
      valid(id, type);
    } catch (e) {
      return { success: false, error: e.message };
    }
    cancelRetry(id);
    const generation = generations.get(id) || 0;
    const engine = engineFor(type, config);
    return enqueue(id, () =>
      enqueue(
        engine,
        async () => {
          let spec, entry;
          try {
            if (closing || generation !== (generations.get(id) || 0))
              throw Error("Start canceled by stop or shutdown");
            if (running(entries.get(id)))
              return { success: true, ...snapshot(id), alreadyRunning: true };
            if (unsettledExit(entries.get(id)))
              throw Object.assign(Error(exitPendingMessage), {
                code: "PROCESS_EXIT_PENDING",
                stage: "shutdown",
              });
            const external = await externalProcesses.find(id);
            if (external.length)
              throw Object.assign(
                Error(
                  `A previous managed SRBMiner instance is still running (PID ${external.map((p) => p.pid).join(", ")}). Use Stop to reclaim it before starting another miner.`,
                ),
                {
                  code: "UNTRACKED_MINER",
                  stage: "process ownership",
                },
              );
            const activeConfig = JSON.parse(JSON.stringify(config));
            spec = await runtime.launchSpec(type, id, activeConfig);
            if (closing || generation !== (generations.get(id) || 0))
              throw Error("Start canceled by stop or shutdown");
            const child = spawnProcess(spec.executable, spec.args, {
              cwd: spec.cwd,
              stdio: ["ignore", "pipe", "pipe"],
              detached: process.platform !== "win32",
              windowsHide: true,
            });
            entry = {
              process: child,
              type,
              engine,
              effectiveSettings: spec.effectiveSettings || null,
              activeConfig,
              startedAt: Date.now(),
              runId: randomUUID(),
              expected: false,
              tail: "",
              error: null,
            };
            entries.set(id, entry);
            diagnostics.set(id, spec.diagnostic);
            const owned = () => entries.get(id) === entry;
            const output = (
              chunk,
              stream,
              observedAt = new Date(now()).toISOString(),
              reset = false,
            ) => {
              if (!owned()) return;
              const data = String(chunk).replace(
                /\x1b\[[0-?]*[ -/]*[@-~]/g,
                "",
              );
              entry.tail = (entry.tail + data).slice(-8000);
              emit("miner-output", {
                minerId: id,
                runId: entry.runId,
                stream,
                engine,
                data,
                observedAt,
                reset,
              });
            };
            for (const [name, stream] of [
              ["stdout", child.stdout],
              ["stderr", child.stderr],
            ]) {
              stream?.setEncoding?.("utf8");
              // The file is Nanominer's canonical output source on every OS;
              // do not count/log its mirrored stdout a second time.
              stream?.on("data", (chunk) => {
                if (!spec.logFile || name === "stderr") output(chunk, name);
              });
            }
            if (spec.logFile)
              entry.logTail = tailLog(
                spec.logFile,
                (data, observedAt, reset) =>
                  output(data, "file", observedAt, reset),
                {
                  freshFile: true,
                  onError: (error) => {
                    audit("miner-log-capture-failed", {
                      minerId: id,
                      runId: entry.runId,
                      engine,
                      code: error.code || null,
                      message: error.message,
                    });
                    output(`Log capture failed: ${error.message}\n`, "stderr");
                  },
                },
              );
            if (spec.apiPort)
              entry.statsMonitor = monitorStats({
                port: spec.apiPort,
                algorithm: activeConfig.algorithm,
                startedAt: entry.startedAt,
                onData: (telemetry) => {
                  if (!owned() || entry.exited || !running(entry)) return;
                  emit("miner-output", {
                    minerId: id,
                    runId: entry.runId,
                    engine,
                    stream: "stats",
                    data: "",
                    telemetry,
                  });
                },
                onError: (error) => {
                  if (owned() && !entry.exited) {
                    audit("miner-stats-unavailable", {
                      minerId: id,
                      runId: entry.runId,
                      engine,
                      message: error.message,
                    });
                    output(
                      `Mining statistics unavailable: ${error.message}\n`,
                      "stderr",
                    );
                  }
                },
              });
            child.on("error", (error) => {
              if (!owned()) return;
              entry.error = error;
              const diagnostic = {
                status: "unavailable",
                engine,
                ...describeError(error, spec.executable),
              };
              diagnostics.set(id, diagnostic);
              emit("miner-error", {
                minerId: id,
                runId: entry.runId,
                error: diagnostic.message,
                diagnostic,
              });
              // An error can also describe a failed kill; retain ownership until exit is observed.
            });
            child.on("exit", (code, signalName) => {
              if (!owned()) return;
              entry.exited = true;
              entry.statsMonitor?.close();
              audit("miner-parent-exit", {
                minerId: id,
                runId: entry.runId,
                engine,
                pid: child.pid,
                code,
                signal: signalName,
                expected: entry.expected,
                outputClosed: !!entry.outputClosed,
              });
              if (!entry.expected)
                diagnostics.set(id, {
                  status: "unavailable",
                  engine,
                  code: "PROCESS_EXIT_PENDING",
                  message: `Miner exited (${code ?? signalName ?? "unknown"}). ${exitPendingMessage}`,
                  path: spec.executable,
                  observedAt: new Date(now()).toISOString(),
                });
            });
            const closed = (code, signalName) => {
              if (!owned()) return;
              if (!entry.expected)
                diagnostics.set(id, {
                  status: "unavailable",
                  engine,
                  code: entry.error?.code || "PROCESS_EXIT",
                  message:
                    entry.error?.message ||
                    `Miner exited (${code ?? signalName ?? "unknown"}). ${entry.tail.slice(-2000)}`,
                  path: spec.executable,
                  observedAt: new Date().toISOString(),
                });
              if (
                !entry.expected &&
                entry.confirmed &&
                entry.activeConfig.restartOnCrash === true &&
                !entry.error &&
                !closing &&
                generation === (generations.get(id) || 0)
              ) {
                const history = (restartHistory.get(id) || []).filter(
                  (at) => at > now() - 3600000,
                );
                const limit = entry.activeConfig.maxCrashRestartsPerHour ?? 2;
                if (history.length < limit) {
                  const at =
                    now() +
                    (entry.activeConfig.crashRestartDelaySeconds ?? 30) * 1000;
                  diagnostics.set(id, {
                    ...diagnostics.get(id),
                    status: "retrying",
                    code: "CRASH_RETRY",
                    message: `Unexpected exit. Restart scheduled at ${new Date(at).toISOString()} (${history.length + 1}/${limit} this hour). Stop cancels recovery.`,
                  });
                  const timer = schedule(() => {
                    retryTimers.delete(id);
                    if (closing || generation !== (generations.get(id) || 0))
                      return;
                    restartHistory.set(id, [...history, now()]);
                    start({
                      minerId: id,
                      minerType: type,
                      config: entry.activeConfig,
                    });
                  }, at - now());
                  retryTimers.set(id, { timer, at, engine });
                }
              }
              emit("miner-closed", {
                minerId: id,
                runId: entry.runId,
                code,
                signal: signalName,
                expected: entry.expected,
                diagnostic: diagnostics.get(id),
              });
              entry.statsMonitor?.close();
              entry.logTail?.close();
              entries.delete(id);
            };
            child.on("close", (code, signalName) => {
              entry.outputClosed = true;
              if (entry.logTail?.finish) {
                entry.finalizing = entry.logTail
                  .finish()
                  .catch(() => {})
                  .then(() => closed(code, signalName));
              } else closed(code, signalName);
            });
            await wait(startWaitMs);
            if (!running(entry) && entry.finalizing) await entry.finalizing;
            if (closing || generation !== (generations.get(id) || 0)) {
              const stopped = await stopEntry(id);
              throw Error(
                stopped.success
                  ? "Start canceled by stop or shutdown"
                  : stopped.error,
              );
            }
            if (entry.error) throw entry.error;
            if (!owned() || !running(entry))
              throw Error(
                `Miner exited during startup. ${entry.tail.slice(-2000)}`,
              );
            entry.confirmed = true;
            audit("miner-start-confirmed", {
              minerId: id,
              runId: entry.runId,
              engine,
              pid: child.pid,
            });
            return { success: true, ...snapshot(id) };
          } catch (error) {
            const diagnostic = {
              status: "unavailable",
              engine,
              ...describeError(error, error.path || spec?.executable),
            };
            diagnostics.set(id, diagnostic);
            return {
              success: false,
              error: diagnostic.message,
              diagnostic,
              ...snapshot(id),
            };
          }
        },
        engineQueues,
      ),
    );
  }
  async function stopEntry(id) {
    const entry = entries.get(id);
    if (!running(entry)) {
      if (!(await waitForOutputClose(entry, id)))
        return { success: false, ...snapshot(id), error: exitPendingMessage };
      await entry?.logTail?.finish?.().catch(() => {});
      entry?.statsMonitor?.close();
      entry?.logTail?.close();
      if (entries.get(id) === entry) entries.delete(id);
      return { success: true, alreadyStopped: true };
    }
    entry.expected = true;
    for (const force of [false, true]) {
      try {
        await signal(entry.process, force);
      } catch (_) {
        /* Confirm exit even if the OS command returned an error. */
      }
      for (let attempt = 0; attempt < stopPolls && running(entry); attempt++)
        await wait(200);
      if (!running(entry)) {
        if (!(await waitForOutputClose(entry, id)))
          return { success: false, ...snapshot(id), error: exitPendingMessage };
        await entry.logTail?.finish?.().catch(() => {});
        entry.statsMonitor?.close();
        entry.logTail?.close();
        if (entries.get(id) === entry) entries.delete(id);
        return { success: true };
      }
    }
    entry.expected = false;
    return {
      success: false,
      ...snapshot(id),
      error: `Could not confirm stop of PID ${entry.process.pid}. The process remains tracked.`,
    };
  }
  function stop({ minerId: id }) {
    try {
      valid(id);
    } catch (e) {
      return Promise.resolve({ success: false, error: e.message });
    }
    cancelRetry(id);
    generations.set(id, (generations.get(id) || 0) + 1);
    return enqueue(id, async () => {
      const entry = entries.get(id);
      const context = {
        minerId: id,
        runId: entry?.runId || null,
        engine: entry?.engine || diagnostics.get(id)?.engine || null,
        pid: entry?.process.pid || null,
      };
      try {
        const result = await stopEntry(id);
        if (!result.success) {
          diagnostics.set(id, {
            status: "unavailable",
            engine: entries.get(id)?.engine,
            code: "PROCESS_STOP_FAILED",
            message: result.error,
          });
          audit("miner-stop-failed", {
            ...context,
            code: "PROCESS_STOP_FAILED",
            message: result.error,
          });
          return { ...result, ...snapshot(id), success: false };
        }
        await externalProcesses.stop(id);
        if (lifecycleDiagnostic(diagnostics.get(id))) diagnostics.delete(id);
        audit("miner-stop-confirmed", context);
        return { ...result, ...snapshot(id) };
      } catch (error) {
        const message =
          error.code === "PROCESS_INVENTORY_UNAVAILABLE"
            ? error.message.replace(
                /^Could not verify existing Windows miner processes:\s*/,
                "Windows could not confirm this slot is clear. Use Stop to retry. ",
              )
            : error.message;
        const diagnostic = {
          status: "unavailable",
          engine: context.engine,
          code: error.code || "EXTERNAL_STOP_FAILED",
          message,
        };
        diagnostics.set(id, diagnostic);
        audit("miner-stop-failed", {
          ...context,
          code: diagnostic.code,
          message: diagnostic.message,
        });
        return { success: false, ...snapshot(id), error: message };
      }
    });
  }
  async function stopAll() {
    closing = true;
    const ids = [
      ...new Set([
        ...entries.keys(),
        ...queues.keys(),
        ...retryTimers.keys(),
        "xmrig-1",
        "nanominer-1",
      ]),
    ];
    const intentGenerations = new Map(
      ids.map((id) => [id, generations.get(id) || 0]),
    );
    const initialIntent = new Set(
      ids.filter((id) => running(entries.get(id)) || retryTimers.has(id)),
    );
    let externalIds;
    try {
      externalIds = new Set(
        (
          await Promise.all(
            ids.map(async (id) =>
              (await externalProcesses.find(id, entries.get(id)?.process.pid))
                .length
                ? id
                : null,
            ),
          )
        ).filter(Boolean),
      );
    } catch (error) {
      closing = false;
      throw error;
    }
    // A scheduled recovery is still explicit mining intent. Preserve it across
    // installation, but never turn an ordinary stopped/failed launch into a start.
    const resumeIds = ids.filter(
      (id) =>
        (generations.get(id) || 0) === intentGenerations.get(id) &&
        (initialIntent.has(id) || externalIds.has(id)),
    );
    const stopGenerations = new Map();
    const results = await Promise.all(
      ids.map((minerId) => {
        const result = stop({ minerId });
        stopGenerations.set(minerId, generations.get(minerId));
        return result;
      }),
    );
    const failed = results.filter((r) => !r.success);
    if (failed.length) {
      closing = false;
      throw Error(failed.map((r) => r.error).join("; "));
    }
    // A user Stop issued while another process is shutting down supersedes the
    // captured resume intent, even if that first process has already stopped.
    return resumeIds.filter(
      (id) => generations.get(id) === stopGenerations.get(id),
    );
  }
  async function diagnose(id, type, customPath, options) {
    valid(id, type);
    const entry = entries.get(id),
      generation = generations.get(id);
    const previous = diagnostics.get(id);
    const diagnostic = await runtime.inspect(type, customPath, options);
    // A file check is not a process-health check, and an asynchronous old check
    // must never overwrite a newer launch, Stop or failure.
    if (
      entry === entries.get(id) &&
      generation === generations.get(id) &&
      previous === diagnostics.get(id) &&
      !lifecycleDiagnostic(previous) &&
      (!entry || entry.engine === type)
    )
      diagnostics.set(id, diagnostic);
    return diagnostic;
  }
  function repair(id, type, customPath) {
    cancelRetry(id);
    return enqueue(id, () =>
      enqueue(
        type,
        async () => {
          try {
            valid(id, type);
            if (
              closing ||
              running(entries.get(id)) ||
              unsettledExit(entries.get(id)) ||
              [...entries.values()].some(
                (entry) =>
                  entry.engine === type &&
                  (running(entry) || unsettledExit(entry)),
              ) ||
              [...retryTimers.values()].some((retry) => retry.engine === type)
            )
              throw Error(
                "Stop every process using this engine before repairing its files (including CPU and GPU instances)",
              );
            if (customPath)
              throw Error(
                "A custom executable is selected. Clear its path in local settings before repairing the managed engine.",
              );
            for (const slot of ["xmrig-1", "nanominer-1"])
              if (
                (
                  await externalProcesses.find(
                    slot,
                    entries.get(slot)?.process.pid,
                  )
                ).length
              )
                throw Error(
                  "Stop the previous managed SRBMiner instance before repairing miner files",
                );
            await runtime.prepare(type, { repair: true });
            const diagnostic = await diagnose(id, type);
            const success = diagnostic.status === "ready";
            return {
              success,
              ...(success
                ? {}
                : {
                    error:
                      diagnostic.message ||
                      "Repaired miner files could not be verified",
                  }),
              diagnostic,
            };
          } catch (error) {
            const diagnostic = {
              status: "unavailable",
              engine: type,
              ...describeError(
                Object.assign(error, { stage: error.stage || "repair" }),
              ),
            };
            diagnostics.set(id, diagnostic);
            return { success: false, error: diagnostic.message, diagnostic };
          }
        },
        engineQueues,
      ),
    );
  }
  return {
    start,
    stop,
    stopAll,
    snapshot,
    diagnose,
    repair,
    prepareEngine: (type) =>
      enqueue(type, () => runtime.prepare(type), engineQueues),
    allowStarts: () => {
      closing = false;
    },
    snapshots: () =>
      Object.fromEntries(
        [...new Set([...entries.keys(), ...diagnostics.keys()])].map((id) => [
          id,
          snapshot(id),
        ]),
      ),
  };
}
module.exports = { createProcessManager, isProcessRunning };
