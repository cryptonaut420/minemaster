const fs = require("fs");
const path = require("path");
function createDiagnosticLog(directory, { maxBytes = 2 * 1024 * 1024 } = {}) {
  const file = path.join(directory, "client.log");
  let queue = Promise.resolve();
  return {
    directory,
    record(event, details = {}) {
      let serialized;
      try {
        serialized = JSON.stringify(details);
      } catch (_) {
        return;
      }
      const line =
        JSON.stringify({
          at: new Date().toISOString(),
          event,
          details:
            serialized.length > 12000
              ? { truncated: true, text: serialized.slice(0, 12000) }
              : details,
        }) + "\n";
      queue = queue
        .catch(() => {})
        .then(async () => {
          await fs.promises.mkdir(directory, { recursive: true });
          const stat = await fs.promises.stat(file).catch(() => null);
          if (stat && stat.size + Buffer.byteLength(line) > maxBytes) {
            await fs.promises.rm(file + ".previous", { force: true });
            await fs.promises.rename(file, file + ".previous");
          }
          await fs.promises.appendFile(file, line, { mode: 0o600 });
        })
        .catch(() => {}); // Disk/log failures must not stop process control.
    },
    flush: () => queue,
  };
}
module.exports = { createDiagnosticLog };
