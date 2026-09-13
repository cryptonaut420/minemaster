const { getDb } = require("../db/mongodb");
const { viewRig, date } = require("./telemetry");
const commands = require("./commands");
const { event } = require("./monitoring");
function candidates(raw, now = Date.now()) {
  const r = viewRig(raw, now),
    policy = r.recovery || {};
  if (
    !policy.enabled ||
    r.archivedAt ||
    r.forgottenAt ||
    !r.freshness.telemetryFresh ||
    date(r.maintenanceUntil) > now ||
    r.protocolVersion < 2
  )
    return [];
  // Recovery only restarts a process still observed running at zero; never overrides an operator stop.
  if (
    r.stats?.cpu?.temperature >= 85 ||
    r.stats?.gpus?.some((g) => g.temperature >= 85)
  )
    return [];
  const desired = (p) => {
    const scoped = r.desiredState?.[p.deviceType],
      all = r.desiredState?.ALL;
    return (date(scoped?.updatedAt) || 0) > (date(all?.updatedAt) || 0)
      ? scoped?.state
      : all?.state;
  };
  return r.processes.filter(
    (p) =>
      p.running &&
      p.enabled &&
      p.quality === "zero" &&
      date(p.zeroSince) !== null &&
      now - date(p.zeroSince) >= (policy.zeroSeconds || 300) * 1000 &&
      desired(p) !== "stopped",
  );
}
async function check(rig, now = Date.now()) {
  const db = getDb(),
    policy = rig.recovery || {};
  for (const p of candidates(rig, now)) {
    const prior = await db
      .collection("commands")
      .find({
        minerId: rig.id,
        actor: "automatic-recovery",
        deviceType: p.deviceType,
        createdAt: { $gte: new Date(now - 86400000) },
      })
      .sort({ createdAt: -1 })
      .toArray();
    if (
      prior.length >= (policy.maxPerDay || 2) ||
      prior.some((c) =>
        ["queued", "sent", "received", "running", "timed_out"].includes(
          c.status,
        ),
      ) ||
      (prior[0] &&
        now - +prior[0].createdAt < (policy.cooldownMinutes || 30) * 60000)
    )
      continue;
    if (
      await db
        .collection("commands")
        .countDocuments({ minerId: rig.id, status: { $in: commands.ACTIVE } })
    )
      continue;
    const idempotencyKey = `recovery:${rig.id}:${p.id}:${Math.floor(now / ((policy.cooldownMinutes || 30) * 60000))}`;
    let command;
    try {
      command = await commands.create(
        rig.id,
        {
          action: "restart",
          deviceType: p.deviceType,
          restartRunningOnly: true,
        },
        "automatic-recovery",
        idempotencyKey,
      );
    } catch (error) {
      if (error.status === 409) continue;
      throw error;
    }
    await event(rig.id, "automatic-recovery", {
      commandId: command.id,
      processId: p.id,
      reason: "Sustained zero hashrate",
    });
  }
}
module.exports = { candidates, check };
