const fs = require("fs");
const path = require("path");
function createDiagnosticLog(
  directory,
  { maxBytes = 2 * 1024 * 1024, maxPending = 256 } = {},
) {
  const file = path.join(directory, "client.log");
  let queue = Promise.resolve(),
    pending = 0,
    dropped = 0;
  async function append(line) {
    await fs.promises.mkdir(directory, { recursive: true });
    const stat = await fs.promises.stat(file).catch(() => null);
    if (stat && stat.size + Buffer.byteLength(line) > maxBytes) {
      await fs.promises.rm(file + ".previous", { force: true });
      await fs.promises.rename(file, file + ".previous");
    }
    await fs.promises.appendFile(file, line, { mode: 0o600 });
  }
  return {
    directory,
    record(event, details = {}) {
      if (pending >= maxPending) {
        dropped++;
        return;
      }
      let line;
      try {
        const serialized = JSON.stringify(details);
        if (serialized === undefined) return;
        line =
          JSON.stringify({
            at: new Date().toISOString(),
            event: String(event).slice(0, 100),
            details:
              serialized.length > 12000
                ? { truncated: true, text: serialized.slice(0, 12000) }
                : JSON.parse(serialized),
          }) + "\n";
      } catch (_) {
        return;
      }
      pending++;
      queue = queue
        .catch(() => {})
        .then(async () => {
          try {
            await append(line);
          } finally {
            pending--;
            if (!pending && dropped) {
              const count = dropped;
              dropped = 0;
              await append(
                JSON.stringify({
                  at: new Date().toISOString(),
                  event: "diagnostic-log-dropped",
                  details: { count, reason: "Pending write limit reached" },
                }) + "\n",
              );
            }
          }
        })
        .catch(() => {}); // Disk/log failures must not stop process control.
    },
    flush: () => queue,
  };
}
module.exports = { createDiagnosticLog };
