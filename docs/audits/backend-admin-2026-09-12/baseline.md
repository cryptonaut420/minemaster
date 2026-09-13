> Archived pre-repair audit at `ace7a2a`. Statements about current behavior below describe the baseline, not the repaired working tree. The maintained reproduction/preview entry points now run the new regression suite and disposable UI fixture. See [implementation](implementation.md).

# Backend/admin operational audit

September 12, 2026 · source revision `ace7a2a` · private MineMaster deployment

The admin has a useful foundation, but reporting and remote-control correctness need attention before adding more charts or fleet automation. The main problems are stale/overwritten state, incorrect aggregation, and commands whose outcomes cannot be verified centrally.

This audit covers backend routes/models/WebSockets, the active admin pages, and the desktop telemetry/control paths that determine what the backend can report. Authentication and security hardening are deferred at the owner's request and excluded from the active findings and repair plan.

## Evidence and limits

- **24 operational findings:** 14 P1 (correctness/reliability priorities), 10 P2 (next improvements). This prioritization is an engineering judgment, not a vulnerability score.
- **15 isolated checks reproduced existing defects.** They execute repository source with in-memory dependency substitutes and deterministic event/timer fixtures. Two checks inspect emitted data/query structure rather than executing MongoDB behavior.
- The admin production build completed successfully: 792 modules, approximately 571 kB main JavaScript / 177 kB gzip. Build size is an observation, not a performance benchmark.
- Browser review used the actual built admin with synthetic, read-only API responses at normal width and 390×844. It confirmed stale-state display, lost configuration drafts, unnamed controls, and responsive hiding of important columns.
- No production database, deployed indexes, live rig, remote command, or real pool was exercised. No hardware accuracy, fleet-scale throughput, Docker build, or long-running network soak test was performed.
- Application source was not fixed as part of this audit. The changes delivered here are the audit/reproduction artifacts, corrected docs, and repository guidance. Proposed behavior below remains work to implement.

## Start here

1. **Make state trustworthy:** MM01–MM04 and MM14. Repair the null-index migration, session ownership, concurrent updates, stale-state derivation, and outage handling.
2. **Make measurements trustworthy:** MM05–MM08, MM13, MM23. Correct sample freshness, zero handling, GPU identity, active configuration identity, and shared summaries.
3. **Make commands predictable:** MM09–MM12. Align payloads, distinguish dispatch from completion, persist outcomes, and make later stop commands supersede pending restart work.
4. **Add useful monitoring and API coverage:** MM16–MM20 and MM24. Logs/events, health rules, history queries, stable retention, pagination, and bounded update traffic.
5. **Improve daily operation:** MM15, MM21–MM22. Drafts, applied-state visibility, pending actions, mobile health information, accessibility, saved views, and bulk controls.

These batches can be split into small changes, but ingestion/schema fixes must land with compatible client updates and migration checks. Keep the current client protocol readable until all relevant clients support its replacement.

## Correct reporting model

Treat a rig, physical device, and mining process as separate entities. Nanominer's aggregate process rate must not masquerade as GPU 0's measured performance. Use stable GPU identifiers, process IDs, session generations, sequence numbers, and explicit units.

Every sample should carry `observedAt`, `receivedAt`, `algorithm`, `activeConfigVersion`, process/device identity, and quality (`valid`, `zero`, `stale`, `unavailable`). A cached value keeps its original observation time. Store zero when actually observed; do not fabricate zero for missing telemetry. A disconnected agent does not prove the mining process itself stopped.

Compute same-algorithm fleet rate by summing concurrent process contributions in consistent time buckets. Derive time-weighted window means, extrema, sample counts, reporting-device counts, and coverage. Do not add RandomX and KawPow into one productivity figure. Keep process uptime, agent uptime, and monitored availability separate.

**Synthetic correctness example:** rig A reports 100 H/s and rig B 300 H/s steadily on the same algorithm. The current chart averages their samples to 200 H/s; the correct fleet rate is 400 H/s. If one rig has no sample, report reduced coverage/unknown contribution rather than silently implying a smaller healthy fleet. Missing intervals remain visible gaps on the time axis.

Retain configurable raw samples plus longer-term rollups when needed. At two samples per five seconds, one continuously mining dual-process rig produces about 241,920 raw rows per seven days; 100 rigs would produce about 24.2 million rows before extra immediate updates. This is a cadence-derived estimate, not observed production volume. Choose retention, bucket size, indexes, and write batching using actual fleet measurements.

## Command/control model to implement

A command is a durable resource with an ID, target rig/process/device scope, action, parameters/config revision, creation time, deadline, requested-by information, and idempotency key. Track queued → sent → received → running → succeeded/failed/timed-out/canceled, preserving per-target errors and the final observed process state.

Delivery retries must not imply exactly-once execution. The client needs command deduplication and a per-process desired-state generation. Newer stop/disable commands cancel older restart continuations. After reconnect, reconcile desired and observed state; do not replay expired actions blindly. Bulk operations need per-rig results, concurrency limits, cancellation, and partial-failure visibility.

The UI should say “command sent” until execution is confirmed. For configuration rollout, show draft, saved desired revision, pending application, applied revision, and drift. Show which values are local overrides. Rollout should support a small selected set first, then the remaining targets once results are verified.

## API parity plan — proposed, not implemented

Keep compatibility for existing `/api` routes while introducing documented resources such as:

- `GET /api/v1/fleet/summary`: shared UI/API health counts and same-algorithm live rates, with freshness and coverage.
- `GET /api/v1/rigs`: bounded filtering, sorting, pagination, field selection, and group/tag support.
- `GET /api/v1/rigs/:id`: rig details, device/process identities, latest metric quality, capabilities, and desired/applied config.
- `GET /api/v1/metrics`: rig/process/device/algorithm filters, `from`, `to`, `resolution`, and explicitly named aggregations/units.
- `GET /api/v1/events` and `GET /api/v1/rigs/:id/logs`: cursor-based history and tailing with timestamps, severity, source, and command correlation.
- `POST /api/v1/commands`, `GET /api/v1/commands/:id`, and command listing: accepted resource IDs and per-target execution results; cancellation where supported.
- Config revisions and rollout resources: validation, diff, targets, applied-state results, and rollback to a selected prior revision.
- Alert/incident resources: rule configuration, active incidents, acknowledgment, maintenance suppression, and recovery history.
- CSV/JSON export using the same query services as charts. Include units, timezone, aggregation, and quality/coverage fields in exports.
- Separate liveness and readiness: database/index readiness, ingestion lag, connected sessions, command backlog, storage/write failures, and process health.

Use consistent response/error envelopes, documented enum values, explicit UTC timestamps, bounded input ranges, and one calculation implementation per metric. Publish the contract and keep route examples executable in contract tests. The current API is documented separately in [backend-admin.md](../../backend-admin.md).

## Admin experience to build

Lead with actionable health: rigs needing attention, online/stale/offline counts, mining processes, current rates by algorithm, and last successful refresh. Add a reason column for idle, zero work, error, unavailable sensor, or missing device. Distinguish process running from shares accepted by the pool.

A rig detail view should combine process/device inventory, current applied config, last command result, recent failures, log tail, and synchronized metric charts. Useful chart controls include date range, algorithm, rig/group, resolution, visible gaps, and event annotations. Add per-rig sensor/share/pool histories only when that data is actually collected.

Support saved filters, tags/groups, configurable columns, bulk actions with per-target outcomes, keyboard-accessible sorting, named toggles, and preserved drafts. On small screens keep health, freshness, and rate visible; put secondary hardware details behind disclosure. Keep action controls pending until the relevant command outcome is available.

## Findings and acceptance criteria

### MM01 · P1 · Unique sparse indexes conflict with offline rigs

**Evidence:** Model construction and disconnect handling explicitly write connectionId:null. The unique sparse connectionId index includes explicit nulls, so a second offline rig can hit E11000. REST-created rigs also share systemId:null. Index creation catches the failure and skips all subsequent indexes, including history retention.

**Operational effect:** Disconnected rigs can remain displayed as mining; registration can fail; required indexes may be absent.

**Recommended change:** Migrate to unique partial indexes on valid string identities, or unset absent fields consistently. Inspect existing duplicates before migration and fail readiness when required indexes cannot be created.

**Acceptance criteria:** Two or more rigs can disconnect and reconnect; multiple unconnected records can coexist; required indexes are verified at startup.

**Validation:** R15 verifies emitted nulls and index declaration; MongoDB sparse-index semantics verified in official documentation. Actual deployed indexes were not inspected.

**Source:** [server/src/db/mongodb.js:51](../../../server/src/db/mongodb.js#L51), [server/src/models/Miner.js:5](../../../server/src/models/Miner.js#L5), [server/src/websocket/server.js:695](../../../server/src/websocket/server.js#L695).

**External behavior reference:** [MongoDB sparse indexes](https://www.mongodb.com/docs/manual/core/index-sparse/) — explicit null values are indexed; only absent fields are skipped.

### MM02 · P1 · An old connection can disconnect a healthy replacement

**Evidence:** Registration replaces the stored connectionId, but the old connection retains its minerId. Disconnect and status handlers update by minerId without checking current connection ownership.

**Operational effect:** Ordinary reconnect overlap can mark the new session offline, erase its command destination, or let delayed old messages overwrite fresh state.

**Recommended change:** Assign connection generations; condition updates on both rig identity and active generation. Retire the prior socket when replacing it and serialize disconnect cleanup.

**Acceptance criteria:** Open connection B for a rig already on A; closing or messaging from A must not change B's state or command routing.

**Validation:** R03 reproduced with two synthetic connections.

**Source:** [server/src/websocket/server.js:264](../../../server/src/websocket/server.js#L264), [server/src/websocket/server.js:674](../../../server/src/websocket/server.js#L674), [server/src/websocket/server.js:537](../../../server/src/websocket/server.js#L537).

### MM03 · P1 · Concurrent telemetry loses CPU or GPU updates

**Evidence:** The async message event handler does not serialize work. Status and hashrate handlers read the full devices object, modify their snapshot, then replace it. A CPU update and GPU update can read the same starting state and overwrite each other.

**Operational effect:** Hashrates and enabled/running states flicker or revert even while valid readings reach history storage.

**Recommended change:** Use atomic field updates by stable device/process ID, monotonic sequence numbers, and a per-rig ordered ingestion path. Keep desired control state separate from observed telemetry.

**Acceptance criteria:** Interleave CPU, GPU, status, and toggle messages deterministically; all newest independent fields must survive and older sequences must be ignored.

**Validation:** R06 reproduced a lost device update while both history records were accepted.

**Source:** [server/src/websocket/server.js:69](../../../server/src/websocket/server.js#L69), [server/src/websocket/server.js:375](../../../server/src/websocket/server.js#L375), [server/src/websocket/server.js:585](../../../server/src/websocket/server.js#L585).

### MM04 · P1 · Stale rigs and readings can still look healthy

**Evidence:** Startup never reconciles stored mining/connection state against the new empty connection map. The reaper only visits current in-memory connections. The dashboard trusts stored status and device.running without a freshness cutoff; heartbeat freshness is not telemetry freshness.

**Operational effect:** After an unclean server restart, a rig that never reconnects may remain mining indefinitely. Offline sensor readings still render without a stale label.

**Recommended change:** Track connectionLastSeen, telemetryObservedAt, and metricObservedAt independently. Reconcile sessions at startup and derive online, stale, unknown, idle, and mining states using explicit thresholds.

**Acceptance criteria:** Crash/restart the server while a rig is unavailable; it must not appear live. A heartbeat-only rig must become telemetry-stale. Browser failures must preserve last data with an outage indicator.

**Validation:** Source tracing plus synthetic browser fixture: a two-hour-old mining record counted in live totals; an offline rig retained displayed temperature and usage.

**Source:** [server/src/server.js:94](../../../server/src/server.js#L94), [server/src/websocket/server.js:101](../../../server/src/websocket/server.js#L101), [server/src/websocket/server.js:625](../../../server/src/websocket/server.js#L625), [server/public/src/components/Dashboard.jsx:134](../../../server/public/src/components/Dashboard.jsx#L134), [server/public/src/components/Dashboard.jsx:532](../../../server/public/src/components/Dashboard.jsx#L532).

### MM05 · P1 · Fleet history averages rigs and mixes algorithms

**Evidence:** The time-series pipeline groups by hour and deviceType and averages all hashrate samples. It does not group by rig, process, or algorithm. It then adds CPU and GPU averages into one total. The dashboard plots only that total on a categorical axis.

**Operational effect:** For two rigs steadily reporting 100 and 300 H/s on the same algorithm, the chart returns 200 H/s instead of the 400 H/s fleet total. Different algorithms become one misleading number. Missing hours are compressed away.

**Recommended change:** Define per-process time buckets, then sum simultaneous contributions within each algorithm. Use time-weighted window statistics, coverage metadata, and explicit gap buckets. Render separate algorithm series on a real time axis.

**Acceptance criteria:** Two constant same-algorithm rigs total 400 H/s; differing sample cadences do not bias the result; different algorithms stay separate; offline and missing intervals have distinct representations.

**Validation:** R14 inspected the executed query pipeline. Numeric example is synthetic, not measured fleet data. MongoDB aggregation integration was not run.

**Source:** [server/src/models/HashRate.js:105](../../../server/src/models/HashRate.js#L105), [server/src/models/HashRate.js:130](../../../server/src/models/HashRate.js#L130), [server/public/src/components/Dashboard.jsx:360](../../../server/public/src/components/Dashboard.jsx#L360), [server/public/src/components/Dashboard.jsx:384](../../../server/public/src/components/Dashboard.jsx#L384).

### MM06 · P1 · Zero, old, and per-GPU console rates are misreported

**Evidence:** parseHashrate returns null for zero, and App retains the previous positive value when parsing returns null. Generic matching accepts a per-GPU line as process total. Every five seconds the cached value is sent with a new timestamp, while server ingestion also rejects zero through a truthiness check.

**Operational effect:** A stalled or zero-rate miner can report an old positive rate indefinitely. Nanominer totals can fluctuate between a device reading and the true aggregate. Downtime is omitted from historical averages.

**Recommended change:** Prefer structured miner statistics when available; otherwise parse complete framed lines and distinguish process totals from device samples. Preserve zero, track original sample time, expire old readings, and never refresh observation time when replaying a cached value.

**Acceptance criteria:** Replay zero-speed, startup placeholders, split lines, per-GPU output, ANSI output, and silent-process fixtures. A stale positive reading must become unknown; a genuine zero remains zero.

**Validation:** R04 and R13 reproduced zero suppression and per-GPU parsing. Cached resend path verified in source.

**Source:** [client/src/utils/formatters.js:82](../../../client/src/utils/formatters.js#L82), [client/src/App.js:239](../../../client/src/App.js#L239), [client/src/App.js:658](../../../client/src/App.js#L658), [server/src/websocket/server.js:562](../../../server/src/websocket/server.js#L562).

### MM07 · P1 · Current stats API disagrees with the dashboard

**Evidence:** GET /api/stats/hashrates sums a rig's single top-level hashrate/deviceType/algorithm. Status prefers the GPU value; individual hash messages overwrite it with whichever device reports last. The dashboard instead adds devices.cpu and GPU entries.

**Operational effect:** A rig mining on both CPU and GPU contributes only one side to the API. Consumers cannot reproduce the UI totals from the stats endpoint, and values depend on message ordering.

**Recommended change:** Create one backend summary service based on fresh process/device metrics, grouped by algorithm. Have the dashboard and integration API use that same summary.

**Acceptance criteria:** A mixed CPU/GPU rig appears in both correct algorithm groups; API and dashboard agree for live, zero, stopped, stale, and missing-device fixtures.

**Validation:** R08 reproduced an omitted CPU contribution.

**Source:** [server/src/api/stats.js:31](../../../server/src/api/stats.js#L31), [server/src/websocket/server.js:438](../../../server/src/websocket/server.js#L438), [server/src/websocket/server.js:605](../../../server/src/websocket/server.js#L605), [server/public/src/components/Dashboard.jsx:134](../../../server/public/src/components/Dashboard.jsx#L134).

### MM08 · P1 · Saved settings can relabel a process before it restarts

**Evidence:** A config push immediately replaces the renderer's miner.config, but a running process keeps the settings used at launch. Status and history messages label its hashrate using miner.config.algorithm. There is no desired/applied version or launch-config snapshot in telemetry.

**Operational effect:** Saving a new algorithm can attribute old-work hashrate to the new algorithm. The admin cannot tell which rigs actually use a pool, wallet, or config revision.

**Recommended change:** Store desiredConfigVersion separately from the immutable process launch config and observed appliedConfigVersion. Only relabel readings after successful process start; report drift and local overrides.

**Acceptance criteria:** Save an algorithm/pool change without restarting: observed metrics retain the old launch identity and the rig shows pending configuration until acknowledgment.

**Validation:** Source-confirmed through config merge, start, and telemetry paths; no live mining experiment.

**Source:** [client/src/App.js:546](../../../client/src/App.js#L546), [client/src/App.js:643](../../../client/src/App.js#L643), [client/src/App.js:664](../../../client/src/App.js#L664), [client/src/App.js:903](../../../client/src/App.js#L903), [server/src/api/configs.js:41](../../../server/src/api/configs.js#L41).

### MM09 · P1 · Generic command and start contracts are inconsistent

**Evidence:** POST /miners/:id/command sends {type,command,params}, while the client dispatches message.data.action. The dashboard start helper sends minerType/config, but the server reads deviceType and ignores those fields.

**Operational effect:** The generic endpoint returns success for a command the shipped client cannot execute. API callers expecting a targeted start or inline config can get different behavior.

**Recommended change:** Consolidate command creation through a single validated envelope and align client, routes, frontend helper, and docs. Either implement inline configuration deliberately or reject it clearly.

**Acceptance criteria:** Contract tests cover every supported action, scope, parameter, and rejection. An unsupported action never returns a successful command dispatch.

**Validation:** R09 reproduced the generic route/client mismatch. Start mismatch confirmed in source.

**Source:** [server/src/api/miners.js:129](../../../server/src/api/miners.js#L129), [server/src/api/miners.js:268](../../../server/src/api/miners.js#L268), [server/public/src/services/api.js:58](../../../server/public/src/services/api.js#L58), [client/src/services/masterServer.js:314](../../../client/src/services/masterServer.js#L314).

### MM10 · P1 · Command completion and failure are not observable

**Evidence:** Sending to an OPEN socket counts as success. There are no command IDs, execution acknowledgments, completion timeouts, or command history. Config apply calls sent messages restarted. Client stop failure/catch paths explicitly set running:false even without confirming termination.

**Operational effect:** Operators cannot distinguish queued, received, completed, and failed actions; a process may continue while the UI reports stopped.

**Recommended change:** Persist command lifecycle and per-target results. Return accepted/queued separately from executed. Confirm process state in Electron, report the actual error and exit information, and keep status unknown/stopping when termination is uncertain.

**Acceptance criteria:** Dropped socket, missing executable, invalid config, stop timeout, and duplicate delivery produce accurate final states visible through both admin and API.

**Validation:** R17 reproduced false stopped state on a failed stop. Dispatch-only success confirmed in server/client source.

**Source:** [server/src/websocket/server.js:768](../../../server/src/websocket/server.js#L768), [server/src/api/configs.js:101](../../../server/src/api/configs.js#L101), [client/src/App.js:972](../../../client/src/App.js#L972), [client/src/services/masterServer.js:478](../../../client/src/services/masterServer.js#L478).

### MM11 · P1 · Delayed restart can override a later stop

**Evidence:** Restart schedules an uncancelled delayed start. A subsequent stop does not invalidate that timer or change desired state; the timer sees the miner enabled and starts it again.

**Operational effect:** A user can stop a rig during restart and find it starts again a moment later.

**Recommended change:** Use a per-process command queue and desired-state generation. Cancel obsolete restart continuations when a newer stop/disable arrives; record the canceled command outcome.

**Acceptance criteria:** Restart followed immediately by stop stays stopped after all timers run, including duplicated and reordered command deliveries.

**Validation:** R18 reproduced restart-after-stop with deterministic timers.

**Source:** [client/src/App.js:355](../../../client/src/App.js#L355), [client/src/App.js:385](../../../client/src/App.js#L385), [client/src/App.js:408](../../../client/src/App.js#L408).

### MM12 · P1 · Per-GPU controls actually affect the whole GPU process

**Evidence:** The API accepts gpuId and updates one stored device, but the client ignores gpuId for enable/disable/stop and acts on its single GPU miner process. An invalid gpuId falls through to toggling all stored GPUs.

**Operational effect:** Disabling one GPU can stop every GPU. Bad indices silently broaden the action, and reported device settings disagree with the actual process.

**Recommended change:** Expose only process-wide GPU control until stable physical IDs and actual selection/restart support exist. Reject unknown device IDs; model target scope explicitly.

**Acceptance criteria:** An invalid ID changes nothing. A supported per-device action affects exactly that device, or returns an explicit unsupported-scope error.

**Validation:** R10 and R16 reproduced broad action scope.

**Source:** [server/src/api/miners.js:394](../../../server/src/api/miners.js#L394), [server/src/api/miners.js:415](../../../server/src/api/miners.js#L415), [client/src/App.js:458](../../../client/src/App.js#L458), [client/src/App.js:506](../../../client/src/App.js#L506).

### MM13 · P1 · Identical GPUs disappear from hardware inventory

**Evidence:** normalizeGpuList deduplicates by vendor and model, although separate mining cards commonly share both. Device IDs are then rebuilt from array positions. Name-based integrated-GPU filtering also excludes every AMD model containing Vega without checking physical identity.

**Operational effect:** Two identical cards appear as one. Counts, status mapping, and future per-device controls cannot be trusted. Discrete Vega hardware needs additional validation.

**Recommended change:** Preserve all physical devices and identify them by PCI address or vendor UUID. Treat uncertain detection as unknown instead of deleting devices by model name.

**Acceptance criteria:** Six identical cards remain six distinct devices through registration, reorder, reconnect, and partial sensor failure.

**Validation:** R07 reproduced two cards collapsing into one. Hardware-specific Vega behavior was not physically tested.

**Source:** [server/src/websocket/server.js:8](../../../server/src/websocket/server.js#L8), [server/src/websocket/server.js:35](../../../server/src/websocket/server.js#L35), [server/src/websocket/server.js:203](../../../server/src/websocket/server.js#L203), [client/electron/main.js:79](../../../client/electron/main.js#L79).

### MM14 · P1 · Database outages become successful empty data

**Evidence:** Miner reads return []/null, HashRate reads return empty results, and Config reads return defaults after database exceptions. Routes often respond success:true. Health always returns ok. Dashboard fetch failures are swallowed and chart failures become an empty chart.

**Operational effect:** An outage looks like no rigs, no history, or default configuration. Readiness and operators can miss a failing backend.

**Recommended change:** Propagate typed storage errors, return explicit 503 responses, separate liveness from database readiness, and retain last-good UI data with visible stale/error state. Never treat a storage error as a missing record or default config.

**Acceptance criteria:** Disconnect the test database: endpoints report unavailable, configuration is not replaced by defaults, and the UI displays an outage instead of an empty fleet.

**Validation:** R11 reproduced a 200 successful empty fleet on an injected database failure; related fallback paths inspected.

**Source:** [server/src/models/Miner.js:60](../../../server/src/models/Miner.js#L60), [server/src/models/HashRate.js:82](../../../server/src/models/HashRate.js#L82), [server/src/models/Config.js:55](../../../server/src/models/Config.js#L55), [server/src/server.js:62](../../../server/src/server.js#L62), [server/public/src/components/Dashboard.jsx:86](../../../server/public/src/components/Dashboard.jsx#L86).

### MM15 · P2 · Configuration validation and override behavior are unclear

**Evidence:** Config PUT accepts arbitrary keys/values without field validation. UI controls do not provide a backend schema. Client merge preserves nonempty local password and rigName over global values. Save pushes desired settings immediately; the page always says Configuration saved even before a save.

**Operational effect:** Invalid pools, algorithms, types, or CPU percentages can be saved across the fleet. Admin edits to locally overridden values may appear to succeed but not take effect.

**Recommended change:** Validate allowed fields and supported values at the API; preserve drafts by miner type; distinguish local overrides, saved desired state, and applied state. Show field-specific errors and rollout results.

**Acceptance criteria:** Invalid payloads return field errors without changing config. Override behavior is explicit. Saving and applying are distinct user-visible states.

**Validation:** Source-confirmed; no config changes sent to real rigs.

**Source:** [server/src/api/configs.js:35](../../../server/src/api/configs.js#L35), [server/src/models/Config.js:61](../../../server/src/models/Config.js#L61), [client/src/App.js:554](../../../client/src/App.js#L554), [server/public/src/components/Configs.jsx:117](../../../server/public/src/components/Configs.jsx#L117).

### MM16 · P2 · Removing a rig deletes history but leaves its socket alive

**Evidence:** Miner.delete deletes the miner and its hashrate records. The route does not retire the active connection. Hashrate messages can still insert rows for the deleted ID, and reconnect creates a new registry record.

**Operational effect:** Historical reports change after deleting a rig; orphaned samples can reappear; removal is not a stable archive operation.

**Recommended change:** Separate archive, forget, and explicit history purge. Close or detach sessions when forgetting a rig. Preserve tombstones/history for archived devices and reject telemetry for deleted identities.

**Acceptance criteria:** Archiving preserves historical fleet reports; forgetting closes ingestion; a reconnect follows a documented re-enrollment policy. History purge is explicit.

**Validation:** Source-confirmed; no live records deleted.

**Source:** [server/src/models/Miner.js:161](../../../server/src/models/Miner.js#L161), [server/src/api/miners.js:109](../../../server/src/api/miners.js#L109), [server/src/websocket/server.js:564](../../../server/src/websocket/server.js#L564), [server/public/src/components/Dashboard.jsx:265](../../../server/public/src/components/Dashboard.jsx#L265).

### MM17 · P2 · Dashboard socket reconnects unnecessarily and misses the dev proxy

**Evidence:** The hook connects to the origin root, but Vite only forwards /ws. In production it sends no heartbeat; server lastSeen advances on received messages, so a read-only dashboard is reaped after roughly 90–120 seconds even if receiving broadcasts.

**Operational effect:** Live updates do not use the intended development proxy, and production dashboards repeatedly disconnect/reconnect. The returned connection status is unused.

**Recommended change:** Use an explicit socket path and matching proxy configuration; adopt server ping/client pong or an application heartbeat appropriate to observers. Display connection and resync state.

**Acceptance criteria:** Development traffic reaches the backend /ws route and an idle dashboard stays connected through multiple reaper periods; disconnect produces a visible status and one resync.

**Validation:** Source-confirmed by comparing hook, Vite proxy, and reaper. Long-duration network test not run.

**Source:** [server/public/src/hooks/useWebSocket.js:7](../../../server/public/src/hooks/useWebSocket.js#L7), [server/public/vite.config.js:13](../../../server/public/vite.config.js#L13), [server/src/websocket/server.js:69](../../../server/src/websocket/server.js#L69), [server/src/websocket/server.js:101](../../../server/src/websocket/server.js#L101).

### MM18 · P2 · Fleet broadcasts and refreshes grow unnecessarily with rig count

**Evidence:** Every rig sends full status and up to two hash messages every five seconds. Each accepted message broadcasts full rig state to every socket, including other rigs. Dashboard messages trigger a full GET /miners after a 300ms debounce, in addition to five-second polling; all responses are unpaginated.

**Operational effect:** Network fanout approaches quadratic growth with rig count. Event-triggered reads can exhaust the shared 100-request/minute per-IP budget or repeatedly reset the debounce during sustained traffic.

**Recommended change:** Send deltas only to interested observers, reuse one in-flight request, cap refresh frequency, use slower polling as fallback, and add server filtering/pagination. Coalesce telemetry writes and measure before setting fleet limits.

**Acceptance criteria:** Load-test representative 10/100/1000-rig fixtures; bound traffic and memory, no action starvation, predictable freshness, and no dashboard-induced 429s.

**Validation:** Source-based capacity risk; no throughput benchmark. For 100 dual-process rigs, baseline is about 60 broadcasts/s and 6000 rig-directed deliveries/s, excluding observer traffic.

**Source:** [client/src/App.js:658](../../../client/src/App.js#L658), [client/src/App.js:678](../../../client/src/App.js#L678), [server/src/websocket/server.js:785](../../../server/src/websocket/server.js#L785), [server/public/src/components/Dashboard.jsx:96](../../../server/public/src/components/Dashboard.jsx#L96), [server/public/src/components/Dashboard.jsx:122](../../../server/public/src/components/Dashboard.jsx#L122), [server/src/server.js:34](../../../server/src/server.js#L34).

### MM19 · P2 · Miner failures and logs never reach the central admin

**Evidence:** Miner stdout/stderr and exit notifications remain in the Electron renderer. The server protocol has no log/exit-event messages, storage, query routes, or log UI. Client code also treats exit code 1 as normal for notification purposes.

**Operational effect:** A rig can stop after an error and appear merely online/idle; operators must visit the rig to find why. Remote command errors cannot be investigated centrally.

**Recommended change:** Ingest structured lifecycle events and a bounded log stream with rig/process/time/sequence/command correlation. Add recent errors and searchable log tails to admin and API, with retention and pause/download controls.

**Acceptance criteria:** A fixture miner failing to start or exiting with code 1 shows cause and relevant log lines in both admin and API without opening Electron.

**Validation:** Source coverage gap, not an implemented feature. All server routes and message cases inspected.

**Source:** [client/src/App.js:261](../../../client/src/App.js#L261), [client/src/App.js:278](../../../client/src/App.js#L278), [server/src/websocket/server.js:120](../../../server/src/websocket/server.js#L120), [server/src/api/miners.js:1](../../../server/src/api/miners.js#L1).

### MM20 · P2 · Health history, shares, and alerts are missing

**Evidence:** Only latest CPU/RAM/GPU sensor state is stored on miners. Hashrate history is the sole historical metric collection. No accepted/rejected shares, pool connectivity, power, thermal history, alert rules, or acknowledged incidents are exposed.

**Operational effect:** Running cannot be distinguished from productive mining. There is no central warning for zero work, rejected shares, high temperatures, missing GPUs, or repeated crashes.

**Recommended change:** Add capability-aware metrics and lifecycle health rules: stale telemetry, zero-rate grace periods, reject ratio, missing devices, temperature, and restart frequency. Persist incidents, acknowledgments, maintenance windows, and recovery events.

**Acceptance criteria:** Each health condition has deterministic fixtures and recovery behavior; unavailable sensors are unknown, not zero. No profit, power, or efficiency metric is fabricated from hashrate alone.

**Validation:** Source coverage gap. Sensor accuracy on real rigs and pool APIs was not measured.

**Source:** [client/src/App.js:587](../../../client/src/App.js#L587), [server/src/models/Miner.js:53](../../../server/src/models/Miner.js#L53), [server/src/models/HashRate.js:6](../../../server/src/models/HashRate.js#L6), [server/src/api/stats.js:1](../../../server/src/api/stats.js#L1).

### MM21 · P2 · Configuration drafts disappear and controls lack accessible names

**Evidence:** Switching configuration tabs replaces formData from saved configs. In the browser fixture, an edited pool value was lost after switching to Nanominer and back. The seven XMRig inputs/selects had no associated labels or aria-label; CPU/GPU checkboxes were unnamed in the accessibility tree.

**Operational effect:** Operators lose edits, and keyboard/screen-reader use is harder than the visual layout suggests.

**Recommended change:** Keep per-type drafts with dirty indicators and a clear discard path. Associate labels, expose toggle names/states, add aria-expanded to disclosures, and make sort headers keyboard-operable with aria-sort.

**Acceptance criteria:** Drafts survive tabs and navigation according to an explicit policy. Every field/control has a meaningful accessible name; sorting and expansion work by keyboard.

**Validation:** Browser verified on the built admin using read-only synthetic API data; no production forms submitted.

**Source:** [server/public/src/components/Configs.jsx:19](../../../server/public/src/components/Configs.jsx#L19), [server/public/src/components/Configs.jsx:132](../../../server/public/src/components/Configs.jsx#L132), [server/public/src/components/Dashboard.jsx:443](../../../server/public/src/components/Dashboard.jsx#L443), [server/public/src/components/Dashboard.jsx:635](../../../server/public/src/components/Dashboard.jsx#L635).

### MM22 · P2 · The overview hides key health information and lacks action progress

**Evidence:** There is no stale/degraded view or command progress per row. CPU/GPU toggles and action buttons stay available while a request is in flight. CSS hides Last Seen and System below 1000px and hides device/hashrate columns below 600px. Filtering does not scope the global cards or history chart.

**Operational effect:** On a phone, core monitoring information disappears from the main list. Repeated clicks can create conflicting commands; a filtered fleet and unfiltered chart can be mistaken for the same scope.

**Recommended change:** Prioritize attention-needed, freshness, rates, and reason in a compact mobile layout. Add per-target pending states and operation results, saved views, groups/tags, bulk selection, configurable columns, and clear global-versus-filtered chart scope.

**Acceptance criteria:** A 390px viewport exposes freshness and hashrate without losing action context; repeated pending actions are prevented; chart scope is explicit and consistent.

**Validation:** Browser checked at default width and 390×844; responsive column hiding confirmed in CSS. Design enhancements are recommendations.

**Source:** [server/public/src/components/Dashboard.jsx:217](../../../server/public/src/components/Dashboard.jsx#L217), [server/public/src/components/Dashboard.jsx:333](../../../server/public/src/components/Dashboard.jsx#L333), [server/public/src/components/Dashboard.jsx:548](../../../server/public/src/components/Dashboard.jsx#L548), [server/public/src/components/Dashboard.css:645](../../../server/public/src/components/Dashboard.css#L645).

### MM23 · P2 · Version, IP, and uptime metadata are unreliable

**Evidence:** Registration hardcodes version 1.0.0 and does not update it on reconnect. Socket IP extraction chooses remoteAddress before forwarded headers, commonly yielding the reverse proxy address. Uptime is inferred from server-observed mining transitions, not process start; reconnect can preserve or reset it inconsistently.

**Operational effect:** Fleet version tracking, rig identification, and uptime comparisons are misleading.

**Recommended change:** Send client/miner versions and actual process start/boot identifiers. Distinguish local addresses, observed peer, and proxy-derived client address according to deployment topology. Define process uptime, agent uptime, and monitored availability separately.

**Acceptance criteria:** Two client versions display distinctly; a proxied connection records expected address fields; reconnect does not pretend a running process just started or count unobserved time as confirmed uptime.

**Validation:** Source-confirmed. Deployment proxy configuration and actual miner versions were not inspected.

**Source:** [server/src/websocket/server.js:58](../../../server/src/websocket/server.js#L58), [server/src/websocket/server.js:241](../../../server/src/websocket/server.js#L241), [server/src/websocket/server.js:523](../../../server/src/websocket/server.js#L523), [server/src/models/Miner.js:191](../../../server/src/models/Miner.js#L191), [client/src/services/masterServer.js:356](../../../client/src/services/masterServer.js#L356).

### MM24 · P2 · The API lacks reporting parity, query controls, and accurate docs

**Evidence:** REST provides snapshots, configs, device snapshots, two global stats queries, and immediate dispatch routes. HashRate.getByMiner exists but has no route. There is no central log, sensor-history, event, command-result, alert, fleet-summary, export, or arbitrary-range endpoint. Existing docs contain incorrect stats paths and retention/update intervals.

**Operational effect:** Integrations cannot obtain the same derived overview or drill into historical rig behavior. Every consumer must duplicate UI calculations and guess operational semantics.

**Recommended change:** Publish an explicit current REST/WebSocket reference now, then add versioned metrics, fleet summary, events/logs, command resources, and export endpoints backed by the same services the UI uses. Add bounded range/resolution/filter/pagination controls and retention metadata.

**Acceptance criteria:** Every rendered admin metric has a documented API source and shared calculation. Contract tests cover mixed rigs, empty results, invalid filters, outages, pagination, and gaps. Generated API examples stay in sync with routes.

**Validation:** All server route modules inspected. Documentation corrected in this audit; proposed endpoints remain unimplemented.

**Source:** [server/src/api/stats.js:1](../../../server/src/api/stats.js#L1), [server/src/models/HashRate.js:154](../../../server/src/models/HashRate.js#L154), [server/public/src/services/api.js:53](../../../server/public/src/services/api.js#L53), [docs/api-reference.md:1](../../../docs/api-reference.md#L1).

## Reproducing and tracking work

Run from the repository root:

```sh
node docs/audits/backend-admin-2026-09-12/reproduce.cjs
```

The script intentionally asserts current defects. `reproduced: true` means the bug was demonstrated; it is not a healthy application test result. As each issue is fixed, replace its characterization with a regression that expects correct behavior and update the finding's status/evidence. R01/R02/R12 were removed from this operational suite when authentication/security was deferred; identifiers remain stable.

- [Machine-readable findings](findings.json)
- [Reproduction source](reproduce.cjs)
- [Recorded reproduction results](reproduction-results.json)
- [Read-only browser fixture](preview.cjs)

The browser fixture can be run after building the admin. It binds only to `127.0.0.1:43187`, serves synthetic records, and rejects all API mutations. Stop it after use. It does not connect to a real server or database.

Required future validation includes a disposable MongoDB integration run with actual indexes/migrations; client/server contract tests; fake miner processes for command failures and console parsing; browser error/pending/mobile flows; and a representative fleet load/soak run. No existing general server/admin application test command was found in the package scripts.
