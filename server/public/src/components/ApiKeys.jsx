import React, { useState } from "react";
import api from "../services/api";
import { useNotifications } from "./Notifications";
import { at, Badge, ErrorNotice, errorText, useResource } from "./Operations";
import "./Dashboard.css";

export default function ApiKeys() {
  const notify = useNotifications();
  const [cursor, setCursor] = useState(null),
    [pages, setPages] = useState([]);
  const keys = useResource("api-keys", { limit: 50, cursor }, 30000);
  const [name, setName] = useState(""),
    [permission, setPermission] = useState("read"),
    [days, setDays] = useState("90"),
    [secret, setSecret] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [copied, setCopied] = useState(false);
  async function create(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await api.post("/v1/api-keys", {
        name,
        permission,
        expiresAt: days
          ? new Date(Date.now() + Number(days) * 86400000).toISOString()
          : null,
      });
      setSecret(response.data.secret);
      setCopied(false);
      setName("");
      setCursor(null);
      setPages([]);
      keys.reload();
      notify.success(
        "API key created. Copy it before leaving this page.",
        6000,
      );
    } catch (e) {
      setError(errorText(e));
      notify.error(errorText(e), 10000);
    } finally {
      setBusy(false);
    }
  }
  async function revoke(id) {
    setBusy(true);
    setError("");
    try {
      await api.delete(`/v1/api-keys/${id}`);
      keys.reload();
      notify.success("API key revoked.");
    } catch (e) {
      setError(errorText(e));
      notify.error(errorText(e), 10000);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="operations">
      <header className="op-header">
        <div>
          <h1>API access</h1>
          <p>Connect reporting tools, scripts, and fleet integrations.</p>
        </div>
      </header>
      <ErrorNotice error={error || keys.error} retry={keys.reload} />
      <div className="op-access-layout">
        <section className="op-surface">
          <h2>Create an API key</h2>
          <p>
            Miner registration and telemetry do not need a key. Keys grant
            access to the fleet data and controls available in this admin.
          </p>
          <form onSubmit={create} className="op-edit">
            <label>
              Key name
              <input
                required
                maxLength={80}
                value={name}
                placeholder="Home dashboard, monitoring script…"
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Access
              <select
                value={permission}
                onChange={(e) => setPermission(e.target.value)}
              >
                <option value="read">Read only</option>
                <option value="manage">Full management</option>
              </select>
            </label>
            <p className="op-muted">
              {permission === "read"
                ? "Read fleet state, configurations, history, logs, and incidents."
                : "Read all data, control miners, change configurations, and create or revoke API keys."}
            </p>
            <label>
              Expires after
              <select value={days} onChange={(e) => setDays(e.target.value)}>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
                <option value="365">1 year</option>
                <option value="">No expiry</option>
              </select>
            </label>
            <button className="op-primary" disabled={busy || !!secret}>
              {busy ? "Saving…" : "Create key"}
            </button>
          </form>
          {secret && (
            <div className="op-secret" role="status">
              <h3>Copy your new key</h3>
              <p>This is the only time the complete key is shown.</p>
              <label>
                API key
                <input
                  readOnly
                  value={secret}
                  onFocus={(e) => e.target.select()}
                />
              </label>
              <div className="op-actions">
                <button
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(secret);
                      setCopied(true);
                    } catch {
                      setError(
                        "Select and copy the key above; clipboard access is unavailable in this browser.",
                      );
                    }
                  }}
                >
                  {copied ? "Copied" : "Copy key"}
                </button>
                <button onClick={() => setSecret("")}>I saved the key</button>
              </div>
            </div>
          )}
        </section>
        <section className="op-surface">
          <div className="op-section-title">
            <h2>Issued keys</h2>
            <button onClick={keys.reload}>Refresh</button>
          </div>
          {keys.loading && <p>Loading keys…</p>}
          {keys.data?.data.length === 0 && (
            <p className="op-empty">
              No API keys yet. Create one for your first integration.
            </p>
          )}
          <ul className="op-feed">
            {keys.data?.data.map((key) => (
              <li key={key.id}>
                <div className="op-row">
                  <strong>{key.name}</strong>
                  <Badge
                    status={key.status === "active" ? "online" : "offline"}
                  >
                    {key.status}
                  </Badge>
                </div>
                <p>
                  {key.permission === "manage"
                    ? "Full management"
                    : "Read only"}{" "}
                  · {key.prefix}…
                </p>
                <small>
                  Created {at(key.createdAt)} · Last used{" "}
                  {key.lastUsedAt ? at(key.lastUsedAt) : "Never"}
                </small>
                <small>
                  Expires {key.expiresAt ? at(key.expiresAt) : "Never"}
                </small>
                {key.status === "active" && (
                  <details>
                    <summary>Revoke access</summary>
                    <p>
                      Stops this key’s API access and live subscriptions
                      immediately.
                    </p>
                    <button
                      className="op-danger"
                      disabled={busy}
                      onClick={() => revoke(key.id)}
                    >
                      Revoke {key.name}
                    </button>
                  </details>
                )}
              </li>
            ))}
          </ul>
          <div className="op-pagination">
            <button
              disabled={!pages.length}
              onClick={() => {
                setCursor(pages.at(-1));
                setPages(pages.slice(0, -1));
              }}
            >
              Previous
            </button>
            <span>Page {pages.length + 1}</span>
            <button
              disabled={!keys.data?.nextCursor}
              onClick={() => {
                setPages([...pages, cursor]);
                setCursor(keys.data.nextCursor);
              }}
            >
              Next
            </button>
          </div>
        </section>
      </div>
      <section className="op-surface">
        <h2>Use the API</h2>
        <p>
          Send the key in the <code>X-API-Key</code> header, or as{" "}
          <code>Authorization: Bearer YOUR_API_KEY</code>. Your normal admin
          login continues to work in the browser.
        </p>
        <pre>{`curl -H 'X-API-Key: YOUR_API_KEY' '${window.location.origin}/api/v1/fleet/summary'`}</pre>
        <p>
          Start with <code>/api/v1/rigs</code>,{" "}
          <code>/api/v1/metrics/hashrate</code>, <code>/api/v1/commands</code>,
          and <code>/api/v1/logs</code>. Retrieve the complete specification at{" "}
          <code>/api/v1/openapi.json</code> using the same header.
        </p>
      </section>
    </div>
  );
}
