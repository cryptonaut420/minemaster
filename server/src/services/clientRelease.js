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
    else if (r.activeUpdate) status = "installing";
    else if (r.pendingCommand?.action === "app-update-check")
      status = "checking";
    else if (r.appUpdate?.state === "installing" && r.freshness?.telemetryFresh)
      status = "installing";
    else if (
      r.appUpdate?.version === release &&
      r.appUpdate?.state === "downloaded" &&
      r.freshness?.telemetryFresh
    )
      status = "ready";
    else if (
      r.appUpdate?.version === release &&
      r.appUpdate?.state === "downloading" &&
      r.freshness?.telemetryFresh
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
    pendingCommand: r.pendingCommand || null,
    lastUpdate: r.lastUpdate || null,
    telemetryFresh: !!r.freshness?.telemetryFresh,
    canCheck:
      (status !== "current" || r.appUpdate?.state === "error") &&
      !["newer", "installing", "checking", "downloading", "ready"].includes(
        status,
      ) &&
      !r.pendingCommand &&
      !r.activeUpdate &&
      online &&
      !!r.capabilities?.appUpdates &&
      r.appUpdate?.supported !== false,
    canInstall: status === "ready" && !r.pendingCommand && !r.activeUpdate,
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
  const commands = getDb().collection("commands"),
    ids = rows.map((r) => r.id),
    projection = {
      _id: 0,
      minerId: 1,
      id: 1,
      action: 1,
      status: 1,
      targetVersion: 1,
      deadline: 1,
      createdAt: 1,
      updatedAt: 1,
      error: 1,
    };
  // Include all active controls: an update has ALL scope and cannot overlap
  // another pending command. Keep overdue work blocked until expiry reconciles it.
  const [pendingCommands, attempts] = await Promise.all([
    commands
      .find({
        minerId: { $in: ids },
        status: { $in: ["queued", "sent", "received", "running"] },
      })
      .project(projection)
      .sort({ createdAt: -1, id: -1 })
      .toArray(),
    commands
      .aggregate([
        {
          $match: {
            minerId: { $in: ids },
            action: { $in: ["app-update-check", "app-update-install"] },
          },
        },
        { $sort: { minerId: 1, createdAt: -1, _id: -1 } },
        { $group: { _id: "$minerId", attempt: { $first: "$$ROOT" } } },
        { $replaceRoot: { newRoot: "$attempt" } },
        { $project: projection },
      ])
      .toArray(),
  ]);
  const pendingByRig = new Map(),
    installsByRig = new Map(),
    lastByRig = new Map(attempts.map((c) => [c.minerId, c]));
  for (const command of pendingCommands) {
    if (!pendingByRig.has(command.minerId))
      pendingByRig.set(command.minerId, command);
    if (
      command.action === "app-update-install" &&
      !installsByRig.has(command.minerId)
    )
      installsByRig.set(command.minerId, command);
  }
  const rigs = rows
    .map((r) =>
      state(
        {
          ...viewRig(r),
          activeUpdate: installsByRig.get(r.id),
          pendingCommand: pendingByRig.get(r.id),
          lastUpdate: lastByRig.get(r.id),
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
