# Backend admin and integration API

This reference describes the working tree after the September 13, 2026 follow-up repair. It supersedes the pre-repair behavior captured in the [audit](audits/backend-admin-2026-09-12/README.md). Management/read APIs and observer subscriptions now accept an admin session or API key; miner registration/reporting remain unauthenticated. See [API access](api-access.md) for setup and examples.

## Run and verify

Install dependencies in `server/`, `server/public/`, and `client/`. There is no root application package. See [server setup](../server/README.md).

```sh
npm --prefix server ci
npm --prefix server/public ci
npm --prefix server test
npm --prefix server/public run build
```

For the desktop renderer, run `npm run build` inside `client/`; its prebuild generates version metadata. Tests use a disposable MongoDB 7.0.24 instance downloaded by `mongodb-memory-server`, synthetic agents, and fake process objects. They override the deployment database URL before loading application modules. No mining binary is launched.

Use `node server/scripts/preview-fixture.cjs` after building the admin for an interactive, disposable fixture at `http://127.0.0.1:43188`. It simulates command outcomes and creates only temporary data. Stop it with Ctrl+C. Its automatic sign-in exists only in this script.

Production startup verifies required indexes, clears stored connections left by a prior server, and marks unfinished commands `timed_out` with an unknown-outcome explanation. One backend process owns the connection registry; multiple replicas require a shared command/connection coordinator and are not supported by this implementation.

## Reporting definitions

`server/src/services/telemetry.js` supplies both the admin and API summary. A rig is connected when its current session has been seen within 90 seconds. Native WebSocket pongs and application heartbeats update connection liveness. Only status reports update telemetry freshness, which expires after 60 seconds. An agent can therefore be connected while its measurements are stale.

Rig `status` is `mining`, `online` (idle), `stale`, `offline`, `error`, `archived`, or `forgotten`. `freshness` includes `connected`, `telemetryFresh`, `lastTelemetryAt`, and `ageSeconds`. `attention` and `reason` describe operational conditions. Rig API rows include `openIncidents`; unsuppressed incidents contribute to attention filters/counts and critical reasons. Maintenance suppresses attention without changing observed process state. Connected counts overlap mining/error/stale counts; do not add them to get total rigs.

Hashrate is always H/s. A mining process has an ID, CPU/GPU scope, algorithm, running/enabled flags, `hashrate`, original `hashrateObservedAt`, and `quality` (`valid`, `zero`, `stale`, `unavailable`). Rates are summed only within the same device type and algorithm. Only fresh, running processes with valid or zero observations contribute. Unavailable readings are not zero. An algorithm group with no reporting processes returns `hashrate: null` and `quality: unavailable`; partial groups say `partial`. Duplicate process IDs reject the entire snapshot before writing data. Legacy agent readings carry `source: legacy-cached`; update the agent to obtain original observation times and reliable command results.

Physical GPUs are separate from the GPU mining process. PCI addresses or hardware UUIDs identify cards; fallback identities explicitly say `positional`. Identical GPU models are retained. Aggregate Nanominer hashrate is never assigned to the first card. Individual-card hashrate/control is unavailable until a real per-card provider and verified device-selection implementation exist.

A process also reports launch `activeConfig`, `appliedConfigVersion`, desired/loaded versions, local overrides, PID, actual process start time, optional miner version, shares, and pool observation. Process uptime is elapsed time since the reported launch, not measured mining availability. Unknown launch times stay unknown. Stale or disconnected process uptime is null instead of continuing to imply confirmed runtime. Client display version and boot ID are sent during registration.

Sensors report CPU load/temperature, memory bytes/percentage, and GPU load/temperature/memory/power where available. Temperatures use °C and power uses watts; unavailable sensors remain null. The client expires sensor caches after 30 seconds. CPU thermal readings come from CPU-specific providers; arbitrary ACPI thermal zones are not labeled as CPU temperature. XMRig share counters and known pool/version log lines are parsed; unsupported Nanominer counters remain unavailable. No earnings or power estimate is inferred from hashrate. Summary `hardware` reports GPU inventory, fresh sensor-reporting rigs, measured GPU watts, contributing GPU count, and maximum fresh temperature. GPU watts exclude missing/stale readings and are not whole-rig or wall power; compare `gpuPowerReportingDevices` with `gpus`. No reporting power readings returns null; a measured zero remains zero.

## History and retention

Raw hashrates, sensor snapshots, logs, and events expire after `RAW_RETENTION_DAYS` (default 7; 1–365 allowed). MongoDB TTL deletion is asynchronous. One-minute hashrate integrals and command history are retained for 90 days. Config revisions and rig records persist. Current incidents persist; occurrence history is recorded as events under the raw retention policy.

Each original rate observation contributes until the next observation, a reported stop, or 60 seconds of freshness, whichever occurs first. Integrals split at minute boundaries and carry a replay watermark. Chart buckets sum observed contributions divided by bucket duration. Duplicate samples do not add time or extra contribution. Different algorithms and CPU/GPU scopes remain separate.

Chart `coverage` is observed process-time divided by bucket duration and the number of processes observed anywhere in that query window. Changing fleet membership can therefore produce partial coverage. A partial bucket is a lower bound on observed contribution, **not a claim about the missing readings**. Empty buckets are null. Stopped/offline periods without observations are gaps; a stop closes the last interval without inserting a synthetic measured zero. The API does not fabricate measurements. When only `to` and `timeframe` are supplied, the range is anchored to that historical end time. Responses include `aggregation`, `coverageBasis`, range, resolution, units, and retention metadata.

Old raw history remains readable through `/metrics/hashrate/raw`. It is not silently converted into the new accurate rollups: the old records lack reliable original timestamps and may contain incorrect algorithm labels. New charts begin with newly collected observations; copy/export needed old raw data before its existing TTL expires.

## REST conventions

The [OpenAPI description](../server/src/api/openapi.json) is also served at `/api/v1/openapi.json`.

Base path `/api/v1`; use `X-API-Key: <key>`, `Authorization: Bearer <key>`, or the existing admin bearer token. Bodies are JSON. Authentication endpoints remain under `/api/auth` and use browser sessions. Invalid/expired/revoked credentials return 401; a read-only key attempting a write returns 403. Operational validation returns 400, missing resources 404, state/concurrency conflicts 409, unsupported capabilities 422, and storage/service failures 503. Errors include `error` and optional field-specific `fields`; failures never masquerade as empty successful lists.

List responses generally contain `data` and `nextCursor`; rig lists also include `total` and `asOf`. Cursors are opaque. Keep the same filters/sort when following a cursor. Lists describe a changing fleet, not an immutable export snapshot. CSV exports return one bounded page, not the entire collection; follow `X-Next-Cursor` response headers (or JSON cursors) when exporting more data. Empty boolean filters are treated as unset; other non-boolean values and nested/repeated query fields return 400.

### Fleet and rigs

- `GET /fleet/summary`: counts, per-algorithm rate groups, sensor/power coverage, freshness threshold, incident counts, monitoring health, and query scope. Counts also include idle rigs, maintenance and config drift.
- `GET /rigs`: current rig page. Filters: `q` (name/hostname/ID/address/tags), `status`, `attention=true`, exact `group`, exact `tag`, `includeArchived=true`, `includeForgotten=true`. Sorting: `sort=name|lastSeen|status|id`, `order=asc|desc`; `limit=1..500` (default 100), `cursor`; optional `format=csv`. Rows include pending command summaries and open incidents. Selecting `status=archived` or `status=forgotten` includes that inventory without a second flag.
- `GET /rigs/:id`: complete rig detail, including preserved archived/forgotten records.
- `GET /rigs/:id/devices`: hardware, physical device readings, mining processes, sensors, and reported capabilities.
- `PATCH /rigs/:id`: `name`, `group`, `tags` (up to 20), `maintenanceUntil` (ISO time within 30 days or null), `archived` boolean, `restore:true`, `acknowledgeInventory:true`, or recovery policy. Changes produce operator events.
- `DELETE /rigs/:id`: forgets and disconnects the rig, cancels pending commands, retains history, and blocks automatic registration for that identity. Restore with `PATCH {"restore":true}` before registering again. Archive merely excludes it from normal fleet views and control, while retaining telemetry/history.

Fleet filters also apply to `/fleet/summary`, `/metrics/hashrate`, and `/incidents`. The Activity tab is explicitly fleet-wide; rig detail activity is rig-specific. Active fleet summaries exclude archived and forgotten rigs even when those records are explicitly requested in a list. The initial inventory baseline is recorded at registration; accept a changed inventory deliberately after maintenance.

### Metrics, logs, and events

- `GET /metrics/hashrate`: chart series. Use `timeframe=1h|24h|7d|30d|90d` or explicit ISO `from`/`to`. `resolution=60|300|900|3600|86400` seconds; maximum 90 days, 2,500 time buckets, 64 series and 50,000 returned points. Boundaries are normalized to minutes. Default resolution is 300 seconds for windows up to one day, otherwise 3600. Optional `minerId`, `processId`, `algorithm`, `deviceType`, fleet filters, and `format=csv`.
- `GET /metrics/hashrate/raw`: individual retained rate records, including legacy data.
- `GET /metrics/sensors`: retained snapshots, normally sampled every 30 seconds per rig.
- `GET /logs`: bounded central log pages. Filters `minerId`, `processId`, `level=debug|info|warning|error`, literal text search `q`, `from`, `to`.
- `GET /events`: lifecycle/operator/recovery/incident events; filters `minerId`, `kind`, `from`, `to`.

Raw metrics, sensors, logs, events and command lists accept `limit=1..1000` (default 100), `cursor`, and `format=csv`. Newest-first order uses timestamp plus unique ID, so equal timestamps paginate consistently. List rows include `minerName`. Log observation time is separate from server receipt time; the UI sorts/displays receipt time and exposes the agent time on hover. Pause/resume preserves the visible data. The agent buffers at most 500 log lines, sends at most 100 per status cycle, and reports dropped lines; this is a bounded operational log feed, not guaranteed archival delivery.

### Commands

- `POST /commands`: body `{ "minerId": "rig-id", "action": "restart", "deviceType": "CPU" }`. Bulk form replaces `minerId` with `minerIds` (1–500 IDs). Supported actions: `start`, `stop`, `restart`, `device-enable`, `device-disable`, `config-update`; scope `CPU`, `GPU`, or `ALL`. Optional `timeoutSeconds` is 5–300 (default 60). `restartRunningOnly:true` preserves stopped processes. Individual `gpuId`/`deviceId` and inline launch `config` are rejected.
- `GET /commands`: history, filterable by `minerId`, `status`, `batchId`, `from`, `to`.
- `GET /commands/:id`: deadline, actor, transition history, result, and error.
- `POST /commands/:id/cancel`: cancels a pending command and signals its agent. Cancellation prevents subsequent steps; it does not undo a process operation that already completed.

Creation returns **202 Accepted**, not execution success. Single responses contain `data`; bulk responses contain `batchId` and a separate command or error for every target. Dispatch concurrency is bounded at eight targets. Supply `Idempotency-Key` for safe request retry (max 160 characters single, 100 bulk); reusing it for a different action/scope is a conflict. Keys and batch IDs are scoped to the caller (admin email or API key identity); separate integrations can reuse a request key without colliding. Retrying through a different API key is a different caller. A canceled command cannot dispatch after preparation.

States are `queued → sent → received → running → succeeded|failed|timed_out|canceled`. Later results cannot overwrite a terminal state. A timeout/server restart means execution outcome is unknown: inspect the rig before retrying. No blind replay occurs. A newer stop cancels an outstanding start/restart; other overlapping process commands return a conflict. The agent serializes process operations, checks deadlines, cancels delayed restarts, and remembers 100 command IDs across renderer reloads.

Ordinary start/restart uses the rig's assigned/local desired settings. Saving a global revision alone does not change an existing rig's assignment. CPU and GPU enable/disable are process-wide; enabling does not implicitly start mining. A failed native stop preserves the process's running/tracked state and fails a dependent restart.

### Configurations and rollout

- `GET /configs`: desired global configurations keyed by `xmrig` and `nanominer`.
- `PUT /configs/:type`: save a partial update; `If-Match` or body `version` protects against stale edits. Supports validated pool/user/algorithm fields, CPU thread percentage (10–100), and the existing miner-specific settings. Empty draft pool/user is allowed at save time; delivery with restart requires launchable settings.
- `GET /configs/:type/revisions`: up to 100 revisions, including the initial state.
- `POST /configs/:type/rollback`: `{ "version": "prior-version", "expectedVersion": "current-version" }`. Restores values as a new desired revision. It does not dispatch or restart.
- `POST /configs/:type/apply`: `{ "minerIds": ["rig-id"], "restart": true }`; explicit targets required. Delivery alone is the default. Restart affects only already-running processes of the relevant type. Returns per-rig command results and accepts `Idempotency-Key`.

The first binding initializes the rig's assignment from the current global configs. Reconnect/request-configs returns that rig's assignment. Delivery updates the assigned desired revision; observed loaded/running versions remain distinct. Local password, worker name, selected GPUs, executable path, and other retained local fields are reported as overrides. Revisions are persisted before replacing the current global document; a conflicting concurrent save can leave an unselected candidate revision in history. The current version returned by `/configs` is authoritative.

### Monitoring and recovery

- `GET /incidents`: cursor-paginated incidents, `limit=1..1000`, `minerId`, fleet filters, `severity=warning|critical`, `suppressed=true|false`, `acknowledged=true|false`, `from`, `to`. `resolved=false` (default) selects open records; `resolved=true` selects only resolved records. Rows include rig names. Occurrence history remains in `/events`.
- `POST /incidents/:key/acknowledge`: acknowledge an active incident. URL-encode the key.
- `GET /monitoring/rules`, `PUT /monitoring/rules`: shared rules. Defaults: offline/stale/zero/temperature/missing-GPU/reject/crash-loop checks enabled; temperature 85°C, start grace 120 seconds, reject threshold 5% after at least 20 shares, three unexpected exits in 15 minutes.

Rules run every 30 seconds. One failed rig check does not stop later rigs; summary and `/health` include monitor status, last sweep, last successful sweep, failed rig count, duration and interval. States are starting/healthy/degraded/unavailable/overdue; 90 seconds without a completed sweep is overdue. Readiness still reports database/index readiness separately. Multiple processes triggering one rule are retained in the incident message. Missing inventory detection does not depend on temperature-sensor support. Rule responses include numeric `limits`; temperatures are 1–150°C, rejects 0.1–100%, start grace 1–3600 seconds, crash windows 1–1440 minutes and crash count 1–100 (whole counts/times). Maintenance suppresses current incidents without erasing them. Resolve/open transitions produce history events. Acknowledging a resolved/reopened condition does not automatically acknowledge a new occurrence.

Recovery is **off by default**. Per-rig policy through PATCH: `{ "recovery": { "enabled": true, "zeroSeconds": 300, "cooldownMinutes": 30, "maxPerDay": 2 } }`. Limits: zero duration 120–3600 seconds, cooldown 5–1440 minutes, 1–10 attempts per rolling day. It only restarts a process still observed running at sustained zero, never a stopped process. It pauses for maintenance, a newer operator stop, overheating at 85°C, pending commands, cooldown, daily budget, or an unknown recovery command outcome within the previous day. Every attempt uses the normal command pipeline and produces an event. It does not reboot machines, change tuning, or recover a disconnected agent.

### Health

- `GET /api/live`: process liveness, even when storage is unavailable.
- `GET /api/health`: readiness; verifies database ping and index initialization, returns 503 on failure.
- `GET /api/v1/health`: authenticated readiness and monitoring details. The static admin shell remains available during database failure, and startup connection errors show a retry state instead of a misleading login prompt.

## WebSocket protocol

The backend accepts WebSocket upgrades on `/ws` (root retained for old desktop connections). Vite proxies `/ws`. Maximum payload is 1 MiB; per-session pending message count is bounded and slow receivers are closed for reconnect. The server uses native ping/pong every 30 seconds. Browser observers subscribe explicitly:

```json
{"type":"subscribe","data":{"token":"ADMIN_SESSION_OR_API_KEY"}}
```

Alternatively send `data.apiKey`. Missing/invalid credentials close the observer connection with code 4001. Key revocation ends current key subscriptions; expiry is enforced during delivery/sweeps. Credentials belong in the first frame, not a URL.

Observers receive incremental `miner_updated`, `miner_deleted`, `command_updated`, `monitoring_updated`, and `service_error` messages. Registered miners never receive fleet broadcasts. The admin batches update invalidations and rereads its sorted/filtered pages so a live delta cannot bypass a filter or preserve an old command badge. Pages/summary/history also refresh periodically. Reconnect performs a REST resync.

Agents send `{type, data}` without authentication. They can register, report their own telemetry/results/logs, and receive their assigned configurations/commands. They cannot subscribe to the fleet feed on a registered miner connection. Agent identity trust is unchanged; API keys do not authenticate miners. Registration requires stable `systemId` and includes `protocolVersion:2`, display `version`, `bootId`, capabilities (`commandResults`, `logs`, etc.), hardware/system information, and optional client name. The response is `bound` or silent `registered`, with `data.minerId`, assigned `configs`, and server protocol/capabilities.

`status-update` contains `processes`, sensor `stats` with observation time, and optional refreshed system inventory. `heartbeat` proves connection liveness only. Protocol v2 includes original rate observation timestamps in process snapshots; the separate legacy `hashrate-update` is ignored for v2 to prevent double recording. `logs` contains an `entries` array (max 100); `event` contains `kind` and `details`.

Commands arrive as `{ "type":"command", "data": { "id":"…", "action":"restart", "deviceType":"CPU", "deadline":"…", "configs":{} } }`; configs are included only for delivery/rollout. Agents send `{ "type":"command-result", "data": { "id":"…", "status":"succeeded", "result":{} } }`, or a failed result with an error. `command-cancel` carries the original ID. `request-configs` receives `config-update`; `unbound` closes binding.

Updates serialize per rig identity. Stored connection ownership is checked before status, result, or disconnect changes; replacing a connection prevents the old one from erasing the new session. Physical inventory and process totals have separate representations. Ordinary telemetry cannot overwrite command desired-state fields.

## Storage migration and deployment

`MONGO_URL` can override the existing `MONGO_HOST`, `MONGO_PORT`, `MONGO_USERNAME`, `MONGO_PASSWORD`, and `MONGO_DB_NAME` settings. The selected database name still comes from `MONGO_DB_NAME`. `TRUST_PROXY_IP=true` opts into using the first forwarded address when deployed behind the expected proxy; otherwise the observed socket peer is used. Confirm the actual proxy topology before enabling it.

Startup installs unique partial indexes on **string** system/connection identities before removing old unique sparse equivalents. Multiple null/missing identities are allowed. Duplicate string identities stop readiness rather than being silently deleted or merged. Existing single-field TTL periods are reconciled with retention settings. Validate on a backup/disposable copy before rollout; the regression suite covers migration from a sparse index with explicit nulls.

Build and deploy backend/admin together, then update desktop agents. The new `apiKeys` collection gets unique ID/hash indexes at startup; no plaintext key is stored. Create integration keys from the admin’s API access page after deployment. Old unauthenticated observer clients must provide credentials. Do not add keys to desktop miners for reporting. Existing agents can still register/report as legacy sources, but remote commands return 422 until an agent advertises acknowledged command support. No production deployment, live miner commands, or real hardware performance/temperature calibration was performed as part of this repair.

## Legacy route compatibility

Existing `/api/miners`, `/api/configs`, and `/api/stats` paths accept the same scoped key/session access and remain wrappers around the repaired services. Commands return 202 with a command resource, never an execution-success claim. Legacy start accepts `deviceType`, not an inline config; generic commands normalize `action` or `command` plus `params`. CPU/GPU toggles require a boolean `enabled` and reject individual GPU IDs. Config save does not broadcast; apply requires explicit `minerIds`. Stats responses now contain grouped, quality-aware series/current groups; integrations that depended on the old inaccurate shape must migrate to `/api/v1`.

## Desktop 1.2 compatibility (September 13, 2026)

The desktop advertises `capabilities.minerMaintenance: true` along with protocol 2 command acknowledgments. Management callers may send `miner-diagnose` or `miner-repair` through the existing `POST /api/v1/commands` endpoint, with `minerId`/`minerIds` and explicit `CPU`, `GPU`, or `ALL` scope. Older agents receive 422 for these actions. Repair defaults to a 300-second deadline; other commands retain 60 seconds. Authentication/permissions and idempotency behavior are unchanged.

`miner-diagnose` completes a file check and returns its diagnostic, which can report an unavailable executable. `miner-repair` refuses a running process, restores verified pinned engine files, and leaves mining stopped. It does not update the MineMaster app, modify protection policies, switch a custom executable selection, or repair arbitrary files. A timed-out/canceled file repair may finish an already-started atomic replacement; it never starts mining afterward. Inspect the resulting diagnostics before retrying.

Process snapshots and API details now preserve `diagnostic` (`status`, `code`, `message`, `path`, `version`, `expectedVersion`, `observedAt`), `paused`, `pauseReason`, and `restartPendingAt`. File verification is separate from pool connectivity/process health. Intentional battery/activity pauses contribute no current hashrate, are counted as `pausedProcesses` in algorithm summaries, and are excluded from zero/stale-rate attention and automatic zero recovery. The original observed hashrate timestamp is retained; no synthetic paused hashrate is invented.

CPU configuration adds `threads` (0–1024; 0 automatic), `cpuPriority` (0–5), `hugePages`, `pauseOnBattery`, `pauseOnActive` (0–3600 idle seconds), `tls`, `keepAlive`, and `backupPools` (up to three host:port addresses). Both engines accept `backupPools`, `restartOnCrash` (default false), `crashRestartDelaySeconds` (10–600), and `maxCrashRestartsPerHour` (0–5). These settings require desktop 1.2 to take effect. `threadPercentage` is now XMRig's efficient-autoconfiguration budget; explicit `threads` takes precedence. Local crash recovery uses the last successful launch configuration, a per-session hourly budget, and cancels on Stop. It is separate from server-controlled sustained-zero recovery.

Nanominer algorithm choices now match the 3.10 GPU release. Unsupported old selections need operator review; they are never silently remapped to a different coin. The `conflux` and `autolykos2` compatibility aliases map to Octopus/Autolykos. Admin delivers desired settings, while already-running processes retain their launch configuration until restarted. Nonempty local password/rig-name/custom-path and explicit old GPU-index settings remain reported overrides.

Windows repair and the driver-free CPU default are documented in [the desktop guide](../client/README.md). The app never installs kernel drivers or disables antivirus. Actual Windows Security threat names and affected-machine verification are needed to confirm the remaining executable-block diagnosis.


## Desktop 1.3: selectable CPU engines and Windows diagnostics

CPU configuration remains under `/api/v1/configs/xmrig` and the `configs.xmrig` object. Its new `engine` field is `nanominer` or `xmrig`. New defaults use Nanominer with a 50% logical-thread budget. Stored configurations with no engine retain XMRig semantics; saving a revision does not automatically change an existing rig assignment. The GPU slot `/configs/nanominer` always uses Nanominer. Desktop macOS supports XMRig CPU only.

Agents advertise `capabilities.cpuEngines: ["xmrig", "nanominer"]` on supported Windows/Linux builds, or `["xmrig"]` on macOS. Initial binding and `request-configs` omit an unsupported Nanominer CPU assignment and send an explanatory error; they still deliver compatible GPU settings. The server rejects start/restart/config-update/device-enable for CPU or ALL with 422 when the chosen CPU engine is unsupported. Stop and compatible diagnostic commands remain available. Existing clients must upgrade or receive an XMRig CPU assignment; the server never treats silently ignored engine selection as success.

Nanominer CPU accepts only `algorithm: "rx/0"`, host:port pools, shared credentials, explicit `threads` or `threadPercentage`, and crash-recovery settings. Effective threads equal the positive explicit count capped at available logical cores, otherwise the percentage of available logical cores rounded down, minimum one. Nondefault XMRig-only tuning (priority, activity/battery pauses, huge-page disabling, TLS/keepalive switches and extra arguments) is rejected. The forms clear incompatible tuning when switching to Nanominer. Nanominer negotiates SSL with plaintext fallback and charges a 2% RandomX developer fee; XMRig retains its documented controls and minimum 1% donation.

Process ID `xmrig-1` and `type: "xmrig"` still identify the CPU slot. `engine` identifies the actual running engine (selected engine when stopped); old agents without this field report null on the backend. `activeConfig.engine` records the launched choice independently of desired configuration. Running Nanominer CPU reports `effectiveSettings: {cpuThreads, devFeePercent: 2}`; stopped processes do not claim effective threads. CPU/GPU rates remain separate H/s series with unchanged freshness/coverage rules. The desktop, rig details and `/rigs/:id/devices` expose this information.

CPU and GPU Nanominer processes share installed engine files but use separate configs/PIDs/working directories. Repair is refused while any process using those files is running or has pending crash recovery. Repair cancels the targeted process's own scheduled retry and never starts mining. Stop both scopes before repairing Nanominer when both use it.

File diagnostics additionally preserve `engine`, `sha256`, `expectedSha256`, and `sourceUrl`. Explicit `miner-diagnose` on Windows can attach `windows: {status, checkedAt, signatureStatus, message, detections}`. Detections contain bounded `threatName`, exact `resource` path, `detectedAt`, and `actionSuccess`; at most five are retained. The read-only native probe checks only matching executable/optional-driver paths, caches briefly and has a ten-second deadline. Unavailable history is explicitly unavailable. Historical matches are not proof of a current block; no match is not proof of permission. API/admin snapshots and command results preserve these diagnostics. No protection settings change and no Microsoft file upload occurs automatically.

See the [desktop operating guide](../client/README.md) and [second-pass validation](audits/client-2026-09-13/second-pass.md). Management access remains session/API-key gated; miner registration, telemetry and command receipts still require no key.

## Desktop 1.3.1: application updates and configuration ownership

Agents advertise `capabilities.appUpdates: true` for the update-command protocol. This capability does not imply that the current installation supports automatic updates: inspect `appUpdate.supported`. Status telemetry includes `appUpdate` with `state`, `supported`, optional `version`, `percent` (0–100), `message`, `updatedAt` and `checkedAt`. It is available on rig details and `/api/v1/rigs/:id/devices`; the admin rig details show it with telemetry freshness. Old agents may omit it. States are idle, checking, available, downloading, downloaded, installing, error and unsupported.

The existing command endpoint accepts `app-update-check` and `app-update-install`, both with `deviceType: "ALL"`. Management access remains required. Agents lacking the capability receive 422. Installation additionally requires fresh telemetry reporting a supported downloaded update (otherwise 409). The server captures `targetVersion`, `sourceVersion` and `sourceBootId`; the agent checks the exact downloaded target before installation. Check means the update check completed; an ensuing background download is tracked through telemetry.

An install defaults to a 600-second deadline and permits 5–1800 seconds; other command deadlines retain their existing maximum of 300 seconds. The desktop stops owned mining processes and hands off to the installer. That handoff remains **running**, even if an agent reports success. The server completes the command only after registration reports the requested version, different from the source version, and a different boot ID when one was originally recorded. Build metadata after `+` is ignored for version confirmation. A timeout or cancellation remains terminal even if the rig later upgrades; inspect its reported version before retrying. A newer Stop cancels an overlapping pending installation during preparation, but cannot reverse an OS installer after handoff.

Admin-assigned CPU passwords and other retained fields now carry a persisted ownership snapshot, so later admin revisions replace earlier admin values. Explicit local differences remain reported overrides. Switching the CPU engine clears a custom executable path belonging to the previous engine and displays a notice. Legacy profiles without an ownership snapshot preserve ambiguous nonempty local differences on their first delivery; review those overrides rather than assuming they were removed. Desired configuration still takes effect at the next launch or explicit restart.

Hardware inventory now includes `gpuDetectionStatus` and `gpuObservedAt`. Failed GPU enumeration retains its previous inventory timestamp and does not suppress successful CPU/OS refreshes. The admin flags retained inventory as unavailable/cached. See the [third desktop audit](audits/client-2026-09-13/third-pass.md) for tests and real-hardware limits.

## End-to-end 1.3.2 follow-up

Sensor snapshots preserve `cpu.observedAt`, `cpu.temperatureObservedAt`, `memory.observedAt` and `gpus[].observedAt` independently from `stats.observedAt` (report time). Each numeric reading becomes null after 60 seconds or for invalid observation times (including more than five seconds ahead). An explicitly missing timestamp remains unavailable; older reports that omit the field fall back to report time. The same aging calculation feeds rig reads, fleet summaries, monitoring and automatic recovery. Historical rows retain the timestamps recorded at ingestion; old rows are not migrated. Empty envelopes do not count toward `hardware.sensorReportingRigs`.

Sustained-zero recovery requires continuous reporting from the same launch. Reconnection, a gap exceeding the freshness window, or a changed launch resets `zeroSince`; an out-of-order observation cannot restore a previous process's rate. Optional share counters, pool metadata, version strings and local override lists are normalized before storage. Invalid optional fields do not turn a valid process report into a successful-looking default measurement.

Desktop 1.3.2 replays installer handoff as running after reconnect or duplicate delivery, without reinstalling. Target-version registration remains the success criterion; timeouts and cancellations remain terminal. Admin action labels are human-readable while API action values remain unchanged. See the [end-to-end audit](audits/end-to-end-2026-09-13.md).

## End-to-end 1.3.3 follow-up

Whole-rig start/restart/stop/disable commands write `desiredState.ALL`, `.CPU` and `.GPU` together. A subsequent scoped command changes its own entry; recovery gives scoped intent precedence when timestamps tie. Desired state remains separate from acknowledged execution. A Stop still dispatches if a restart selected for cancellation finishes concurrently; storage failures are not swallowed.

`restartRunningOnly` reports idle processes skipped without issuing Stop or Start. Desired configuration delivery still occurs before the skip. Desktop native output carries optional `stream` (`stdout`/`stderr`) and `runId` for independent line assembly; process rates and complete centralized log lines can no longer be corrupted by interleaved stderr chunks. REST/WebSocket command action names and reporting access remain unchanged. See the [second end-to-end pass](audits/end-to-end-2026-09-13.md#second-end-to-end-pass--desktop-133).

## Logging and attention follow-up — 1.3.4

`attention=false` now selects only rigs without an attention flag; omission still selects all rigs and `true` selects flagged rigs. The dashboard exposes all three choices, including saved URL/view state. Fleet summaries, history scoped through fleet filters, and incident selection share this interpretation. Maintenance/suppression can clear flags, so “No attention flagged” is not a claim that every sensor is healthy.

The desktop network log queue remains capped at 500 entries with batches of at most 100. Overflow warnings no longer evict an additional buffered entry. Failed/backpressured sends retain both queued lines and their drop count; a successful socket send consumes only the lines included in that batch. Logging remains best effort: a socket send is not a database acknowledgment, and abrupt disconnects/crashes can lose logs. This pass does not introduce durable log delivery or log deduplication.

## Dispatch and transport follow-up — 1.3.5

Command dispatch now checks the stored deadline when moving from queued to sent. A command that expires during preparation becomes `timed_out` immediately, with a “before dispatch” explanation and no `sentAt`; it is not transmitted. Canceled or otherwise terminal commands remain terminal, including on late receipts and idempotent retries. `sentAt` now records the dispatch transition rather than the earlier preparation start. Desired-state/configuration writes already completed during preparation are retained as intent, not evidence that a command executed. Commands that expire after dispatch retain the existing unknown-outcome semantics.

Desktop log batches obey both the 100-entry maximum and the 1 MiB JSON/UTF-8 payload limit, including escaped characters and overflow warnings. Long non-ASCII or escaped lines are divided into smaller batches instead of indefinitely blocking the queue. A timed-out desktop connection retires socket ownership before closing, so late open, binding and command events cannot revive it. Retry/backpressure, unauthenticated miner reporting, and management access requirements are unchanged.

## SRBMiner integration — desktop 1.4

Both configuration slots accept `engine: "srbminer"`; slot names and process IDs remain `xmrig`/`xmrig-1` for CPU and `nanominer`/`nanominer-1` for GPU. Process telemetry reports `engine: "srbminer"`. Registration capabilities add SRBMiner to `cpuEngines` and `gpuEngines` on supported clients. Registration and `request-configs` omit incompatible assignments and return an explicit error. Start, restart, configuration delivery and enable operations reject unsupported assignments with 422; Stop remains available. Upgrade clients before changing fleet configuration.

`GET /api/v1/mining/engines` requires read access and returns `data.srbminer`: pinned version/source, algorithm names and command arguments, developer fee percentages, vendor support, numeric field bounds/defaults, platforms and scope notes. It is a static upstream capability catalog, not hardware detection or a profitability service. The OpenAPI document describes this route and configuration fields.

SRBMiner adds `srbGpuIntensity` (0–31, default 0/automatic), `srbCpuPriority` (1–5, default 2), `srbRetrySeconds` (1–120, default 10), `srbPoolAttempts` (1–100, default 5), `srbMainPoolSeconds` (120–86400, default 600), `srbJobTimeout` (0–3600, default 0/off), and `srbStratumMode` (0–2, default 0). Intensity applies to GPU and thread priority to CPU. Existing thread limits, huge-page selection, pool/backup addresses, wallet, password, worker, TLS, keepalive and crash recovery fields remain managed. CPU worker identity uses `workerName`; GPU uses `rigName`. Credentials/worker names cannot contain upstream list separators `, ; ! #`. XMRig-only priority/activity settings and arbitrary arguments are rejected for SRBMiner.

Canonical algorithms retain fleet identity: `rx/0` launches upstream `randomx`, `rx/arq` launches `randomarq`, and `autolykos` launches `autolykos2`. Other catalog names pass through unchanged, including GPU `pearlhash`. One algorithm runs per process. Rates remain H/s, with unavailable share/pool observations missing rather than invented. `effectiveSettings.devFeePercent` is the published algorithm fee, not measured revenue or a hashrate adjustment. See the [client integration audit](audits/client-2026-09-13/srbminer.md) for limitations.

### SRBMiner follow-up — desktop 1.4.1

SRBMiner capabilities now require the native preload's platform **and architecture** to be Windows/Linux x64; unknown targets and ARM64 do not advertise it. The local selector uses the same check, and native launch refuses unsupported targets even with a custom executable. Existing server capability gates continue filtering delivery and rejecting incompatible launch commands.

Both validators reject nondefault settings belonging to the other process scope: `srbGpuIntensity` must remain 0 in CPU configurations and `srbCpuPriority` must remain 2 in GPU configurations. Defaults remain accepted for compatibility with the shared configuration schema. Colored process output is stripped before parsing engine version details.

### Stopped process reporting — desktop 1.4.2

Desktop snapshots for stopped processes report the desired engine/algorithm together. They clear `activeConfig`, `appliedConfigVersion`, running version, PID/start time, effective settings, hashrate/timestamp, pool/share observations and pause state. The desired revision and pending restart time remain available. Confirmed Stop, exit notifications and native reconciliation apply the same cleanup immediately; running processes still report their actual launch identity until stopped/restarted. This prevents a newly selected engine from appearing alongside the previous engine's algorithm or observations. Negative client hashrates are unavailable, matching backend validation. Historical server records remain unchanged.

## September 14 reliability follow-up — desktop 1.4.3

GPU inventory checks apply to Start, Restart and Enable. Stop/Disable remain available during missing inventory, and maintenance/configuration commands retain their own access/capability checks. A socket dispatch still requires a receipt before execution is considered successful.

Fleet `q` search now also matches group names (case-insensitive substring), alongside name, hostname, ID, IP and tags. Exact `group` and `tag` filters remain available. Fleet summaries, history and incident filtering use the same fleet selection. Admin rendering supports TH/s and PH/s; API rates remain H/s. Incident and pending-command association now uses per-rig maps to avoid repeated full-array scans.

Client native polling rejects responses predating a newer lifecycle operation/event. New-run output carries native run identity for reconciliation, preventing automatic-restart samples from being erased by a later poll or inheriting previous-run counters. Stopped command receipts use the selected engine; running receipts use the active engine. See the [September 14 audit](audits/end-to-end-2026-09-14.md).
