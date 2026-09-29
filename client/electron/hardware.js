function pci(value) {
  if (!value) return null;
  const text = String(value)
    .trim()
    .toLowerCase()
    .replace(/^00000000:/, "0000:");
  if (/^[0-9a-f]{2}:[0-9a-f]{2}\.[0-7]$/.test(text)) return `0000:${text}`;
  return /^[0-9a-f]{4}:[0-9a-f]{2}:[0-9a-f]{2}\.[0-7]$/.test(text)
    ? text
    : null;
}
function identity(gpu, index) {
  const explicit = gpu.deviceId;
  const bus = pci(gpu.busAddress || gpu.pciBus || gpu.bus);
  return (
    (typeof explicit === "string" &&
    explicit &&
    (!explicit.startsWith("pci:") || pci(explicit.slice(4)))
      ? explicit
      : null) ||
    (bus
      ? `pci:${bus}`
      : gpu.uuid
        ? `uuid:${gpu.uuid}`
        : `index:${gpu.id ?? index}`)
  );
}
function integrated(gpu = {}) {
  const model = (gpu.model || "").replace(/\((?:tm|r)\)/gi, "").trim();
  return (
    gpu.integrated === true ||
    /basic display|virtual|integrated/i.test(gpu.model || "") ||
    (/intel/i.test(gpu.vendor || "") &&
      /uhd|iris|hd graphics/i.test(gpu.model || "")) ||
    (/amd|ati|advanced micro devices/i.test(gpu.vendor || "") &&
      /^(?:amd )?radeon graphics$|renoir|raphael|cezanne|lucienne/i.test(model))
  );
}
function inventory(controllers = []) {
  const seen = new Set();
  return controllers
    .filter((g) => !integrated(g))
    .map((g, i) => ({
      id: i,
      deviceId: identity(g, i),
      identityQuality: identity(g, i).startsWith("index:")
        ? "positional"
        : "hardware",
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
