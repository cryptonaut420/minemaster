# MineMaster Server

Central backend and React admin for the MineMaster desktop clients. The active admin pages are Dashboard and Global Configurations. It uses Express, MongoDB, WebSocket, and a Vite build.

The [backend/admin reference](../docs/backend-admin.md) documents every current REST route, message envelope, telemetry interval, storage unit, and known contract limitation. The [September 2026 operational audit](../docs/audits/backend-admin-2026-09-12/README.md) records the original findings. The [implementation report](../docs/audits/backend-admin-2026-09-12/implementation.md) tracks the repair and validation.

## Setup

Use Node.js 20.19 or newer for the development and test tools. The verified local runtime was Node 25.9.0.

From the repository root:

```sh
npm --prefix server ci
npm --prefix server/public ci
```

Create `server/.env` from `server/env.example` if it does not exist. Configure `MONGO_HOST`, `MONGO_PORT`, `MONGO_USERNAME`, `MONGO_PASSWORD`, and `MONGO_DB_NAME`. `PORT` defaults to 3001. MongoDB is a separate service; this directory's Compose file does not provision it.

## Development

Run the API and admin in separate terminals:

```sh
cd server
NODE_ENV=development npm run dev
```

```sh
cd server/public
npm run dev
```

API: [localhost:3001](http://localhost:3001). Admin: [localhost:3002](http://localhost:3002).

Vite proxies `/api` and `/ws`. Observers subscribe for incremental rig updates; periodic REST reconciliation handles missed messages and reconnects.

## Production

```sh
npm --prefix server/public run build
cd server
NODE_ENV=production npm start
```

Express serves `public/build` in production. The current Dockerfile builds the admin and runs the server on Node 18. The local audit build used Node 25.9.0 and does not verify the container image.

## Operational behavior

- `/api/v1/fleet/summary` and `/api/v1/rigs` provide shared, freshness-aware fleet data with filters and rig pagination.
- `/api/v1/metrics/hashrate` returns per-algorithm time-weighted history, null gaps, coverage, and configurable ranges/resolution.
- `/api/v1/commands` provides single/bulk acknowledged process control, persistent outcomes, deadlines, cancellation, and idempotency.
- `/api/v1/configs` provides validated desired settings, revisions, rollback, and explicit per-rig rollout.
- `/api/v1/logs`, `/events`, `/metrics/sensors`, `/incidents`, and `/monitoring/rules` support central operations and matching UI/API views.
- The admin includes attention filters, saved views, groups/tags, column preferences, mobile rig rows, central logs, command history, maintenance, and optional bounded recovery.
- `/api/live` is liveness; `/api/health` verifies database/index readiness.
- Raw history defaults to seven days; hashrate rollups and commands retain 90 days. Individual GPU control remains explicitly unsupported.

Operational REST routes accept the admin bearer token or a named API key. Create read-only or full-management keys in the admin’s API access page; see [API access](../docs/api-access.md). Miner WebSocket registration/reporting remain unauthenticated. Observer subscriptions require credentials. First admin setup uses the registration screen; subsequent sessions use login. Password maintenance is documented by `scripts/reset-password.js`.

## Validation

Run from the repository root:

```sh
npm --prefix server test
npm --prefix server/public run build
node server/scripts/preview-fixture.cjs
```

The tests create a disposable MongoDB and synthetic agents; no real miner executes. The browser fixture binds to `127.0.0.1:43188`, uses temporary data, and simulates commands. See [AGENTS.md](../AGENTS.md), the [API reference](../docs/backend-admin.md), and the [implementation report](../docs/audits/backend-admin-2026-09-12/implementation.md).
