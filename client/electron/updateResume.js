const fs = require("fs");
const path = require("path");
function createResumeStore({ userData, version, now = Date.now }) {
  const file = path.join(userData, "update-resume-state.json");
  const clear = () => {
    try {
      fs.unlinkSync(file);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  };
  return {
    clear,
    save(minerIds, targetVersion) {
      if (
        typeof targetVersion !== "string" ||
        !targetVersion ||
        targetVersion === version
      )
        throw Error(
          "A different target app version is required before saving update resume state",
        );
      const data = {
        minerIds: [...new Set(minerIds)],
        sourceVersion: version,
        targetVersion,
        savedAt: now(),
      };
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(data), { mode: 0o600 });
      fs.renameSync(`${file}.tmp`, file);
    },
    take() {
      try {
        const data = JSON.parse(fs.readFileSync(file, "utf8"));
        // Releases through 1.1.3 wrote only these two fields immediately before
        // updater handoff. Preserve that explicit intent within its original
        // ten-minute window, once. Modern state stays strictly version-bound.
        if (
          Object.keys(data).length === 2 &&
          !Object.hasOwn(data, "targetVersion") &&
          Number.isFinite(data.savedAt) &&
          data.savedAt <= now() + 5000 &&
          now() - data.savedAt <= 10 * 60 * 1000 &&
          Array.isArray(data.minerIds) &&
          data.minerIds.every((id) => ["xmrig-1", "nanominer-1"].includes(id))
        ) {
          clear();
          return { ...data, targetVersion: version, legacyResume: true };
        }
        if (
          !Number.isFinite(data.savedAt) ||
          data.savedAt > now() + 5000 ||
          now() - data.savedAt > 2 * 60 * 60 * 1000 ||
          typeof data.targetVersion !== "string" ||
          !data.targetVersion ||
          typeof data.sourceVersion !== "string" ||
          !data.sourceVersion ||
          !Array.isArray(data.minerIds) ||
          data.minerIds.some((id) => !["xmrig-1", "nanominer-1"].includes(id))
        ) {
          clear();
          return null;
        }
        // Only valid, unexpired intent survives a renderer reload of the old app.
        if (data.sourceVersion === version && data.targetVersion !== version)
          return null;
        clear();
        if (data.targetVersion !== version || data.sourceVersion === version)
          return null;
        return data;
      } catch (_) {
        try {
          clear();
        } catch (_) {}
        return null;
      }
    },
  };
}
module.exports = { createResumeStore };
