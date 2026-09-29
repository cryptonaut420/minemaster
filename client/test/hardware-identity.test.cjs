const { test } = require("node:test");
const assert = require("node:assert/strict");
const { pci, identity, inventory } = require("../electron/hardware");
const { normalizeGpus } = require("../../server/src/services/telemetry");
const {
  evaluate,
  DEFAULT_RULES,
} = require("../../server/src/services/monitoring");

test("Windows AMD integrated adapters and placeholder bus names do not become physical mining GPUs", () => {
  const rows = [
    { vendor: "NVIDIA", model: "RTX 3080", bus: "01:00.0", vram: 10240 },
    {
      vendor: "Advanced Micro Devices, Inc.",
      model: "AMD Radeon(TM) Graphics",
      bus: "PCI",
      deviceId: "pci:pci",
      vram: 512,
    },
    { vendor: "AMD", model: "AMD Radeon RX 6800", bus: "PCI" },
    { vendor: "AMD", model: "AMD Radeon RX 6800", bus: "PCI" },
  ];
  const local = inventory(rows),
    server = normalizeGpus(rows);
  assert.equal(local.length, 3);
  assert.equal(server.length, 3);
  assert.equal(local[0].deviceId, "pci:0000:01:00.0");
  assert.equal(server[0].deviceId, local[0].deviceId);
  assert.equal(local[1].identityQuality, "positional");
  assert.equal(server[1].identityQuality, "positional");
  assert.notEqual(local[1].deviceId, local[2].deviceId);
  assert.notEqual(server[1].deviceId, server[2].deviceId);
  assert.equal(pci("PCI"), null);
  assert.equal(pci("00000000:01:00.0"), "0000:01:00.0");
  assert.equal(
    identity({ deviceId: "pci:pci", bus: "PCI", uuid: "GPU-fixture" }, 0),
    "uuid:GPU-fixture",
  );
  assert.equal(
    inventory([{ vendor: "Intel", model: "Intel Arc A770", bus: "01:00.0" }])
      .length,
    1,
  );
});

test("correcting a fake PCI identity does not raise a missing-GPU incident while real missing cards still do", () => {
  const now = Date.now();
  const rig = {
    id: "fixture",
    connectionId: "connected",
    lastSeen: new Date(now),
    telemetryReceivedAt: new Date(now),
    expectedDeviceIds: ["pci:pci"],
    hardware: { gpus: [] },
    processes: [],
  };
  assert.equal(
    evaluate(rig, DEFAULT_RULES, now).some((i) => i.rule === "missing_gpu"),
    false,
  );
  rig.expectedDeviceIds.push("pci:0000:01:00.0");
  assert.equal(
    evaluate(rig, DEFAULT_RULES, now).some((i) => i.rule === "missing_gpu"),
    true,
  );
});
