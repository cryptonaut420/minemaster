# Backend/admin audit and repair

**September 15 correction:** The [live-fleet regression repair](../regression-repair-2026-09-15/README.md) documents the lost Windows Nanominer file output, legacy update resume migration, registration retry gaps and restored direct admin controls. Earlier successful synthetic tests did not cover these runtime regressions.

The 24 operational findings from the September 12, 2026 audit have corresponding working-tree repairs. The [September 13 second pass](second-pass.md) adds scoped API keys, observer access control, and further reporting/control/overview fixes. Miner registration/reporting remain unauthenticated.

- [First-pass implementation, verification, and remaining deployment/hardware limits](implementation.md)
- [Current backend/admin API and protocol reference](../../backend-admin.md)
- [Original pre-repair audit](baseline.md), source revision `ace7a2a`
- [Machine-readable findings and resolutions](findings.json)
- [Original defect reproduction results](reproduction-results.json)

## Validation

`npm --prefix server test` runs 43 expected-correctness tests with a disposable MongoDB, synthetic WebSocket agents, parser/command fixtures, and fake native processes. Both admin and desktop renderer builds pass. Browser checks cover populated data, command results, retained configuration drafts, narrow-screen rates/freshness, and a visible outage with retained data.

The maintained [reproduction entry point](reproduce.cjs) runs those regressions. [The browser fixture](../../../server/scripts/preview-fixture.cjs) uses a disposable database and simulated agents at `127.0.0.1:43188`; it does not run mining binaries or use the configured deployment database.

## Finding resolutions

- **MM01:** Unique partial string indexes, required index checks, and sparse-index migration verified in disposable MongoDB.
- **MM02:** Connection ownership guards and per-identity queues retire old sockets; stale close cannot erase the replacement.
- **MM03:** Serialized process snapshots and separate desired fields prevent independent CPU/GPU/control updates from replacing each other.
- **MM04:** Startup reconciles connection state; connection, telemetry, rates, and sensor freshness have separate semantics.
- **MM05:** Time-weighted per-process integrals, same-algorithm fleet sums, bounded holds, explicit null gaps, coverage, and 90-day rollups.
- **MM06:** Complete-line aggregate parsing accepts zero, rejects per-card totals, retains original timestamps, and expires stale readings.
- **MM07:** The admin and API use the same fleet summary and history services.
- **MM08:** Launch config/version and actual start time remain attached to the running process; assigned, loaded, and applied versions are distinct.
- **MM09:** Legacy and v1 command routes share validated action envelopes and explicit CPU/GPU process scope.
- **MM10:** Persistent command IDs, acknowledgments, results, timeouts, partial bulk outcomes, and native stop-failure tracking.
- **MM11:** Cancelable per-process queues, deadline checks, deduplication, and newer-stop supersession.
- **MM12:** Individual GPU targets are explicitly rejected with 422; controls correctly identify whole GPU-process scope.
- **MM13:** PCI/UUID identities retain identical cards and discrete Vega GPUs; positional fallbacks are labeled.
- **MM14:** Storage failures propagate as unavailable responses; readiness checks database/indexes; the UI retains data with visible errors.
- **MM15:** Typed config validation, version conflicts, retained local overrides, revision history, rollback, and explicit target rollout.
- **MM16:** Forget cancels/disconnects and blocks re-enrollment until restoration; archive and forget preserve history.
- **MM17:** Admin uses /ws subscription and native ping/pong; reconnect resynchronizes REST state.
- **MM18:** Observer-only incremental broadcasts, bounded queues/dispatch, paged API responses, and periodic UI reconciliation.
- **MM19:** Bounded central log feed and process start/error/exit events; unexpected code 1 is no longer treated as normal.
- **MM20:** Sensor history, optional shares/pool/power/version observations, health rules, incident lifecycle/acknowledgment, maintenance, and opt-in bounded recovery.
- **MM21:** Per-type retained drafts, explicit discard, field labels, named selections, keyboard sort controls, and dirty-state indicators.
- **MM22:** Attention views, matched summary/chart filters, rig details, command progress, saved views, groups/tags, bulk selection, optional columns, and mobile rows retaining rates/freshness.
- **MM23:** Actual client version/boot ID, observed/proxy address source, immutable native process launch metadata, and optional miner version parsing.
- **MM24:** Versioned fleet/metrics/command/log/event/incident/config API, bounded queries/CSV exports, complete route OpenAPI coverage, and updated docs/AGENTS.md.

The [September 14 cross-system follow-up](../end-to-end-2026-09-14.md) fixes missing-inventory GPU control, improves group search/fleet association work, and verifies operational management-key controls alongside desktop lifecycle reconciliation. Its test counts supersede the historical counts above.
