import React, { useEffect, useState } from "react";
import api from "../services/api";
import { Badge, ErrorNotice, errorText } from "./Operations";
import { useNotifications } from "./Notifications";
const matches = (profile, config) =>
  config &&
  Object.entries(profile.config).every(
    ([key, value]) => JSON.stringify(config[key]) === JSON.stringify(value),
  );
export default function ConfigProfiles({
  type,
  draft,
  baseline,
  dirty,
  disabled,
  onLoad,
  onBusyChange,
  onChooseDelivery,
  onActivated,
}) {
  const notify = useNotifications();
  const [reload, setReload] = useState(0),
    [rows, setRows] = useState([]),
    [name, setName] = useState("");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [confirmation, setConfirmation] = useState(null),
    [results, setResults] = useState(null);
  useEffect(() => {
    let canceled = false;
    setBusy(true);
    setError("");
    setConfirmation(null);
    setResults(null);
    (async () => {
      const items = [];
      let cursor;
      do {
        const { data } = await api.get("/v1/config-profiles", {
          params: { type, cursor },
        });
        if (canceled) return;
        items.push(...data.data);
        cursor = data.nextCursor;
      } while (cursor);
      if (!canceled) setRows(items);
    })()
      .catch((e) => {
        if (!canceled) setError(errorText(e));
      })
      .finally(() => {
        if (!canceled) setBusy(false);
      });
    return () => {
      canceled = true;
    };
  }, [type, reload]);
  const pendingCommands = (results || [])
    .filter(
      (r) =>
        r.command &&
        ["queued", "sent", "received", "running"].includes(r.command.status),
    )
    .map((r) => r.command.id)
    .join(",");
  useEffect(() => {
    if (!pendingCommands) return;
    let disposed = false,
      inFlight = false;
    const timer = setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const updates = await Promise.all(
          pendingCommands
            .split(",")
            .map((id) =>
              api.get(`/v1/commands/${id}`).then((r) => r.data.data),
            ),
        );
        if (!disposed)
          setResults((previous) =>
            previous?.map((row) => {
              const command = updates.find((c) => c.id === row.command?.id);
              return command
                ? {
                    ...row,
                    command,
                    status: command.status,
                    error: command.error,
                  }
                : row;
            }),
          );
      } catch (e) {
        if (!disposed) setError(errorText(e));
      } finally {
        inFlight = false;
      }
    }, 3000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [pendingCommands]);
  const locked = busy || disabled || !draft;
  async function act(action, profile) {
    setConfirmation(null);
    onBusyChange(true);
    setBusy(true);
    setError("");
    try {
      if (action === "activate") {
        notify.info(`Activating ${profile.name} for the fleet…`, 5000);
        const { data } = await api.post(
          `/v1/config-profiles/${profile.id}/activate`,
          { expectedConfigVersion: baseline.version },
          { headers: { "If-Match": profile.version } },
        );
        setResults(data.results);
        onActivated(data.config);
        const problems = data.results.filter(
          (r) =>
            r.error || ["failed", "timed_out", "canceled"].includes(r.status),
        ).length;
        const offline = data.results.filter(
          (r) => r.status === "awaiting_reconnect",
        ).length;
        notify.showToast(
          `${profile.name} is now the fleet default. ${offline ? `${offline} rigs await reconnect. ` : ""}${problems ? `${problems} rigs need attention below.` : "Running miners are switching; paused miners stay paused. Check command history for confirmations."}`,
          problems ? "error" : "info",
          9000,
        );
      } else if (action === "edit") {
        const { data } = await api.get(`/v1/config-profiles/${profile.id}`);
        onLoad(data.data.config);
        notify.info(
          `Editing ${data.data.name}. Mining stays unchanged until you activate or deliver it.`,
        );
      } else if (action === "delete") {
        await api.delete(`/v1/config-profiles/${profile.id}`, {
          headers: { "If-Match": profile.version },
        });
        setRows((prev) => prev.filter((r) => r.id !== profile.id));
        notify.success("Profile deleted. Fleet settings are unchanged.");
      } else {
        const payload = {
          name: action === "replace" ? profile.name : name,
          type,
          config: draft,
        };
        const { data } =
          action === "replace"
            ? await api.put(`/v1/config-profiles/${profile.id}`, payload, {
                headers: { "If-Match": profile.version },
              })
            : await api.post("/v1/config-profiles", payload);
        setRows((prev) => [
          ...prev.filter((r) => r.id !== data.data.id),
          data.data,
        ]);
        setName("");
        notify.success(`Saved ${data.data.name}. Activate it when ready.`);
      }
    } catch (e) {
      setError(errorText(e));
      notify.error(errorText(e), 10000);
    } finally {
      onBusyChange(false);
      setBusy(false);
    }
  }
  const active = rows.find((p) => matches(p, baseline));
  return (
    <section
      className="op-surface op-profile-library"
      aria-label="Saved coin profiles"
    >
      <div className="op-profile-heading">
        <div>
          <h2>{type === "xmrig" ? "CPU" : "GPU"} coin profiles</h2>
          <p>
            Fleet default:{" "}
            <strong>{active?.name || baseline?.coin || "Not loaded"}</strong>
            {baseline?.algorithm ? ` · ${baseline.algorithm}` : ""}
          </p>
        </div>
        <button disabled={locked} onClick={() => setReload((n) => n + 1)}>
          Refresh profiles
        </button>
      </div>
      <p className="op-muted">
        Choose a coin and activate it for all bound rigs. Running miners switch;
        paused miners stay paused. The other mining type is unchanged.
      </p>
      <ErrorNotice error={error} retry={() => setReload((n) => n + 1)} />
      {!rows.length && !busy && (
        <p>
          No saved profiles yet. Save your current settings below to keep a
          reusable pool and wallet setup.
        </p>
      )}
      <div className="op-coin-profiles">
        {[...rows]
          .sort(
            (a, b) =>
              Number(matches(b, baseline)) - Number(matches(a, baseline)) ||
              a.name.localeCompare(b.name),
          )
          .map((profile) => (
            <article
              key={profile.id}
              className={`op-coin-profile ${matches(profile, baseline) ? "is-active" : ""}`}
            >
              <div className="op-profile-heading">
                <strong className="op-profile-coin">
                  {profile.config.coin || profile.config.algorithm}
                </strong>
                {matches(profile, baseline) && (
                  <Badge status="online">Fleet default</Badge>
                )}
              </div>
              <h3>{profile.name}</h3>
              <p>
                {profile.config.engine} · {profile.config.algorithm}
              </p>
              <dl>
                <dt>Pool</dt>
                <dd>{profile.config.pool}</dd>
                <dt>Receiving wallet</dt>
                <dd className="op-profile-wallet">{profile.config.user}</dd>
              </dl>
              <button
                className="op-primary"
                disabled={locked || !baseline?.version}
                onClick={() => setConfirmation({ action: "activate", profile })}
              >
                {matches(profile, baseline)
                  ? "Reapply to fleet"
                  : "Activate for fleet"}
              </button>
              <div className="op-actions">
                <button
                  disabled={locked}
                  onClick={() =>
                    dirty
                      ? setConfirmation({ action: "edit", profile })
                      : act("edit", profile)
                  }
                >
                  Edit profile settings
                </button>
              </div>
              <details>
                <summary>More options</summary>
                <p className="op-muted">
                  {profile.config.backupPools?.length
                    ? `Backup pools: ${profile.config.backupPools.join(", ")}`
                    : "No backup pool"}
                </p>
                <div className="op-actions">
                  <button
                    disabled={locked}
                    onClick={() => onChooseDelivery(profile)}
                  >
                    Apply to selected rigs
                  </button>
                  <button
                    disabled={locked || !dirty}
                    onClick={() =>
                      setConfirmation({ action: "replace", profile })
                    }
                  >
                    Replace with edited settings
                  </button>
                  <button
                    disabled={locked}
                    onClick={() =>
                      setConfirmation({ action: "delete", profile })
                    }
                  >
                    Delete profile
                  </button>
                </div>
              </details>
            </article>
          ))}
      </div>
      {confirmation && (
        <div role="alert" className="op-warning op-profile-confirm">
          <strong>
            {confirmation.action === "activate"
              ? `Activate ${confirmation.profile.name} for all bound ${type === "xmrig" ? "CPU" : "GPU"} miners?`
              : confirmation.action === "edit"
                ? "Replace unsaved edits with this profile?"
                : confirmation.action === "replace"
                  ? `Replace ${confirmation.profile.name} with the edited settings?`
                  : `Delete ${confirmation.profile.name}?`}
          </strong>
          <p>
            {confirmation.action === "activate"
              ? "This sets the fleet default, switches running miners, and delivers to offline rigs when they reconnect. Paused rigs stay paused. Unsupported clients will be flagged for upgrade; model/driver compatibility still needs a tested profile. Any unsaved draft will be replaced."
              : "Other saved profiles and running settings are unchanged."}
          </p>
          <div className="op-actions">
            <button
              className="op-primary"
              disabled={locked}
              onClick={() => act(confirmation.action, confirmation.profile)}
            >
              {confirmation.action === "activate"
                ? "Confirm fleet activation"
                : "Confirm"}
            </button>
            <button disabled={locked} onClick={() => setConfirmation(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <details className="op-profile-save">
        <summary>Save current settings as another profile</summary>
        <div className="op-toolbar">
          <label>
            New profile name
            <input
              maxLength={80}
              value={name}
              disabled={locked}
              placeholder="e.g. Quantus · Kryptex"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button
            disabled={locked || !name.trim()}
            onClick={() => act("create")}
          >
            Save new profile
          </button>
        </div>
      </details>
      {results && (
        <div className="op-profile-result">
          <h3>Fleet activation delivery</h3>
          <p>
            Fleet default saved. Dispatch is not execution confirmation; command
            history below tracks each rig's result.
          </p>
          <ul className="op-feed">
            {results.map((r) => (
              <li key={r.minerId}>
                <strong>{r.name || r.minerId}</strong>
                <span>
                  {r.error ||
                    {
                      awaiting_reconnect: "Saved · will apply on reconnect",
                      assigned: "Assigned · check rig status",
                    }[r.status] ||
                    r.command?.status ||
                    r.status}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
