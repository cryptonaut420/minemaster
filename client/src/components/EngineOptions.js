import React from "react";
import { engineFor, switchEngine, SRB } from "../utils/miningConfig";
export default function EngineOptions({ miner, onChange, bound }) {
  const disabled = miner.running || miner.loading || bound;
  const set = (key, value) => onChange({ ...miner.config, [key]: value });
  const id = (key) => `${miner.id}-${key}`;
  const srb = engineFor(miner.type, miner.config) === "srbminer";
  const nanoCpu =
    miner.deviceType === "CPU" &&
    engineFor(miner.type, miner.config) === "nanominer";
  return (
    <details className="engine-options">
      <summary>
        {miner.deviceType === "CPU"
          ? "CPU engine, pools and recovery"
          : "Pool failover and recovery settings"}
      </summary>
      {
        <div className="form-group">
          <label htmlFor={id("engine")}>{miner.deviceType} mining engine</label>
          <select
            id={id("engine")}
            disabled={disabled}
            value={engineFor(miner.type, miner.config)}
            onChange={(e) =>
              onChange(switchEngine(miner.type, miner.config, e.target.value))
            }
          >
            <option
              value="nanominer"
              disabled={window.electronAPI?.platform === "darwin"}
            >
              Nanominer{" "}
              {miner.deviceType === "CPU" ? "· RandomX · 2% fee" : "· GPU"}
            </option>
            {miner.deviceType === "CPU" && (
              <option value="xmrig">
                XMRig · advanced CPU controls · minimum 1% fee
              </option>
            )}
            <option
              value="srbminer"
              disabled={window.electronAPI?.platform === "darwin"}
            >
              SRBMiner-MULTI · CPU/GPU algorithms
            </option>
          </select>
          <span className="field-hint">
            CPU and GPU run separately. Changing engine clears its custom path
            and engine-specific tuning. Existing configurations keep their
            engine until changed.
          </span>
        </div>
      }
      {srb && (
        <>
          <p className="field-hint">
            SRBMiner 3.6.7. One algorithm per process; GPU models must support
            the selected algorithm. MSR tuning and miner-owned restarts are
            disabled. Pool fees are separate from the algorithm's developer fee.
          </p>
          {Object.entries(SRB.fields)
            .filter(([key]) =>
              miner.deviceType === "CPU"
                ? key !== "srbGpuIntensity"
                : key !== "srbCpuPriority",
            )
            .map(([key, field]) => (
              <div className="form-group" key={key}>
                <label htmlFor={id(key)}>{field.label}</label>
                <input
                  id={id(key)}
                  type="number"
                  min={field.min}
                  max={field.max}
                  value={miner.config[key] ?? field.default}
                  disabled={disabled}
                  onChange={(e) => set(key, Number(e.target.value))}
                />
              </div>
            ))}
          {miner.deviceType === "GPU" && (
            <>
              <div className="form-group">
                <label htmlFor={id("password")}>Pool password</label>
                <input
                  id={id("password")}
                  value={miner.config.password ?? "x"}
                  disabled={disabled}
                  onChange={(e) => set("password", e.target.value)}
                />
              </div>
              {["tls", "keepAlive"].map((key) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={miner.config[key] === true}
                    disabled={disabled}
                    onChange={(e) => set(key, e.target.checked)}
                  />{" "}
                  {key === "tls"
                    ? "Require TLS for all pools"
                    : "Pool keepalive"}
                </label>
              ))}
            </>
          )}
        </>
      )}
      <div className="form-group">
        <label htmlFor={id("backupPools")}>
          Backup pools (up to three, comma separated)
        </label>
        <input
          id={id("backupPools")}
          value={(Array.isArray(miner.config.backupPools)
            ? miner.config.backupPools
            : []
          ).join(", ")}
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
          {!nanoCpu &&
            ["hugePages", "tls", "keepAlive"].map((key) => (
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
