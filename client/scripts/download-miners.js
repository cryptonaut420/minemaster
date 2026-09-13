#!/usr/bin/env node
const path = require("path");
const {
  releases,
  targetName,
  releaseFor,
  verifyDirectory,
  installRelease,
} = require("../electron/mining/install");
async function setupTarget(platform = process.platform, arch = process.arch) {
  let count = 0;
  for (const type of Object.keys(releases)) {
    if (!releases[type][`${platform}-${arch}`]) continue;
    const release = releaseFor(type, platform, arch);
    const dir = path.join(
      __dirname,
      "..",
      "miners",
      targetName(platform, arch),
      type,
      release.version,
    );
    try {
      await verifyDirectory(dir, release);
    } catch (_) {
      await installRelease(type, dir, { platform, arch });
    }
    console.log(`Verified ${type} ${release.version} (${platform}/${arch})`);
    count++;
  }
  if (!count) throw Error(`No supported miners for ${platform}/${arch}`);
}
function parseTargets(args) {
  let all = false,
    platform = process.platform,
    arch = process.arch,
    platformSet = false,
    archSet = false;
  const usage = () =>
    Error(
      "Usage: setup [--all | --platform linux|win32|darwin] [--arch x64|arm64]",
    );
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--all" && !all) all = true;
    else if (
      args[i] === "--platform" &&
      !platformSet &&
      ["linux", "win32", "darwin"].includes(args[i + 1])
    ) {
      platform = args[++i];
      platformSet = true;
    } else if (
      args[i] === "--arch" &&
      !archSet &&
      ["x64", "arm64"].includes(args[i + 1])
    ) {
      arch = args[++i];
      archSet = true;
    } else throw usage();
  }
  if (all && (platformSet || (archSet && arch !== "x64"))) throw usage();
  return all
    ? [
        { platform: "linux", arch: "x64" },
        { platform: "win32", arch: "x64" },
      ]
    : [{ platform, arch }];
}
async function main(args) {
  for (const { platform, arch } of parseTargets(args))
    await setupTarget(platform, arch);
}
if (require.main === module)
  main(process.argv.slice(2)).catch((e) => {
    console.error(`Miner setup failed: ${e.message}`);
    process.exitCode = 1;
  });
module.exports = { setupTarget, parseTargets };
