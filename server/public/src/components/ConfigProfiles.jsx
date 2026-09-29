import React, { useEffect, useState } from "react";
import api from "../services/api";
import { ErrorNotice, errorText } from "./Operations";
import { useNotifications } from "./Notifications";

export default function ConfigProfiles({
  type,
  draft,
  dirty,
  disabled,
  onLoad,
  onBusyChange,
}) {
  const notify = useNotifications();
  const [reload, setReload] = useState(0);
  const [rows, setRows] = useState([]),
    [selected, setSelected] = useState(""),
    [name, setName] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [confirmation, setConfirmation] = useState(null);
  useEffect(() => {
    let canceled = false;
    setRows([]);
    setSelected("");
    setName("");
    setError("");
    setConfirmation(null);
    setBusy(true);
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
  const profile = rows.find((r) => r.id === selected);
  async function act(action) {
    setConfirmation(null);
    onBusyChange(true);
    setBusy(true);
    setError("");
    try {
      if (action === "load") {
        // Re-fetch to avoid loading a profile another operator has replaced.
        const { data } = await api.get(`/v1/config-profiles/${selected}`);
        onLoad(data.data.config);
        notify.success(
          `Loaded ${data.data.name} into the draft. Save and deliver when ready.`,
          6000,
        );
      } else if (action === "delete") {
        await api.delete(`/v1/config-profiles/${selected}`, {
          headers: { "If-Match": profile.version },
        });
        setRows((prev) => prev.filter((r) => r.id !== selected));
        setSelected("");
        setName("");
        notify.success("Saved profile deleted. Rig settings are unchanged.");
      } else {
        const payload = { name, type, config: draft };
        const { data } =
          action === "replace"
            ? await api.put(`/v1/config-profiles/${selected}`, payload, {
                headers: { "If-Match": profile.version },
              })
            : await api.post("/v1/config-profiles", payload);
        setRows((prev) => [
          ...prev.filter((r) => r.id !== data.data.id),
          data.data,
        ]);
        setSelected(data.data.id);
        setName(data.data.name);
        notify.success(`Saved ${data.data.name}. Rig settings are unchanged.`);
      }
    } catch (e) {
      setError(errorText(e));
      notify.error(errorText(e), 10000);
    } finally {
      onBusyChange(false);
      setBusy(false);
    }
  }
  const locked = busy || disabled || !draft;
  return (
    <section
      className="op-surface op-profile-library"
      aria-label="Saved coin profiles"
    >
      <h2>Saved coin profiles</h2>
      <p className="op-muted">
        Keep wallets, pools and tuning ready for the next switch. Loading a
        profile changes only this draft.
      </p>
      <ErrorNotice error={error} retry={() => setReload((n) => n + 1)} />
      <div className="op-toolbar">
        <button disabled={locked} onClick={() => setReload((n) => n + 1)}>
          Refresh profiles
        </button>
        <label>
          Saved {type === "xmrig" ? "CPU" : "GPU"} profile
          <select
            value={selected}
            disabled={locked}
            onChange={(e) => {
              setSelected(e.target.value);
              setName(rows.find((r) => r.id === e.target.value)?.name || "");
              setConfirmation(null);
            }}
          >
            <option value="">{busy ? "Loading…" : "Choose a profile"}</option>
            {[...rows]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} · {r.config.algorithm}
                </option>
              ))}
          </select>
        </label>
        <button
          disabled={locked || !profile}
          onClick={() => (dirty ? setConfirmation("load") : act("load"))}
        >
          Load into draft
        </button>
        <label>
          Profile name
          <input
            value={name}
            maxLength={80}
            disabled={locked}
            placeholder="e.g. Quantus · Kryptex"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button disabled={locked || !name.trim()} onClick={() => act("create")}>
          Save draft as new profile
        </button>
        <button
          disabled={locked || !profile || !name.trim()}
          onClick={() => setConfirmation("replace")}
        >
          Replace saved profile
        </button>
        <button
          disabled={locked || !profile}
          onClick={() => setConfirmation("delete")}
        >
          Delete profile
        </button>
      </div>
      {confirmation && (
        <div role="alert" className="op-warning">
          <p>
            {confirmation === "load"
              ? "Replace your unsaved draft with this profile?"
              : confirmation === "replace"
                ? `Replace “${profile?.name}” with the current draft?`
                : `Delete “${profile?.name}” from the profile library? Existing rig settings and revision history stay available.`}
          </p>
          <div className="op-actions">
            <button disabled={locked} onClick={() => act(confirmation)}>
              Confirm {confirmation === "load" ? "load" : confirmation}
            </button>
            <button disabled={locked} onClick={() => setConfirmation(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
