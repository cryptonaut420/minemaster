# MineMaster

MineMaster runs XMRig and Nanominer through an Electron desktop client and provides a central backend/admin for monitoring and remote control.

- [Documentation index](docs/README.md)
- [Backend/admin and API reference](docs/backend-admin.md)
- [Server setup](server/README.md)
- [Client setup](client/README.md)
- [Client/server binding](docs/client-server-binding.md)
- [Backend/admin audit and repair status](docs/audits/backend-admin-2026-09-12/README.md)
- [Contributor and agent guidance](AGENTS.md)

The backend/admin repair adds shared reporting, acknowledged process commands, central logs and incidents, versioned configuration rollout, and a refreshed fleet dashboard. See the [implementation and validation report](docs/audits/backend-admin-2026-09-12/implementation.md) for completed work and hardware/deployment limits. The follow-up adds scoped API keys and gates observer access while preserving unauthenticated miner registration/reporting. See [API access](docs/api-access.md) and the [second-pass report](docs/audits/backend-admin-2026-09-12/second-pass.md).

Desktop 1.3 adds selectable Nanominer/XMRig CPU mining, independent CPU/GPU Nanominer processes, engine-aware admin controls and read-only Windows detection diagnostics. New Windows/Linux profiles default to Nanominer; existing engine choices remain intact. The preceding 1.2 pass updated the bundled engines to XMRig 6.26.0 and Nanominer 3.10.0, verifies downloads and runtime files, improves native process ownership and Windows diagnostics, and adds scoped miner repair, CPU tuning, pool failover and opt-in crash recovery. See the [client audit](docs/audits/client-2026-09-13/README.md) and [second pass](docs/audits/client-2026-09-13/second-pass.md) for validation and rollout limits.

Desktop reliability and update follow-up: [1.3.1 audit](docs/audits/client-2026-09-13/third-pass.md).
