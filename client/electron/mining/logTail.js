const fs = require("fs");
const { StringDecoder } = require("string_decoder");

// Read only this process's newly created log. Windows Nanominer does not
// reliably write to redirected stdout. Never replay a previous run as fresh.
function followLog(file, output, { interval = 1000, onError = () => {} } = {}) {
  let offset = 0,
    identity,
    decoder = new StringDecoder("utf8"),
    closed = false,
    busy = false;
  let lastError = null;
  async function poll() {
    if (closed || busy) return;
    busy = true;
    let handle;
    try {
      handle = await fs.promises.open(file, "r");
      const stat = await handle.stat();
      const current = `${stat.dev}:${stat.ino}`;
      if (identity !== current || stat.size < offset) {
        offset = 0;
        decoder = new StringDecoder("utf8");
      }
      identity = current;
      // Bound work and memory; a backlog remains stale using its file timestamp.
      const length = Math.min(256 * 1024, Math.max(0, stat.size - offset));
      if (length) {
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, offset);
        offset += bytesRead;
        const data = decoder.write(buffer.subarray(0, bytesRead));
        if (!closed && data) output(data, new Date(stat.mtimeMs).toISOString());
      }
      lastError = null;
    } catch (error) {
      if (!closed && error.code !== "ENOENT" && error.code !== lastError) {
        lastError = error.code;
        onError(error);
      }
    } finally {
      await handle?.close().catch(() => {});
      busy = false;
    }
  }
  const timer = setInterval(poll, interval);
  timer.unref?.();
  return {
    poll,
    close() {
      closed = true;
      clearInterval(timer);
    },
  };
}
module.exports = { followLog };
