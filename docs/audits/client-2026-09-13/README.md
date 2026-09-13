# Desktop mining client audit — September 13, 2026

The prior backend/admin changes were committed as `699c76f` before this client pass. The first client pass was committed as `b97ac1e`, targeting desktop **1.2.0**, then fast-forwarded onto `master` at the owner's request. Subsequent **1.3.0** changes are recorded in the [second pass](second-pass.md). This document describes implemented changes, not a proposed backlog. See [the operating guide](../../../client/README.md) and [the API contract](../../backend-admin.md).

## Findings repaired

### Engine distribution

The old installer trusted file existence, so changing a download URL did not upgrade an existing miner. Downloads had no checksum validation or overall deadline, archives extracted into live directories, failures could leave partial files, and the script could print success after failure. Platform files shared directories and macOS ARM builds selected the x64 XMRig archive.

The replacement pins official XMRig 6.26.0 and Nanominer 3.10.0 archives and extracted files, bounds redirects/size/time, verifies before extraction and installation, and stages directory replacement with rollback. Setup/build failures are nonzero. Platform/architecture directories and the actual-target packaging hook prevent cross-build contamination. The new writable runtime copies preserve versions, provenance, supplied licenses and stable executable paths. Removal after installation requires an explicit repair; it is not a redownload loop.

### Native process ownership and recovery

Several shutdown/update paths treated `ChildProcess.killed` as proof of exit. Windows termination was fire-and-forget, update installation could continue after a stop timeout, and POSIX process-group signals did not match how processes were spawned.

One native controller now serializes starts, stops and repairs; tracks the actual process and launch generation; deep-copies configuration; checks live PIDs; creates owned POSIX groups; awaits Windows process-tree termination; and retains tracking after a failed stop. Pending preparation is canceled by a newer stop. Obsolete process-close callbacks cannot erase replacement processes. The single-instance lock prevents duplicate apps sharing a rig identity. Background throttling is disabled for reliable reporting, sensor probes have deadlines, and a crashed renderer can reload at most twice in five minutes while native process ownership remains intact.

Optional local crash recovery is bounded by an hourly per-session budget, requires a previously successful launch, and uses that launch's configuration. Blocked/missing-file startup is never automatically retried. Stop cancels scheduled recovery even if the process is currently down. Server sustained-zero recovery remains separate and opt-in.

### Windows XMRig blocks

No affected Windows machine or exact threat name was available during this pass. Consequently, the executable quarantine cause is **not confirmed fixed on the fleet**.

The app now reports the exact path and structured missing/access-denied/checksum/platform/startup diagnostics. The UI and management API can verify/repair the pinned engine while stopped. Default CPU mining disables MSR reads/writes and does not install optional kernel drivers, removing that dependency from ordinary CPU mining. This can trade some peak throughput for compatibility. Upstream checksums establish file identity, not that every detection is a false positive. The operating guide directs operators to the matching Protection History entry and device policy; the app does not disable protection, create blanket exclusions, rename payloads, or bypass quarantine.

### Configuration and monitoring accuracy

- Nanominer now receives the actual selected algorithm in an INI section, with globals in the correct location. Its self-updater, watchdog, management ports and duplicate disk log stream are disabled under MineMaster ownership.
- Current supported algorithms replace removed choices; known aliases are explicit. Primary and backup pool validation accepts valid ports/usernames and XMRig IPv6 addresses. Nanominer uses plain host:port addresses.
- CPU settings cover an efficient automatic thread budget, optional explicit threads, priority, huge pages, battery/activity pauses, TLS and keepalive. The UI accurately describes a thread budget rather than promised CPU utilization. Native and renderer validate before launching.
- The first startup logs, version, shares and rate observations are preserved instead of being cleared after the start acknowledgment. Original sample timestamps remain intact. Zero, missing, stale, stopped and paused displays differ.
- Pauses are preserved through status normalization, excluded from current hashrate contributions, and do not cause zero/stale-rate attention or automatic zero recovery. Algorithm summaries expose paused-process counts.
- GPU inventory/sensors join by hardware identity. Misleading sensor-index selection checkboxes were removed; previous explicit Nanominer indices remain visible and can be reset to all GPUs. The UI does not promise physical GPU control it cannot execute.
- Reconciliation with native state runs while the app is open, including after renderer reload. Explicit remote start/stop confirms native state rather than trusting an old renderer flag.

### Admin control and connection behavior

The existing authenticated management API gains capability-gated `miner-diagnose` and `miner-repair` commands, returning acknowledged structured results. They are available in the admin control dialog; engine diagnostics appear on the rig details page. Older agents fail with 422 rather than accepting unsupported actions. New CPU, failover and crash-recovery configuration fields are typed, versioned and documented in OpenAPI. Simple miner registration and telemetry remain unauthenticated.

Completed command receipts are replayed on reconnect without executing the actions again. Unfinished receipts after an agent restart report an unknown outcome. Socket errors keep their connection timeout, the send queue is bounded, dead peers trigger reconnect, and stale socket events cannot override a newer connection. The desktop distinguishes its admin binding from current connection health.

Malformed saved command history is discarded without breaking new commands; malformed GPU settings produce validation errors instead of crashing the form. Unreadable admin connection settings leave an editable recovery form. Repair cancels pending local crash recovery and refuses custom executable selections instead of claiming to repair an engine that would not be used.

### Quality of life and app updates

The overview has individual CPU/GPU controls and diagnostics, engine versions, process uptime and pending settings. Detail views show pool/share observations, file paths and repair guidance. Advanced settings expose failover, bounded recovery and local custom paths. Console storage is bounded by both line count and characters; filtering, paused viewing and text export are available. GPU disable confirms stopping first.

Application updates download without interrupting mining and install only after an explicit action. The updater retains version/progress/error metadata, avoids duplicate listener registration, handles asynchronous check failures, refuses to install after failed stops, and saves resume state only after successful shutdown. Portable/development limitations are visible.

## Verification

- Client behavioral tests use fake processes and synthetic files; no mining executable is launched.
- Backend tests use disposable MongoDB 7.0.24, fake rigs/WebSockets and the shared fake native lifecycle tests. Maintenance capability gates, command outcomes, diagnostics, paused telemetry and receipt replay are covered alongside existing API-key/reporting regressions.
- Client production build and admin production build are checked.
- Official archive/executable verification succeeds for Linux x64 and Windows x64 engines and both macOS XMRig architectures. Downloaded binaries remain ignored by Git.
- Linux and Windows unpacked packages are generated and checked for the correct engine files and native/shared modules. The Windows layout check disables executable resource/signature editing; it is not a signed installer or a Windows runtime test.
- The loopback desktop browser fixture checks blocked CPU diagnostics, repair-without-start, first startup logs/zero rate, independent controls, log filtering and update readiness. It uses simulated hardware and does not contact the fleet.

Final verification: **26 client tests passed; 58 backend tests passed**, with zero failures or skips. The backend suite also includes the shared native lifecycle tests, so these counts overlap. Both production builds succeeded. Linux x64 and Windows x64 unpacked packages were rebuilt from the final renderer.

The browser fixture confirmed CPU repair without starting, a real zero distinct from missing data, preserved startup logs, filtered/paused log viewing, independent GPU startup, GPU disable waiting for stop, and an explicit installation button after update download. Checks at 640 and 1280 CSS pixels found no elements extending beyond the document width. They caught and fixed stylesheet ordering that overrode the compact dashboard controls. Browser screenshot capture clipped the right edge, so complete visual validation in the native app remains a hardware check. No browser console errors were present in the final fixture.

## Validation limits and rollout

No production database or fleet command was used. No live miner was started, no application was deployed/published, and no protection policy was changed. Real Windows quarantine, MSR throughput tradeoffs, driver sensors, actual pool failover and real-engine process-tree termination still need an operator-owned hardware smoke test. macOS release packaging/signing was not run on this Linux host. Per-physical-GPU command control remains unsupported.

A practical first rollout is one affected Windows rig: install the new client, inspect the exact detection and file path, resolve the device policy if needed, repair, start CPU mining, confirm fresh shares/rate in app and admin, then test stop/restart and an app update. Test one Linux rig and macOS CPU-only host before expanding to those platforms. Review any existing removed Nanominer algorithm or additional argument that now conflicts with managed configuration. This audit prepares that rollout; it does not claim those machine-level checks have already passed.

## Upstream references

- [XMRig 6.26.0 release and archive hashes](https://github.com/xmrig/xmrig/releases/tag/v6.26.0).
- [Nanominer 3.10.0 release](https://github.com/nanopool/nanominer/releases/tag/v3.10.0) and [published archive/executable checksums](https://github.com/nanopool/nanominer/releases/download/v3.10.0/sha256checksums.txt).
- [XMRig command-line settings](https://xmrig.com/docs/miner/command-line-options).
- [Nanominer 3.10 configuration and algorithms](https://github.com/nanopool/nanominer/blob/v3.10.0/README.md).
- [Microsoft Protection History guidance](https://support.microsoft.com/en-us/windows/security/windows-security/protection-history-in-the-windows-security-app).
