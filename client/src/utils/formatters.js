/**
 * Shared formatting utilities for consistent display across the app
 */

/**
 * Format bytes to human-readable format
 * @param {number} bytes - Number of bytes
 * @param {number} decimals - Number of decimal places (default: 1)
 * @returns {string} Formatted string (e.g., "8.0 GB")
 */
export function formatBytes(bytes, decimals = 1) {
  if (bytes === null || bytes === undefined || bytes === 0) return '0 B';
  if (typeof bytes !== 'number' || !isFinite(bytes)) return 'N/A';
  if (bytes < 0) bytes = Math.abs(bytes);
  
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

/**
 * Format temperature to Celsius
 * @param {number|null} temp - Temperature value
 * @returns {string} Formatted temperature (e.g., "65°C" or "N/A")
 */
export function formatTemp(temp) {
  if (temp === null || temp === undefined || isNaN(temp)) return 'N/A';
  return `${Math.round(temp)}°C`;
}

/**
 * Format percentage value
 * @param {number} value - Percentage value (0-100)
 * @param {number} decimals - Number of decimal places (default: 1)
 * @returns {string} Formatted percentage (e.g., "75.5%")
 */
export function formatPercent(value, decimals = 1) {
  if (value === null || value === undefined || isNaN(value)) return 'N/A';
  return `${value.toFixed(decimals)}%`;
}

/**
 * Format hashrate with appropriate unit
 * @param {number} hashrate - Hashrate in H/s
 * @returns {string|null} Formatted hashrate (e.g., "1.23 MH/s")
 */
export function formatHashrate(hashrate) {
  if (!hashrate || hashrate === 0) return null;
  if (typeof hashrate !== 'number' || !isFinite(hashrate)) return null;
  
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

/**
 * Parse hashrate from miner output
 * @param {string} output - Miner output line
 * @returns {number|null} Hashrate in H/s or null if not found
 */
export function parseHashrate(output) {
  if (!output || typeof output !== 'string') return null;

  // XMRig format: "speed 10s/60s/15m 123.4 456.7 789.0 H/s" - capture first hashrate value after the label
  const xmrigPattern = /speed\s+\S+\s+([\d.]+)\s+[\d.]+\s+[\d.]+\s*(H\/s|kH\/s|KH\/s|MH\/s|GH\/s|TH\/s)/i;
  
  // Nanominer format: "Total: 25.5 Mh/s"
  const nanominerPattern = /Total:\s*([\d.]+)\s*(H\/s|kH\/s|KH\/s|MH\/s|Mh\/s|GH\/s|TH\/s)/i;

  // Generic fallback: any number followed by hashrate unit
  const genericPattern = /([\d.]+)\s*(H\/s|kH\/s|KH\/s|MH\/s|GH\/s|TH\/s)/i;
  
  const match = output.match(xmrigPattern) || output.match(nanominerPattern) || output.match(genericPattern);
  
  if (!match) return null;
  
  const value = parseFloat(match[1]);
  if (isNaN(value) || value === 0) return null;
  const unit = match[2].toLowerCase();
  
  // Convert to base H/s
  const multipliers = {
    'h/s': 1,
    'kh/s': 1000,
    'mh/s': 1000000,
    'gh/s': 1000000000,
    'th/s': 1000000000000
  };
  
  return value * (multipliers[unit] || 1);
}

/**
 * Format uptime duration
 * @param {number} milliseconds - Duration in milliseconds
 * @returns {string} Formatted duration (e.g., "2h 15m")
 */
export function formatUptime(milliseconds) {
  if (!milliseconds || milliseconds < 0) return '0m';
  
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) {
    return `${days}d ${hours % 24}h`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Truncate string to max length
 * @param {string} str - String to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} Truncated string
 */
export function truncate(str, maxLength = 50) {
  if (!str || str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
}
