const { randomUUID } = require("crypto");
const { getDb } = require("../db/mongodb");
const { viewRig } = require("../services/telemetry");
class Miner {
  constructor(data = {}) {
    Object.assign(
      this,
      {
        id: randomUUID(),
        systemId: null,
        name: "Unnamed rig",
        hostname: "unknown",
        status: "offline",
        bound: false,
        devices: { cpu: { enabled: true, running: false }, gpus: [] },
        hardware: { cpu: null, gpus: [] },
        processes: [],
        tags: [],
        createdAt: new Date().toISOString(),
      },
      data,
    );
    delete this._id;
  }
  static async getAll({
    includeArchived = false,
    includeForgotten = false,
  } = {}) {
    const query = {};
    if (!includeArchived) query.archivedAt = null;
    if (!includeForgotten) query.forgottenAt = null;
    return (await getDb().collection("miners").find(query).toArray()).map(
      (r) => new Miner(r),
    );
  }
  static async getById(id) {
    const r = await getDb().collection("miners").findOne({ id });
    return r ? new Miner(r) : null;
  }
  static async getBySystemId(systemId) {
    const r = await getDb().collection("miners").findOne({ systemId });
    return r ? new Miner(r) : null;
  }
  static async getByConnectionId(connectionId) {
    const r = await getDb().collection("miners").findOne({ connectionId });
    return r ? new Miner(r) : null;
  }
  static async getAllBound() {
    return (await Miner.getAll()).filter((r) => r.bound);
  }
  static async create(data) {
    const r = new Miner(data);
    await getDb()
      .collection("miners")
      .insertOne({ ...r });
    return r;
  }
  static async update(id, changes, condition = {}) {
    const r = await getDb()
      .collection("miners")
      .findOneAndUpdate(
        { id, ...condition },
        { $set: { ...changes, updatedAt: new Date().toISOString() } },
        { returnDocument: "after" },
      );
    return r ? new Miner(r) : null;
  }
  static async delete(id) {
    return !!(await Miner.update(id, {
      forgottenAt: new Date().toISOString(),
      connectionId: null,
      bound: false,
    }));
  }
  async bind() {
    return Miner.update(this.id, { bound: true });
  }
  async unbind() {
    return Miner.update(this.id, { bound: false });
  }
  toJSON() {
    return viewRig({ ...this });
  }
}
module.exports = Miner;
