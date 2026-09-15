# Regression follow-up — client 1.4.5

September 15, 2026. Continues the [live-fleet repair](README.md). No real miner or production control/install command is used for validation.

## Implemented repairs

- The update controller returned early whenever a release was downloaded, so hourly/manual checks could never discover a newer release. It now refreshes while preserving a ready installer if the check fails, and serializes checks against installation.
- Heartbeat expiry previously called `close()` and relied on a close event to reconnect. A dead transport is now retired immediately, with reconnect scheduled and late commands rejected.
- A full/unavailable browser preference store could throw inside registration callbacks before periodic reporting began. Nonessential binding/name preferences now fail independently of native control/reporting.
- A Nanominer process exiting before the first one-second poll lost its file-only diagnostic. Owned exit/stop cleanup drains final bytes before releasing the reader. Pending final reads retain the generation guard against crash recovery after Stop.
- Monitoring recognized overdue agent reports and zero hashrate, but did not open an incident for a running process with missing/expired hashrate. The existing stale rule now covers that case after startup grace; stopped, intentionally paused and fresh zero states remain distinct.
- The release wrapper previously published Linux before Windows finished building. It now builds all targets without publishing, verifies feed hashes/sizes, then verifies every uploaded asset in a GitHub draft before publication. No version bump or destructive dist cleanup occurs during release.

## Validation

Full suites: 79 client tests and 97 server tests pass (shared native coverage overlaps). Both production web builds pass. New behavioral regressions cover the repairs above. The installed updater library downloads synthetic Windows NSIS and Linux AppImage assets through a loopback feed, refreshes a downloaded 1.4.4 to 1.4.5, and rejects mismatched SHA-512 bytes. Resume format, failed-stop handling and cancellation remain tested separately; no installer is executed.

Browser and final deployment/package results are recorded after completion below.

## Live evidence and limits

Read-only inspection before deployment still found ten connected rigs, all on 1.4.3. PG_Z2 was running GPU Nanominer with missing hashrate; KAM_Z1/KAM_Z6 remained disconnected at their previous times. No new evidence establishes the reason those Windows apps disconnected. A release cannot restart an offline app remotely, and the restored reporting still needs an observed sample after installation on PG_Z2.

Windows NSIS execution, Linux AppImage replacement/relaunch, real mining output/performance and device policy remain hardware validation limits. A successful build, simulated client or checksum test does not prove those behaviors.
