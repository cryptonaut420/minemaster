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

Full suites: 80 client tests and 98 server tests pass (shared native coverage overlaps). Both production web builds pass. New behavioral regressions cover the repairs above. The installed updater library downloads synthetic Windows NSIS and Linux AppImage assets through a loopback feed, refreshes a downloaded 1.4.4 to 1.4.5, and rejects mismatched SHA-512 bytes. Resume format, failed-stop handling and cancellation remain tested separately; no installer is executed.

A real client renderer connected to the disposable backend with simulated Windows native APIs. Admin row Play received agent confirmation, separate CPU 7.25 kH/s and GPU 61.50 MH/s samples, and centrally visible logs. After the fixture stopped emitting new samples, the rates aged to stale and a process-specific monitoring incident appeared after startup grace. Fleet Pause confirmed all twelve connected simulated rigs and stopped both client processes; the incident subsequently resolved. A synthetic database outage retained prior data with a visible error and disabled fleet actions. No admin layout was changed in this pass; the prior narrow-screen checks remain recorded in the parent report.

## Live evidence and limits

Read-only inspection before deployment still found ten connected rigs, all on 1.4.3. PG_Z2 was running GPU Nanominer with missing hashrate; KAM_Z1/KAM_Z6 remained disconnected at their previous times. No new evidence establishes the reason those Windows apps disconnected. A release cannot restart an offline app remotely, and the restored reporting still needs an observed sample after installation on PG_Z2.

Windows NSIS execution, Linux AppImage replacement/relaunch, real mining output/performance and device policy remain hardware validation limits. A successful build, simulated client or checksum test does not prove those behaviors.

## Deployment and publication completed

- Backend commit `101951e` deployed to tsqr through the existing Docker deployment script. Previous image retained as `minemaster:before-101951e`. The container and public `/api/health` both report healthy/ready. All ten previously connected rigs returned; the live admin still exposes direct fleet/rig controls and now flags PG_Z2's missing rate as an open incident.
- Client [v1.4.5](https://github.com/cryptonaut420/minemaster/releases/tag/v1.4.5), build `1.4.5+84.101951e`, published from source/tag `101951e`. Windows NSIS, Windows portable and Linux AppImage were built together without publication. All 26 packaged native/shared/build files match their verified source/build, and all three engines pass pinned installed-file hash checks on both platforms; optional drivers are absent. The app archives embedded inside both Windows executables and the Linux AppImage match the checked unpacked archives. No package was executed.
- Windows/Linux update feeds match actual artifact versions, SHA-512 hashes and sizes. All seven GitHub uploaded assets passed SHA-256/size checks before the draft became public, and both public latest feeds match local release bytes. The build wrapper additionally returns root-owned Docker output to the invoking publisher before checksum generation.
- PG_R1 and PG_R2 were already reporting a downloaded 1.4.4 while this pass finished. Older clients retain the old downloaded-update behavior until upgraded: they may need to install that cached release first, then check again, or install the latest Windows Setup directly. New 1.4.5 clients can refresh past an older cached release. No production install command was sent.
- Documentation/build-wrapper cleanup after publication does not change the packaged client or deployed backend code.
