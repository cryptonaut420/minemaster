# Second backend/admin pass — September 13, 2026

The follow-up is implemented in the working tree. It adds the requested API-key boundary and fixes further reporting, control, monitoring and admin workflow issues found after the first repair. No production database, live mining process, deployment or production credential was used.

## Access and integration

- Named API keys with read-only/full-management permissions, optional expiry, one-time secret display, hashed storage, last use, metadata pagination and revocation.
- Versioned and legacy operational endpoints accept keys or existing admin sessions. Read keys cannot issue commands or change settings. Actors identify the integration in operator events and commands.
- Observer subscriptions require a key/session; revocation closes key subscriptions. Miner WebSocket registration/reporting remain unauthenticated.
- Updated OpenAPI security schemes, key-management routes and incident query parameters. See [API setup and examples](../../api-access.md).

## Accuracy and controls

- Duplicate/malformed process snapshots are rejected before they can inflate totals. Missing readings stay unavailable; no-reporting algorithm totals are null. Offline/stale uptime is unknown.
- Stops close observed history without manufacturing a measured zero. Historical chart ranges ending at a supplied `to` use that end when deriving the start.
- Cancellation during command preparation prevents dispatch. Idempotency/batch identities are scoped to the caller, preventing independent integrations from colliding. Configuration rollout fields cannot be attached to unrelated stop/enable actions.
- Power overview reports measured GPU watts and contributing-card coverage, separately from inventory; it makes no claim about whole-rig or wall power. Temperature overview uses fresh sensors only.

## Overview and monitoring

- Incidents follow rig filters, have stable cursor pagination, include rig names, and contribute to attention counts/reasons. Resolved-only, severity, acknowledgment and suppression filters are available through the API. Maintenance suppresses attention.
- Multiple processes triggering one rule retain both messages. Reopened incidents clear prior acknowledgment identity. Stopped-process share counters no longer trigger rejection incidents. Missing-GPU checks work without temperature sensors.
- Rule thresholds have meaningful bounds. Monitoring reports healthy/degraded/unavailable/overdue state and sweep timing; one failing rig check does not halt checks for other rigs.
- Command dialogs track results until completion and can cancel pending commands. History has status filters and pagination. Selection is preserved across pages and can be cleared explicitly.
- Central logs/events/history identify the rig. Logs can pause/resume and return to latest entries; receipt and observation time are distinguished. CSV pages expose a continuation cursor header.
- Explicit archive/forgotten status searches find those rigs without another include flag. Rig details show loaded/running config versions, launch configuration, PID and missing device IDs.
- Live updates trigger batched REST reconciliation so sorted/filtered rows and pending-command badges agree with the API. Slow poll requests are allowed to finish. Empty UI boolean filters remain compatible.
- Admin shell routing is independent of database availability. Startup service failures show retry guidance. Page-level loading reduces the initial JavaScript bundle and removes the prior large-chunk advisory.

## Verification and limits

The regression suite passes **43 tests**, including real HTTP/WebSocket requests and disposable MongoDB 7.0.24. New cases cover key permissions/revocation/expiry, public agent registration/reporting, incident scoping/pagination, malformed inputs, caller-scoped retries, stop-history accuracy and monitoring failure isolation. The admin production build passes.

Browser checks on the disposable 12-rig fixture verified authenticated live updates, key creation/revocation, per-filter GPU power coverage, a simulated restart reaching `succeeded` inside its dialog, and rig attribution in activity. At 390×844, the API access page and fleet rows remained usable with both CPU/GPU rates and freshness visible. A synthetic API outage preserved the last data with explicit error feedback. Reloading during a simulated startup outage showed a retry screen, and retrying after recovery restored the fleet. No browser console errors were reported during normal operation.

The desktop source is unchanged in this follow-up; its existing fake-process/transport regressions remain in the 43-test suite. Real AMD/NVIDIA/Windows behavior, production proxy topology, deployment migration at production data volume and fleet soak behavior remain unverified. The backend still owns connections in one process. Per-card GPU control remains unsupported; API keys do not change miner identity trust. No deployment or production key creation was performed.

The [first-pass report](implementation.md) records the earlier 31-test validation. The [current operational reference](../../backend-admin.md) is authoritative for the combined behavior.
