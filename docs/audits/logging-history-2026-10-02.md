# Logging and history follow-up — October 2

## Reproduced fixes

- Stop and removed-process history boundaries used server time even though accepted original samples retain client time under the five-minute tolerance. A synthetic rig 180 seconds behind incorrectly contributed 120 seconds instead of its final 20 seconds; an ahead-clock rig could lose the interval. Stop, intentional pause and process removal now close the previous interval using the same bounded report-clock basis as current telemetry. Original observation timestamps stay unchanged, no synthetic zero is inserted, and raw valid samples remain distinct. New disposable-WebSocket tests cover ahead/behind offsets and all three transitions.
- The owned file reader silently ignored ENOENT even after successfully reading a miner log. It now reports disappearance once until recovery, clears partial bytes/position, and resumes safely if a file reappears, including same-length/inode reuse. Initial absence while waiting for file creation remains quiet. Original observation times, frozen Windows write timestamps, read limits and monitoring-gap backlog discard are preserved.
- A thrown diagnostic callback could reject a scheduled file read. Error callbacks now isolate synchronous and asynchronous failures, and asynchronous output failures are observed. File-reader tests reproduce missing-file and callback failure cases without mining binaries.
- Native diagnostics now record confirmed starts, parent exits, confirmed/failed Stops, and log-capture failures, with process/run IDs and engine/PID where known. These records distinguish parent exit from confirmed cleanup. Launch settings, command arguments, wallet and password are not added to these lifecycle records. Existing bounded rotating logs are reused; logging failures cannot prevent control.

## Validation and limits

129 client tests and 139 backend tests passed, with both production builds passing. Native tests cover lifecycle correlation, launch-secret exclusion, and throwing/rejecting loggers. Tests use fake processes and disposable databases. There are no new UI controls or protocol fields, and no browser walkthrough was needed for these native/history-only changes.

The history change affects newly received transitions; it does not rewrite old chart buckets. Diagnostic logs remain bounded and cannot guarantee delivery after abrupt power loss or disk failure. This pass does not fix Windows policy blocks, GPU driver faults, physical cooling, or unknown surviving processes. No real miner/installer was executed during testing and no live mining/repair/forced-install command was issued. See the [site visit checklist](site-visit-2026-10-02.md).

## Deployment and release evidence

Source commit `b410091` was pushed to master and deployed to tsqr using the existing Docker deployment script. Container `cf2c3c28490635f09f4da2ab58f6ca06bf250543cfc864e286317e836e9660af` replaced the prior deployment, retained as image `minemaster:before-1.4.13`. The post-deployment health check reported database/index readiness and a successful monitoring sweep at `2026-10-02T20:16:57Z`, with zero failed rigs in the sweep. That is monitor health, not proof that every mining process is healthy.

Client **1.4.13+115.b410091** was published as a stable release at `2026-10-02T20:15:18Z`. The release pipeline verified all seven release assets, both updater feeds, uploaded asset digests, and the Windows/Linux packaged miner paths and hashes before publication. Packaged native lifecycle/log-reader source also matched this commit on both platforms. Official latest stable checks retained SRBMiner 3.7.1, Nanominer 3.10.0 and XMRig 6.26.0. Supported clients can discover this release through their normal update cycle; no forced installation was sent.

The immediate post-deployment summary contained 27 rigs, 18 online, with complete current rate coverage for six Quantus processes (1.64727 GH/s), five KawPow processes (127.481 MH/s), and two RandomX processes (2.637 kH/s). These algorithm-specific observations are a point-in-time snapshot, not an uptime or profitability guarantee. GPU-stopped rigs and older clients still need the on-site checks above.
