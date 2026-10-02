# Logging and history follow-up — October 2

## Reproduced fixes

- Stop and removed-process history boundaries used server time even though accepted original samples retain client time under the five-minute tolerance. A synthetic rig 180 seconds behind incorrectly contributed 120 seconds instead of its final 20 seconds; an ahead-clock rig could lose the interval. Stop, intentional pause and process removal now close the previous interval using the same bounded report-clock basis as current telemetry. Original observation timestamps stay unchanged, no synthetic zero is inserted, and raw valid samples remain distinct. New disposable-WebSocket tests cover ahead/behind offsets and all three transitions.
- The owned file reader silently ignored ENOENT even after successfully reading a miner log. It now reports disappearance once until recovery, clears partial bytes/position, and resumes safely if a file reappears, including same-length/inode reuse. Initial absence while waiting for file creation remains quiet. Original observation times, frozen Windows write timestamps, read limits and monitoring-gap backlog discard are preserved.
- A thrown diagnostic callback could reject a scheduled file read. Error callbacks now isolate synchronous and asynchronous failures, and asynchronous output failures are observed. File-reader tests reproduce missing-file and callback failure cases without mining binaries.
- Native diagnostics now record confirmed starts, parent exits, confirmed/failed Stops, and log-capture failures, with process/run IDs and engine/PID where known. These records distinguish parent exit from confirmed cleanup. Launch settings, command arguments, wallet and password are not added to these lifecycle records. Existing bounded rotating logs are reused; logging failures cannot prevent control.

## Validation and limits

129 client tests and 139 backend tests passed, with both production builds passing. Native tests cover lifecycle correlation, launch-secret exclusion, and throwing/rejecting loggers. Tests use fake processes and disposable databases. There are no new UI controls or protocol fields, and no browser walkthrough was needed for these native/history-only changes.

The history change affects newly received transitions; it does not rewrite old chart buckets. Diagnostic logs remain bounded and cannot guarantee delivery after abrupt power loss or disk failure. This pass does not fix Windows policy blocks, GPU driver faults, physical cooling, or unknown surviving processes. No real miner/installer was executed during testing and no live mining/repair/forced-install command was issued. See the [site visit checklist](site-visit-2026-10-02.md).
