# Desktop client second pass — September 13, 2026

The owner requested another client audit and explicitly chose Nanominer as the default CPU/RandomX engine while retaining XMRig. Previous work was committed as `b97ac1e` and fast-forwarded onto `master`. This pass targets **1.3.0** on `master`. No deployment, publishing, live-fleet operation, antivirus-policy change or mining-binary execution was performed.

## Implemented changes

### Two CPU engines and independent Nanominer processes

- New Windows/Linux profiles use Nanominer CPU; old saved CPU configurations without `engine` retain XMRig. macOS stays XMRig. The desktop and admin expose explicit engine selection and disclose Nanominer's 2% RandomX fee.
- The CPU slot retains ID `xmrig-1` and config key/type `xmrig` for protocol compatibility. A separate `engine` field identifies the running executable. Desired engine, launch configuration and observed process state remain distinct.
- CPU-only `[RandomX]` and GPU-only configurations have separate working directories, files, logs, PIDs and controls, sharing only the pinned Nanominer installation. Native tests verify CPU stop leaves GPU running.
- Preparation/start/repair coordinate by actual engine in addition to process identity. Repair cannot replace a shared executable while another process is running, preparing to launch, or scheduled for crash recovery. Stop retains pending-start cancellation and independent PID ownership.
- Nanominer's CPU percentage becomes a concrete logical-thread count; explicit threads take precedence and are capped at available logical cores. Desktop/admin/API report effective threads and the engine fee. CPU/GPU rates retain separate units, algorithms and observation times.
- XMRig-only tuning is hidden for Nanominer and incompatible values are rejected by both native and backend validation. Partial backend saves validate the merged result, closing a cross-field validation gap. Nanominer share counters exclude developer work; unsupported Nanominer pool/share observations stay unavailable.
- Agents advertise supported CPU engines. Binding/config requests withhold unsupported Nanominer CPU settings while preserving compatible GPU delivery. Dependent commands return 422 for old or macOS clients. Regression tests cover both capable and old agents and stored legacy defaults.

### Windows diagnostics and distribution

- Archive repair previously extracted optional drivers before discarding them. It now lists members and extracts only manifest runtime files and supplied licenses. Optional drivers are excluded from temporary extraction as well as installed/package directories. Archive and final-file verification remain mandatory.
- Explicit file diagnosis reads Authenticode metadata and exact-path Defender history with a ten-second deadline, 128 KB output limit, bounded matching results and a 30-second cache. Paths are passed as environment data, not interpolated script text. Normal telemetry does not repeatedly query Defender.
- The probe covers managed and bundled executable paths, plus adjacent optional XMRig driver paths, or the exact custom selection. It returns no unrelated detection history. Unavailable permissions/providers remain unavailable. Historical matches and an empty history do not establish current execution permission.
- The app exposes the expected executable hash, signature/history details, check time, a copyable diagnostic report and Microsoft's file-review page. Copy failures have visible feedback. No upload occurs automatically. Management command results and API/admin snapshots retain bounded Windows diagnostics.
- Diagnostics retain actual engine identity after launch/crash/repair errors. Checking a running process uses its active custom path. Failed maintenance no longer clears an existing diagnostic simply because an IPC result omitted one; a local notification makes the failure visible.
- The release guide's obsolete blanket-exclusion advice was removed. Current guidance distinguishes executable quarantine, optional-driver issues, enterprise PUA policy, reputation checks and other endpoint controls. No engine switching is triggered by antivirus detection.

### Additional reliability and interface fixes

- An installer error event could leave mining starts blocked after an update failed. Synchronous/asynchronous installer failures now release starts, preserve a retryable downloaded update and surface the error. Saved resume intent is cleared after failure; resume-state writes use a temporary file and rename.
- Renderer update IPC failures are surfaced. Invalid/future hashrate timestamps are stale rather than apparently fresh, and an XMRig pool-selection line reports connecting until an actual job is observed.
- Engine labels follow the selected/active engine rather than the legacy CPU slot name. Nanominer-only forms explain supported controls, thread conversion, fee and SSL fallback. Both desktop and admin show effective CPU threads.
- The admin could turn blank after a deployment/rebuild removed a lazily loaded page's old asset. A view error boundary now preserves navigation and offers an explicit reload with an unsaved-edit notice.
- Both disposable browser fixtures cover Nanominer CPU/GPU data. Docs, API/OpenAPI and repository guidance were updated to the implemented 1.3 behavior.

## Validation

- `npm --prefix client test`: **34 passing**, no failures or skips. Tests use fake process objects and benign text files, never miners. Coverage includes shared-engine launch/stop/repair races, configuration isolation, CPU limits, driver-free extraction selection, path-limited diagnostics, failed updates, stale/zero/paused telemetry and earlier lifecycle regressions.
- `npm --prefix server test`: **63 passing**, no failures or skips. Uses disposable MongoDB. Coverage includes old/new engine capabilities, legacy configuration preservation, bounded diagnostic telemetry, API permissions, command acknowledgments/cancellation, overlapping/reconnected telemetry and reporting regressions. Some native tests are shared with the client suite; these counts are not a claim of 97 unique cases.
- Client production build and admin production build pass. Existing toolchain notices remain: stale Browserslist data and Vite's deprecated CommonJS Node API.
- All six pinned official archives were installed into disposable temporary directories through the new selective extraction path on Linux. Archive hashes, every required runtime/license hash, and final file lists matched the manifest plus generated release metadata. This includes Windows ZIPs and both macOS XMRig architectures without executing any binary. Windows-native `tar.exe` invocation is covered by a mocked argument test, not a Windows execution test.
- Linux x64 and Windows x64 unpacked packages were built locally without publishing. Windows executable editing/signing was disabled for this layout check. Package contents were checked against the source and pinned runtime files; no other platform's engines or optional drivers are included.
- Desktop loopback fixture: both Nanominer processes started with distinct PIDs and CPU/GPU rates; stopping CPU left GPU running; shared repair was refused while GPU ran and remained stopped after successful repair; engine selection exposed the correct controls; simulated Windows diagnostics and copy feedback were visible. This is UI simulation, not mining or Defender evidence.
- Admin loopback fixture: saved both engine choices as new revisions; verified engine-specific fields and unsaved-state feedback. Removing a built page asset produced the visible recovery screen, and restoring it plus Reload recovered the page. Config controls at 640×900 had no DOM overflow; the same screenshot-surface limitation below applies.
- Desktop layout inspected at 640×900, including long diagnostic paths/hashes. DOM bounds showed no document/control overflow. The browser screenshot surface clipped the right edge inconsistently with those bounds (also seen in the first pass), so this is limited visual validation and needs a real Electron/Windows check.

## Remaining validation and rollout

No affected Windows machine was available. **Actual CPU-mining recovery, Defender classifications, native PowerShell behavior, Windows archive extraction and concurrent real Nanominer performance remain unverified.** No relative hashrate/efficiency improvement is claimed. Linux/macOS mining and OS sensors were not exercised on hardware either. Signed installers, actual auto-update installation and a macOS update feed remain release-machine checks.

Build/deploy the backend and admin together, then upgrade one operator-owned Windows rig to 1.3. Preserve its existing choice until explicitly selecting Nanominer CPU. With both engines stopped, verify files; launch CPU and GPU separately; confirm distinct engine/PID/config data and fresh accepted-work/hashrate observations at the pool, desktop and admin; verify stopping one leaves the other running. Compare sustained effective work and measured power before wider rollout. This manual hardware trial is outstanding and was not performed by this audit.

If an executable remains blocked, collect its exact path/hash, threat name and current Windows Security entry and follow device policy/Microsoft review. Hash identity or app signing does not prove a false positive or guarantee permission. Repair restores verified files only after explicit operator action and never starts mining.

## Primary references

- [Nanominer 3.10 README](https://github.com/nanopool/nanominer/blob/v3.10.0/README.md): RandomX CPU support, 2% fee, `cpuThreads`, INI sections, ports, SSL fallback and `countDevShares`.
- [Nanominer 3.10 release](https://github.com/nanopool/nanominer/releases/tag/v3.10.0) and [XMRig 6.26 release](https://github.com/xmrig/xmrig/releases/tag/v6.26.0): pinned distributions.
- [Microsoft detection criteria](https://learn.microsoft.com/en-us/unified-secops/criteria): enterprise cryptomining PUA classification.
- [Microsoft reputation guidance](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation): publisher signing/reputation and Smart App Control distinctions.
- [Get-MpThreatDetection](https://learn.microsoft.com/en-us/powershell/module/defender/get-mpthreatdetection?view=windowsserver2025-ps) and [Get-MpThreat](https://learn.microsoft.com/en-us/powershell/module/defender/get-mpthreat?view=windowsserver2025-ps): active/historical detection data and threat lookup.
- [Microsoft file submission](https://www.microsoft.com/en-us/wdsi/filesubmission): operator-directed review portal.

See [the operating guide](../../../client/README.md), [release guide](../../../client/RELEASING.md), [API contract](../../backend-admin.md), and [first audit](README.md).
