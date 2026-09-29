const fs = require("fs/promises");
const path = require("path");
const { releases, verifyDirectory } = require("../electron/mining/install");

async function filesUnder(root, prefix = "") {
  const files = [];
  for (const entry of await fs.readdir(path.join(root, prefix), {
    withFileTypes: true,
  })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(root, relative)));
    else if (entry.isFile()) files.push(relative);
    else throw Error(`Unexpected packaged miner entry: ${relative}`);
  }
  return files;
}

async function verifyPackagedMiners(root, platform, arch, manifest = releases) {
  const expected = [];
  for (const [engine, targets] of Object.entries(manifest)) {
    const release = targets[`${platform}-${arch}`];
    if (!release) continue;
    const relative = `${engine}/${release.version}`;
    await verifyDirectory(path.join(root, relative), release);
    const receipt = JSON.parse(
      await fs.readFile(path.join(root, relative, "release.json"), "utf8"),
    );
    if (
      receipt.version !== release.version ||
      receipt.archiveSha256 !== release.sha256
    )
      throw Error(`Incorrect packaged ${engine} receipt`);
    expected.push(
      ...Object.keys(release.files).map((file) => `${relative}/${file}`),
      `${relative}/release.json`,
    );
  }
  if (!expected.length) throw Error(`No pinned miners for ${platform}/${arch}`);
  const actual = await filesUnder(root);
  if (JSON.stringify(actual.sort()) !== JSON.stringify(expected.sort()))
    throw Error(`Unexpected or missing miner files in ${root}`);
}

if (require.main === module) {
  const output = process.argv[2];
  if (!output)
    throw Error("Usage: verify-packaged-miners.cjs <release-directory>");
  Promise.all([
    verifyPackagedMiners(
      path.join(output, "linux-unpacked/resources/miners"),
      "linux",
      "x64",
    ),
    verifyPackagedMiners(
      path.join(output, "win-unpacked/resources/miners"),
      "win32",
      "x64",
    ),
  ])
    .then(() =>
      console.log("Windows/Linux packaged miner files and hashes verified"),
    )
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
module.exports = { verifyPackagedMiners };
