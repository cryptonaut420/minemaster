// Format hashrate with appropriate unit
export function formatHashrate(hashrate) {
  if (!hashrate || hashrate === 0) return null;
  
  const absHashrate = Math.abs(hashrate);
  
  if (absHashrate >= 1000000000000) {
    return `${(hashrate / 1000000000000).toFixed(2)} TH/s`;
  } else if (absHashrate >= 1000000000) {
    return `${(hashrate / 1000000000).toFixed(2)} GH/s`;
  } else if (absHashrate >= 1000000) {
    return `${(hashrate / 1000000).toFixed(2)} MH/s`;
  } else if (absHashrate >= 1000) {
    return `${(hashrate / 1000).toFixed(2)} kH/s`;
  } else {
    return `${hashrate.toFixed(2)} H/s`;
  }
}
