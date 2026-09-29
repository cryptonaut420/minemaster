const { getDb } = require("../db/mongodb");
const { viewRig } = require("./telemetry");
const version = (value) =>
  /^(?:v)?(\d+\.\d+\.\d+)(?:\+[^\s]+)?$/.exec(value || "")?.[1] || null;
let cached, pending;
const compare = (a, b) => {
  const x = version(a)?.split(".").map(Number),
    y = version(b)?.split(".").map(Number);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return Math.sign(x[i] - y[i]);
  return 0;
};
async function latest(fetcher = fetch, force = false) {
  if (
    cached &&
    Date.now() - Date.parse(cached.checkedAt) < (force ? 60000 : 600000)
  )
    return cached;
  if (pending) return pending;
  pending = (async () => {
    const response = await fetcher(
      "https://api.github.com/repos/cryptonaut420/minemaster/releases/latest",
      {
        headers: { Accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!response.ok)
      throw Error("Could not verify the latest published client release");
    const release = await response.json(),
      v = version(release.tag_name);
    const assets = new Set((release.assets || []).map((a) => a.name));
    if (
      !v ||
      release.draft ||
      release.prerelease ||
      ![
        "latest.yml",
        "latest-linux.yml",
        `MineMaster-${v}-Windows-Setup.exe`,
        `MineMaster-${v}-Linux.AppImage`,
      ].every((a) => assets.has(a))
    )
      throw Error("The latest client release is incomplete");
    return (cached = {
      version: v,
      url: `https://github.com/cryptonaut420/minemaster/releases/tag/v${v}`,
      publishedAt: release.published_at,
      checkedAt: new Date().toISOString(),
    });
  })();
  try {
    return await pending;
  } finally {
    pending = null;
  }
}
function state(r, release) {
  const installed = version(r.version),
    online = !!r.freshness?.connected;
  let status = !online
    ? r.activeUpdate
      ? "reconnecting"
      : "offline"
    : !installed
      ? "unknown"
      : installed === release
        ? "current"
        : compare(installed, release) > 0
          ? "newer"
          : "outdated";
  if (online && !["current", "newer"].includes(status)) {
    if (!r.capabilities?.appUpdates || r.appUpdate?.supported === false)
      status = "manual";
    else if (r.appUpdate?.state === "installing") status = "installing";
    else if (
      r.appUpdate?.version === release &&
      r.appUpdate?.state === "downloaded" &&
      r.freshness?.telemetryFresh
    )
      status = "ready";
    else if (
      r.appUpdate?.version === release &&
      r.appUpdate?.state === "downloading"
    )
      status = "downloading";
    else if (r.appUpdate?.state === "error") status = "error";
  }
  return {
    id: r.id,
    name: r.name,
    version: r.version,
    installed,
    online,
    status,
    appUpdate: r.appUpdate,
    activeUpdate: r.activeUpdate || null,
    canCheck:
      !["current", "newer", "installing"].includes(status) &&
      online &&
      !!r.capabilities?.appUpdates &&
      r.appUpdate?.supported !== false,
    canInstall: status === "ready",
  };
}
async function overview() {
  let release;
  try {
    release = await latest();
  } catch (e) {
    e.status = 503;
    throw e;
  }
  const rows = await getDb()
    .collection("miners")
    .find({ bound: true, archivedAt: null, forgottenAt: null })
    .toArray();
  // A freshly upgraded rig can reveal a release published during our cache window.
  if (rows.some((r) => compare(r.version, release.version) > 0)) {
    try {
      release = await latest(fetch, true);
    } catch (e) {
      e.status = 503;
      throw e;
    }
  }
  const updates = await getDb()
    .collection("commands")
    .find({
      minerId: { $in: rows.map((r) => r.id) },
      action: "app-update-install",
      status: { $in: ["queued", "sent", "received", "running"] },
      deadline: { $gt: new Date() },
    })
    .project({
      _id: 0,
      minerId: 1,
      id: 1,
      status: 1,
      targetVersion: 1,
      deadline: 1,
    })
    .toArray();
  const rigs = rows
    .map((r) =>
      state(
        {
          ...viewRig(r),
          activeUpdate: updates.find((c) => c.minerId === r.id),
        },
        release.version,
      ),
    )
    .sort(
      (a, b) =>
        Number(b.online) - Number(a.online) || a.name.localeCompare(b.name),
    );
  return { release, rigs, asOf: new Date().toISOString() };
}
module.exports = { latest, state, version, compare, overview };
