// Keep a record of admin-owned values so a delivered password never becomes a local override.
import { engineFor } from "./miningConfig.js";
const localKeys = ["password", "rigName", "workerName", "customPath", "gpus"];
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const meaningful = (value) =>
  value !== undefined &&
  value !== "" &&
  (!Array.isArray(value) || value.length > 0);
export function mergeAssignment(miner, assigned) {
  const local = {};
  for (const key of localKeys) {
    const value = miner.config[key];
    if (!meaningful(value)) continue;
    const inherited =
      miner.assignedConfig && equal(value, miner.assignedConfig[key]);
    if (!inherited && !equal(value, assigned[key])) local[key] = value;
  }
  const nextEngine = engineFor(miner.type, assigned);
  const changedEngine = nextEngine !== engineFor(miner.type, miner.config);
  const clearedPath = changedEngine && !!miner.config.customPath;
  if (changedEngine) {
    delete local.customPath;
    delete local.gpus;
  }
  return {
    ...miner,
    assignedConfig: JSON.parse(JSON.stringify(assigned)),
    config: {
      ...miner.config,
      ...assigned,
      ...local,
      engine: nextEngine,
      ...(changedEngine ? { customPath: "", gpus: [] } : {}),
    },
    localOverrides: Object.keys(local),
    configNotice: clearedPath
      ? "Admin changed the mining engine. The previous engine's custom executable path was cleared; the verified managed engine will be used at the next start."
      : null,
  };
}
