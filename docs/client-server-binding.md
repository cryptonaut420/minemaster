# Client/server binding

Binding connects the desktop agent to its configured master server. The agent registers its stable system identity, hardware, client version, boot ID, and protocol capabilities. Reconnection replaces the old session; only the current connection may update that rig.

The desktop sends status roughly every five seconds and original hashrate observation timestamps. Heartbeats keep the connection alive but do not make stalled telemetry fresh. The server distinguishes idle, mining, stale, offline, and error states. It stores process totals separately from physical GPUs.

On initial binding, the rig receives global desired configs. Later reconnects return its assigned configs. Saving a global revision does not change an existing assignment; use the admin's explicit target rollout. Launch configuration/version stays attached to the running process. Local worker/password/GPU/path overrides remain visible in reporting.

Remote commands have IDs, deadlines, acknowledgments, results, and history. A send is not execution success. Failed stops retain running state, and a newer stop cancels pending restart steps. CPU/GPU controls apply to mining processes; individual GPU control is rejected until implemented. Older agents remain visible but must be upgraded for acknowledged controls.

The agent buffers a bounded set of central logs and reports process errors/exits. Sensor values depend on the OS/driver and remain unknown when unsupported. Maintenance and optional bounded recovery are controlled through the admin or the same API.

See the [backend/admin reference](backend-admin.md) for REST endpoints, protocol messages, retention, migration, and reporting definitions. Miner registration/reporting remain unauthenticated. Management/read APIs and fleet observer subscriptions require an admin session or API key; see [API access](api-access.md). Agent identity trust is otherwise unchanged.
