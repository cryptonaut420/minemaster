const fs = require("fs");
const { StringDecoder } = require("string_decoder");

// Read only this process's newly created log. Windows Nanominer does not
// reliably write to redirected stdout. Never replay a previous run as fresh.
function followLog(
  file,
  output,
  {
    interval = 1000,
    onError = () => {},
    freshFile = false,
    now = Date.now,
  } = {},
) {
  let offset = 0,
    identity,
    decoder = new StringDecoder("utf8"),
    closed = false,
    reading = null,
    finishing = null;
  let lastError = null;
  let lastPollAt = now(),
    resetNext = false;
  function poll() {
    if (closed) return Promise.resolve();
    if (reading) return reading;
    reading = read().finally(() => {
      reading = null;
    });
    return reading;
  }
  async function read() {
    let handle;
    try {
      handle = await fs.promises.open(file, "r");
      const stat = await handle.stat();
      const observedAt = now();
      const current = `${stat.dev}:${stat.ino}`;
      if (identity !== current || stat.size < offset) {
        resetNext = !!identity;
        offset = 0;
        decoder = new StringDecoder("utf8");
      }
      identity = current;
      // Windows last-write time is not guaranteed to advance while a writer
      // holds its handle open. A newly emptied, owned log is observed by growth.
      // After a long monitoring gap discard backlog rather than freshen old rates.
      if (freshFile && observedAt - lastPollAt > 10000 && stat.size > offset) {
        offset = stat.size;
        decoder = new StringDecoder("utf8");
        resetNext = true;
        onError(
          Error(
            "Output skipped after a monitoring gap; waiting for new miner output",
          ),
        );
      }
      lastPollAt = observedAt;
      let skipPartialLine = false;
      if (freshFile && stat.size - offset > 256 * 1024) {
        offset = stat.size - 256 * 1024;
        decoder = new StringDecoder("utf8");
        resetNext = true;
        skipPartialLine = true;
        onError(Error("Output backlog exceeded 256 KiB; older output skipped"));
      }
      const length = Math.min(256 * 1024, Math.max(0, stat.size - offset));
      if (length) {
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, offset);
        offset += bytesRead;
        let data = decoder.write(buffer.subarray(0, bytesRead));
        if (skipPartialLine)
          data = data.includes("\n") ? data.slice(data.indexOf("\n") + 1) : "";
        if (!closed && data) {
          output(
            data,
            new Date(freshFile ? observedAt : stat.mtimeMs).toISOString(),
            resetNext,
          );
          resetNext = false;
        }
      }
      lastError = null;
    } catch (error) {
      if (!closed && error.code !== "ENOENT" && error.code !== lastError) {
        lastError = error.code;
        onError(error);
      }
    } finally {
      await handle?.close().catch(() => {});
    }
  }
  const timer = setInterval(poll, interval);
  timer.unref?.();
  return {
    poll,
    finish() {
      // Flush a short-lived miner's final errors before ownership is released.
      // Wait for an in-flight read, then collect bytes written during that read.
      if (!finishing)
        finishing = (async () => {
          clearInterval(timer);
          if (reading) await reading;
          await poll();
          closed = true;
        })();
      return finishing;
    },
    close() {
      closed = true;
      clearInterval(timer);
    },
  };
}
module.exports = { followLog };
