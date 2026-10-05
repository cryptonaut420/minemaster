const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const helpers = import(
  "data:text/javascript;base64," +
    fs
      .readFileSync(path.join(__dirname, "../public/src/utils/fleetViews.js"))
      .toString("base64")
);

test("fleet quick views preserve rig group/search and sorting while resetting incompatible state filters", async () => {
  const { changeQuery, clearFilters, fleetViews } = await helpers;
  const original = new URLSearchParams(
    "q=PG&group=North&status=offline&attention=false&sort=name&order=desc&includeArchived=true",
  );
  const attention = fleetViews.find((v) => v.label === "Needs attention");
  const next = changeQuery(original, {
    status: attention.status,
    attention: attention.attention,
  });
  assert.equal(next.get("status"), null);
  assert.equal(next.get("attention"), "true");
  assert.equal(next.get("group"), "North");
  assert.equal(next.get("q"), "PG");
  assert.equal(next.get("order"), "desc");
  assert.equal(
    original.get("status"),
    "offline",
    "query snapshots are not mutated",
  );
  assert.equal(clearFilters(next).toString(), "sort=name&order=desc");
});

test("broken or unavailable browser preferences never prevent opening the fleet", async () => {
  const { readViews, readColumns, storePreference } = await helpers;
  const broken = {
    getItem() {
      throw Error("Storage disabled");
    },
    setItem() {
      throw Error("Full");
    },
  };
  assert.deepEqual(readViews(broken), []);
  assert.deepEqual(readColumns(broken), {});
  assert.equal(storePreference(broken, "view", []), false);
  for (const value of [
    "null",
    "{}",
    "17",
    "not json",
    '[null,3,{"name":"bad"}]',
  ]) {
    const storage = { getItem: () => value };
    assert.deepEqual(readViews(storage), []);
    assert.notEqual(readColumns(storage), null);
  }
  const storage = {
    getItem: () =>
      '[null,{"name":"North","query":"group=North"},{"name":"Bad","query":null}]',
  };
  assert.deepEqual(readViews(storage), [
    { name: "North", query: "group=North" },
  ]);
});
