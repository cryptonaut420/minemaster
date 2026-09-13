// Disposable, loopback-only admin fixture. Never connects to the configured deployment.
const { MongoMemoryServer } = require("mongodb-memory-server");
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const { ObjectId } = require("mongodb");
(async () => {
  const mongo = await MongoMemoryServer.create({
    binary: { version: "7.0.24" },
  });
  process.env.MONGO_URL = mongo.getUri();
  process.env.MONGO_DB_NAME = "minemaster_ui_fixture";
  process.env.JWT_SECRET = "loopback-fixture-only";
  const storage = require("../src/db/mongodb"),
    db = await storage.connect();
  const admin = { _id: new ObjectId(), email: "fixture@local.test" },
    token = require("../src/middleware/auth").generateToken(admin);
  let failure = false;
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.headers.authorization = `Bearer ${token}`;
    next();
  });
  app.get("/api/auth/setup-required", (req, res) =>
    failure
      ? res.status(503).json({ error: "Synthetic database outage" })
      : res.json({ setupRequired: false }),
  );
  app.get("/api/auth/me", (req, res) => res.json({ admin }));
  app.post("/__fixture/failure", (req, res) => {
    failure = req.body.enabled === true;
    res.json({ failure });
  });
  app.get("/api/v1/fixture-failure", (req, res) =>
    res.status(503).json({ error: "Synthetic database outage" }),
  );
  app.use(
    "/api/v1",
    (req, res, next) =>
      failure || req.headers["x-fixture-failure"]
        ? res.status(503).json({ error: "Synthetic database outage" })
        : next(),
    require("../src/api/v1"),
  );
  app.use((err, req, res, next) =>
    res
      .status(err.status || 503)
      .json({ error: err.message, fields: err.fields }),
  );
  app.use(
    express.static(require("path").join(__dirname, "../public/build"), {
      index: false,
    }),
  );
  app.get("*", (req, res) =>
    res.type("html").send(
      require("fs")
        .readFileSync(
          require("path").join(__dirname, "../public/build/index.html"),
          "utf8",
        )
        .replace(
          "<head>",
          `<head><script>localStorage.setItem("minemaster_auth_token", ${JSON.stringify(token)})</script>`,
        ),
    ),
  );
  const server = http.createServer(app),
    wss = new WebSocket.Server({ server });
  const service = require("../src/websocket/server");
  service.initialize(wss);
  await require("../src/models/Config").update(
    "xmrig",
    { pool: "fixture.pool:3333", user: "synthetic-wallet", coin: "XMR" },
    "fixture",
  );
  await require("../src/models/Config").update(
    "nanominer",
    { pool: "fixture.pool:4444", user: "synthetic-wallet", coin: "RVN" },
    "fixture",
  );
  await new Promise((resolve) => server.listen(43188, "127.0.0.1", resolve));
  const agents = [];
  for (let i = 0; i < 12; i++) {
    const gpus =
      i % 3 === 0
        ? []
        : [
            {
              deviceId: `pci:0000:01:00.0`,
              model: "Radeon RX Vega 64",
              vendor: "AMD",
            },
            {
              deviceId: `pci:0000:02:00.0`,
              model: "Radeon RX Vega 64",
              vendor: "AMD",
            },
          ];
    const socket = new WebSocket("ws://127.0.0.1:43188/ws");
    agents.push(socket);
    let id,
      processes,
      initial = true;
    socket.on("open", () =>
      socket.send(
        JSON.stringify({
          type: "register",
          data: {
            systemId: `fixture-${i}`,
            clientName: `Workshop ${String(i + 1).padStart(2, "0")}`,
            protocolVersion: 2,
            version: "1.3.1+audit-fixture",
            bootId: `fixture-boot-${i}`,
            capabilities: {
              commandResults: true,
              appUpdates: true,
              cpuEngines: ["xmrig", "nanominer"],
            },
            systemInfo: {
              hostname: `workshop-${i + 1}`,
              cpu: { brand: "AMD Ryzen 9 5950X" },
              gpus,
            },
          },
        }),
      ),
    );
    const report = () => {
      if (socket.readyState !== 1 || !processes || i === 10) return;
      const now = new Date().toISOString();
      socket.send(
        JSON.stringify({
          type: "status-update",
          data: {
            appUpdate: {
              state: "downloaded",
              supported: true,
              version: "1.3.2",
              percent: 100,
              updatedAt: now,
            },
            processes: processes.map((p) => ({
              ...p,
              hashrateObservedAt: now,
            })),
            stats: {
              observedAt: now,
              cpu: { usage: 96, temperature: i === 8 ? 92 : 64 },
              memory: { usage: 42, total: 32e9, used: 13e9 },
              gpus: gpus.map((g) => ({
                ...g,
                temperature: 69,
                powerWatts: 132,
                usage: 98,
              })),
            },
          },
        }),
      );
    };
    socket.on("message", async (raw) => {
      const msg = JSON.parse(raw);
      if (msg.type === "bound") {
        id = msg.data.minerId;
        const config = msg.data.configs;
        processes = [
          {
            id: "xmrig-1",
            type: "xmrig",
            engine: "nanominer",
            minerVersion: "3.10.0",
            effectiveSettings: { cpuThreads: 16, devFeePercent: 2 },
            diagnostic: {
              status: "ready",
              engine: "nanominer",
              version: "3.10.0",
              path: "C:/Fixture/MineMaster/miners/nanominer/3.10.0/nanominer.exe",
              expectedSha256: "a".repeat(64),
              observedAt: new Date().toISOString(),
              windows: {
                status: "available",
                signatureStatus: "NotSigned",
                detections: [],
                checkedAt: new Date().toISOString(),
                message: "Simulated file check; no matching Defender history.",
              },
            },
            deviceType: "CPU",
            running: true,
            enabled: true,
            algorithm: "rx/0",
            hashrate: i === 7 ? 0 : 18000 + i * 450,
            startedAt: new Date(Date.now() - 25e6).toISOString(),
            activeConfig: config.xmrig,
            appliedConfigVersion:
              i === 5 ? "older-revision" : config.xmrig.version,
            desiredConfigVersion: config.xmrig.version,
          },
          ...(gpus.length
            ? [
                {
                  id: "nanominer-1",
                  type: "nanominer",
                  engine: "nanominer",
                  minerVersion: "3.10.0",
                  deviceType: "GPU",
                  running: true,
                  enabled: true,
                  algorithm: "kawpow",
                  hashrate: 58e6 + i * 1e6,
                  startedAt: new Date(Date.now() - 25e6).toISOString(),
                  activeConfig: config.nanominer,
                  appliedConfigVersion: config.nanominer.version,
                  desiredConfigVersion: config.nanominer.version,
                },
              ]
            : []),
        ];
        await db.collection("miners").updateOne(
          { id },
          {
            $set: {
              group: i < 6 ? "Workshop" : "Garage",
              tags: i % 2 ? ["gpu", "amd"] : ["cpu"],
            },
          },
        );
        report();
        const rows = [],
          base = Math.floor((Date.now() - 86400000) / 60000) * 60000;
        for (let minute = 0; minute < 1440; minute++)
          for (const p of processes)
            if (!(minute > 600 && minute < 625))
              rows.push({
                minerId: id,
                processId: p.id,
                deviceType: p.deviceType,
                algorithm: p.algorithm,
                timestamp: new Date(base + minute * 60000),
                integral:
                  p.hashrate * (0.97 + Math.sin(minute / 20) * 0.03) * 60000,
                coveredMs: 60000,
                coveredUntil: base + (minute + 1) * 60000,
              });
        await db.collection("hashrateBuckets").insertMany(rows);
        socket.send(
          JSON.stringify({
            type: "logs",
            data: {
              entries: Array.from({ length: 12 }, (_, n) => ({
                processId: "xmrig-1",
                message:
                  n === 3
                    ? "pool connection lost; retrying in 5 seconds"
                    : `accepted (${142 + n}/0) diff 250000`,
                level: n === 3 ? "warning" : "info",
                observedAt: new Date(Date.now() - n * 5000).toISOString(),
              })),
            },
          }),
        );
        if (i === 11) socket.close();
      }
      if (msg.type === "command") {
        const c = msg.data;
        socket.send(
          JSON.stringify({
            type: "command-result",
            data: { id: c.id, status: "received" },
          }),
        );
        setTimeout(() => {
          for (const p of processes.filter(
            (p) => c.deviceType === "ALL" || p.deviceType === c.deviceType,
          )) {
            if (c.action === "stop") p.running = false;
            if (c.action === "start" || c.action === "restart")
              p.running = true;
            if (c.configs?.[p.type]) {
              p.desiredConfigVersion = c.configs[p.type].version;
              if (c.action !== "config-update")
                p.appliedConfigVersion = p.desiredConfigVersion;
            }
          }
          report();
          if (socket.readyState === 1)
            socket.send(
              JSON.stringify({
                type: "command-result",
                data: {
                  id: c.id,
                  status: "succeeded",
                  result: { simulated: true },
                },
              }),
            );
        }, 800);
      }
    });
    const timer = setInterval(report, 5000);
    socket.on("close", () => clearInterval(timer));
  }
  console.log("Disposable UI fixture: http://127.0.0.1:43188");
  const stop = async () => {
    agents.forEach((s) => s.terminate());
    wss.clients.forEach((s) => s.terminate());
    service.shutdown();
    server.close();
    await storage.disconnect();
    await mongo.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
