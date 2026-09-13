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
