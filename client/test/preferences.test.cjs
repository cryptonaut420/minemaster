const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
test("unavailable browser preferences do not interrupt binding and telemetry startup", () => {
  const source = fs
    .readFileSync(path.join(__dirname, "../src/utils/preferences.js"), "utf8")
    .replace(/export /g, "");
  const preferences = vm.runInNewContext(
    `${source}; ({readPreference, writePreference})`,
    {
      localStorage: {
        getItem() {
          throw Error("Storage unavailable");
        },
        setItem() {
          throw Error("Quota exceeded");
        },
        removeItem() {
          throw Error("Storage unavailable");
        },
      },
    },
  );
  assert.equal(preferences.readPreference("master-server-bound"), null);
  assert.equal(
    preferences.writePreference("master-server-bound", "true"),
    false,
  );
  assert.equal(preferences.writePreference("master-server-bound", null), false);
});
