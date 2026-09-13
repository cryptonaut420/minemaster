const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { mergeSystemSnapshot } = require("../electron/systemSnapshot");
test("a failed GPU provider preserves timestamped inventory without blocking CPU or OS updates", () => {
  const base = {
    os: { distro: "old" },
    cpu: { brand: "CPU" },
    gpus: [{ deviceId: "pci:01:00.0" }],
    gpuObservedAt: "2026-09-01T00:00:00.000Z",
  };
  const result = mergeSystemSnapshot(base, [
    { status: "fulfilled", value: { distro: "Linux" } },
    { status: "rejected", reason: Error("GPU timeout") },
    { status: "fulfilled", value: { physicalCores: 8 } },
  ]);
  assert.equal(result.os.distro, "Linux");
  assert.equal(result.cpu.physicalCores, 8);
  assert.equal(result.gpuObservedAt, base.gpuObservedAt);
  assert.equal(result.gpuDetectionStatus, "unavailable");
  assert.deepEqual(result.gpus, base.gpus);
});
