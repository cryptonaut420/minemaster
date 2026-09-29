const { randomUUID } = require("crypto");
const { getDb } = require("../db/mongodb");
const Config = require("../models/Config");
const ConfigProfile = require("../models/ConfigProfile");
const commands = require("./commands");
const { viewRig } = require("./telemetry");
const locks = new Set();
const fail = (message, status = 409) =>
  Object.assign(Error(message), { status });
async function activate(id, version, expectedConfigVersion, actor) {
  if (!version || !expectedConfigVersion)
    throw fail("Profile and current fleet-default versions are required", 428);
  const profile = await ConfigProfile.get(id),
    type = profile.type;
  if (profile.version !== version)
    throw fail("Profile changed. Reload before activating it.");
  if (locks.has(type)) throw fail("Another fleet activation is in progress");
  locks.add(type);
  try {
    const db = getDb(),
      rigs = await db
        .collection("miners")
        .find({ bound: true, archivedAt: null, forgottenAt: null })
        .toArray();
    const config = await Config.update(
      type,
      profile.config,
      actor,
      expectedConfigVersion,
    );
    // Capture this approved profile. Later library edits must not affect offline delivery.
    const activation = {
      id: randomUUID(),
      profile,
      actor,
      createdAt: new Date().toISOString(),
    };
    const assigned = { ...profile.config, version: profile.version };
    await db.collection("miners").updateMany(
      { id: { $in: rigs.map((r) => r.id) } },
      {
        $set: {
          [`desiredConfigs.${type}`]: assigned,
          [`pendingProfileActivation.${type}`]: activation,
        },
      },
    );
    const results = [];
    for (const rig of rigs) {
      if (!viewRig(rig).freshness.connected) {
        results.push({
          minerId: rig.id,
          name: rig.name,
          status: "awaiting_reconnect",
        });
        continue;
      }
      const delivered = await deliverPending(rig.id, rig.connectionId, type);
      results.push(
        ...(delivered.length
          ? delivered
          : [{ minerId: rig.id, name: rig.name, status: "assigned" }]),
      );
    }
    await db.collection("events").insertOne({
      timestamp: new Date(),
      kind: "fleet-profile-activated",
      details: {
        activationId: activation.id,
        profileId: id,
        profileVersion: version,
        type,
        actor,
        boundRigs: rigs.length,
      },
    });
    return {
      activationId: activation.id,
      profile: { id: profile.id, name: profile.name, version: profile.version },
      config,
      results,
    };
  } finally {
    locks.delete(type);
  }
}
async function deliverPending(minerId, connectionId, onlyType) {
  const db = getDb(),
    results = [];
  for (const type of onlyType ? [onlyType] : ["xmrig", "nanominer"]) {
    const miner = await db
      .collection("miners")
      .findOne({ id: minerId, connectionId });
    const pending = miner?.pendingProfileActivation?.[type];
    if (!pending || !miner.bound || miner.archivedAt || miner.forgottenAt)
      continue;
    if (
      !Config.supportsEngine(
        type,
        pending.profile.config,
        miner.capabilities,
      ) ||
      miner.protocolVersion < 2 ||
      !miner.capabilities?.commandResults
    ) {
      results.push({
        minerId,
        name: miner.name,
        status: "upgrade_required",
        error:
          "This client needs an upgrade for the selected engine. Assignment is retained.",
      });
      continue;
    }
    // Claim once before dispatch; never replay an ambiguous command on reconnect.
    const claim = await db.collection("miners").updateOne(
      {
        id: minerId,
        connectionId,
        [`pendingProfileActivation.${type}.id`]: pending.id,
      },
      { $unset: { [`pendingProfileActivation.${type}`]: "" } },
    );
    if (!claim.modifiedCount) continue;
    try {
      const command = await commands.create(
        minerId,
        commands.profileSpec(
          pending.profile,
          type === "nanominer" && !miner.hardware?.gpus?.length
            ? { action: "config-update" }
            : {},
        ),
        pending.actor,
        `activation:${pending.id}:${minerId}:${type}`,
      );
      results.push({
        minerId,
        name: miner.name,
        command,
        status: command.status,
      });
    } catch (e) {
      const error = String(e.message).slice(0, 1000);
      await db.collection("miners").updateOne(
        { id: minerId },
        {
          $set: {
            [`profileDeliveryError.${type}`]: {
              activationId: pending.id,
              error,
              at: new Date().toISOString(),
            },
          },
        },
      );
      results.push({ minerId, name: miner.name, status: "failed", error });
    }
  }
  return results;
}
module.exports = { activate, deliverPending };
