const fs = require("fs/promises");
const path = require("path");
// electron-updater removes the old AppImage before moving its replacement. Keep one recoverable copy.
function createAppImageBackup({ userData, appImage, version }) {
  const journal = path.join(userData, "appimage-update-backup.json");
  async function read() {
    try {
      return JSON.parse(await fs.readFile(journal, "utf8"));
    } catch {
      return null;
    }
  }
  return {
    async prepare(targetVersion) {
      if (!appImage) return;
      const backup = appImage + ".minemaster-backup";
      await fs.access(path.dirname(appImage), require("fs").constants.W_OK);
      await fs.copyFile(appImage, backup + ".tmp");
      await fs.rename(backup + ".tmp", backup);
      await fs.writeFile(
        journal + ".tmp",
        JSON.stringify({
          original: appImage,
          backup,
          sourceVersion: version,
          targetVersion,
        }),
        { mode: 0o600 },
      );
      await fs.rename(journal + ".tmp", journal);
    },
    async restore() {
      const data = await read();
      if (!data || data.sourceVersion !== version || data.original !== appImage)
        return;
      try {
        await fs.access(data.original);
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
        await fs.copyFile(data.backup, data.original);
      }
    },
    async complete() {
      const data = await read();
      if (
        !data ||
        data.targetVersion !== version ||
        data.sourceVersion === version ||
        data.backup !== data.original + ".minemaster-backup"
      )
        return;
      await fs.rm(data.backup, { force: true });
      await fs.rm(journal, { force: true });
    },
  };
}
module.exports = { createAppImageBackup };
