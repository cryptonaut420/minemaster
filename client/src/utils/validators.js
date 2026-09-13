import { validate, poolAddress } from "./miningConfig";
export function validatePool(pool) {
  return {
    valid: poolAddress(pool),
    error: poolAddress(pool)
      ? null
      : "Pool must be host:port with a valid port",
  };
}
export function validateWallet(wallet) {
  const valid = typeof wallet === "string" && !!wallet.trim();
  return {
    valid,
    error: valid ? null : "Wallet address or pool username is required",
  };
}
export const validateXMRigConfig = (config) => validate("xmrig", config);
export const validateNanominerConfig = (config) =>
  validate("nanominer", config);
export const validateMinerConfig = validate;
