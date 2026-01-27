/**
 * Utility to get a unique system identifier (MAC address)
 */

/**
 * Get the MAC address of the primary network interface
 * @returns {Promise<string>} MAC address
 */
export async function getMacAddress() {
  if (!window.electron) {
    console.warn('Electron API not available');
    return 'unknown-mac';
  }

  try {
    const macAddress = await window.electron.invoke('get-mac-address');
    return macAddress;
  } catch (error) {
    console.error('Error getting MAC address:', error);
    return 'unknown-mac';
  }
}

/**
 * Get a unique system ID (cached MAC address)
 * @returns {Promise<string>} System ID
 */
export async function getSystemId() {
  // Check if we have a cached ID
  const cachedId = localStorage.getItem('systemId');
  if (cachedId) {
    return cachedId;
  }

  // Get MAC address and cache it
  const macAddress = await getMacAddress();
  localStorage.setItem('systemId', macAddress);
  return macAddress;
}
