const express = require("express");
const { requireAccess, accessActor } = require("../middleware/auth");
const Miner = require("../models/Miner");
const commands = require("../services/commands");
const ws = require("../websocket/server");
const { route } = require("./v1");
const router = express.Router();
router.use(requireAccess);
router.get(
  "/",
  route(async (req, res) =>
    res.json({
      success: true,
      miners: (await Miner.getAll()).map((m) => m.toJSON()),
    }),
  ),
);
router.get(
  "/:id",
  route(async (req, res) => {
    const m = await Miner.getById(req.params.id);
    if (!m) return res.status(404).json({ error: "Rig not found" });
    res.json({ success: true, miner: m.toJSON() });
  }),
);
router.get(
  "/:id/devices",
  route(async (req, res) => {
    const m = await Miner.getById(req.params.id);
    if (!m) return res.status(404).json({ error: "Rig not found" });
    res.json({
      success: true,
      devices: m.toJSON().devices,
      hardware: m.hardware,
      processes: m.toJSON().processes,
    });
  }),
);
router.post(
  "/",
  route(async (req, res) => {
    if (typeof req.body.systemId !== "string" || !req.body.systemId.trim())
      return res.status(400).json({
        error:
          "A stable systemId is required; IP addresses do not identify rigs",
      });
    const existing = await Miner.getBySystemId(req.body.systemId);
    const miner =
      existing ||
      (await Miner.create({
        systemId: req.body.systemId,
        name: req.body.name || req.body.hostname || "Unnamed rig",
        hostname: req.body.hostname || "unknown",
      }));
    res.json({ success: true, miner: miner.toJSON(), isNew: !existing });
  }),
);
router.put(
  "/:id",
  route(async (req, res) => {
    if (
      typeof req.body.name !== "string" ||
      !req.body.name.trim() ||
      req.body.name.length > 120
    )
      return res
        .status(400)
        .json({ error: "Provide a name up to 120 characters" });
    const m = await Miner.update(req.params.id, { name: req.body.name.trim() });
    if (!m) return res.status(404).json({ error: "Rig not found" });
    ws.broadcast({ type: "miner_updated", miner: m.toJSON() });
    res.json({ success: true, miner: m.toJSON() });
  }),
);
router.delete(
  "/:id",
  route(async (req, res) => {
    if (!(await ws.forget(req.params.id)))
      return res.status(404).json({ error: "Rig not found" });
    res.json({ success: true, historyPreserved: true });
  }),
);
for (const action of [
  "start",
  "stop",
  "restart",
  "command",
  "toggle-cpu",
  "toggle-gpu",
])
  router.post(
    `/:id/${action}`,
    route(async (req, res) => {
      let spec = { ...req.body, action };
      if (action === "command")
        spec = {
          ...req.body.params,
          ...req.body,
          action: req.body.action || req.body.command,
        };
      if (action.startsWith("toggle-")) {
        if (typeof req.body.enabled !== "boolean")
          return res.status(400).json({ error: "enabled must be boolean" });
        spec = {
          ...req.body,
          action: req.body.enabled ? "device-enable" : "device-disable",
          deviceType: action === "toggle-cpu" ? "CPU" : "GPU",
        };
      }
      const command = await commands.create(
        req.params.id,
        spec,
        accessActor(req),
        req.get("Idempotency-Key"),
      );
      res.status(202).json({
        success: true,
        command,
        message: "Command accepted; inspect command status for its outcome",
      });
    }),
  );
module.exports = router;
