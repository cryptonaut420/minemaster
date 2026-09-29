const { getDb } = require("../db/mongodb");
const { viewRig } = require("./telemetry");
const version = (value) =>
  /^(?:v)?(\d+\.\d+\.\d+)(?:\+[^\s]+)?$/.exec(value || "")?.[1] || null;
let cached, pending;
async function latest(fetcher = fetch) {
  if (cached && Date.now() - Date.parse(cached.checkedAt) < 600000)
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
    ? "offline"
    : !installed
      ? "unknown"
      : installed === release
        ? "current"
        : "outdated";
  if (online && status !== "current") {
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
    canCheck:
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
  const rigs = rows
    .map((r) => state(viewRig(r), release.version))
    .sort(
      (a, b) =>
        Number(b.online) - Number(a.online) || a.name.localeCompare(b.name),
    );
  return { release, rigs, asOf: new Date().toISOString() };
}
module.exports = { latest, state, version, overview };
