const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("events");
const { createUpdateController } = require("../electron/updateController");
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("automatic installation waits for verified download settlement, stops once and hands off the exact version", async () => {
  const updater = new EventEmitter();
  let finishDownload,
    finishStop,
    installs = 0,
    stops = [];
  updater.quitAndInstall = () => installs++;
  updater.checkForUpdates = async () => {
    updater.emit("update-available", { version: "1.4.9" });
    return {
      downloadPromise: new Promise((resolve) => (finishDownload = resolve)),
    };
  };
  const c = createUpdateController({
    updater,
    stopMiners: (version) => {
      stops.push(version);
      return new Promise((resolve) => (finishStop = resolve));
    },
  });
  await c.checkForUpdates();
  updater.emit("update-downloaded", { version: "1.4.9" });
  await flush();
  assert.deepEqual(stops, []);
  finishDownload();
  await flush();
  assert.deepEqual(stops, ["1.4.9"]);
  assert.equal(installs, 0);
  assert.equal(c.getState().state, "installing");
  assert.equal(c.getState().autoInstall, true);
  assert.equal((await c.install("1.4.9")).success, false);
  finishStop();
  await flush();
  assert.equal(installs, 1);
  c.cleanup();
});

test("cached completion during a check installs only after the check settles", async () => {
  const updater = new EventEmitter();
  let finishCheck,
    stops = 0,
    installs = 0;
  updater.quitAndInstall = () => installs++;
  updater.checkForUpdates = () => {
    updater.emit("update-downloaded", { version: "1.4.9" });
    return new Promise((resolve) => (finishCheck = resolve));
  };
  const c = createUpdateController({
    updater,
    stopMiners: async () => stops++,
  });
  const checking = c.checkForUpdates();
  await flush();
  assert.equal(stops, 0);
  finishCheck({ downloadPromise: Promise.resolve([]) });
  await checking;
  await flush();
  assert.equal(stops, 1);
  assert.equal(installs, 1);
  c.cleanup();
});

test("automatic stop failure and repeated completion do not form an install loop; explicit retry works", async () => {
  const updater = new EventEmitter();
  let blocked = true,
    stops = 0,
    installs = 0,
    released = 0;
  updater.quitAndInstall = () => installs++;
  const c = createUpdateController({
    updater,
    stopMiners: async () => {
      stops++;
      if (blocked) throw Error("PID still alive");
    },
    releaseStarts: () => released++,
  });
  updater.emit("update-downloaded", { version: "1.4.9" });
  await flush();
  assert.equal(stops, 1);
  assert.equal(installs, 0);
  assert.equal(released, 1);
  assert.match(c.getState().message, /PID still alive/);
  updater.emit("update-downloaded", { version: "1.4.9" });
  await flush();
  assert.equal(stops, 1);
  assert.match(c.getState().message, /paused/);
  blocked = false;
  assert.equal((await c.install("1.4.9")).success, true);
  assert.equal(installs, 1);
  c.cleanup();
});

test("canceling automatic preparation prevents handoff and same-version automatic retry", async () => {
  const updater = new EventEmitter();
  let finish,
    installed = 0,
    released = 0;
  updater.quitAndInstall = () => installed++;
  const c = createUpdateController({
    updater,
    stopMiners: () => new Promise((resolve) => (finish = resolve)),
    releaseStarts: () => released++,
  });
  updater.emit("update-downloaded", { version: "1.4.9" });
  await flush();
  assert.equal(c.cancelInstall().success, true);
  finish();
  await flush();
  assert.equal(installed, 0);
  assert.equal(released, 1);
  updater.emit("update-downloaded", { version: "1.4.9" });
  await flush();
  assert.equal(c.getState().state, "downloaded");
  assert.match(c.getState().message, /paused/);
  c.cleanup();
});

test("failed download, unsupported package and shutdown never auto-install", async () => {
  for (const scenario of ["download failure", "unsupported", "shutdown"]) {
    const updater = new EventEmitter();
    let rejectDownload,
      installs = 0,
      stops = 0;
    updater.quitAndInstall = () => installs++;
    updater.checkForUpdates = async () => ({
      downloadPromise: new Promise((_, reject) => (rejectDownload = reject)),
    });
    const c = createUpdateController({
      updater,
      supported: () => scenario !== "unsupported",
      stopMiners: async () => stops++,
    });
    if (scenario === "download failure") await c.checkForUpdates();
    updater.emit("update-downloaded", { version: "1.4.9" });
    if (scenario === "download failure")
      rejectDownload(Error("checksum failed"));
    if (scenario === "shutdown") c.cleanup();
    await flush();
    assert.equal(stops, 0, scenario);
    assert.equal(installs, 0, scenario);
    c.cleanup();
  }
});
