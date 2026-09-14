const { spawn, execFile } = require("child_process");
const { promisify } = require("util");
const { randomUUID } = require("crypto");
const { describeError } = require("./runtime");
const { engineFor } = require("../../src/utils/miningConfig");
const runFile = promisify(execFile);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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
  spawnProcess = spawn,
  alive = isProcessRunning,
  signal = signalProcess,
  wait = delay,
  startWaitMs = 500,
  stopPolls = 25,
  schedule = setTimeout,
  unschedule = clearTimeout,
  now = Date.now,
} = {}) {
  const entries = new Map(),
    queues = new Map(),
    engineQueues = new Map(),
    generations = new Map(),
    diagnostics = new Map();
  const retryTimers = new Map(),
    restartHistory = new Map();
  let closing = false;
  const cancelRetry = (id) => {
    if (retryTimers.has(id)) {
      unschedule(retryTimers.get(id).timer);
      retryTimers.delete(id);
    }
  };
  const valid = (id, type) => {
    if (!/^[\w-]{1,80}$/.test(id || "")) throw Error("Invalid miner identity");
    if (type && !["xmrig", "nanominer"].includes(type))
      throw Error("Unsupported miner type");
  };
  const running = (entry) =>
    !!entry &&
    entry.process.exitCode == null &&
    entry.process.signalCode == null &&
    alive(entry.process.pid);
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
            const output = (chunk, stream) => {
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
                data,
              });
            };
            for (const [name, stream] of [
              ["stdout", child.stdout],
              ["stderr", child.stderr],
            ]) {
              stream?.setEncoding?.("utf8");
              stream?.on("data", (chunk) => output(chunk, name));
            }
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
            child.on("close", (code, signalName) => {
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
                !closing
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
              entries.delete(id);
            });
            await wait(startWaitMs);
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
    return enqueue(id, () => stopEntry(id));
  }
  async function stopAll() {
    closing = true;
    const ids = [
      ...new Set([...entries.keys(), ...queues.keys(), ...retryTimers.keys()]),
    ];
    const runningIds = ids.filter((id) => running(entries.get(id)));
    const results = await Promise.all(ids.map((minerId) => stop({ minerId })));
    const failed = results.filter((r) => !r.success);
    if (failed.length) {
      closing = false;
      throw Error(failed.map((r) => r.error).join("; "));
    }
    return runningIds;
  }
  async function diagnose(id, type, customPath, options) {
    const diagnostic = await runtime.inspect(type, customPath, options);
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
              [...entries.values()].some(
                (entry) => entry.engine === type && running(entry),
              ) ||
              [...retryTimers.values()].some((retry) => retry.engine === type)
            )
              throw Error(
                "Stop every process using this engine before repairing its files (including CPU and GPU Nanominer)",
              );
            if (customPath)
              throw Error(
                "A custom executable is selected. Clear its path in local settings before repairing the managed engine.",
              );
            await runtime.prepare(type, { repair: true });
            return { success: true, diagnostic: await diagnose(id, type) };
          } catch (error) {
            const diagnostic = {
              status: "unavailable",
              engine: type,
              ...describeError(error),
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
