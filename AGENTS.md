# MineMaster project guidance

Applies to the whole repository. Read this file before making changes.

## Project map
- `server/src/`: CommonJS Express API, MongoDB models, and WebSocket service.
- `server/public/src/`: React/Vite admin. Active pages are Dashboard and Configs.
- `client/src/`: React desktop renderer, telemetry, and remote-command handlers.
- `client/electron/`: process control, OS sensors, preload bridge, and updates.
- Read `docs/backend-admin.md` for the current REST/WebSocket contract.
- Read `docs/audits/backend-admin-2026-09-12/README.md` for repair history and remaining validation limits.

## Current priorities
- Prioritize accurate reporting, reliable remote controls, monitoring, API parity, and usable admin workflows.
- Management/read REST endpoints and observer feeds require an admin session or API key. Keep simple miner registration and telemetry reporting unauthenticated, as requested by the owner. Broader authentication/security changes remain outside scope.
- An audit finding or proposed endpoint is not an implemented feature. State what was actually changed and verified.

## Data and reporting rules
- Store hashrate in H/s with explicit algorithm and process/device identity. Never add unlike algorithms into a meaningful fleet total.
- Keep zero, missing, stale, and offline distinct. Cached readings retain their original observation timestamp.
- Separate desired configuration/state from observed process state and the configuration actually used at launch.
- Identify physical GPUs by stable hardware identifiers, not model names or array order.
- Use shared backend calculations for UI and API summaries; document units, window, aggregation, and sample coverage.
- Never convert database failures into successful empty/default data. Distinguish readiness from process liveness.
- Avoid full-document read/modify/write for independent telemetry fields; account for concurrent messages and reconnect generations.

## Command and UI rules
- Trace changes end to end: API → WebSocket → desktop service → renderer → Electron → reported result.
- A socket send is dispatch, not successful execution. Use explicit scope and observable outcomes when evolving commands.
- Require read/manage access on operational endpoints and observer subscriptions; test expired/revoked keys and read-only writes. Never store or return an API key's secret after creation.
- A newer stop must supersede a pending restart. Unknown device IDs must not fall back to all devices.
- Show pending actions, stale data, errors, and unsaved edits explicitly. Controls need accessible names and keyboard support.
- Keep scripts/build outputs separate from source. Do not launch mining binaries to test admin or API changes.
- Use isolated synthetic rigs and databases for tests; avoid live fleet commands or production data changes during verification.

## Validation and documentation
- Install dependencies in their package: `server/`, `server/public/`, or `client/`; there is no root application package.
- Admin build: `npm --prefix server/public run build`.
- Regression tests: `npm --prefix server test` (disposable MongoDB, protocol, reporting, and fake native process tests). Never substitute a deployment database.
- Include access boundaries, filter/incident agreement, cancellation during preparation, and monitor failure isolation in backend regressions. The second-pass report is `docs/audits/backend-admin-2026-09-12/second-pass.md`.
- Historical reproduction results describe the baseline only. The reproduction entry point now runs expected-correctness regressions.
- Browser fixture: `node server/scripts/preview-fixture.cjs` after the admin build; loopback only, disposable data and simulated commands.
- Format changed backend modules with the local Prettier dependency. Add focused behavioral regressions for substantial fixes.
- For protocol/storage changes, test reconnects, overlapping updates, zero/stale readings, and failed commands as relevant; validate migrations on disposable data.
- For UI changes, check a populated fixture, failure state, and narrow screen. Document whether real hardware was tested.
- Update `docs/backend-admin.md` with route/protocol changes and update the audit status when fixing a finding.
- Keep documentation links relative within the repository. Never document planned capabilities as available.

## Desktop client 1.2
- Read `client/README.md` and `docs/audits/client-2026-09-13/README.md` before changing miner distribution or lifecycle.
- Native process ownership is in `client/electron/mining/processManager.js`; renderer and shutdown/update paths must use it. Preserve real PID exit checks, pending-start cancellation, crash-retry limits and Stop cancellation. Never use `ChildProcess.killed` as proof of exit or kill by process basename.
- Pin releases in `client/electron/mining/releases.json`. Verify archive and installed-file hashes, preserve supplied license files, stage replacements, and package only the actual target platform/architecture. Never run mining binaries during tests or verification; use fake processes and `npm --prefix client test`.
- Keep managed binaries/configs in writable user-data directories, with original filenames. Do not change antivirus settings or introduce automatic quarantine-repair loops. Default CPU mining is driver-free with MSR tuning disabled; document its throughput tradeoff.
- Shared renderer/native configuration validation is `client/src/utils/miningConfig.js`. Keep backend `Config` validation and OpenAPI in agreement. Optional paused mining and file diagnostics must survive status normalization and remain visible through API/admin.
- New `miner-diagnose`/`miner-repair` commands require `capabilities.minerMaintenance`; check the API-to-native result path. Repair does not start mining and must refuse running processes. Miner reporting still needs no key.
- Client browser fixture: build the renderer, then run `node client/scripts/preview-fixture.cjs`. It simulates Electron and hardware, binds loopback only, and cannot prove Windows quarantine behavior or real miner performance.
