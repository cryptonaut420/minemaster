const STATES = [
  "idle",
  "checking",
  "available",
  "downloading",
  "downloaded",
  "installing",
  "error",
  "unsupported",
];
function normalize(value) {
  if (!value || !STATES.includes(value.state)) return null;
  const time = (v) =>
    Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;
  return {
    state: value.state,
    supported: value.supported === true,
    version:
      typeof value.version === "string" ? value.version.slice(0, 100) : null,
    percent: Number.isFinite(value.percent)
      ? Math.max(0, Math.min(100, value.percent))
      : null,
    message:
      typeof value.message === "string" ? value.message.slice(0, 2000) : null,
    updatedAt: time(value.updatedAt),
    checkedAt: time(value.checkedAt),
  };
}
module.exports = { normalize };
