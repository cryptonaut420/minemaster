const { load } = require("cheerio");
const { randomUUID } = require("crypto");
const { getDb } = require("../db/mongodb");
const { viewRig } = require("./telemetry");
const BASE = "https://hashrate.no";
const ZONE = "America/Vancouver";
const JOB = "daily-profitability";
let timer,
  busy = false;
const clean = (value) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim();
function modelKey(kind, name) {
  const value = clean(name).replace(/\(R\)|\(TM\)/gi, "");
  const match =
    kind === "GPU"
      ? value.match(
          /\b(?:RTX|GTX|RX)\s*\d{3,4}(?:\s*(?:Ti\s*SUPER|Ti|SUPER|XTX|XT))?\b/i,
        )
      : value.match(/\bi[3579]-\d{4,5}[a-z]*\b/i) ||
        value.match(/\bRyzen\s+\d\s+(\d{4}[a-z0-9]*)\b/i) ||
        value.match(/\bEPYC\s+(\w+)\b/i);
  return match
    ? (match[1] || match[0]).replace(/[^a-z0-9]/gi, "").toLowerCase() +
        (kind === "GPU" && /gddr6x/i.test(value) ? "gddr6x" : "") +
        (kind === "GPU" && /laptop|mobile/i.test(value) ? "mobile" : "")
    : null;
}
function catalog(html, kind) {
  const $ = load(html),
    rows = new Map(),
    path = kind === "GPU" ? "gpus" : "cpus";
  $("#myUL .estimate[onclick]").each((_, element) => {
    const row = $(element),
      match = row
        .attr("onclick")
        ?.match(
          new RegExp(
            "^window\\.location\\.href='(/" + path + "/[a-zA-Z0-9_-]+)'$",
          ),
        );
    const name = clean(
      row.find(".brand").first().text() +
        " " +
        row.find(".model").first().text(),
    );
    const key = modelKey(kind, name);
    if (match && key && !rows.has(key))
      rows.set(key, { name, url: BASE + match[1] });
  });
  if (!rows.size)
    throw Error(`${kind} provider catalog unavailable or changed`);
  return rows;
}
const algorithmKey = (a) =>
  ({ randomx: "rx/0", "pearl-pow": "pearlhash", autolykos2: "autolykos" })[
    String(a).toLowerCase()
  ] || String(a || "").toLowerCase();
function coinKey(coin, algorithm) {
  if (algorithmKey(algorithm) === "quantus") return "quantus";
  if (algorithmKey(algorithm) === "pearlhash") return "pearl";
  return String(coin || "").toUpperCase();
}
function estimates(html, url) {
  const $ = load(html),
    rows = [];
  if ($("#currency option[selected]").text() !== "USD")
    throw Error("Provider currency is not confirmed USD");
  $("#myUL > li > a").each((_, element) => {
    const row = $(element),
      href = row.attr("href");
    if (!href?.startsWith(new URL(url).pathname.replace(/\/$/, "") + "/"))
      return;
    const symbol = clean(row.find(".name span").first().text());
    const name = clean(
      row.find(".name").first().clone().children().remove().end().text(),
    );
    const algorithm = algorithmKey(
      clean(row.find(".estimatesModel .estimatesDescription").first().text()),
    );
    const field = (label) => {
      const description = row
        .find(".estimatesDescription")
        .filter((_, e) => clean($(e).text()) === label)
        .first();
      return clean(description.parent().find(".estimates").first().text());
    };
    const revenue = field("Rev. 24h"),
      power = field("Power");
    if (
      !/^\$\d+(?:,\d{3})*(?:\.\d+)?$/.test(revenue) ||
      !/^\d+(?:\.\d+)? w$/i.test(power) ||
      !symbol ||
      !algorithm
    )
      return;
    const revenueUsd = Number(revenue.replace(/[$,]/g, "")),
      watts = Number(power.split(" ")[0]);
    if (!Number.isFinite(revenueUsd) || !Number.isFinite(watts) || watts <= 0)
      return;
    rows.push({
      name,
      symbol,
      algorithm,
      coin: coinKey(symbol, algorithm),
      revenueUsd,
      watts,
      url: BASE + href,
    });
  });
  if (!rows.length) throw Error("Provider estimates missing or layout changed");
  return rows;
}
async function fetchText(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(20000),
    redirect: "error",
    headers: {
      "User-Agent": "MineMaster-Profitability/1.0",
      Accept: "text/html,application/json",
    },
  });
  if (!response.ok) throw Error(`Provider HTTP ${response.status}`);
  if (Number(response.headers.get("age") || 0) > 21600)
    throw Error("Provider cache is over six hours old");
  let text = "",
    bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > 8 * 1024 * 1024) throw Error("Provider response too large");
    text += Buffer.from(chunk).toString("utf8");
  }
  return text;
}
function fxRate(json, now = Date.now()) {
  const observation = json.observations?.at(-1),
    rate = Number(observation?.FXUSDCAD?.v);
  const date = Date.parse(observation?.d + "T00:00:00Z");
  if (
    !Number.isFinite(rate) ||
    rate <= 0 ||
    !Number.isFinite(date) ||
    now - date > 7 * 86400000 ||
    date > now + 86400000
  )
    throw Error("USD/CAD quote unavailable or stale");
  return { rate, date: observation.d };
}
function activeGroups(rigs, now = Date.now()) {
  const groups = new Map(),
    gaps = [];
  for (const raw of rigs) {
    const rig = viewRig(raw, now);
    if (
      rig.archivedAt ||
      rig.forgottenAt ||
      !rig.freshness.connected ||
      !rig.freshness.telemetryFresh
    )
      continue;
    for (const p of rig.processes || []) {
      if (!p.running || p.paused) continue;
      const cfg = p.activeConfig;
      if (!cfg?.coin || !cfg?.algorithm) {
        gaps.push(`${rig.name} ${p.deviceType}: active coin unknown`);
        continue;
      }
      const names =
        p.deviceType === "GPU"
          ? rig.hardware?.gpus?.map((g) => g.model) || []
          : [rig.hardware?.cpu?.brand];
      if (!names.length) gaps.push(`${rig.name} GPU: hardware unknown`);
      for (const name of names) {
        const model = modelKey(p.deviceType, name),
          coin = coinKey(cfg.coin, cfg.algorithm);
        if (!model) {
          gaps.push(
            `${rig.name}: no exact model match for ${name || "unknown"}`,
          );
          continue;
        }
        const key = [
          p.deviceType,
          model,
          coin,
          algorithmKey(cfg.algorithm),
        ].join(":");
        if (!groups.has(key))
          groups.set(key, {
            kind: p.deviceType,
            model,
            name,
            coin,
            algorithm: algorithmKey(cfg.algorithm),
            devices: 0,
            rigs: [],
          });
        const group = groups.get(key);
        group.devices++;
        if (!group.rigs.includes(rig.name)) group.rigs.push(rig.name);
      }
    }
  }
  return { groups: [...groups.values()], gaps };
}
function compare(group, rows, fx, electricity = 0.13) {
  const ranked = rows
    .map((row) => ({
      ...row,
      netBeforeFeesCad:
        row.revenueUsd * fx - (row.watts / 1000) * 24 * electricity,
    }))
    .sort((a, b) => b.netBeforeFeesCad - a.netBeforeFeesCad);
  const current = ranked.find(
    (r) => r.coin === group.coin && r.algorithm === group.algorithm,
  );
  if (!current)
    return {
      gap: `${group.name}: current ${group.coin}/${group.algorithm} has no comparable benchmark`,
    };
  const best = ranked[0],
    improvement = best.netBeforeFeesCad - current.netBeforeFeesCad;
  if (
    best.coin === current.coin ||
    best.netBeforeFeesCad <= 0 ||
    improvement < Math.max(0.1, Math.abs(current.netBeforeFeesCad) * 0.1)
  )
    return { current, best, opportunity: false };
  return { ...group, current, best, improvement, opportunity: true };
}
async function review(read = fetchText, now = Date.now()) {
  const db = getDb(),
    rigs = await db
      .collection("miners")
      .find({ archivedAt: null, forgottenAt: null })
      .toArray();
  const { groups, gaps } = activeGroups(rigs, now);
  const result = {
    checkedAt: new Date(now).toISOString(),
    source: "Hashrate.no public model estimates (24-hour revenue)",
    electricityCadPerKwh: 0.13,
    estimatesBeforeFees: true,
    opportunities: [],
    gaps,
    groupsChecked: 0,
    activeGroups: groups.length,
    comparisons: [],
  };
  if (!groups.length) {
    result.gaps.push("No fresh running processes available for comparison");
    return result;
  }
  result.fx = fxRate(
    JSON.parse(
      await read(
        "https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=1",
      ),
    ),
    now,
  );
  const libraries = new Map(),
    cache = new Map();
  const profiles = await db
    .collection("configProfiles")
    .find({}, { projection: { name: 1, type: 1, config: 1 } })
    .toArray();
  for (const kind of new Set(groups.map((g) => g.kind))) {
    try {
      libraries.set(
        kind,
        catalog(await read(BASE + (kind === "GPU" ? "/gpus" : "/cpus")), kind),
      );
    } catch (e) {
      result.gaps.push(`${kind}: ${e.message}`);
    }
  }
  // Sequential per-model reads bound provider load; each model is fetched once per run.
  for (const group of groups) {
    const model = libraries.get(group.kind)?.get(group.model);
    if (!model) {
      result.gaps.push(
        `${group.kind} ${group.name}: provider model unavailable`,
      );
      continue;
    }
    if (!cache.has(model.url) && cache.size >= 60) {
      result.gaps.push(
        "Provider lookup limit reached; remaining models not checked",
      );
      continue;
    }
    if (!cache.has(model.url)) {
      try {
        cache.set(model.url, estimates(await read(model.url), model.url));
      } catch (e) {
        cache.set(model.url, { error: e.message });
      }
    }
    const rows = cache.get(model.url);
    if (rows.error) {
      result.gaps.push(`${group.name}: ${rows.error}`);
      continue;
    }
    const compared = compare(group, rows, result.fx.rate);
    if (compared.gap) {
      result.gaps.push(compared.gap);
      continue;
    }
    result.groupsChecked++;
    result.comparisons.push({
      ...group,
      current: compared.current,
      best: compared.best,
      opportunity: compared.opportunity,
    });
    if (compared.opportunity) {
      compared.profiles = profiles
        .filter(
          (p) =>
            p.type === (group.kind === "GPU" ? "nanominer" : "xmrig") &&
            coinKey(p.config.coin, p.config.algorithm) === compared.best.coin &&
            algorithmKey(p.config.algorithm) === compared.best.algorithm,
        )
        .map((p) => p.name);
      result.opportunities.push(compared);
    }
  }
  result.gaps = [...new Set(result.gaps)].slice(0, 100);
  return result;
}
function message(result) {
  const money = (n) => `C$${n.toFixed(2)}`;
  const lines = [
    `**MineMaster daily profitability** · ${result.checkedAt.slice(0, 10)}`,
  ];
  if (result.error)
    lines.push(`Check failed: ${result.error}. No mining changes made.`);
  for (const r of result.opportunities.slice(0, 5))
    lines.push(
      `**${r.kind} ${r.name}** (${r.devices} devices): ${r.current.name} → **${r.best.name}**\n${money(r.current.netBeforeFeesCad)} → ${money(r.best.netBeforeFeesCad)}/device/day after electricity, before fees. ${r.profiles.length ? "Saved profile: " + r.profiles.join(", ") : "No saved profile; engine/model compatibility needs checking."}\n${r.best.url}`,
    );
  if (result.opportunities.length > 5)
    lines.push(
      `${result.opportunities.length - 5} additional opportunities in the admin.`,
    );
  if (result.gaps.length)
    lines.push(
      `Coverage: ${result.groupsChecked}/${result.activeGroups} active hardware/coin groups checked; ${result.gaps.length} gaps. ${result.gaps.slice(0, 2).join("; ")}`,
    );
  if (!result.error)
    lines.push(
      "24h calculator estimates, not measured income. C$0.13/kWh; device power excludes the rest of the rig. Miner/pool fees not deducted; verify before switching.",
    );
  if (result.fx)
    lines.push(
      `USD/CAD ${result.fx.rate} (${result.fx.date}, Bank of Canada).`,
    );
  lines.push("Recommendations only. https://mining.ironcladtech.ca/configs");
  return lines.join("\n").slice(0, 1900);
}
function localDay(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
  };
}
async function status() {
  const state = await getDb().collection("scheduledJobs").findOne({ _id: JOB });
  return {
    enabled: !!process.env.PROFITABILITY_DISCORD_WEBHOOK,
    schedule: "Daily 09:00 America/Vancouver",
    electricityCadPerKwh: 0.13,
    source: "Hashrate.no · 24h benchmarks",
    automaticSwitching: false,
    lastRun: state?.lastRun || null,
    lastResult: state?.lastResult || null,
    lastDelivery: state?.lastDelivery || null,
    running: !!state?.leaseUntil && state.leaseUntil > new Date(),
  };
}
async function run({
  force = false,
  reviewFn = review,
  discordFetch = fetch,
  clock = () => new Date(),
} = {}) {
  if (busy || !process.env.PROFITABILITY_DISCORD_WEBHOOK) return;
  const now = clock(),
    day = localDay(now),
    db = getDb(),
    jobs = db.collection("scheduledJobs"),
    owner = randomUUID();
  if (!force && day.hour < 9) return;
  busy = true;
  try {
    await jobs.updateOne(
      { _id: JOB },
      { $setOnInsert: { lastDay: null } },
      { upsert: true },
    );
    const leased = await jobs.findOneAndUpdate(
      {
        _id: JOB,
        $and: [
          {
            $or: [
              { leaseUntil: { $lte: now } },
              { leaseUntil: { $exists: false } },
            ],
          },
          ...(force ? [] : [{ lastDay: { $ne: day.date } }]),
        ],
      },
      { $set: { leaseUntil: new Date(+now + 30 * 60000), owner } },
      { returnDocument: "after" },
    );
    if (!leased) return;
    let result;
    try {
      result = await reviewFn();
    } catch (e) {
      result = {
        checkedAt: new Date().toISOString(),
        error: e.message,
        opportunities: [],
        gaps: [],
        groupsChecked: 0,
        activeGroups: 0,
      };
    }
    // Persist before sending. A crash/uncertain POST must not blindly resend on restart.
    await jobs.updateOne(
      { _id: JOB, owner },
      {
        $set: {
          lastDay: day.date,
          lastRun: new Date().toISOString(),
          lastResult: result,
          lastDelivery: { status: "not-needed" },
        },
      },
    );
    if (result.error || result.opportunities.length || result.gaps.length) {
      await jobs.updateOne(
        { _id: JOB, owner },
        {
          $set: {
            lastDelivery: { status: "sending", at: new Date().toISOString() },
          },
        },
      );
      try {
        const webhook = process.env.PROFITABILITY_DISCORD_WEBHOOK;
        if (
          !/^https:\/\/discord\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(webhook)
        )
          throw Error("Invalid Discord webhook configuration");
        const response = await discordFetch(webhook + "?wait=true", {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(20000),
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: message(result),
            allowed_mentions: { parse: [] },
          }),
        });
        if (!response.ok) throw Error(`Discord HTTP ${response.status}`);
        const receipt = await response.json();
        if (!receipt.id) throw Error("Discord response missing receipt");
        await jobs.updateOne(
          { _id: JOB, owner },
          {
            $set: {
              lastDelivery: {
                status: "sent",
                at: new Date().toISOString(),
                messageId: receipt.id,
              },
            },
          },
        );
      } catch (e) {
        await jobs.updateOne(
          { _id: JOB, owner },
          {
            $set: {
              lastDelivery: {
                status: "failed-or-uncertain",
                at: new Date().toISOString(),
                error: e.message,
              },
            },
          },
        );
      }
    }
    return result;
  } finally {
    try {
      await jobs.updateOne(
        { _id: JOB, owner },
        { $unset: { leaseUntil: "", owner: "" } },
      );
    } finally {
      busy = false;
    }
  }
}
function start() {
  if (timer) return;
  const tick = () =>
    run().catch(() =>
      console.error(
        "Profitability scheduled check failed; see database/provider readiness",
      ),
    );
  timer = setInterval(tick, 60000);
  timer.unref(); // First tick allows agents to reconnect after server startup.
}
function stop() {
  clearInterval(timer);
  timer = null;
}
module.exports = {
  modelKey,
  catalog,
  estimates,
  coinKey,
  algorithmKey,
  fxRate,
  activeGroups,
  compare,
  review,
  message,
  localDay,
  status,
  run,
  start,
  stop,
};
