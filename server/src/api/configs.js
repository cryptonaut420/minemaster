const express = require("express");
const Config = require("../models/Config");
const commands = require("../services/commands");
const { requireAccess, accessActor } = require("../middleware/auth");
const { route } = require("./v1");
const router = express.Router();
router.use(requireAccess);
router.get(
  "/",
  route(async (req, res) =>
    res.json({ success: true, configs: await Config.getAll() }),
  ),
);
router.get(
  "/:type",
  route(async (req, res) => {
    const config = await Config.get(req.params.type);
    if (!config) return res.status(404).json({ error: "Unknown type" });
    res.json({ success: true, config });
  }),
);
router.put(
  "/:type",
  route(async (req, res) =>
    res.json({
      success: true,
      config: await Config.update(
        req.params.type,
        req.body,
        accessActor(req),
        req.body.version,
      ),
      message:
        "Saved desired configuration. Apply to selected rigs separately.",
    }),
  ),
);
router.post(
  "/:type/apply",
  route(async (req, res) => {
    if (!Config.DEFAULTS[req.params.type])
      return res.status(400).json({ error: "Unknown type" });
    if (!Array.isArray(req.body.minerIds))
      return res
        .status(400)
        .json({ error: "Provide explicit minerIds for the rollout" });
    res.status(202).json({
      success: true,
      ...(await commands.bulk(
        req.body.minerIds,
        {
          action: "restart",
          deviceType: req.params.type === "xmrig" ? "CPU" : "GPU",
          configType: req.params.type,
          restartRunningOnly: true,
        },
        accessActor(req),
        req.get("Idempotency-Key"),
      )),
    });
  }),
);
module.exports = router;
