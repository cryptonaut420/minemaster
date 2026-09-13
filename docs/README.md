# MineMaster documentation

MineMaster includes a desktop mining client and a central backend/admin. Start with the documentation for the component you are changing.

## Backend, admin, and integrations

- [API access](api-access.md): named keys, permissions, live subscriptions and request examples.
- [Backend/admin reference](backend-admin.md): current REST and WebSocket contracts, reporting semantics, storage, and setup.
- [Server setup](../server/README.md): install, development, and production commands.
- [Client/server binding](client-server-binding.md): connection lifecycle, configuration behavior, and current control limitations.
- [Backend/admin operational audit](audits/backend-admin-2026-09-12/README.md): original findings, implemented repairs, verification, and remaining validation limits.
- [Repository guidance](../AGENTS.md): expectations for implementation, validation, and documentation.

## Desktop client

- [Client README](../client/README.md)
- [Quick start](quick-start.md)
- [Installation](installation.md)
- [User guide](user-guide.md)
- [Mining configuration](mining-configuration.md)
- [IPC API reference](api-reference.md)
- [Architecture](architecture.md)
- [Development](development.md)
- [Troubleshooting](troubleshooting.md)
- [FAQ](faq.md)

The [backend/admin reference](backend-admin.md) describes the repaired working-tree behavior. The [implementation report](audits/backend-admin-2026-09-12/implementation.md) records validation and remaining hardware limits. Older desktop guides retain historical examples.

## Data flow

An independent desktop client keeps its settings and console locally. When bound to a master, it sends rig identity, hardware, process state, sensor snapshots, and parsed hashrates to that configured server and receives configurations and remote commands. It also communicates with the configured mining pool. The server stores rig snapshots, configuration revisions, command outcomes, sensor/log/event history, and time-weighted hashrate rollups in MongoDB. Raw retention defaults to seven days; rollups and commands retain 90 days.

## Known work

The [implementation report](audits/backend-admin-2026-09-12/implementation.md) records the completed operational repairs and the hardware/deployment checks still needed. The [second pass](audits/backend-admin-2026-09-12/second-pass.md) adds [API keys](api-access.md) and gated observer access while keeping miner reporting public. Broader authentication changes remain outside scope. [FUTURE_UPGRADES.md](../FUTURE_UPGRADES.md) contains older desktop ideas.

- [Desktop client audit and validation](audits/client-2026-09-13/README.md)
- [Desktop 1.3 second pass](audits/client-2026-09-13/second-pass.md): CPU engine selection, shared-file lifecycle and Windows diagnostics

- [Desktop 1.3.1 third audit](audits/client-2026-09-13/third-pass.md): Windows/Linux reliability, CPU configuration control and application updates.
- [End-to-end 1.3.2 audit](audits/end-to-end-2026-09-13.md): recovery continuity, sensor accuracy, update replay and admin controls.
