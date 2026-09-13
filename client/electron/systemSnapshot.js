const { inventory } = require("./hardware");
function mergeSystemSnapshot(base, results, now = Date.now()) {
  const [os, graphics, cpu] = results;
  const value = (result) =>
    result.status === "fulfilled" && result.value ? result.value : null;
  const osInfo = value(os),
    gpuInfo = value(graphics),
    cpuInfo = value(cpu);
  return {
    ...base,
    ...(osInfo
      ? {
          os: {
            platform: osInfo.platform,
            distro: osInfo.distro,
            release: osInfo.release,
            arch: osInfo.arch,
          },
        }
      : {}),
    ...(cpuInfo
      ? { cpu: { ...base.cpu, physicalCores: cpuInfo.physicalCores || null } }
      : {}),
    ...(gpuInfo
      ? {
          gpus: inventory(gpuInfo.controllers || []),
          gpuDetectionStatus: "complete",
          gpuObservedAt: new Date(now).toISOString(),
        }
      : { gpuDetectionStatus: "unavailable" }),
    lastUpdatedAt: now,
  };
}
module.exports = { mergeSystemSnapshot };
