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
        // A renderer reload in the old app must not consume the new app's resume intent.
        if (data.sourceVersion === version && data.targetVersion !== version)
          return null;
        clear();
        if (
          data.targetVersion !== version ||
          data.sourceVersion === version ||
          !Number.isFinite(data.savedAt) ||
          data.savedAt > now() + 5000 ||
          now() - data.savedAt > 2 * 60 * 60 * 1000 ||
          !Array.isArray(data.minerIds) ||
          data.minerIds.some((id) => !["xmrig-1", "nanominer-1"].includes(id))
        )
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
