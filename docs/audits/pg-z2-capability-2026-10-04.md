# PG_Z2 capability review — October 4, 2026

## Production findings

At 23:48 UTC, PG_Z2 reported `1.4.18+128.ba0bb06`, GPU engines `nanominer`, `srbminer`, `krig`, and the loaded KRig Quantus profile `9269fc84-1161-4a86-a1f7-bf07bc15910a`. Its latest explicit run-state command remained the successful whole-rig Stop at 06:23 UTC before installation. Its process reports had no error or configuration drift. The reported unsupported-engine message could not be reproduced from this current registration; its precise UI source/time has not been established.

An explicitly read-only GPU diagnostic command (`1858ee41-822d-418d-96bd-c690aa5359fe`) succeeded. The packaged KRig 1.5.6 executable matched its pinned SHA-256, with status `bundled`: it had not yet been copied into the managed working directory because the engine had not launched. No repair or mining start was performed. The bounded Windows check returned no matching detections, which is not proof of permission or future antivirus behavior.

Twelve rigs were connected, all reporting client 1.4.18. The monitored period after 06:40 UTC had three process-exit events, all marked expected; no new unexpected exit was recorded. Current active processes had fresh samples, while logs retained occasional SupportXMR write/pool errors and KRig stale-share warnings. These observations do not guarantee overnight uptime or pool-side effective earnings.

## Changes

- Admin action failures previously stayed beneath Play/Pause with no timestamp or dismissal. They now explicitly say when the last attempt occurred and allow dismissal, without clearing live rig errors or stored command history. A late batch poll cannot resurrect an explicitly dismissed message; pending commands remain visible.
- Capability rejection messages now identify the reported client version and supported engines. A `command-rejected` event records bounded diagnostic context for failures occurring before a command is created, so future reports can be traced after an upgrade. No launch configuration or credential is recorded.
- Added a same-rig upgrade regression: old capability registration rejects KRig, new 1.4.18 registration accepts it, and the original rejection remains in event history. Desktop registration checks now explicitly verify KRig advertisement on Windows/Linux x64 and its exclusion on unsupported targets and CPU scope.

## Validation

150 backend tests and 149 client tests passed; the admin production build passed. Browser fixture checks covered dated action failures, dismissal with live state retained, and a successful retry, including visual inspection in a 390px iframe. Only synthetic mining actions were used during browser checks. No client source or mining engine binary changed; client 1.4.18 remains current.

Deployment verification is recorded after completion.
