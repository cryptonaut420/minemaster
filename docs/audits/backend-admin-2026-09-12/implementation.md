# First-pass backend/admin implementation and verification

This records the first repair and its 31-test validation. The [September 13 follow-up](second-pass.md) supersedes the authentication scope and adds further verified fixes.

The repair is implemented in the working tree across backend, admin, and desktop telemetry/control. It covers the operational recommendations from MM01–MM24. Authentication and security hardening remain outside scope. Nothing was deployed and no real mining process or production database was exercised.

## What changed

- **Accurate state and reporting:** partial identity indexes, checked startup/readiness, connection ownership, serialized telemetry, separate connection/measurement freshness, stable physical GPU identities, aggregate-only console parsing, real zero readings, and immutable process launch configuration.
- **Shared statistics and history:** one backend summary for UI/API; same-algorithm fleet sums; time-weighted minute integrals with replay watermarks, null gaps and coverage; configurable raw retention and 90-day rate rollups.
- **Predictable controls:** persistent commands with IDs, acknowledgments, results, deadlines, cancellation, duplicate-request handling, bulk target outcomes, and newer-stop supersession. Failed native stops retain tracking. Ordinary restarts retain assigned settings.
- **Configuration management:** validated drafts, version conflicts, revision history, rollback, separate saved/assigned/loaded/running versions, reported local overrides, and explicit selected-rig rollout with optional restart of already-running processes.
- **Monitoring:** central bounded logs and lifecycle events, sensor history, available shares/pool/power/version data, health rules, acknowledged incidents, maintenance, and optional recovery with sustained-zero checks, cooldowns, attempt budgets, and unknown-outcome stops.
- **Admin workflow:** attention filters, consistent filtered charts/counts, detail panels, command history, logs/events, saved views, grouping/tags, bulk controls, column preferences, preserved config drafts, accessible labels, and mobile rows retaining rates and freshness.
- **API/docs:** versioned operational resources, bounded history filters/cursors, CSV pages, OpenAPI route coverage, updated setup/architecture/binding/development docs, and root `AGENTS.md`.

## Verified

- **31 passing tests:** `npm --prefix server test`, Node 25.9.0, disposable MongoDB 7.0.24. The test dependency requires Node 20.19 or newer.
- Actual index migration accepts multiple null identities and installs TTL indexes. Real MongoDB aggregation verifies replay-safe time integration, fleet sums, separate algorithms, and null gaps.
- Real WebSocket fixtures verify overlapping reconnects, current-session ownership, concurrent CPU/GPU snapshots, zero values, observer-only broadcasts, acknowledged results, terminal-state protection, and forgetting/re-enrollment.
- Commands are exercised for duplicate IDs, bulk partial failures, deadlines/server restart, failed stops, delayed-restart cancellation, and preserved assignments after a global save.
- Native process tests use fake processes: failed termination retains tracking, an immediate exit is not reported as a successful launch, and old close events cannot delete a replacement. Desktop transport tests verify retired-socket handling and build/protocol metadata.
- Monitoring fixtures verify zero/temperature/missing-device conditions, incident acknowledgment/resolution/reopening, maintenance, recovery cooldown/budget, and unknown outcomes.
- A synthetic fanout test with 1,000 registered agents and three observers produces 3,000 observer messages for 1,000 updates and **zero fleet broadcasts to agents**. This is a fanout correctness test, not a live throughput or soak benchmark.
- Admin production build passes. Desktop renderer production build passes. The admin’s chart dependency still produces a bundle-size advisory; the existing dependency database also produces a Browserslist age advisory.
- Browser checks on the actual built admin with a disposable 12-rig fixture verified a simulated restart reaching succeeded, config drafts surviving CPU/GPU tab changes, filtered fleet data, a 390×844 mobile row showing both rates and freshness, and a synthetic API outage retaining data with an explicit error.
- Every v1 route is covered by the machine-readable OpenAPI document, enforced in an integration test.

## Compatibility and practical limits

Deploy the matching backend/admin and update desktop agents. Legacy agents remain readable but cannot provide trustworthy original observation timing or acknowledged command outcomes; commands explicitly return 422 until the agent supports the new protocol.

Per-physical-GPU start/stop remains unsupported. The API now rejects those requests rather than accidentally controlling every GPU. Nanominer is controlled as one process. Identical cards remain individually visible for available sensors.

OS/driver/miner providers determine sensor, power, share, and version coverage. Unsupported readings stay unknown. Real AMD/NVIDIA hardware, pool counters, Windows termination behavior, proxy topology, production indexes/data volume, Docker builds, and long-running network/fleet soak behavior were not validated here.

Existing raw history remains available within its TTL. It is not backfilled into accurate rollups because old timestamps and algorithm labels cannot be trusted. Export necessary legacy data before its existing retention expires.

Logs use a bounded best-effort buffer, with dropped-line reporting; they are not a lossless archival transport. Commands and rollups retain 90 days. Current incidents persist; occurrence events follow raw retention. CSV exports are bounded pages.

The backend still owns connections in one process. Horizontal replicas need a shared connection/command coordinator. Recovery is disabled by default and must be enabled per rig; it cannot reboot or repair disconnected hosts.

The [current reference](../../backend-admin.md) defines request/response semantics, thresholds, units, migration behavior, and rollout steps. The [baseline audit](baseline.md) remains historical evidence; its original “open” statements are superseded by [finding resolutions](findings.json).
