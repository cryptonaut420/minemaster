import React, { useState } from "react";
import api from "../services/api";
import { useResource, ErrorNotice, at, errorText } from "./Operations";
import { useNotifications } from "./Notifications";
export default function Profitability() {
  const resource = useResource("profitability", {}, 30000),
    notify = useNotifications();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const state = resource.data?.data,
    report = state?.lastResult;
  const money = (n) => `C$${n.toFixed(2)}`;
  async function check() {
    setBusy(true);
    setError("");
    try {
      await api.post("/v1/profitability/check");
      notify.info(
        "Profitability review requested. Results and Discord delivery status will appear here.",
      );
      resource.reload();
    } catch (e) {
      setError(errorText(e));
      notify.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="op-surface op-profile-library"
      aria-label="Daily profitability review"
      id="profitability"
    >
      <h2>Daily profitability review</h2>
      <p>
        {state?.enabled
          ? "Runs on the MineMaster server daily at 9 a.m. Vancouver time."
          : "Daily alerts are not configured on this server."}{" "}
        GPU + CPU recommendations via Discord. C$0.13/kWh. You choose when to
        switch.
      </p>
      <ErrorNotice error={resource.error || error} retry={resource.reload} />
      <div className="op-actions">
        <button
          disabled={!state?.enabled || busy || state?.running}
          onClick={check}
        >
          {state?.running ? "Review running…" : "Check profitability now"}
        </button>
        <button onClick={resource.reload}>Refresh review</button>
      </div>
      {state?.lastRun && (
        <p>
          Last checked: {at(state.lastRun)} · Discord:{" "}
          {state.lastDelivery?.status || "not reported"} ·{" "}
          {report?.groupsChecked || 0}/{report?.activeGroups || 0} active
          hardware/coin groups covered
        </p>
      )}
      <ErrorNotice error={report?.error || state?.lastDelivery?.error} />
      {!!report?.opportunities?.length && (
        <ul className="op-feed">
          {report.opportunities.map((r, i) => (
            <li key={i}>
              <strong>
                {r.kind} {r.name} · {r.devices} devices: {r.current.name} →{" "}
                {r.best.name}
              </strong>
              <span>
                {money(r.current.netBeforeFeesCad)} →{" "}
                {money(r.best.netBeforeFeesCad)}/device/day after estimated
                electricity, before fees
              </span>
              <small>
                {r.profiles.length
                  ? `Saved profile: ${r.profiles.join(", ")}`
                  : "No saved profile; check engine/model compatibility."}
              </small>
              <a href={r.best.url} target="_blank" rel="noreferrer">
                View benchmark source
              </a>
            </li>
          ))}
        </ul>
      )}
      {report && !report.error && !report.opportunities?.length && (
        <p>No qualifying alternative found within the checked coverage.</p>
      )}
      {!!report?.gaps?.length && (
        <details>
          <summary>{report.gaps.length} coverage gaps</summary>
          <ul>
            {report.gaps.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
        </details>
      )}
      <p className="op-muted">
        Hashrate.no 24-hour benchmark revenue, not measured income. Device power
        excludes the rest of the rig; miner/pool fees are not deducted. Alerts
        require at least C$0.10/device/day and 10% estimated improvement.
        Missing hardware or current-coin benchmarks stay unavailable.
      </p>
    </section>
  );
}
