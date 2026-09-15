// Local process rates use SI units; missing and invalid readings remain distinct from zero.
export const rate = (n) => {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0)
    return "Unavailable";
  for (const [factor, unit] of [
    [1e15, "PH/s"],
    [1e12, "TH/s"],
    [1e9, "GH/s"],
    [1e6, "MH/s"],
    [1e3, "kH/s"],
  ])
    if (n >= factor) return `${(n / factor).toFixed(2)} ${unit}`;
  return `${n.toFixed(1)} H/s`;
};
