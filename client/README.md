# MineMaster desktop client 1.3

MineMaster manages a selectable Nanominer/XMRig CPU process and an independent Nanominer GPU process, reports their actual state to the admin, and accepts acknowledged remote commands. Miner registration and reporting do not need an API key. Reading/managing the fleet through REST requires a read/manage key or admin session; see [the backend contract](../docs/backend-admin.md).

## Install and build

Use Node 20 or later for development and the checked-in dependency lockfile.

```bash
cd client
npm ci --legacy-peer-deps
npm start
```

Dependency installation runs verified miner setup for the host platform. To fetch explicitly:

```bash
npm run setup
npm run setup -- --all                         # Linux x64 and Windows x64
npm run setup -- --platform darwin --arch arm64
npm test                                      # Fake processes, no mining
npm run build                                 # Renderer only
npm run build:linux                           # AppImage
npm run build:windows-installer                # NSIS
npm run build:windows                         # Portable Windows
npm run build:mac                             # macOS x64 and arm64
```

Packaging runs `scripts/prepare-miners.js` for the actual target platform and architecture, including cross builds. Missing downloads, failed checksums, unsupported targets and extraction failures stop the build. Windows extraction requires the native `tar.exe` present on supported Windows 10/11 systems. Unix hosts use `tar` and `unzip`. Windows packaging on Linux still needs the existing Wine/container build environment. macOS packaging needs a macOS builder.

Current pinned releases, verified September 13, 2026:

- [XMRig 6.26.0](https://github.com/xmrig/xmrig/releases/tag/v6.26.0): Linux static x64, Windows x64, macOS x64 and arm64. The static Linux build avoids depending on Ubuntu Noble's particular glibc version.
- [Nanominer 3.10.0](https://github.com/nanopool/nanominer/releases/tag/v3.10.0): Linux x64 and Windows x64. Nanominer does not ship a macOS build in this release.

Versions, official URLs, archive SHA-256 and extracted runtime-file SHA-256 values live in `electron/mining/releases.json`. XMRig executable hashes were derived from the checksum-verified upstream archives; Nanominer publishes executable hashes too. Upstream license files included in the archives are retained. [XMRig's source and license](https://github.com/xmrig/xmrig/tree/v6.26.0) accompany its release.

Binaries stay outside Git under `miners/linux-x64`, `miners/win-x64`, `miners/mac-x64` or `miners/mac-arm64`. Old unversioned `miners/xmrig` and `miners/nanominer` directories are no longer packaged or executed automatically.

## CPU engine selection

New Windows/Linux profiles default to **Nanominer for Monero/RandomX**. Existing saved configurations without an engine keep XMRig; explicit choices are preserved. macOS remains XMRig because the pinned Nanominer release has no macOS build. Stop CPU mining, open its **CPU engine, pools and recovery** section, and choose the engine. The admin Configs page exposes the same choice; save a revision and explicitly apply it to selected rigs.

Nanominer can run twice on the same machine: one CPU-only `[RandomX]` process and one GPU-only algorithm process. They share the verified executable but have separate PIDs, working directories, configs, logs, hashrates and start/stop controls. A CPU stop does not stop GPU mining. Stop **both** before repairing their shared Nanominer files. Starts, installation and repair coordinate across processes using the same engine.

Nanominer RandomX has a **2% developer fee**. Its CPU thread count is explicit `threads` (capped at available logical cores), or `floor(logical cores × threadPercentage / 100)` with a minimum of one. Effective threads appear in desktop/admin/API process details. XMRig remains available for its more extensive CPU controls and minimum 1% donation. Compare actual accepted work and power on your hardware; this audit did not benchmark either engine. Nanominer CPU supports `rx/0`, pool failover and bounded crash recovery. Priority, activity/battery pauses, disabling huge pages, strict TLS, keepalive and additional command-line options are XMRig-only here; incompatible nondefault settings are rejected, and the forms show engine-specific controls.

CPU configuration retains the legacy API key `xmrig` and process ID `xmrig-1` for compatibility. `xmrig.engine` selects `nanominer` or `xmrig`; these legacy names do not identify the running executable. Desktop 1.3 advertises `capabilities.cpuEngines`. The server withholds Nanominer CPU configuration from unsupported agents and rejects dependent launch/config commands with 422. Upgrade those agents or select XMRig. GPU settings and registration/reporting remain available.

## Daily operation

- Start/stop CPU and GPU independently from the overview. Disabling a process stops it first; a failed stop leaves it enabled and tracked.
- Each process shows fresh, zero, missing, stale or intentionally paused hashrate, its engine version, uptime, file diagnostics and pending settings. CPU and GPU rates are never added together.
- The detail view shows active algorithm, pool connectivity observations, accepted/rejected XMRig share counters and configuration differences. Logs support filtering, pausing the view and saving the displayed text.
- `Check miner files` reads and verifies files. `Repair` restores the pinned upstream files while every process using that engine is stopped, using the bundled copy when possible and downloading the pinned official release when necessary. Repair cancels pending crash recovery and does not start mining. Clear a custom executable selection before repairing the managed engine.
- Closing MineMaster stops its owned processes first. If the operating system refuses the stop, the app stays open with the failure. Only one MineMaster instance may run for each user-data profile.

The process controller tracks PIDs and process generations, waits for confirmed exits, owns POSIX process groups/Windows child trees, and serializes start/stop/repair. It does not kill unrelated miners by executable name. A stop also cancels a pending automatic crash restart.

## Configuration and performance

Admin revisions supply the desired configuration. A running process keeps the immutable configuration used at launch; restart it to apply changes. Nonempty local pool-password/rig-name/custom-path selections and explicit legacy GPU-index selections remain visible as overrides. The global GPU configuration applies to the whole Nanominer process.

Available XMRig CPU fields include `threadPercentage` (10–100), `threads` (0 = automatic), `cpuPriority` (0–5), `hugePages`, `pauseOnBattery`, `pauseOnActive` (idle seconds, 0 disables), `tls`, `keepAlive` and up to three `backupPools`. Explicit `threads` takes precedence over the automatic thread budget. XMRig's thread budget is a tuning hint, not a guarantee that Windows Task Manager reports that CPU percentage. Priority defaults to idle and yielding remains enabled to keep the machine responsive.

For XMRig, huge pages are used when available. **MSR read/write tuning is disabled and the optional kernel drivers are not installed by MineMaster.** This reduces driver dependencies and avoids making normal CPU mining depend on a blocked driver. It can lower peak RandomX throughput compared with a successfully tuned MSR setup. MineMaster does not change OS huge-page allocation, drivers, protection settings, or administrator privileges. The old `enable-msr.sh` helper is not part of this workflow and should not be used as a repair step. The official XMRig build enforces at least a 1% developer donation.

Both engines support a primary pool plus up to three backup pool addresses with the same wallet/user credentials. Nanominer addresses must use host:port without URL schemes; its upstream default negotiates SSL with plaintext fallback. The XMRig CPU form retains additional arguments for compatible upstream options; process-detaching, config/pool/algorithm/CPU-limit overrides, alternative GPU backends and background web APIs are rejected because they break tracked configuration or process ownership.

Nanominer excludes developer-work shares from its own counters (`countDevShares=false`); MineMaster currently leaves Nanominer share/pool observations unavailable when no supported log observation exists. Nanominer receives an explicit algorithm section and cannot replace itself, reboot the rig, enable its watchdog or write duplicate disk logs. Supported GPU algorithms follow 3.10: Ethash, Etchash, EthashB3, FishHash, Karlsenhashv2, Ubqhash, FiroPow, KawPow, Octopus, Autolykos and Verthash. Existing `conflux`/`autolykos2` aliases map to Octopus/Autolykos. Removed/unsupported algorithms require an explicit configuration change. Sensor array positions are not mining device indices; old explicit `gpus` selections remain usable but must be reviewed against Nanominer's own device listing when hardware changes. Per-physical-GPU remote control is still unavailable.

Optional crash recovery is controlled by `restartOnCrash` (default false), `crashRestartDelaySeconds` (10–600, default 30), and `maxCrashRestartsPerHour` (0–5, default 2). It only retries an unexpected exit after a confirmed successful launch, using that launch's configuration. It stops at the budget, never retries failed preparation/blocked launches, and is canceled by Stop or application shutdown. The budget is held in the current app session. Server maintenance suppresses server monitoring/recovery; explicitly Stop the process to cancel local crash recovery during maintenance. The server's separate sustained-zero recovery remains opt-in. Intentional battery/activity pauses are reported and excluded from zero alerts/recovery.

## Windows CPU mining blocked

A missing/blocked `xmrig.exe` and a blocked `WinRing0x64.sys` are different problems. The default driver-free launch removes the dependency on the latter; it cannot override an executable quarantine.

1. Use **Check miner files**, then expand **Miner files and Windows troubleshooting**. On Windows this explicitly reads executable signature metadata and up to five matching Defender detection-history entries for the exact managed/bundled executable paths (and XMRig optional-driver paths). It has a ten-second deadline and a short cache. Missing permissions/Defender return an unavailable check, not a clean bill of health. Normal telemetry does not repeatedly query Defender. **Copy diagnostic report** includes app/engine version, paths, expected executable SHA-256 and these results; it excludes wallet/pool configuration.
2. Open **Windows Security → Virus & threat protection → Protection history** and match the entry to that exact path. Determine whether it is the executable, optional driver, a PUA policy, or another detection.
3. Review the intentionally installed miner and its provenance with the device administrator. Microsoft explains how to inspect and act on detections in [Protection History](https://support.microsoft.com/en-us/windows/security/windows-security/protection-history-in-the-windows-security-app). An upstream checksum establishes file identity; it does not prove every security detection is a false positive. Respect managed device policy and use Microsoft's file-submission process when a detection needs review.
4. After the detection/policy is resolved, stop all processes using that engine and choose **Repair**. Verify that the file check reports the pinned version, then start CPU mining and confirm fresh pool/share/hashrate observations in the app and admin.

The **Microsoft file review** button opens Microsoft's submission portal; it never uploads a file automatically. Signature status and checksum identity are separate facts. Historical detections do not establish a current block, and an empty Defender history does not establish that Smart App Control, another antivirus, or device policy permits execution. Microsoft includes cryptomining in its enterprise potentially unwanted application criteria; a block is not necessarily an erroneous malware classification. App signing helps publisher identity/reputation but does not guarantee that a separate miner executable will be allowed. See [Microsoft detection criteria](https://learn.microsoft.com/en-us/unified-secops/criteria), [reputation guidance](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation), and [Defender history documentation](https://learn.microsoft.com/en-us/powershell/module/defender/get-mpthreatdetection?view=windowsserver2025-ps).

Nanominer is an explicitly selectable alternative, not an automatic reaction to a detection. Whether it runs on an affected Windows rig still requires an operator-owned hardware trial. No blanket antivirus exclusions, renamed payloads, protection disabling, driver installation or quarantine retry loops are performed. If Windows continues blocking the verified executable, the OS/device policy needs review; redownloading it repeatedly is not a fix.

Installed miner files use a stable writable location under Electron `app.getPath('userData')/miners/<type>/<version>/`, under `%APPDATA%` on Windows. The app displays the actual path, which is authoritative. Configurations live in `userData/processes/<process-id>/`; packaged Program Files/AppImage resources are never used as a writable working directory. Only manifest-listed executables/runtime files and supplied licenses are extracted; optional drivers are not written into temporary extraction directories. Replacing an installation stages and verifies new files before swapping directories. A marker outside the version directory remembers installation, so a subsequently removed/quarantined directory is not recreated automatically on every start.

## Application updates

Installed Windows, macOS and Linux AppImage builds can check/download app updates. Portable Windows and development builds show that automatic app installation is unavailable. Downloading does not interrupt mining: choose **Install and restart** when ready. Installation requires confirmed process stops and saved resume state. A failed stop pauses installation. Installer errors restore manual start controls, retain a visible retryable update error, and remove saved update-resume intent so an ordinary later startup cannot unexpectedly resume mining. Miners that were running before a successful update are eligible to resume after restart if still enabled; ordinary app startup does not start mining automatically.

## Validation and maintenance

- `npm test` exercises fake native processes, configuration generation, pinned releases, corrupt downloads, update failures and telemetry formatting. It never runs a mining binary.
- `node scripts/preview-fixture.cjs` serves the built desktop UI on loopback port 4319 with simulated hardware, dual Nanominer CPU/GPU processes and fake start/stop/repair/update actions. Selecting XMRig and checking files exposes a simulated Windows block. It does not connect to production. Use `CLIENT_PREVIEW_PORT` to choose another port.
- Backend compatibility: `npm --prefix ../server test` from `client/`, or `npm --prefix server test` from the repository root; disposable MongoDB only.
- The [client audit](../docs/audits/client-2026-09-13/README.md) and [second pass](../docs/audits/client-2026-09-13/second-pass.md) record fixes and remaining hardware validation.

To update an engine, pin a specific official release and checksum, verify the extracted runtime files without executing them, update the manifest and supported algorithms, run the tests and verify every requested package target. Do not replace a running executable, follow an unpinned `latest` URL at runtime, or restore old unversioned binaries as a fallback.

## Version 1.3.1: reliability and troubleshooting

The admin can check for application updates and explicitly install a downloaded update using whole-rig commands. Rig details show update availability, progress, errors and freshness. An installation command succeeds only when the rig reconnects reporting the requested new version. A stopped, disconnected or timed-out rig is not proof of installation. See [the command contract](../docs/backend-admin.md#desktop-131-application-updates-and-configuration-ownership).

The updater observes background-download failures and rechecks cancellation/errors after stopping miners. Resume intent is atomic, limited to two hours and bound to the intended new version; a renderer reload of the old version cannot consume it. A newer operator Stop suppresses delayed resume. On Linux AppImage, MineMaster creates a sibling `.minemaster-backup` before replacement, restores a missing original after a reported install failure, and removes the backup after the intended new version starts. This is a recovery copy, not a guarantee against power loss, disk failure or an installer that never returns. If the replacement cannot launch, an operator can recover the retained original manually; inspect the diagnostic log and `appimage-update-backup.json` in user data first.

**Diagnostic logs** opens the application log directory. `client.log` and one rotated `client.log.previous` are bounded to roughly 2 MiB each and record startup, process failures/exits, renderer failures and update transitions. The live mining console remains separate. Review logs before sharing because process error messages may contain local paths or miner output. Logging failures do not block mining controls.

Linux executable failures distinguish missing files, missing loaders/libraries, incompatible executable format, missing execute permission, `noexec` mounts and host policy. Custom executables must already have execute permission. GPU sensor/enumeration failures no longer discard successful CPU/OS refreshes; retained GPU inventory keeps its observation timestamp. Windows retains the existing read-only Defender diagnostics and file-review workflow. No antivirus settings are changed.

Admin configuration ownership is persisted separately from effective local configuration. New admin passwords remain admin-owned across revisions. Genuine local differences survive; legacy profiles without ownership history may need their overrides reviewed. Switching CPU engines clears an incompatible custom executable path. Nanominer CPU and GPU continue using independent processes/configuration; the regression harness verifies an admin CPU revision reaches the CPU configuration without replacing the GPU process.

Nanominer documents a [2% RandomX fee](https://github.com/nanopool/nanominer/blob/v3.10.0/README.md) and no fee-disable setting. The shipped official XMRig build has a 1% minimum. [XMRig's GPL source explicitly permits a zero-donation build](https://github.com/xmrig/xmrig/blob/v6.26.0/src/donate.h), which would require maintaining and verifying a separate custom distribution. This release does not modify either upstream binary or ship a zero-fee build.

See the [third audit](../docs/audits/client-2026-09-13/third-pass.md) for verification and outstanding Windows/Linux hardware checks.

## Version 1.3.2 follow-up

Installer handoff receipts now survive reconnect and duplicate command delivery without being mislabeled failed or invoking installation twice. Expired/malformed resume intent is cleared even when the old application launches. Backend/admin updates preserve native sensor observation times, so fresh reports cannot refresh cached readings; rig details expose those times. See the [end-to-end audit](../docs/audits/end-to-end-2026-09-13.md) for fixes, regression coverage and release limits.

## Version 1.3.3 follow-up

Native stdout/stderr now have independent line buffers, preserving hashrate and log lines when warnings arrive between output chunks. A new process run clears partial lines. Remote restart-only rollouts leave currently idle processes untouched and report them skipped. The accompanying server fix ensures a newer Stop still dispatches when an earlier restart finishes during cancellation, and preserves whole-rig versus scoped desired-state ordering. See the [second end-to-end pass](../docs/audits/end-to-end-2026-09-13.md#second-end-to-end-pass--desktop-133).

## Version 1.3.4 follow-up

Network log flushing now preserves buffered entries and exact overflow counts during backpressure; reporting dropped logs does not itself drop another line. The native diagnostic writer caps queued writes at 256, snapshots details at enqueue time, tolerates invalid/unserializable details and records a `diagnostic-log-dropped` entry after an overflow drains. Disk failures remain isolated from process controls; logs are best effort, not a guaranteed crash-safe delivery channel. The updated admin adds “No attention flagged” filtering with matching API results.

## Version 1.3.5 follow-up

Timed-out server connections ignore late events from the retired socket, including commands, while a replacement connection can proceed normally. Central log batches now account for JSON escaping and UTF-8 bytes, so long Unicode or escaped messages cannot jam an otherwise connected log feed. The existing 500-entry buffer, overflow accounting and best-effort delivery limits remain. Deploy the accompanying backend fix to report commands that expire during preparation as timed out before dispatch.

## Version 1.4 — SRBMiner CPU and GPU

SRBMiner-MULTI 3.6.7 is selectable independently for CPU and GPU on Windows/Linux x64. Existing engine choices remain unchanged. In either miner's **engine, pools and recovery** section, choose SRBMiner, select an algorithm, and enter the appropriate pool and wallet. For Pearl select GPU `pearlhash`; RandomX CPU uses `rx/0`. The coin field is a display label, not automatic pool or algorithm discovery.

The admin provides the same managed settings: algorithm, wallet, worker, password, primary pool and up to three backups, TLS, keepalive, reconnect/failover delays, job timeout and Ethash stratum mode. CPU adds thread budget/explicit thread count, huge pages and SRBMiner thread priority. GPU adds intensity (0 means automatic). Algorithm choices show upstream fees and hardware vendors. A listed vendor does not guarantee every GPU model or driver supports that algorithm. Upgrade clients before delivering SRBMiner configurations; older clients reject operational commands requiring this engine.

CPU and GPU run as separate owned processes with separate working directories, even when both use SRBMiner. MineMaster handles starts, stops, bounded crash recovery, diagnostics and repair. Repair refuses while either instance uses the executable. Switching engines clears the previous custom executable and GPU indices. This integration uses all engine-compatible GPUs in the GPU process; arbitrary engine arguments, SRBMiner multi-algorithm combinations, per-device engine indices and automatic overclocking are not exposed. Specialized protocols requiring additional upstream options need further integration.

The official release is pinned and verified by archive/file SHA-256, with its supplied `ReadMe.txt` notices preserved. Optional Windows drivers are never extracted; MSR tuning and engine-owned watchdogs are disabled. SRBMiner is not guaranteed to avoid Windows detection. RandomX's pinned upstream fee is 0.85%; Pearl's is 2%. Fees are not deducted from local H/s or treated as measured pool earnings.

Process rates, engine/version, logs, configuration revision, health and command outcomes use the existing monitoring path. SRBMiner aggregate `Total:` readings are normalized to H/s. Pool-side effective rates and SRBMiner-specific share counters are not collected by this integration; unavailable values remain missing. Native launch uses managed arguments; the process-directory `config.json` records the configuration snapshot. No real miner was executed during development verification. See the [SRBMiner integration audit](../docs/audits/client-2026-09-13/srbminer.md) for coverage and hardware validation limits.
