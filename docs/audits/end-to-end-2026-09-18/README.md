# End-to-end follow-up — desktop 1.4.6

This pass follows [the 1.4.5 audit](../regression-repair-2026-09-15/follow-up.md). It preserves direct row, selected-rig and whole-fleet Play/Pause, separate CPU/GPU control, engine configuration, API-key access boundaries and explicit update installation.

## Findings and changes

- Nanominer's `last 10 min` summary uses the same `Total:` marker as current output. The generic parser incorrectly accepted it as a new instantaneous sample, replacing current speed and refreshing its age. These rolling summaries now remain visible in logs without updating current hashrate or charts. Current zero and H/s through TH/s observations remain supported. The distinction agrees with [Nanominer's pinned documentation](https://github.com/nanopool/nanominer/blob/v3.10.0/README.md#automatic-restart-function).
- Share and pool parsers dated observations at renderer receipt time even when native output carried an older timestamp. Both now retain the native observation time, as hashrate already did.
- The renderer checked an update's version before invoking installation through a separate native call. A newer download completing between those calls could replace the requested installer. Both local and remote install calls now pass the intended version to the native owner, which validates it before claiming an attempt or stopping miners.
- Repeated hardware/miner errors could remain buried in logs while a nonzero aggregate rate appeared healthy. The new `miner_errors` monitoring rule opens a warning after three error-level entries within five minutes for a currently running, unpaused process. The bounded query examines at most 200 recent errors, requires original observation time within the window and current launch, and excludes old backlog. It respects maintenance, can be disabled through admin/API, and resolves when the condition expires or the process stops. It never automatically restarts mining. Existing incident decoration keeps fleet attention, summary, history selection and incident filters consistent.
- Monitoring rule fields and numeric bounds are now described in the OpenAPI request schema, including the new switch.

## Live evidence from September 18 (Vancouver)

Read-only production inspection confirms 1.4.5 is installed on multiple Windows rigs and their file-only Nanominer output is reaching central logs. PG_Z2 reported approximately 41.2 MH/s with fresh observations, resolving the previously observed missing-rate symptom on that rig.

Two other findings require machine-specific investigation. PG_Z1's low reported rate is present in Nanominer's own output: 36.519 kH/s with repeated `GPU 1 OpenCL call error -49(106)` messages. It is not a MineMaster unit conversion error. PG_GH1 reports ongoing pool jobs but no speed observation. Neither cause has been established as fixed, and no production miner, update-install, repair or configuration command was issued during verification. KAM_Z1/KAM_Z6 now report again on 1.4.3 with 1.4.5 downloaded; they retain their old updater behavior until installed/upgraded.

Nanominer aggregate share counters are still not normalized into accepted/rejected telemetry; the existing parser supports XMRig counters. This pass does not guess how Nanominer's total includes rejects. Logs retain the supplied totals. The new log-error rule does not replace share rejection monitoring.

## Validation and release status

Behavioral tests cover actual-format rolling output, original timestamps, native version matching, current-run error windows, maintenance, paused/stopped/restarted processes, rule disabling and fleet/summary/incident filter agreement. The actual installed updater library downloads inert Windows/Linux feed assets through a loopback server, refreshes 1.4.5 to 1.4.6 and rejects corrupted next-release bytes. Existing native process, command cancellation, engine, API-key, database failure and reconnect tests remain in the full suites.

Final suite totals, package verification, browser checks and deployed source/release identifiers are recorded below after completion. No test launches mining binaries or installers. Windows NSIS and Linux AppImage execution/relaunch, antivirus decisions and GPU driver behavior remain hardware validation limits.

### Verification completed before packaging

- 83 client and 99 server tests pass, with no failures/skips; shared native tests overlap. Both production web builds pass. Monitoring OpenAPI fields match the supported runtime rule fields.
- The production renderer in the Windows browser fixture connected to the disposable backend. Direct row Play showed agent confirmation and separate CPU 7.25 kH/s / GPU 61.50 MH/s readings. Row Pause confirmed and stopped both processes.
- A separate synthetic agent with repeated OpenCL errors produced the new visible incident and the enabled `miner errors` rule switch in the admin. No production command was involved.
- The monitoring page fit the measured 1280-pixel document width. A requested 640-pixel browser override did not change its actual viewport; narrow-screen validation in this pass is therefore unverified. No CSS/layout change was made.


### Live verification follow-up and published artifacts

The deployed monitor revealed repeated GPU errors on PG_Z1, PG_Z2 and PG_Z3, including errors that a nonzero aggregate rate previously concealed. PG_GH1 still had pool jobs without speed output. These are observed miner/driver symptoms, not confirmed hardware repairs.

A final live UI check found that a stopped, explicitly disabled CPU miner's old error could mask active GPU mining as a fleet error. The backend now excludes only that inactive error from operational status/reason; diagnostics remain in the process record. Enabled failures and a disabled process that is still running continue to raise error status. The added regression verifies fleet summary counts as well. **Final suites: 83 client and 100 backend tests**, with shared native coverage overlapping.

The fixture's simulated database outage retained existing data, showed the error and disabled whole-fleet actions. The live admin reload confirmed direct Play/Pause and the new error incidents. No real rig commands were sent.

Client [v1.4.6](https://github.com/cryptonaut420/minemaster/releases/tag/v1.4.6) was published from source/tag `876b13f`, build `1.4.6+86.876b13f`. All 26 packaged native/shared/build files match source on Windows and Linux. Every pinned XMRig, Nanominer and SRBMiner file verifies on both platforms, and optional driver files are absent. The application archives embedded in Windows Setup, Windows Portable and Linux AppImage match the checked unpacked archives. All seven uploaded release assets passed digest/size checks while still in a draft. No executable package was launched.

Initial backend deployment `876b13f` is healthy on tsqr, with rollback image `minemaster:before-876b13f`; 14 of 27 active inventory records were connected after deployment. The inactive-CPU status correction is a subsequent backend-only change and does not alter the client release contents.
