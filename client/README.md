# MineMaster desktop client 1.2

MineMaster manages an XMRig CPU process and a Nanominer GPU process, reports their actual state to the admin, and accepts acknowledged remote commands. Miner registration and reporting do not need an API key. Reading/managing the fleet through REST requires a read/manage key or admin session; see [the backend contract](../docs/backend-admin.md).

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

## Daily operation

- Start/stop CPU and GPU independently from the overview. Disabling a process stops it first; a failed stop leaves it enabled and tracked.
- Each process shows fresh, zero, missing, stale or intentionally paused hashrate, its engine version, uptime, file diagnostics and pending settings. CPU and GPU rates are never added together.
- The detail view shows active algorithm, pool connectivity observations, accepted/rejected XMRig share counters and configuration differences. Logs support filtering, pausing the view and saving the displayed text.
- `Check miner files` reads and verifies files. `Repair` restores the pinned upstream files while the process is stopped, using the bundled copy when possible and downloading the pinned official release when necessary. Repair cancels pending crash recovery and does not start mining. Clear a custom executable selection before repairing the managed engine.
- Closing MineMaster stops its owned processes first. If the operating system refuses the stop, the app stays open with the failure. Only one MineMaster instance may run for each user-data profile.

The process controller tracks PIDs and process generations, waits for confirmed exits, owns POSIX process groups/Windows child trees, and serializes start/stop/repair. It does not kill unrelated miners by executable name. A stop also cancels a pending automatic crash restart.

## Configuration and performance

Admin revisions supply the desired configuration. A running process keeps the immutable configuration used at launch; restart it to apply changes. Nonempty local pool-password/rig-name/custom-path selections and explicit legacy GPU-index selections remain visible as overrides. The global GPU configuration applies to the whole Nanominer process.

Available CPU fields include `threadPercentage` (10–100), `threads` (0 = automatic), `cpuPriority` (0–5), `hugePages`, `pauseOnBattery`, `pauseOnActive` (idle seconds, 0 disables), `tls`, `keepAlive` and up to three `backupPools`. Explicit `threads` takes precedence over the automatic thread budget. XMRig's thread budget is a tuning hint, not a guarantee that Windows Task Manager reports that CPU percentage. Priority defaults to idle and yielding remains enabled to keep the machine responsive.

Huge pages are used when available. **MSR read/write tuning is disabled and the optional kernel drivers are not installed by MineMaster.** This reduces driver dependencies and avoids making normal CPU mining depend on a blocked driver. It can lower peak RandomX throughput compared with a successfully tuned MSR setup. MineMaster does not change OS huge-page allocation, drivers, protection settings, or administrator privileges. The old `enable-msr.sh` helper is not part of this workflow and should not be used as a repair step. The official XMRig build enforces at least a 1% developer donation.

Both engines support a primary pool plus up to three backup pool addresses with the same wallet/user credentials. Nanominer addresses must use host:port without URL schemes; its upstream default negotiates SSL with plaintext fallback. The CPU form retains additional arguments for compatible upstream options; process-detaching, config/pool/algorithm/CPU-limit overrides, alternative GPU backends and background web APIs are rejected because they break tracked configuration or process ownership.

Nanominer receives an explicit algorithm section and cannot replace itself, reboot the rig, enable its watchdog or write duplicate disk logs. Supported GPU algorithms follow 3.10: Ethash, Etchash, EthashB3, FishHash, Karlsenhashv2, Ubqhash, FiroPow, KawPow, Octopus, Autolykos and Verthash. Existing `conflux`/`autolykos2` aliases map to Octopus/Autolykos. Removed/unsupported algorithms require an explicit configuration change. Sensor array positions are not mining device indices; old explicit `gpus` selections remain usable but must be reviewed against Nanominer's own device listing when hardware changes. Per-physical-GPU remote control is still unavailable.

Optional crash recovery is controlled by `restartOnCrash` (default false), `crashRestartDelaySeconds` (10–600, default 30), and `maxCrashRestartsPerHour` (0–5, default 2). It only retries an unexpected exit after a confirmed successful launch, using that launch's configuration. It stops at the budget, never retries failed preparation/blocked launches, and is canceled by Stop or application shutdown. The budget is held in the current app session. Server maintenance suppresses server monitoring/recovery; explicitly Stop the process to cancel local crash recovery during maintenance. The server's separate sustained-zero recovery remains opt-in. Intentional battery/activity pauses are reported and excluded from zero alerts/recovery.

## Windows CPU mining blocked

A missing/blocked `xmrig.exe` and a blocked `WinRing0x64.sys` are different problems. The default driver-free launch removes the dependency on the latter; it cannot override an executable quarantine.

1. Use **Check miner files**, then copy the exact executable path from the app. Record the diagnostic and Windows Security threat name.
2. Open **Windows Security → Virus & threat protection → Protection history** and match the entry to that exact path. Determine whether it is the executable, optional driver, a PUA policy, or another detection.
3. Review the intentionally installed miner and its provenance with the device administrator. Microsoft explains how to inspect and act on detections in [Protection History](https://support.microsoft.com/en-us/windows/security/windows-security/protection-history-in-the-windows-security-app). An upstream checksum establishes file identity; it does not prove every security detection is a false positive. Respect managed device policy and use Microsoft's file-submission process when a detection needs review.
4. After the detection/policy is resolved, stop the affected miner and choose **Repair**. Verify that the file check reports the pinned version, then start CPU mining and confirm fresh pool/share/hashrate observations in the app and admin.

No blanket antivirus exclusions, renamed payloads, protection disabling, driver installation or quarantine retry loops are performed. If Windows continues blocking the verified executable, the OS/device policy needs review; redownloading it repeatedly is not a fix.

Installed miner files use a stable writable location under Electron `app.getPath('userData')/miners/<type>/<version>/`, under `%APPDATA%` on Windows. The app displays the actual path, which is authoritative. Configurations live in `userData/processes/<process-id>/`; packaged Program Files/AppImage resources are never used as a writable working directory. Replacing an installation stages and verifies new files before swapping directories. A marker outside the version directory remembers installation, so a subsequently removed/quarantined directory is not recreated automatically on every start.

## Application updates

Installed Windows, macOS and Linux AppImage builds can check/download app updates. Portable Windows and development builds show that automatic app installation is unavailable. Downloading does not interrupt mining: choose **Install and restart** when ready. Installation requires confirmed process stops and saved resume state. A failed stop pauses installation. Miners that were running before a successful update are eligible to resume after restart if still enabled; ordinary app startup does not start mining automatically.

## Validation and maintenance

- `npm test` exercises fake native processes, configuration generation, pinned releases, corrupt downloads, update failures and telemetry formatting. It never runs a mining binary.
- `node scripts/preview-fixture.cjs` serves the built desktop UI on loopback port 4319 with simulated hardware, blocked CPU files and fake start/stop/repair/update actions. It does not connect to production. Use `CLIENT_PREVIEW_PORT` to choose another port.
- Backend compatibility: `npm --prefix ../server test` from `client/`, or `npm --prefix server test` from the repository root; disposable MongoDB only.
- The [client audit](../docs/audits/client-2026-09-13/README.md) records fixes and remaining hardware validation.

To update an engine, pin a specific official release and checksum, verify the extracted runtime files without executing them, update the manifest and supported algorithms, run the tests and verify every requested package target. Do not replace a running executable, follow an unpinned `latest` URL at runtime, or restore old unversioned binaries as a fallback.
