const { test } = require("node:test");
const assert = require("node:assert/strict");
const loadAssignment = async () => {
  const fs = require("fs"),
    path = require("path"),
    { pathToFileURL } = require("url");
  const source = fs
    .readFileSync(
      path.join(__dirname, "../src/utils/configAssignment.js"),
      "utf8",
    )
    .replace(
      "./miningConfig.js",
      pathToFileURL(path.join(__dirname, "../src/utils/miningConfig.js")).href,
    );
  return import(
    "data:text/javascript;base64," + Buffer.from(source).toString("base64")
  );
};
test("admin passwords remain admin-owned across revisions and persisted reconnect state", async () => {
  const { mergeAssignment } = await loadAssignment();
  let miner = { type: "xmrig", config: { engine: "nanominer", password: "" } };
  miner = mergeAssignment(miner, {
    engine: "nanominer",
    password: "first",
    version: "v1",
  });
  miner = mergeAssignment(JSON.parse(JSON.stringify(miner)), {
    engine: "nanominer",
    password: "second",
    version: "v2",
  });
  assert.equal(miner.config.password, "second");
  assert.deepEqual(miner.localOverrides, []);
  miner.config.password = "intentional-local";
  miner = mergeAssignment(miner, {
    engine: "nanominer",
    password: "third",
    version: "v3",
  });
  assert.equal(miner.config.password, "intentional-local");
  assert.deepEqual(miner.localOverrides, ["password"]);
});
test("admin CPU engine switches cannot carry an executable from the previous engine", async () => {
  const { mergeAssignment } = await loadAssignment();
  const result = mergeAssignment(
    {
      type: "xmrig",
      config: {
        engine: "xmrig",
        customPath: "C:/Custom/xmrig.exe",
        password: "local",
      },
    },
    {
      engine: "nanominer",
      algorithm: "rx/0",
      pool: "p:3333",
      user: "wallet",
      threads: 4,
    },
  );
  assert.equal(result.config.customPath, "");
  assert.equal(result.config.engine, "nanominer");
  assert.equal(result.config.threads, 4);
  assert.match(result.configNotice, /custom executable path was cleared/);
});
