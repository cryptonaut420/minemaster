const terminal = ["succeeded", "failed", "canceled"];
export function createCommandRunner({
  getMiners,
  start,
  stop,
  enable,
  maintenance,
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
      throw Object.assign(Error("Canceled or superseded"), { canceled: true });
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
  async function execute(command) {
    if (!command?.id || !Number.isFinite(Date.parse(command.deadline)))
      throw Error("Command ID and deadline required");
    if (journal[command.id]) {
      if (active.has(command.id)) return report(journal[command.id]);
      const prior = journal[command.id];
      return publish(
        terminal.includes(prior.status)
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
        ].includes(command.action)
      )
        throw Error("Unsupported action");
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
                ensure(await start(id));
              }
              if (command.action === "start") {
                current = getMiners().find((m) => m.id === id);
                ensure(await start(id));
              }
              check(c, command);
              current = getMiners().find((m) => m.id === id);
              return {
                id,
                running: current.running,
                enabled: current.enabled,
                pid: current.pid,
                engine:
                  current.engine ||
                  current.activeConfig?.engine ||
                  current.type,
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
          ? c.signal.aborted
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
      active.delete(command.id);
      for (const [id, controller] of controllers)
        if (controller === c) controllers.delete(id);
    }
  }
  return {
    execute,
    replayResults: () => {
      for (const prior of Object.values(journal)) {
        if (terminal.includes(prior.status) || active.has(prior.id))
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
