const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

// Read process identity without running a miner. Only managed SRBMiner instances
// with this profile's exact per-slot log argument can be reclaimed. A name check
// comes first so stopping XMRig or Nanominer does not walk every process under load.
const shell = (body) => String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$WarningPreference = 'SilentlyContinue'
try {
  $OutputEncoding = New-Object System.Text.UTF8Encoding $false
  [Console]::OutputEncoding = $OutputEncoding
} catch {}
try {
${body}
} catch {
  Write-Output ('ERROR ' + $_.Exception.Message)
  exit 1
}
`;
const QUERY = shell(String.raw`
  try {
    $procs = @(Get-Process -Name 'SRBMiner-MULTI' -ErrorAction Stop)
  } catch {
    if ($_.FullyQualifiedErrorId -notlike 'NoProcessFoundForGivenName*') { throw }
    $procs = @()
  }
  if ($procs.Count -eq 0) { Write-Output '[]'; exit 0 }
  $ids = @($procs | ForEach-Object { [int]$_.Id } | Where-Object { $_ -ge 2 })
  if ($ids.Count -eq 0) { throw 'Miner process id is unusable' }
  $filter = ($ids | ForEach-Object { 'ProcessId=' + $_ }) -join ' OR '
  $rows = @(Get-CimInstance Win32_Process -Filter $filter | ForEach-Object {
    if ($_.Name -ne 'SRBMiner-MULTI.exe') { return }
    $created = $null
    if ($null -ne $_.CreationDate) { $created = $_.CreationDate.ToUniversalTime().ToString('o') }
    @{ pid = [int]$_.ProcessId; executable = [string]$_.ExecutablePath; command = [string]$_.CommandLine; created = $created }
  })
  if ($rows.Count -eq 0) { Write-Output '[]' }
  elseif ($rows.Count -eq 1) { Write-Output ('[' + (ConvertTo-Json -InputObject $rows[0] -Compress) + ']') }
  else { Write-Output (ConvertTo-Json -InputObject $rows -Compress) }
`);
const STOP = shell(String.raw`
  $target = $env:MINEMASTER_PROCESS_IDENTITY | ConvertFrom-Json
  $p = Get-CimInstance Win32_Process -Filter ("ProcessId = " + [int]$target.pid)
  if ($null -eq $p) { exit 0 }
  if ($p.ExecutablePath -cne $target.executable -or $p.CommandLine -cne $target.command -or $p.CreationDate.ToUniversalTime().ToString('o') -cne $target.created) {
    throw 'Process identity changed; refusing to stop a reused PID'
  }
  $result = Invoke-CimMethod -InputObject $p -MethodName Terminate
  if ($result.ReturnValue -ne 0) { throw ('Could not stop managed miner: ' + $result.ReturnValue) }
`);
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
        if (i < command.length && (quoted || !/\s/.test(command[i])))
          value += command[i++];
      }
    }
    args.push(value);
  }
  return args;
}
const norm = (p) => path.win32.normalize(p).toLowerCase();
function outputText(value) {
  const buf = Buffer.isBuffer(value)
    ? value
    : Buffer.from(String(value || ""), "utf8");
  const utf16 =
    (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) ||
    (buf.length >= 4 && buf[1] === 0 && buf[3] === 0);
  return (utf16 ? buf.toString("utf16le") : buf.toString("utf8")).replace(
    /^\uFEFF/,
    "",
  );
}
function parseInventory(stdout) {
  const text = outputText(stdout).trim();
  if (/^ERROR\b/i.test(text))
    throw Error(
      text.replace(/^ERROR\s*/i, "").trim() || "Invalid process inventory",
    );
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end < start) throw Error("Invalid process inventory");
  const rows = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(rows)) throw Error("Invalid process inventory");
  return rows;
}
function xmlText(value) {
  return value
    .replace(/_x000D__x000A_/g, " ")
    .replace(/_x000A_/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}
function commandFailure(error) {
  if (error?.killed || error?.signal)
    return "The Windows process check timed out before it could list miner processes.";
  if (error?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER")
    return "The Windows process list was truncated before it could be verified.";
  const stdout = outputText(error?.stdout);
  const stderr = outputText(error?.stderr);
  const errorLine = stdout.match(/^ERROR (.*)$/m)?.[1]?.trim();
  const xml = stderr.match(/<S N="Message">([\s\S]*?)<\/S>/)?.[1];
  const cleaned = String(error?.message || "")
    .replace(/Command failed:[\s\S]*/i, "")
    .replace(/#<\s*CLIXML[\s\S]*/g, "")
    .trim();
  return (
    errorLine ||
    (xml ? xmlText(xml) : "") ||
    cleaned ||
    "Windows could not list miner processes."
  ).slice(0, 500);
}
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
  // Windows' resolved ExecutablePath establishes the image identity. argv[0]
  // can legitimately be just a basename on a miner-owned restart.
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
    try {
      return await run(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-EncodedCommand",
          Buffer.from(script, "utf16le").toString("base64"),
        ],
        {
          windowsHide: true,
          timeout: 15000,
          maxBuffer: 64 * 1024,
          encoding: "buffer",
          env: {
            ...process.env,
            ...(identity
              ? { MINEMASTER_PROCESS_IDENTITY: JSON.stringify(identity) }
              : {}),
          },
        },
      );
    } catch (error) {
      throw Object.assign(Error(commandFailure(error)), {
        code: "PROCESS_INVENTORY_UNAVAILABLE",
      });
    }
  }
  async function find(id, excludePid) {
    if (platform !== "win32") return [];
    let failure;
    // One retry covers a process that is exiting or a brief WMI stall. CPU and
    // GPU slots share this check because either slot can still hold SRBMiner.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { stdout } = await execute(QUERY);
        const rows = parseInventory(stdout);
        // Do not mistake unreadable same-name processes for proof that no orphan
        // exists. No unreadable process is ever eligible for termination.
        if (rows.some((r) => !r.executable || !r.command || !r.created))
          throw Error("A miner process identity is unreadable");
        return rows.filter(
          (r) => r.pid !== excludePid && matches(r, userData, id),
        );
      } catch (error) {
        failure = error;
        if (attempt === 0) await wait(200);
      }
    }
    throw Object.assign(
      Error(
        `Could not verify existing Windows miner processes: ${failure.message}`,
      ),
      { code: "PROCESS_INVENTORY_UNAVAILABLE" },
    );
  }
  async function stop(id, excludePid) {
    const rows = await find(id, excludePid);
    // Nothing managed is running. Do not repeat the list while confirming it.
    if (!rows.length) return;
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
