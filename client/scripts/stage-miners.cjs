const fs = require("fs/promises");
const path = require("path");
const {
  releases,
  targetName,
  copyRuntime,
  replaceDirectory,
} = require("../electron/mining/install");

// Build a clean allowlisted resource tree. Keep download caches intact; never
// package obsolete versions, optional drivers or arbitrary files from a cache.
async function stageMiners(
  platform,
  arch,
  {
    sourceRoot = path.join(__dirname, "../miners"),
    bundleRoot = path.join(__dirname, "../.miner-bundles"),
    manifest = releases,
  } = {},
) {
  const target = targetName(platform, arch);
  const selected = Object.entries(manifest).filter(
    ([, rows]) => rows[`${platform}-${arch}`],
  );
  if (!selected.length) throw Error(`No pinned miners for ${platform}/${arch}`);
  await fs.mkdir(bundleRoot, { recursive: true });
  const staging = await fs.mkdtemp(path.join(bundleRoot, `${target}.staging-`));
  try {
    for (const [engine, rows] of selected) {
      const release = rows[`${platform}-${arch}`];
      await copyRuntime(
        path.join(sourceRoot, target, engine, release.version),
        path.join(staging, engine, release.version),
        release,
      );
    }
    await replaceDirectory(staging, path.join(bundleRoot, target));
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
  return path.join(bundleRoot, target);
}
module.exports = { stageMiners };
