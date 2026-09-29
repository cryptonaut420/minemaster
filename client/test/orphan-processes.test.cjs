const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  createOrphanProcesses,
  matches,
  argumentsOf,
} = require("../electron/mining/orphanProcesses");
const userData = "C:\\Users\\Rig Owner\\AppData\\Roaming\\minemaster-client";
const row = {
  pid: 1234,
  executable: userData + "\\miners\\srbminer\\3.6.7\\SRBMiner-MULTI.exe",
  created: "2026-09-29T13:00:00.0000000Z",
};
row.command = `"${row.executable}" --algorithm quantus --log-file "${userData}\\processes\\nanominer-1\\miner.log" --log-file-mode 0`;
test("orphan ownership requires exact managed executable, slot and log argument", () => {
  assert.equal(matches(row, userData, "nanominer-1"), true);
  assert.equal(matches(row, userData, "xmrig-1"), false);
  assert.equal(matches(row, userData + "-other", "nanominer-1"), false);
  assert.equal(
    matches(
      { ...row, executable: "C:\\Other\\SRBMiner-MULTI.exe" },
      userData,
      "nanominer-1",
    ),
    false,
  );
  assert.equal(
    matches(
      { ...row, command: row.command.replace("--log-file ", "--comment ") },
      userData,
      "nanominer-1",
    ),
    false,
  );
  assert.equal(
    matches(
      { ...row, command: row.command + ' --log-file "C:\\other.log"' },
      userData,
      "nanominer-1",
    ),
    false,
  );
  assert.equal(
    matches({ ...row, created: "" }, userData, "nanominer-1"),
    false,
  );
  assert.deepEqual(
    argumentsOf('"C:\\Rig Owner\\miner.exe" --x "hello world"'),
    ["C:\\Rig Owner\\miner.exe", "--x", "hello world"],
  );
});
test("Windows cleanup revalidates the complete identity and verifies exit; unrelated processes survive", async () => {
  let rows = [
    row,
    {
      ...row,
      pid: 456,
      command: row.command.replace("nanominer-1", "xmrig-1"),
    },
  ];
  const calls = [];
  const guard = createOrphanProcesses({
    userData,
    platform: "win32",
    run: async (exe, args, options) => {
      assert.equal(exe, "powershell.exe");
      assert.equal(options.timeout, 10000);
      const script = Buffer.from(args.at(-1), "base64").toString("utf16le");
      calls.push(script);
      if (options.env.MINEMASTER_PROCESS_IDENTITY) {
        assert.match(script, /CreationDate/);
        assert.match(script, /CommandLine -cne/);
        const target = JSON.parse(options.env.MINEMASTER_PROCESS_IDENTITY);
        assert.deepEqual(target, row);
        rows = rows.filter((r) => r.pid !== target.pid);
      }
      return { stdout: JSON.stringify(rows) };
    },
  });
  assert.deepEqual(await guard.find("nanominer-1", 1234), []);
  await guard.stop("nanominer-1");
  assert.deepEqual(
    rows.map((r) => r.pid),
    [456],
  );
  assert.equal(calls.filter((s) => s.includes("Invoke-CimMethod")).length, 1);
});
test("unknown process identity and enumeration failure fail closed without termination", async () => {
  for (const run of [
    async () => ({ stdout: JSON.stringify([{ ...row, command: "" }]) }),
    async () => {
      throw Error("timeout");
    },
  ]) {
    const guard = createOrphanProcesses({ userData, platform: "win32", run });
    await assert.rejects(guard.find("nanominer-1"), /Could not verify/);
  }
  const other = createOrphanProcesses({
    userData,
    platform: "linux",
    run: () => {
      throw Error("must not run");
    },
  });
  assert.deepEqual(await other.find("nanominer-1"), []);
});
