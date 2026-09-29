const { test } = require("node:test");
const assert = require("node:assert/strict");
const p = require("../src/services/profitability");
const row = (coin, symbol, algorithm, revenue = "2.00", watts = "100") =>
  `<li><a href='/gpus/3060ti/${symbol}'><div class='estimatesModel'><div class='name'>${coin} <span>${symbol}</span></div><div class='estimatesDescription'>${algorithm}</div></div><div><div class='estimatesDescription'>Power</div><div class='estimates'>${watts} w</div></div><div><div class='estimatesDescription'>Revenue</div><div class='estimates'>$999.00</div></div><div><div class='estimatesDescription'>Rev. 24h</div><div class='estimates'>$${revenue}</div></div></a></li>`;
const html = (rows) =>
  `<select id='currency'><option selected>USD</option></select><ul id='myUL'>${rows}</ul>`;
test("profitability reads 24h revenue, explicit USD and watts; changed markup fails closed", () => {
  const rows = p.estimates(
    html(
      row("Quantus", "QUAN", "quantus") +
        row("Pearl", "PRL", "pearl-pow", "1.50", "135"),
    ),
    "https://hashrate.no/gpus/3060ti",
  );
  assert.equal(rows[0].revenueUsd, 2);
  assert.equal(rows[1].algorithm, "pearlhash");
  assert.equal(rows[1].watts, 135);
  assert.throws(() =>
    p.estimates(
      html(row("Coin", "X", "x")).replace("USD", "CAD"),
      "https://hashrate.no/gpus/3060ti",
    ),
  );
  assert.throws(() =>
    p.estimates(
      html(row("Coin", "X", "x", "n/a")),
      "https://hashrate.no/gpus/3060ti",
    ),
  );
  assert.throws(() =>
    p.estimates("<html>Unavailable</html>", "https://hashrate.no/gpus/3060ti"),
  );
});
test("exact hardware and coin identity never confuse GDDR6X, Ti, mobile, or Qubitcoin with Quantus", () => {
  assert.equal(
    p.modelKey("GPU", "GA104 [GeForce RTX 3060 Ti Lite Hash Rate]"),
    "rtx3060ti",
  );
  assert.notEqual(
    p.modelKey("GPU", "RTX 3060 Ti GDDR6X"),
    p.modelKey("GPU", "RTX 3060 Ti"),
  );
  assert.notEqual(
    p.modelKey("GPU", "RTX 3060 Laptop"),
    p.modelKey("GPU", "RTX 3060"),
  );
  assert.equal(p.modelKey("CPU", "AMD Ryzen 5 3600 6-Core Processor"), "3600");
  assert.equal(
    p.modelKey("CPU", "Intel(R) Core(TM) i7-7700K CPU @ 4.20GHz"),
    "i77700k",
  );
  assert.equal(p.coinKey("QTC", "quantus"), "quantus");
  assert.equal(p.coinKey("QUAN", "quantus"), "quantus");
  assert.notEqual(p.coinKey("QTC", "Qhash"), p.coinKey("QTC", "quantus"));
});
test("recommendations compare the current coin, subtract CAD electricity and expose missing baselines", () => {
  const rows = p.estimates(
    html(
      row("Quantus", "QUAN", "quantus") +
        row("Ravencoin", "RVN", "KawPow", "0.20", "200"),
    ),
    "https://hashrate.no/gpus/3060ti",
  );
  const r = p.compare(
    { coin: "RVN", algorithm: "kawpow", name: "RTX 3060 Ti" },
    rows,
    1.4,
    0.13,
  );
  assert.equal(r.opportunity, true);
  assert.equal(r.best.coin, "quantus");
  assert.ok(Math.abs(r.best.netBeforeFeesCad - 2.488) < 1e-9);
  assert.equal(
    p.compare({ coin: "quantus", algorithm: "quantus" }, rows, 1.4).opportunity,
    false,
  );
  assert.match(
    p.compare({ coin: "UNKNOWN", algorithm: "unknown", name: "GPU" }, rows, 1.4)
      .gap,
    /no comparable/,
  );
});
test("Vancouver daily date handles DST and FX rejects stale/missing quotes", () => {
  assert.deepEqual(p.localDay(new Date("2026-09-29T16:00:00Z")), {
    date: "2026-09-29",
    hour: 9,
  });
  assert.deepEqual(p.localDay(new Date("2026-12-29T17:00:00Z")), {
    date: "2026-12-29",
    hour: 9,
  });
  const now = Date.parse("2026-09-29T00:00:00Z");
  assert.equal(
    p.fxRate(
      { observations: [{ d: "2026-09-28", FXUSDCAD: { v: "1.4" } }] },
      now,
    ).rate,
    1.4,
  );
  assert.throws(() =>
    p.fxRate(
      { observations: [{ d: "2026-08-28", FXUSDCAD: { v: "1.4" } }] },
      now,
    ),
  );
  assert.throws(() => p.fxRate({}, now));
});
test("daily Discord message is bounded and never claims it switched the fleet", () => {
  const message = p.message({
    checkedAt: "2026-09-29",
    opportunities: [],
    gaps: ["Unknown model"],
    groupsChecked: 0,
    activeGroups: 1,
  });
  assert.match(message, /Recommendations only/);
  assert.match(message, /Coverage: 0\/1/);
  assert.ok(message.length <= 1900);
});
