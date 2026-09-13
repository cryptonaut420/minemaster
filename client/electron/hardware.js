function pci(value) {
  if (!value) return null;
  const text = String(value)
    .toLowerCase()
    .replace(/^00000000:/, "0000:");
  return /^[0-9a-f]{2}:[0-9a-f]{2}\.[0-7]$/.test(text) ? `0000:${text}` : text;
}
function identity(gpu, index) {
  return (
    gpu.deviceId ||
    (gpu.busAddress || gpu.pciBus || gpu.bus
      ? `pci:${pci(gpu.busAddress || gpu.pciBus || gpu.bus)}`
      : gpu.uuid
        ? `uuid:${gpu.uuid}`
        : `index:${gpu.id ?? index}`)
  );
}
function integrated(gpu = {}) {
  return (
    gpu.integrated === true ||
    /basic display|virtual|integrated/i.test(gpu.model || "") ||
    (/intel/i.test(gpu.vendor || "") &&
      /uhd|iris|hd graphics/i.test(gpu.model || "")) ||
    (/amd|ati/i.test(gpu.vendor || "") &&
      /^(?:amd )?radeon graphics$|renoir|raphael|cezanne|lucienne/i.test(
        gpu.model || "",
      ))
  );
}
function inventory(controllers = []) {
  const seen = new Set();
  return controllers
    .filter((g) => !integrated(g))
    .map((g, i) => ({
      id: i,
      deviceId: identity(g, i),
      identityQuality:
        g.busAddress || g.pciBus || g.bus || g.uuid || g.deviceId
          ? "hardware"
          : "positional",
      vendor: g.vendor || "",
      model: g.model || "Unknown GPU",
      vram: g.vram ?? null,
      bus: pci(g.busAddress || g.pciBus || g.bus),
      uuid: g.uuid || null,
    }))
    .filter((g) => {
      if (seen.has(g.deviceId)) return false;
      seen.add(g.deviceId);
      return true;
    });
}
module.exports = { pci, identity, integrated, inventory };
