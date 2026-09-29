const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

// Read process identity without running a miner. Only managed SRBMiner instances
// with this profile's exact per-slot log argument can be reclaimed.
const QUERY = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$rows = @(Get-CimInstance Win32_Process -Filter "Name = 'SRBMiner-MULTI.exe'" | ForEach-Object {
  @{ pid = [int]$_.ProcessId; executable = [string]$_.ExecutablePath; command = [string]$_.CommandLine; created = $_.CreationDate.ToUniversalTime().ToString('o') }
})
ConvertTo-Json -InputObject $rows -Compress
`;
const STOP = String.raw`
$ErrorActionPreference = 'Stop'
$target = $env:MINEMASTER_PROCESS_IDENTITY | ConvertFrom-Json
$p = Get-CimInstance Win32_Process -Filter ("ProcessId = " + [int]$target.pid)
if ($null -eq $p) { exit 0 }
if ($p.ExecutablePath -cne $target.executable -or $p.CommandLine -cne $target.command -or $p.CreationDate.ToUniversalTime().ToString('o') -cne $target.created) {
  throw 'Process identity changed; refusing to stop a reused PID'
}
$result = Invoke-CimMethod -InputObject $p -MethodName Terminate
if ($result.ReturnValue -ne 0) { throw ('Could not stop managed miner: ' + $result.ReturnValue) }
`;
// Windows CommandLineToArgvW quoting rules for backslashes preceding quotes.
function argumentsOf(command) {
  const args = [];
  let i = 0;
  while (i < command.length) {
    while (/\s/.test(command[i] || "") && i < command.length) i++;
    if (i === command.length) break;
    let value = "",
      quoted = false;
    while (i < command.length && (quoted || !/\s/.test(command[i]))) {
      let slashes = 0;
      while (command[i] === "\\") {
        slashes++;
        i++;
      }
      if (command[i] === '"') {
        value += "\\".repeat(Math.floor(slashes / 2));
        if (slashes % 2) value += '"';
        else quoted = !quoted;
        i++;
      } else {
        value += "\\".repeat(slashes);
        if (i < command.length) value += command[i++];
      }
    }
    args.push(value);
  }
  return args;
}
const norm = (p) => path.win32.normalize(p).toLowerCase();
function matches(row, userData, id) {
  if (
    !Number.isInteger(row.pid) ||
    row.pid < 2 ||
    !row.created ||
    !row.executable ||
    !row.command ||
    !["xmrig-1", "nanominer-1"].includes(id)
  )
    return false;
  const root = path.win32.join(userData, "miners", "srbminer");
  const relative = path.win32.relative(root, row.executable);
  if (!/^\d+\.\d+\.\d+\\SRBMiner-MULTI\.exe$/i.test(relative)) return false;
  const args = argumentsOf(row.command);
  if (norm(args[0] || "") !== norm(row.executable)) return false;
  const indices = args.flatMap((arg, i) => (arg === "--log-file" ? [i] : []));
  return (
    indices.length === 1 &&
    norm(args[indices[0] + 1] || "") ===
      norm(path.win32.join(userData, "processes", id, "miner.log"))
  );
}
function createOrphanProcesses({
  userData,
  platform = process.platform,
  run = promisify(execFile),
  wait = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  async function execute(script, identity) {
    return run(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ],
      {
        windowsHide: true,
        timeout: 10000,
        maxBuffer: 256 * 1024,
        env: {
          ...process.env,
          ...(identity
            ? { MINEMASTER_PROCESS_IDENTITY: JSON.stringify(identity) }
            : {}),
        },
      },
    );
  }
  async function find(id, excludePid) {
    if (platform !== "win32") return [];
    try {
      const { stdout } = await execute(QUERY);
      const rows = JSON.parse(stdout.replace(/^\uFEFF/, ""));
      if (!Array.isArray(rows)) throw Error("Invalid process inventory");
      // Do not mistake unreadable same-name processes for proof that no orphan
      // exists. No unreadable process is ever eligible for termination.
      if (rows.some((r) => !r.executable || !r.command || !r.created))
        throw Error("A miner process identity is unreadable");
      return rows.filter(
        (r) => r.pid !== excludePid && matches(r, userData, id),
      );
    } catch (error) {
      throw Object.assign(
        Error(
          `Could not verify existing Windows miner processes: ${error.message}`,
        ),
        { code: "PROCESS_INVENTORY_UNAVAILABLE" },
      );
    }
  }
  async function stop(id, excludePid) {
    const rows = await find(id, excludePid);
    for (const row of rows) await execute(STOP, row);
    for (let i = 0; i < 10; i++) {
      if (!(await find(id, excludePid)).length) return;
      await wait(200);
    }
    throw Error("A managed SRBMiner process is still running after Stop");
  }
  return { find, stop };
}
module.exports = { createOrphanProcesses, matches, argumentsOf };
