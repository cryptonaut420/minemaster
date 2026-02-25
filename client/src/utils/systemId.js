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
  const cachedId = localStorage.getItem('systemId');
  if (cachedId && cachedId !== 'unknown-mac') {
    return cachedId;
  }

  const macAddress = await getMacAddress();
  // Only persist if we got a real MAC address
  if (macAddress && macAddress !== 'unknown-mac') {
    localStorage.setItem('systemId', macAddress);
  }
  return macAddress;
}
