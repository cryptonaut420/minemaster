const { execFileSync } = require("child_process");
const path = require("path");
const { writeChecksums } = require("./verify-release.cjs");
const repository = "cryptonaut420/minemaster";
const gh = (...args) =>
  execFileSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
async function publish(directory, version, notes, runGh = gh) {
  const assets = await writeChecksums(directory, version);
  const tag = `v${version}`;
  runGh(
    "release",
    "create",
    tag,
    "--repo",
    repository,
    "--verify-tag",
    "--draft",
    "--title",
    `MineMaster ${version}`,
    "--notes-file",
    notes,
    ...assets.map((asset) => path.join(directory, asset.name)),
  );
  // A failed upload/check leaves a draft, never an incomplete public update.
  const release = JSON.parse(
    runGh("api", `repos/${repository}/releases?per_page=100`),
  ).find((row) => row.tag_name === tag);
  if (!release?.draft) throw Error("Expected an unpublished draft release");
  for (const asset of assets) {
    const uploaded = release.assets.find((row) => row.name === asset.name);
    if (
      uploaded?.state !== "uploaded" ||
      uploaded.size !== asset.size ||
      uploaded.digest !== `sha256:${asset.sha256}`
    )
      throw Error(
        `Uploaded asset verification failed: ${asset.name}; release remains a draft`,
      );
  }
  runGh(
    "release",
    "edit",
    tag,
    "--repo",
    repository,
    "--draft=false",
    "--latest",
  );
  console.log(`Published https://github.com/${repository}/releases/tag/${tag}`);
}
if (require.main === module)
  publish(...process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { publish };
