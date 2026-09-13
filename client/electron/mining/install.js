// Pinned upstream releases. This module downloads and verifies files; it never runs a miner.
const fs = require("fs");
const path = require("path");
const https = require("https");
const crypto = require("crypto");
const { pipeline } = require("stream/promises");
const { Transform } = require("stream");
const { execFile } = require("child_process");
const { promisify } = require("util");
const releases = require("./releases.json");
const runFile = promisify(execFile);
const targetName = (platform, arch) =>
  `${{ win32: "win", darwin: "mac", linux: "linux" }[platform] || platform}-${arch}`;
function releaseFor(type, platform = process.platform, arch = process.arch) {
  const release = releases[type]?.[`${platform}-${arch}`];
  if (!release)
    throw Object.assign(
      Error(`${type} is not bundled for ${platform}/${arch}`),
      { code: "UNSUPPORTED_PLATFORM" },
    );
  return release;
}
async function hashFile(file) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
async function verifyDirectory(dir, release) {
  for (const [file, expected] of Object.entries(release.files)) {
    if ((await hashFile(path.join(dir, file))) !== expected)
      throw Object.assign(
        Error(
          `Verification failed for ${file}. Use Repair to restore the pinned upstream release.`,
        ),
        { code: "CHECKSUM_MISMATCH" },
      );
  }
  return path.join(dir, release.binary);
}
async function download(
  url,
  file,
  { timeoutMs = 120000, maxBytes = 150 * 1024 * 1024 } = {},
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  async function request(current, remaining = 5) {
    const parsed = new URL(current);
    if (parsed.protocol !== "https:")
      throw Error("Miner downloads require HTTPS");
    const response = await new Promise((resolve, reject) => {
      const req = https.get(
        parsed,
        {
          signal: controller.signal,
          headers: { "User-Agent": "MineMaster/1.2" },
        },
        resolve,
      );
      req.setTimeout(30000, () => req.destroy(Error("Download stalled")));
      req.on("error", reject);
    });
    if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
      response.resume();
      if (!remaining || !response.headers.location)
        throw Error("Invalid download redirect");
      return request(
        new URL(response.headers.location, parsed).href,
        remaining - 1,
      );
    }
    if (response.statusCode !== 200) {
      response.resume();
      throw Error(`Download returned HTTP ${response.statusCode}`);
    }
    let size = 0;
    const limit = new Transform({
      transform(chunk, encoding, cb) {
        size += chunk.length;
        cb(
          size > maxBytes ? Error("Download exceeds size limit") : null,
          chunk,
        );
      },
    });
    await pipeline(
      response,
      limit,
      fs.createWriteStream(file, { flags: "wx" }),
      { signal: controller.signal },
    );
    if (!size) throw Error("Download was empty");
  }
  try {
    await request(url);
  } finally {
    clearTimeout(timeout);
  }
}
async function extract(archive, staging) {
  // Arguments are passed directly; paths with spaces/quotes never become shell code.
  if (archive.endsWith(".zip")) {
    if (process.platform === "win32")
      await runFile("tar.exe", ["-xf", archive, "-C", staging], {
        timeout: 120000,
        windowsHide: true,
      });
    else
      await runFile("unzip", ["-q", archive, "-d", staging], {
        timeout: 120000,
      });
  } else
    await runFile("tar", ["-xzf", archive, "-C", staging], {
      timeout: 120000,
      windowsHide: true,
    });
}
async function locate(dir, binary) {
  for (const item of await fs.promises.readdir(dir, { withFileTypes: true })) {
    if (item.isFile() && item.name === binary) return dir;
    if (item.isDirectory()) {
      const found = await locate(path.join(dir, item.name), binary);
      if (found) return found;
    }
  }
  return null;
}
async function copyRuntime(source, dest, release) {
  await fs.promises.mkdir(dest, { recursive: true });
  // Only runtime files are installed: no example wallets, scripts, autoupdaters or optional kernel drivers.
  for (const file of Object.keys(release.files)) {
    await fs.promises.mkdir(path.dirname(path.join(dest, file)), {
      recursive: true,
    });
    await fs.promises.copyFile(path.join(source, file), path.join(dest, file));
  }
  if (release.platform !== "win32")
    await fs.promises.chmod(path.join(dest, release.binary), 0o755);
  await verifyDirectory(dest, release);
  await fs.promises.writeFile(
    path.join(dest, "release.json"),
    JSON.stringify(
      {
        version: release.version,
        archiveSha256: release.sha256,
        installedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}
async function replaceDirectory(staged, destination) {
  const backup = `${destination}.previous-${crypto.randomUUID()}`;
  let backedUp = false;
  try {
    try {
      await fs.promises.rename(destination, backup);
      backedUp = true;
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    await fs.promises.rename(staged, destination);
  } catch (e) {
    if (backedUp) await fs.promises.rename(backup, destination);
    throw e;
  }
  if (backedUp)
    await fs.promises
      .rm(backup, { recursive: true, force: true })
      .catch(() => {});
}
async function installRelease(
  type,
  destination,
  {
    platform = process.platform,
    arch = process.arch,
    source,
    fetch = download,
    unpack = extract,
  } = {},
) {
  const release = releaseFor(type, platform, arch);
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  const staging = await fs.promises.mkdtemp(`${destination}.staging-`);
  try {
    let sourceDir = source;
    if (!sourceDir) {
      const archive = path.join(staging, release.archive);
      await fetch(release.url, archive);
      if ((await hashFile(archive)) !== release.sha256)
        throw Object.assign(
          Error(
            "Downloaded archive checksum does not match the upstream release",
          ),
          { code: "CHECKSUM_MISMATCH" },
        );
      const extracted = path.join(staging, "extracted");
      await fs.promises.mkdir(extracted);
      await unpack(archive, extracted);
      sourceDir = await locate(extracted, release.binary);
      if (!sourceDir)
        throw Error("Miner executable missing from verified archive");
    }
    await verifyDirectory(sourceDir, release);
    const ready = path.join(staging, "ready");
    await copyRuntime(sourceDir, ready, release);
    await replaceDirectory(ready, destination);
    return {
      version: release.version,
      path: path.join(destination, release.binary),
    };
  } finally {
    await fs.promises
      .rm(staging, { recursive: true, force: true })
      .catch(() => {});
  }
}
module.exports = {
  releases,
  releaseFor,
  targetName,
  hashFile,
  verifyDirectory,
  installRelease,
  download,
  copyRuntime,
  replaceDirectory,
};
