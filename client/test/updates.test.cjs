const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("events");
const { createUpdateController } = require("../electron/updateController");
test("downloaded app updates wait for explicit installation and retain their metadata", async () => {
  const updater = new EventEmitter();
  let installed = 0,
    stopped = 0;
  updater.quitAndInstall = () => installed++;
  const controller = createUpdateController({
    updater,
    stopMiners: async () => {
      stopped++;
    },
  });
  updater.emit("update-downloaded", { version: "2.0.0" });
  assert.equal(installed, 0);
  assert.equal(controller.getState().version, "2.0.0");
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal((await controller.install()).success, true);
  assert.equal(stopped, 1);
  assert.equal(installed, 1);
  controller.cleanup();
  assert.equal(updater.listenerCount("update-downloaded"), 0);
});
test("failed stop prevents installing and keeps a downloaded update available for retry", async () => {
  const updater = new EventEmitter();
  let installed = false,
    released = false;
  updater.quitAndInstall = () => (installed = true);
  const c = createUpdateController({
    updater,
    stopMiners: async () => {
      throw Error("PID remains alive");
    },
    releaseStarts: () => (released = true),
  });
  updater.emit("update-downloaded", { version: "2.0.0" });
  assert.equal((await c.install()).success, false);
  assert.equal(installed, false);
  assert.equal(released, true);
  assert.equal(c.getState().state, "downloaded");
});
test("asynchronous update failures are handled and concurrent checks share a single request", async () => {
  const updater = new EventEmitter();
  let calls = 0,
    reject;
  updater.checkForUpdates = () => {
    calls++;
    return new Promise((_, r) => (reject = r));
  };
  const c = createUpdateController({ updater });
  const a = c.checkForUpdates(),
    b = c.checkForUpdates();
  reject(Error("network down"));
  assert.equal((await a).success, false);
  assert.equal((await b).success, false);
  assert.equal(calls, 1);
});
