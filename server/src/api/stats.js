const express = require("express");
const { requireAccess, accessActor } = require("../middleware/auth");
const HashRate = require("../models/HashRate");
const { summary } = require("../services/telemetry");
const { fleet, route } = require("./v1");
const router = express.Router();
router.use(requireAccess);
router.get(
  "/hashrates-timeseries",
  route(async (req, res) =>
    res.json({
      success: true,
      data: await HashRate.getTimeSeries({
        ...req.query,
        minerIds: (await fleet(req.query)).map((r) => r.id),
      }),
    }),
  ),
);
router.get(
  "/hashrates",
  route(async (req, res) => {
    const rigs = await fleet(req.query);
    res.json({
      success: true,
      historical: await HashRate.getTimeSeries({
        ...req.query,
        minerIds: rigs.map((r) => r.id),
      }),
      current: summary(rigs).algorithms,
    });
  }),
);
module.exports = router;
