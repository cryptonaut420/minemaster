// KRig's upstream h-stats.sh uses /hiveos: khs is the process total in kH/s.
// Poll only the owned run's loopback endpoint. Failed polls never produce zero.
const http = require("http");
const net = require("net");
async function chooseApiPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}
const number = (value) =>
  (typeof value === "number" ||
    (typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value))) &&
  Number.isFinite(Number(value)) &&
  Number(value) >= 0
    ? Number(value)
    : null;
function parseKrigStats(body, { algorithm, observedAt, elapsedSeconds }) {
  const stats = body?.stats;
  const rate = number(body?.khs),
    uptime = number(stats?.uptime);
  if (
    !stats ||
    rate === null ||
    uptime === null ||
    uptime > elapsedSeconds + 15
  )
    throw Error("KRig returned missing or mismatched run statistics");
  const reported =
    { pearl: "pearlhash", prl: "pearlhash", qtc: "quantus", quan: "quantus" }[
      String(stats.algo).toLowerCase()
    ] || String(stats.algo).toLowerCase();
  if (reported !== algorithm)
    throw Error("KRig statistics algorithm does not match this launch");
  const hashrate = rate * 1000;
  if (!Number.isFinite(hashrate)) throw Error("Invalid KRig hashrate");
  const observation = { hashrate, hashrateObservedAt: observedAt };
  if (/^\d+\.\d+\.\d+(?:[-\w.]*)?$/.test(stats.ver || ""))
    observation.minerVersion = stats.ver;
  if (Array.isArray(stats.ar) && stats.ar.length >= 2) {
    const accepted = number(stats.ar[0]),
      rejected = number(stats.ar[1]);
    if (Number.isSafeInteger(accepted) && Number.isSafeInteger(rejected))
      observation.shares = {
        accepted,
        rejected,
        observedAt,
        source: "krig-api",
      };
  }
  return { uptime, observation };
}
function readStats(port) {
  let request;
  const promise = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => request?.destroy(Error("KRig statistics timed out")),
      3000,
    );
    const finish = (error, value) => {
      clearTimeout(timer);
      error ? reject(error) : resolve(value);
    };
    request = http.get(
      { host: "127.0.0.1", port, path: "/hiveos", agent: false },
      (response) => {
        if (response.statusCode !== 200) {
          response.destroy();
          finish(Error(`KRig statistics HTTP ${response.statusCode}`));
          return;
        }
        let data = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          data += chunk;
          if (Buffer.byteLength(data) > 256 * 1024)
            request.destroy(Error("KRig statistics exceed size limit"));
        });
        response.on("error", finish);
        response.on("end", () => {
          try {
            finish(null, JSON.parse(data));
          } catch (_) {
            finish(Error("KRig statistics are not valid JSON"));
          }
        });
      },
    );
    request.on("error", finish);
  });
  return {
    promise,
    cancel: () => request?.destroy(Error("Statistics monitor closed")),
  };
}
function monitorKrig({
  port,
  algorithm,
  startedAt,
  onData,
  onError,
  now = Date.now,
  request = readStats,
  schedule = setTimeout,
  unschedule = clearTimeout,
}) {
  let closed = false,
    timer,
    pending,
    lastUptime = -1,
    lastWarning = 0;
  const safe = (callback, value) => {
    try {
      Promise.resolve(callback?.(value)).catch(() => {});
    } catch (_) {}
  };
  const poll = async () => {
    if (closed) return;
    const observedAt = new Date(now()).toISOString();
    try {
      pending = request(port);
      const body = await pending.promise;
      if (closed) return;
      const result = parseKrigStats(body, {
        algorithm,
        observedAt,
        elapsedSeconds: (now() - startedAt) / 1000,
      });
      if (result.uptime <= lastUptime)
        throw Error("KRig statistics uptime has not advanced");
      lastUptime = result.uptime;
      safe(onData, result.observation);
    } catch (error) {
      // Startup needs time to bind; report persistent API loss at most once/minute.
      if (
        !closed &&
        now() - startedAt >= 30000 &&
        (!lastWarning || now() - lastWarning >= 60000)
      ) {
        lastWarning = now();
        safe(onError, error);
      }
    } finally {
      pending = null;
      if (!closed) timer = schedule(poll, 10000);
    }
  };
  timer = schedule(poll, 1000);
  return {
    close() {
      closed = true;
      unschedule(timer);
      pending?.cancel();
    },
  };
}
module.exports = { chooseApiPort, parseKrigStats, readStats, monitorKrig };
