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
      assert.equal(options.timeout, 15000);
      const script = Buffer.from(args.at(-1), "base64").toString("utf16le");
      assert.match(script, /\$ProgressPreference = 'SilentlyContinue'/);
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
  assert.match(calls[0], /Get-Process -Name 'SRBMiner-MULTI'/);
});
test("a failed Windows process list stays fail-closed without echoing the command", async () => {
  const error = Object.assign(
    Error(
      "Command failed: powershell.exe -NoProfile -NonInteractive -EncodedCommand AAAA\n#< CLIXML",
    ),
    {
      stderr: `#< CLIXML\n<Objs><S N="Message">The host does not support progress</S></Objs>`,
    },
  );
  const guard = createOrphanProcesses({
    userData,
    platform: "win32",
    wait: async () => {},
    run: async () => {
      throw error;
    },
  });
  await assert.rejects(guard.find("xmrig-1"), (failure) => {
    assert.match(failure.message, /host does not support progress/);
    assert.doesNotMatch(failure.message, /EncodedCommand|CLIXML/);
    assert.equal(failure.code, "PROCESS_INVENTORY_UNAVAILABLE");
    return true;
  });
  const timed = createOrphanProcesses({
    userData,
    platform: "win32",
    wait: async () => {},
    run: async () => {
      throw Object.assign(Error("Command failed: powershell.exe\n#< CLIXML"), {
        killed: true,
        signal: "SIGTERM",
        stderr: "#< CLIXML",
      });
    },
  });
  await assert.rejects(timed.find("nanominer-1"), (failure) => {
    assert.match(
      failure.message,
      /timed out before it could list miner processes/,
    );
    assert.doesNotMatch(failure.message, /EncodedCommand|CLIXML/);
    return true;
  });
});
test("unknown process identity and enumeration failure fail closed without termination", async () => {
  for (const run of [
    async () => ({ stdout: JSON.stringify([{ ...row, command: "" }]) }),
    async () => {
      throw Error("timeout");
    },
  ]) {
    const guard = createOrphanProcesses({
      userData,
      platform: "win32",
      wait: async () => {},
      run,
    });
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

test("CPU and GPU stops list Windows miners once when none match, including UTF-16 output", async () => {
  let calls = 0;
  const guard = createOrphanProcesses({
    userData,
    platform: "win32",
    run: async () => {
      calls++;
      return { stdout: Buffer.from("[]\n", "utf16le") };
    },
  });
  await guard.stop("xmrig-1");
  await guard.stop("nanominer-1");
  assert.equal(calls, 2);
  assert.deepEqual(await guard.find("xmrig-1"), []);
});
test("a transient Windows process-list failure is retried once and then accepted", async () => {
  let calls = 0;
  const guard = createOrphanProcesses({
    userData,
    platform: "win32",
    wait: async () => {},
    run: async () => {
      calls++;
      if (calls === 1)
        throw Object.assign(Error("Command failed: powershell.exe\n#< CLIXML"), {
          stderr: "#< CLIXML",
          killed: true,
        });
      return {
        stdout: Buffer.concat([
          Buffer.from([0xff, 0xfe]),
          Buffer.from("[]", "utf16le"),
        ]),
      };
    },
  });
  assert.deepEqual(await guard.find("nanominer-1"), []);
  assert.equal(calls, 2);
});
test("miner-owned restart may use a basename argv while resolved image and slot path still match", () => {
  const restarted = {
    ...row,
    command: row.command.replace(`"${row.executable}"`, "SRBMiner-MULTI.exe"),
  };
  assert.equal(matches(restarted, userData, "nanominer-1"), true);
  assert.equal(
    matches(
      { ...restarted, executable: "C:\\Other\\SRBMiner-MULTI.exe" },
      userData,
      "nanominer-1",
    ),
    false,
  );
  assert.equal(
    matches(
      {
        ...restarted,
        command: restarted.command.replace("nanominer-1", "xmrig-1"),
      },
      userData,
      "nanominer-1",
    ),
    false,
  );
});

test("unquoted trailing backslashes do not swallow the next Windows argument", () => {
  assert.deepEqual(
    argumentsOf('miner.exe C:\\cache\\ --log-file "C:\\rig path\\miner.log"'),
    ["miner.exe", "C:\\cache\\", "--log-file", "C:\\rig path\\miner.log"],
  );
});
