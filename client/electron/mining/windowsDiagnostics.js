const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

// Read-only, explicit diagnostics. Paths are environment data, never PowerShell code.
const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$targets = @($env:MINEMASTER_DIAGNOSTIC_PATHS | ConvertFrom-Json)
$result = @{ status = 'unavailable'; detections = @(); signatureStatus = $null }
try {
  if (Test-Path -LiteralPath $targets[0] -PathType Leaf) {
    $result.signatureStatus = [string](Get-AuthenticodeSignature -LiteralPath $targets[0]).Status
  }
} catch {}
try {
  $detections = @(Get-MpThreatDetection -ErrorAction Stop | Where-Object {
    $matching = $false
    foreach ($resource in $_.Resources) {
      $file = ([string]$resource) -replace '^file:_', ''
      if ($targets -contains $file) { $matching = $true }
    }
    $matching
  } | Sort-Object InitialDetectionTime -Descending | Select-Object -First 5)
  $result.detections = @($detections | ForEach-Object {
    $detection = $_
    $name = [string]$detection.ThreatID
    try { $name = [string](Get-MpThreat -ThreatID $detection.ThreatID -ErrorAction Stop | Select-Object -First 1).ThreatName } catch {}
    $resource = @($detection.Resources | ForEach-Object { ([string]$_) -replace '^file:_', '' } | Where-Object { $targets -contains $_ } | Select-Object -First 1)[0]
    @{
      threatName = $name
      resource = $resource
      detectedAt = if ($detection.InitialDetectionTime) { $detection.InitialDetectionTime.ToUniversalTime().ToString('o') } else { $null }
      actionSuccess = $detection.ActionSuccess
    }
  })
  $result.status = 'available'
} catch {}
ConvertTo-Json -InputObject $result -Depth 5 -Compress
`;
const normalizePath = (value) =>
  path.win32.normalize(String(value || "")).toLowerCase();
function normalizeResult(raw, targets, now = Date.now()) {
  const paths = new Set(targets.map(normalizePath));
  const available = raw?.status === "available";
  return {
    status: available ? "available" : "unavailable",
    checkedAt: new Date(now).toISOString(),
    signatureStatus:
      typeof raw?.signatureStatus === "string"
        ? raw.signatureStatus.slice(0, 80)
        : null,
    detections: (Array.isArray(raw?.detections) ? raw.detections : [])
      .filter((d) => d && paths.has(normalizePath(d.resource)))
      .slice(0, 5)
      .map((d) => ({
        threatName: String(d.threatName || "Unknown detection").slice(0, 200),
        resource: String(d.resource).slice(0, 1000),
        detectedAt: Number.isFinite(Date.parse(d.detectedAt))
          ? new Date(d.detectedAt).toISOString()
          : null,
        actionSuccess:
          typeof d.actionSuccess === "boolean" ? d.actionSuccess : null,
      })),
    message: available
      ? "Matching Defender history only. Past detections do not prove a current block; no matches do not rule out Smart App Control, device policy or another antivirus."
      : "Windows detection history is unavailable to this account. Inspect Protection History or ask the device administrator; no protection settings were changed.",
  };
}
function createWindowsDiagnostics({
  platform = process.platform,
  run = promisify(execFile),
  now = Date.now,
} = {}) {
  const pending = new Map(),
    cache = new Map();
  return async (targets) => {
    if (platform !== "win32") return null;
    const selected = [
      ...new Set(
        targets.filter(
          (p) => typeof p === "string" && path.win32.isAbsolute(p),
        ),
      ),
    ].slice(0, 6);
    if (!selected.length) return normalizeResult(null, [], now());
    const key = selected.map(normalizePath).join("\n");
    if (cache.has(key) && now() - cache.get(key).at < 30000)
      return cache.get(key).value;
    if (pending.has(key)) return pending.get(key);
    const task = (async () => {
      let raw;
      try {
        const executable = path.win32.join(
          process.env.SystemRoot || "C:\\Windows",
          "System32",
          "WindowsPowerShell",
          "v1.0",
          "powershell.exe",
        );
        const { stdout } = await run(
          executable,
          ["-NoProfile", "-NonInteractive", "-Command", SCRIPT],
          {
            timeout: 10000,
            maxBuffer: 128 * 1024,
            windowsHide: true,
            env: {
              ...process.env,
              MINEMASTER_DIAGNOSTIC_PATHS: JSON.stringify(selected),
            },
          },
        );
        raw = JSON.parse(stdout.replace(/^\uFEFF/, "").trim());
      } catch (_) {}
      const value = normalizeResult(raw, selected, now());
      if (cache.size >= 16) cache.clear();
      cache.set(key, { at: now(), value });
      return value;
    })();
    pending.set(key, task);
    try {
      return await task;
    } finally {
      pending.delete(key);
    }
  };
}
module.exports = { createWindowsDiagnostics, normalizeResult, SCRIPT };
