const terminal = ["succeeded", "failed", "canceled"];
const handedOff = (result) =>
  result?.status === "running" &&
  result.result?.update?.phase === "installer-handoff";
export function createCommandRunner({
  getMiners,
  start,
  stop,
  enable,
  maintenance,
  application,
  applyConfigs,
  report,
  storage,
  delayMs = 1500,
}) {
  const queues = new Map(),
    controllers = new Map(),
    active = new Map();
  let journal = {};
  try {
    const saved = JSON.parse(
      storage?.getItem("minemaster-command-results") || "{}",
    );
    if (saved && typeof saved === "object" && !Array.isArray(saved)) {
      journal = Object.fromEntries(
        Object.entries(saved)
          .filter(
            ([id, result]) =>
              result &&
              result.id === id &&
              [...terminal, "received", "running"].includes(result.status),
          )
          .slice(-100),
      );
    }
  } catch (_) {}
  const save = () => {
    const entries = Object.entries(journal).slice(-100);
    journal = Object.fromEntries(entries);
    try {
      storage?.setItem("minemaster-command-results", JSON.stringify(journal));
    } catch (_) {}
  };
  const publish = (result) => {
    journal[result.id] = result;
    save();
    report(result);
  };
  const check = (c, command) => {
    if (c.signal.aborted)
      throw Object.assign(
        Error(
          c.signal.reason?.deadline
            ? "Command deadline expired"
            : "Canceled or superseded",
        ),
        { canceled: !c.signal.reason?.deadline },
      );
    if (Date.now() >= Date.parse(command.deadline))
      throw Error("Command deadline expired");
  };
  const wait = (c) =>
    new Promise((resolve, reject) => {
      if (c.signal.aborted)
        return reject(Object.assign(Error("Canceled"), { canceled: true }));
      const abort = () => {
        clearTimeout(timer);
        reject(Object.assign(Error("Canceled"), { canceled: true }));
      };
      const timer = setTimeout(() => {
        c.signal.removeEventListener("abort", abort);
        resolve();
      }, delayMs);
      c.signal.addEventListener("abort", abort, { once: true });
    });
  const ensure = (result) => {
    if (!result?.success)
      throw Error(result?.error || "Process operation failed");
    return result;
  };
  async function startCancelable(id, c, command) {
    check(c, command);
    let canceledStop;
    const abort = () => {
      // Reach native Stop immediately: waiting behind this Start would defeat preparation cancellation.
      canceledStop = Promise.resolve().then(() => stop(id));
      canceledStop.catch(() => {});
    };
    c.signal.addEventListener("abort", abort, { once: true });
    try {
      const result = await start(id);
      if (canceledStop) ensure(await canceledStop);
      check(c, command);
      return ensure(result);
    } finally {
      c.signal.removeEventListener("abort", abort);
    }
  }
  async function execute(command) {
    if (!command?.id || !Number.isFinite(Date.parse(command.deadline)))
      throw Error("Command ID and deadline required");
    if (journal[command.id]) {
      if (active.has(command.id)) return report(journal[command.id]);
      const prior = journal[command.id];
      return publish(
        terminal.includes(prior.status) || handedOff(prior)
          ? prior
          : {
              id: command.id,
              status: "failed",
              error:
                "Agent restarted during execution; outcome unknown. Inspect the process before retrying.",
            },
      );
    }
    publish({ id: command.id, status: "received" });
    const c = new AbortController();
    active.set(command.id, c);
    const deadlineTimer = setTimeout(
      () => c.abort({ deadline: true }),
      Math.max(0, Date.parse(command.deadline) - Date.now()),
    );
    try {
      const scope = String(command.deviceType || "ALL").toUpperCase();
      if (
        !["CPU", "GPU", "ALL"].includes(scope) ||
        command.gpuId != null ||
        command.deviceId != null
      )
        throw Error("Unsupported device scope");
      if (
        ![
          "start",
          "stop",
          "restart",
          "device-enable",
          "device-disable",
          "config-update",
          "miner-diagnose",
          "miner-repair",
          "app-update-check",
          "app-update-install",
        ].includes(command.action)
      )
        throw Error("Unsupported action");
      if (command.action.startsWith("app-update-")) {
        if (scope !== "ALL" || !application)
          throw Error(
            "Application updates require whole-rig scope and a supported agent",
          );
        check(c, command);
        if (command.action === "app-update-install")
          for (const miner of getMiners()) {
            controllers.get(miner.id)?.abort();
            controllers.set(miner.id, c);
          }
        publish({ id: command.id, status: "running" });
        const result = ensure(
          await application(command.action, command.targetVersion, c.signal),
        );
        check(c, command);
        publish({
          id: command.id,
          status:
            command.action === "app-update-install" ? "running" : "succeeded",
          result: { update: result },
        });
        return;
      }
      const targets = getMiners().filter(
        (m) => scope === "ALL" || m.deviceType === scope,
      );
      if (!targets.length) throw Error("No matching mining process");
      check(c, command);
      if (command.configs) applyConfigs(command.configs, scope);
      publish({ id: command.id, status: "running" });
      const settled = await Promise.allSettled(
        targets.map((target) => {
          const id = target.id;
          if (command.action !== "config-update") {
            controllers.get(id)?.abort();
            controllers.set(id, c);
          }
          const previous = queues.get(id) || Promise.resolve();
          const next = previous
            .catch(() => {})
            .then(async () => {
              check(c, command);
              let current = getMiners().find((m) => m.id === id);
              if (["miner-diagnose", "miner-repair"].includes(command.action)) {
                const result = ensure(await maintenance(id, command.action));
                check(c, command);
                return { id, diagnostic: result.diagnostic };
              }
              if (command.action === "config-update")
                return {
                  id,
                  desiredConfigVersion: current.config?.version,
                  appliedConfigVersion: current.activeConfig?.version || null,
                };
              if (command.action === "device-enable") {
                enable(id, true);
                return { id, enabled: true };
              }
              if (
                scope === "ALL" &&
                current.enabled === false &&
                ["start", "restart"].includes(command.action)
              )
                return { id, skipped: "Process disabled" };
              const wasRunning = current.running;
              if (
                command.action === "restart" &&
                command.restartRunningOnly &&
                !wasRunning
              )
                return { id, skipped: "Process was not running" };
              if (
                ["stop", "restart", "device-disable"].includes(command.action)
              ) {
                ensure(await stop(id));
                check(c, command);
              }
              if (command.action === "device-disable") enable(id, false);
              if (
                command.action === "restart" &&
                (!command.restartRunningOnly || wasRunning)
              ) {
                await wait(c);
                check(c, command);
                current = getMiners().find((m) => m.id === id);
                if (current.enabled === false)
                  throw Error("Process is disabled");
                await startCancelable(id, c, command);
              }
              if (command.action === "start") {
                current = getMiners().find((m) => m.id === id);
                await startCancelable(id, c, command);
              }
              check(c, command);
              current = getMiners().find((m) => m.id === id);
              return {
                id,
                running: current.running,
                enabled: current.enabled,
                pid: current.pid,
                engine: current.running
                  ? current.engine ||
                    current.activeConfig?.engine ||
                    current.type
                  : current.config?.engine || current.type,
                effectiveSettings: current.effectiveSettings || null,
                appliedConfigVersion: current.activeConfig?.version || null,
              };
            });
          queues.set(id, next);
          next
            .finally(() => {
              if (queues.get(id) === next) queues.delete(id);
            })
            .catch(() => {});
          return next;
        }),
      );
      const results = settled.map((r, i) =>
        r.status === "fulfilled"
          ? r.value
          : { id: targets[i].id, error: r.reason.message },
      );
      const errors = settled.filter((r) => r.status === "rejected");
      publish({
        id: command.id,
        status: errors.length
          ? c.signal.aborted && !c.signal.reason?.deadline
            ? "canceled"
            : "failed"
          : "succeeded",
        result: { processes: results },
        ...(errors.length
          ? { error: errors.map((r) => r.reason.message).join("; ") }
          : {}),
      });
    } catch (error) {
      publish({
        id: command.id,
        status: error.canceled ? "canceled" : "failed",
        error: error.message,
      });
    } finally {
      clearTimeout(deadlineTimer);
      active.delete(command.id);
      for (const [id, controller] of controllers)
        if (controller === c) controllers.delete(id);
    }
  }
  return {
    execute,
    replayResults: () => {
      for (const prior of Object.values(journal)) {
        if (
          terminal.includes(prior.status) ||
          handedOff(prior) ||
          active.has(prior.id)
        )
          report(prior);
        else
          publish({
            id: prior.id,
            status: "failed",
            error:
              "Agent restarted during execution; outcome unknown. Inspect the process before retrying.",
          });
      }
    },
    cancel: (id) => active.get(id)?.abort(),
    cancelProcess: (id) => controllers.get(id)?.abort(),
    dispose: () => {
      for (const c of active.values()) c.abort();
    },
  };
}
