import React from "react";
export default function EngineOptions({ miner, onChange, bound }) {
  const disabled = miner.running || miner.loading || bound;
  const set = (key, value) => onChange({ ...miner.config, [key]: value });
  const id = (key) => `${miner.id}-${key}`;
  return (
    <details className="engine-options">
      <summary>Pool failover and recovery settings</summary>
      <div className="form-group">
        <label htmlFor={id("backupPools")}>
          Backup pools (up to three, comma separated)
        </label>
        <input
          id={id("backupPools")}
          value={(miner.config.backupPools || []).join(", ")}
          disabled={disabled}
          placeholder="backup.example.com:3333"
          onChange={(e) =>
            set(
              "backupPools",
              e.target.value.trim()
                ? e.target.value.split(",").map((v) => v.trim())
                : [],
            )
          }
        />
      </div>
      {miner.type === "xmrig" && (
        <>
          <div className="form-group">
            <label htmlFor={id("threads")}>
              Explicit CPU threads (0 uses automatic tuning)
            </label>
            <input
              id={id("threads")}
              type="number"
              min={0}
              max={1024}
              value={miner.config.threads ?? 0}
              disabled={disabled}
              onChange={(e) => set("threads", Number(e.target.value))}
            />
          </div>
          {["hugePages", "tls", "keepAlive"].map((key) => (
            <div className="form-group" key={key}>
              <label>
                <input
                  type="checkbox"
                  checked={miner.config[key] ?? key === "hugePages"}
                  disabled={disabled}
                  onChange={(e) => set(key, e.target.checked)}
                />{" "}
                {
                  {
                    hugePages: "Use huge pages when available",
                    tls: "Use TLS for every pool (requires pool support)",
                    keepAlive: "Pool keepalive (requires pool support)",
                  }[key]
                }
              </label>
            </div>
          ))}
        </>
      )}
      <div className="form-group">
        <label>
          <input
            type="checkbox"
            checked={miner.config.restartOnCrash === true}
            disabled={disabled}
            onChange={(e) => set("restartOnCrash", e.target.checked)}
          />{" "}
          Restart after an unexpected exit
        </label>
        <span className="field-hint">
          Disabled by default. Stop cancels a pending restart. Blocked launches
          are not retried.
        </span>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label htmlFor={id("crash-delay")}>
            Wait before retrying (seconds)
          </label>
          <input
            id={id("crash-delay")}
            type="number"
            min={10}
            max={600}
            disabled={disabled}
            value={miner.config.crashRestartDelaySeconds ?? 30}
            onChange={(e) =>
              set("crashRestartDelaySeconds", Number(e.target.value))
            }
          />
        </div>
        <div className="form-group">
          <label htmlFor={id("crash-budget")}>Maximum restarts per hour</label>
          <input
            id={id("crash-budget")}
            type="number"
            min={0}
            max={5}
            disabled={disabled}
            value={miner.config.maxCrashRestartsPerHour ?? 2}
            onChange={(e) =>
              set("maxCrashRestartsPerHour", Number(e.target.value))
            }
          />
        </div>
      </div>
      <div className="form-group">
        <label htmlFor={id("customPath")}>
          Custom executable path (optional local override)
        </label>
        <input
          id={id("customPath")}
          value={miner.config.customPath || ""}
          disabled={miner.running || miner.loading}
          onChange={(e) => set("customPath", e.target.value)}
        />
        <span className="field-hint">
          Leave empty for the verified managed release. Custom files are not
          repaired or assigned a verified version.
        </span>
      </div>
    </details>
  );
}
