# API access

Sign in to the admin and open **API access**. Create a named key, choose **Read only** or **Full management**, choose its expiry, and copy the complete key when shown. Only a SHA-256 digest and identifying prefix are stored; the complete key cannot be retrieved later. The list shows expiry, last use (updated at most once per minute), and revocation status.

Read keys can use GET/HEAD operational endpoints, including fleet state, configurations, metrics, history, logs, events, incidents, health, and key metadata. Management keys also control miners, change rig metadata/configurations/rules, acknowledge incidents, and create or revoke keys. Existing admin sessions have management access. Revocation is idempotent and closes active subscriptions using that key. An in-flight request may already have passed authentication; revocation does not undo earlier actions.

## Request examples

Set `MINEMASTER_URL` to your server and `MINEMASTER_API_KEY` to a key obtained from the admin. Keep the key out of URLs. `X-API-Key` and `Authorization: Bearer` are accepted; when both are supplied, `X-API-Key` takes precedence.

```sh
curl -H "X-API-Key: $MINEMASTER_API_KEY" \
  "$MINEMASTER_URL/api/v1/fleet/summary"

curl -H "X-API-Key: $MINEMASTER_API_KEY" \
  "$MINEMASTER_URL/api/v1/rigs?attention=true&limit=100"

curl -H "X-API-Key: $MINEMASTER_API_KEY" \
  "$MINEMASTER_URL/api/v1/openapi.json"
```

With a management key and a known rig ID, an explicitly scoped command looks like this:

```sh
curl -X POST -H "X-API-Key: $MINEMASTER_API_KEY" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: restart-cpu-request-001' \
  --data '{"minerId":"YOUR_RIG_ID","action":"restart","deviceType":"CPU"}' \
  "$MINEMASTER_URL/api/v1/commands"
```

A 202 response acknowledges acceptance. Inspect `/api/v1/commands/COMMAND_ID` until it reaches a terminal status. Reuse the same idempotency key and credentials when retrying an uncertain HTTP response. A timed-out command has an unknown execution outcome; inspect the rig before issuing a new request. Different API keys are different callers for retry deduplication.

## Managing keys through the API

- `GET /api/v1/api-keys?limit=100&cursor=…`: metadata pages, without key secrets or digests.
- `POST /api/v1/api-keys`: `{ "name": "Reporting integration", "permission": "read", "expiresAt": null }`. Expiry can be a future ISO timestamp. Returns 201 with `data` metadata and the one-time `secret`.
- `DELETE /api/v1/api-keys/KEY_ID`: revokes access; repeated revocation returns the same revoked resource. Requires management access.

Missing, incorrect, expired or revoked credentials return 401. Read-only writes return 403. Storage failures remain 503. User login/setup endpoints retain their existing session flow; API keys are for operational resources. `/api/live` and `/api/health` remain public probes without fleet data.

## Live updates and miner reporting

Open `/ws` and send the credential in the first subscription frame:

```json
{"type":"subscribe","data":{"apiKey":"YOUR_API_KEY"}}
```

The server replies `subscribed` before sending incremental rig/command/monitoring updates. Invalid credentials close the connection with code 4001. Use REST for initial state, filtered lists and history, and resynchronize after reconnecting. The browser admin sends its session token automatically.

**Miner registration and reporting stay unauthenticated on the existing WebSocket protocol.** Agents do not need API keys to register, report status/hashrate/sensors/logs/results, or receive their assigned commands/configurations. A miner connection cannot subscribe to fleet broadcasts. The older REST `POST /api/miners` is an admin inventory/pre-registration utility and remains gated, as do the legacy read/control routes.

This adds an integration access boundary; it does not change the trust model for miner identities. Deploy the matching backend and admin together. No production key is created automatically by the code or tests.

See the [complete operational reference](backend-admin.md) and [OpenAPI document](../server/src/api/openapi.json) for filters, pagination, units, command semantics and rollout behavior.
