const fs = require("fs/promises");
const path = require("path");
const { createHash } = require("crypto");
const { createReadStream } = require("fs");
const yaml = require("js-yaml");
async function digest(file, algorithm, encoding) {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest(encoding);
}
async function verifyRelease(directory, version) {
  const setup = `MineMaster-${version}-Windows-Setup.exe`;
  const linux = `MineMaster-${version}-Linux.AppImage`;
  const names = [
    setup,
    `MineMaster-${version}-Windows-Portable.exe`,
    linux,
    `${setup}.blockmap`,
    "latest.yml",
    "latest-linux.yml",
  ];
  const assets = [];
  for (const name of names) {
    const file = path.join(directory, name);
    const { size } = await fs.stat(file);
    if (!size) throw Error(`Empty release asset: ${name}`);
    assets.push({ name, size, sha256: await digest(file, "sha256", "hex") });
  }
  for (const [feed, target] of [
    ["latest.yml", setup],
    ["latest-linux.yml", linux],
  ]) {
    const info = yaml.load(
      await fs.readFile(path.join(directory, feed), "utf8"),
    );
    const file = info.files?.find((entry) => entry.url === target);
    const expected = await digest(
      path.join(directory, target),
      "sha512",
      "base64",
    );
    if (
      info.version !== version ||
      info.path !== target ||
      !file ||
      info.files.length !== 1 ||
      file.size !== assets.find((a) => a.name === target).size ||
      file.sha512 !== expected ||
      info.sha512 !== expected
    )
      throw Error(`Update feed does not match its release artifact: ${feed}`);
  }
  return assets;
}
async function writeChecksums(directory, version) {
  const assets = await verifyRelease(directory, version);
  const file = path.join(directory, "SHA256SUMS");
  await fs.writeFile(
    file,
    assets.map((a) => `${a.sha256}  ${a.name}\n`).join(""),
  );
  return [
    ...assets,
    {
      name: "SHA256SUMS",
      size: (await fs.stat(file)).size,
      sha256: await digest(file, "sha256", "hex"),
    },
  ];
}
if (require.main === module)
  writeChecksums(process.argv[2], process.argv[3])
    .then((assets) =>
      console.log(
        `Verified ${assets.length} release assets and both update feeds`,
      ),
    )
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
module.exports = { verifyRelease, writeChecksums };
