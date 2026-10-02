# Production stability audit — October 2, 2026

## Production evidence (read-only)

At approximately 19:47 UTC, 18 of 27 inventory records were connected. Thirteen connected agents reported 1.4.11; five remained on 1.4.5/1.4.7. Six Quantus GPU processes contributed about 1.646 GH/s, five KawPow processes about 126.82 MH/s, and two RandomX processes about 2.77 kH/s. These are separate algorithm totals, not earnings estimates. Eleven rig statuses were errors; working GPU mining can coexist with a failed enabled CPU process.

Database/index readiness and monitoring were healthy, with zero failed rig scans. The backend container reported zero restarts since September 29. Its bounded 72-hour container-log query returned no entries; the latest container log contained startup messages only. Central agent logs and incidents, rather than container silence, supplied the actionable findings:

- KAM_Z1, PGZ9, PG_GH1, PG_Z3, PG_Z6 and PG_Z8 reported SRBMiner file-preparation ENOENT at the bundled executable path. Missing files are established; antivirus attribution is not. No repair, download retry loop or protection-policy change was issued.
- PG_R1 reported `PROCESS_EXIT_PENDING`: the parent exited while inherited output remained open. This is uncertain descendant ownership, not confirmed mining and not a safe ordinary stopped state.
- PG_Z2 repeatedly reported `GPU 1 OpenCL call error -49(106)` while still providing an aggregate Nanominer rate. Its existing miner-error incident correctly exposed the problem. No unsupported per-GPU performance claim is inferred from the aggregate.
- KamZ4 had a temperature incident and a snapshot reaching 90°C. Physical cooling/driver investigation remains needed; no power or clock settings were changed.
- PG_Z7 was reporting approximately 266 MH/s, versus about 87 MH/s at the previous audit. This establishes recovery in the snapshot, not its root cause or sustained performance.
- Five older connected clients have not adopted the automatic-install policy. No forced fleet installation or configuration/mining command was issued. Recent command history was reviewed; historical timeout outcomes remain unknown and were not replayed.

## Reproduced repairs

1. Admin and desktop controls previously offered Play/Start after a parent exit even when `PROCESS_EXIT_PENDING` indicated possible surviving children. Stop/Pause now remains available for ownership/failed-Stop/inventory failures, including disabled slots and missing GPU inventory. Quick Play excludes these slots. Both UIs distinguish **Stop required** from ordinary stopped mining. File-only errors and a final `PROCESS_EXIT` do not receive this treatment.
2. A first Stop could signal a live parent, then wait unsuccessfully for inherited output to close without attempting managed-survivor cleanup. Cleanup now runs within that same Stop when the parent exits during shutdown, before checking closure. Exact native identity matching and failure-closed behavior remain; this is not general Windows descendant containment. The new native regression failed before the fix and passes afterward.
3. The desktop health panel hid all diagnostics whose engine differed from the selected engine, including unresolved ownership errors. It now uses the existing narrow unused-file-check filter. Ownership errors remain visible, Repair stays blocked, and confirmed Stop immediately returns/reconciles the remaining native diagnostic state.

## Engine release

[SRBMiner 3.7.1](https://github.com/doktor83/SRBMiner-Multi/releases/tag/3.7.1), published after the previous audit, advertises Quantus improvements for AMD and Intel GPUs. The Windows/Linux archive SHA-256 values were matched against the official GitHub asset digests. Only executable and ReadMe bytes were read to derive runtime hashes; no optional driver was extracted and no binary was run. The notices and algorithm/vendor/fee catalog entries are unchanged; both catalog copies now identify 3.7.1. Nanominer 3.10.0 and XMRig 6.26.0 remain the latest official stable releases at this check. No NVIDIA performance gain or Windows allow-list behavior is claimed.

## Validation and limitations

Focused native and admin tests reproduced the two control failures before changes. Final validation covers fake process shutdown, refusal on unresolved ownership, enabled/disabled and missing-inventory controls, matching desktop/admin decisions, diagnostic retention, ordinary completed exits and immediate Stop reconciliation. Full client/server suites and both production builds are run before release. Browser fixtures use loopback-only synthetic rigs and fake Electron; no miners, installers or production controls are executed.

Remaining hardware issues above are not repaired by a backend deployment. Real Windows process containment, protection decisions, driver behavior, installed updater handoff and long-running mining stability still require device observation. Existing update policy, profiles, fees, authentication and recovery authorization remain unchanged.

Prepublication validation: 126 client tests and 137 backend tests passed; both production builds passed. Local browser fixtures confirmed the new stopped-parent state, visible cross-engine ownership errors, disabled Repair, immediate cleanup after Stop, and admin Stop via the real WebSocket command route to a simulated agent. At a measured 390-pixel viewport the admin Pause button remained inside the viewport. A synthetic command failure produced a toast and persistent failure indicator; a synthetic database outage retained the rig row with an explicit alert. Tests do not establish hardware behavior.
