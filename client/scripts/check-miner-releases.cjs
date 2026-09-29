const { execFile } = require("child_process");
const { promisify } = require("util");
const run = promisify(execFile);
const releases = require("../electron/mining/releases.json");
const repositories = {
  srbminer: "doktor83/SRBMiner-Multi",
  nanominer: "nanopool/nanominer",
  xmrig: "xmrig/xmrig",
};
const loadLatest = async (repository) =>
  JSON.parse(
    (
      await run("gh", ["api", `repos/${repository}/releases/latest`], {
        timeout: 20000,
        maxBuffer: 1024 * 1024,
      })
    ).stdout,
  );

async function checkMinerReleases({
  manifest = releases,
  load = loadLatest,
} = {}) {
  const rows = await Promise.all(
    Object.entries(repositories).map(async ([engine, repository]) => {
      const latest = await load(repository);
      const version = /^(?:v)?(\d+\.\d+\.\d+)$/.exec(
        latest.tag_name || "",
      )?.[1];
      if (!version || latest.draft || latest.prerelease)
        throw Error(`Could not verify a stable ${engine} release`);
      const pinned = Object.values(manifest[engine] || {});
      if (!pinned.length || pinned.some((r) => r.version !== version))
        throw Error(
          `${engine}: pinned ${[...new Set(pinned.map((r) => r.version))].join(", ") || "missing"}; official latest is ${version}. Review and verify the new release before publishing.`,
        );
      for (const pin of pinned) {
        const asset = latest.assets?.find((a) => a.name === pin.archive);
        if (!asset || asset.browser_download_url !== pin.url)
          throw Error(
            `${engine}: pinned archive is not an asset of the latest official release: ${pin.archive}`,
          );
        if (asset.digest && asset.digest !== `sha256:${pin.sha256}`)
          throw Error(
            `${engine}: upstream archive digest changed: ${pin.archive}`,
          );
      }
      return {
        engine,
        version,
        url: `https://github.com/${repository}/releases/tag/${latest.tag_name}`,
      };
    }),
  );
  return rows;
}
if (require.main === module)
  checkMinerReleases()
    .then((rows) => {
      for (const r of rows)
        console.log(
          `${r.engine} ${r.version}: matches latest official stable release`,
        );
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
module.exports = { checkMinerReleases };
