/**
 * Configuration validation utilities
 */

/**
 * Validate pool address format
 * @param {string} pool - Pool address
 * @returns {{valid: boolean, error: string|null}}
 */
export function validatePool(pool) {
  if (!pool || pool.trim() === '') {
    return { valid: false, error: 'Pool address is required' };
  }
  
  // Basic format: host:port
  const poolPattern = /^[\w\-\.]+:\d+$/;
  if (!poolPattern.test(pool.trim())) {
    return { valid: false, error: 'Pool format should be host:port (e.g., pool.example.com:3333)' };
  }
  
  return { valid: true, error: null };
}

/**
 * Validate wallet address (basic check)
 * @param {string} wallet - Wallet address
 * @param {string} coin - Coin type (optional, for specific validation)
 * @returns {{valid: boolean, error: string|null}}
 */
export function validateWallet(wallet, coin = null) {
  if (!wallet || wallet.trim() === '') {
    return { valid: false, error: 'Wallet address is required' };
  }
  
  const trimmed = wallet.trim();
  
  // Minimum length check
  if (trimmed.length < 10) {
    return { valid: false, error: 'Wallet address is too short' };
  }
  
  // Coin-specific validation
  if (coin) {
    switch (coin.toUpperCase()) {
      case 'XMR':
      case 'WOW':
        // Monero addresses start with 4 and are ~95 characters
        if (!trimmed.startsWith('4')) {
          return { valid: false, error: 'Monero wallet should start with "4"' };
        }
        if (trimmed.length < 90 || trimmed.length > 100) {
          return { valid: false, error: 'Monero wallet length seems incorrect' };
        }
        break;
      
      case 'RVN':
        // Ravencoin addresses start with R
        if (!trimmed.startsWith('R')) {
          return { valid: false, error: 'Ravencoin wallet should start with "R"' };
        }
        break;
      
      case 'ETC':
      case 'ETH':
        // Ethereum addresses start with 0x
        if (!trimmed.startsWith('0x')) {
          return { valid: false, error: 'Ethereum wallet should start with "0x"' };
        }
        if (trimmed.length !== 42) {
          return { valid: false, error: 'Ethereum wallet should be 42 characters' };
        }
        break;
      
      case 'ERG':
        // Ergo addresses start with 9
        if (!trimmed.startsWith('9')) {
          return { valid: false, error: 'Ergo wallet should start with "9"' };
        }
        break;
    }
  }
  
  return { valid: true, error: null };
}

/**
 * Validate XMRig configuration
 * @param {Object} config - XMRig configuration object
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateXMRigConfig(config) {
  const errors = [];
  
  // Validate pool
  const poolCheck = validatePool(config.pool);
  if (!poolCheck.valid) {
    errors.push(poolCheck.error);
  }
  
  // Validate wallet
  const walletCheck = validateWallet(config.user, config.coin);
  if (!walletCheck.valid) {
    errors.push(walletCheck.error);
  }
  
  // Validate algorithm
  if (!config.algorithm || config.algorithm.trim() === '') {
    errors.push('Algorithm is required');
  }
  
  // Validate thread percentage
  if (config.threadPercentage !== undefined) {
    if (config.threadPercentage < 10 || config.threadPercentage > 100) {
      errors.push('CPU usage must be between 10% and 100%');
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validate Nanominer configuration
 * @param {Object} config - Nanominer configuration object
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateNanominerConfig(config) {
  const errors = [];
  
  // Validate pool
  const poolCheck = validatePool(config.pool);
  if (!poolCheck.valid) {
    errors.push(poolCheck.error);
  }
  
  // Validate wallet
  const walletCheck = validateWallet(config.user, config.coin);
  if (!walletCheck.valid) {
    errors.push(walletCheck.error);
  }
  
  // Validate algorithm
  if (!config.algorithm || config.algorithm.trim() === '') {
    errors.push('Algorithm is required');
  }
  
  // Validate coin
  if (!config.coin || config.coin.trim() === '') {
    errors.push('Coin is required');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validate miner configuration based on type
 * @param {string} minerType - Type of miner ('xmrig' or 'nanominer')
 * @param {Object} config - Configuration object
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateMinerConfig(minerType, config) {
  if (minerType === 'xmrig') {
    return validateXMRigConfig(config);
  } else if (minerType === 'nanominer') {
    return validateNanominerConfig(config);
  }
  
  return { valid: false, errors: ['Unknown miner type'] };
}
