const fs = require("fs");
const path = require("path");
const {
  releaseFor,
  targetName,
  verifyDirectory,
  installRelease,
} = require("./install");
const {
  validate,
  xmrigConfig,
  nanominerConfig,
  parseArguments,
} = require("../../src/utils/miningConfig");
function describeError(error, executable) {
  const code = error.code || "START_FAILED";
  const messages = {
    ENOENT:
      "Miner executable is missing. It may have been removed or quarantined. Review Windows Security Protection History, then use Repair.",
    EACCES:
      "The operating system denied access to the miner. Review file permissions and security protection history.",
    EPERM:
      "The operating system blocked this operation. Review Windows Security Protection History and device policy.",
    UNKNOWN:
      "The operating system could not launch the miner. Review protection history for this exact file.",
  };
  return {
    code,
    message: messages[code] || error.message,
    path: executable || null,
    observedAt: new Date().toISOString(),
  };
}
function createRuntime({
  userData,
  bundledRoot,
  platform = process.platform,
  arch = process.arch,
  hostname,
}) {
  const directory = (type) =>
    path.join(
      userData,
      "miners",
      type,
      releaseFor(type, platform, arch).version,
    );
  const busy = new Set();
  async function inspect(type, customPath) {
    let executable;
    try {
      const release = releaseFor(type, platform, arch);
      executable = customPath || path.join(directory(type), release.binary);
      if (customPath) {
        const stat = await fs.promises.stat(customPath);
        if (!stat.isFile())
          throw Error("Custom path must point to an executable file");
        return {
          status: "custom",
          version: null,
          expectedVersion: release.version,
          path: executable,
          message:
            "Custom executable selected; upstream provenance and version are not verified",
          observedAt: new Date().toISOString(),
        };
      }
      await verifyDirectory(directory(type), release);
      return {
        status: "ready",
        version: release.version,
        expectedVersion: release.version,
        path: executable,
        message: "Verified upstream executable",
        observedAt: new Date().toISOString(),
      };
    } catch (error) {
      return { status: "unavailable", ...describeError(error, executable) };
    }
  }
  async function prepare(type, { repair = false } = {}) {
    if (busy.has(type))
      throw Error("Miner installation is already in progress");
    busy.add(type);
    try {
      const release = releaseFor(type, platform, arch),
        dest = directory(type);
      // Once a version has been installed, a missing file is a fault requiring explicit repair.
      if (
        !repair &&
        (fs.existsSync(dest) || fs.existsSync(`${dest}.installed`))
      ) {
        await verifyDirectory(dest, release);
        return;
      }
      const source = path.join(bundledRoot, type, release.version);
      try {
        await verifyDirectory(source, release);
      } catch (error) {
        if (!repair) throw error;
        const result = await installRelease(type, dest, { platform, arch });
        await fs.promises.writeFile(`${dest}.installed`, release.version);
        return result;
      }
      const result = await installRelease(type, dest, {
        platform,
        arch,
        source,
      });
      await fs.promises.writeFile(`${dest}.installed`, release.version);
      return result;
    } finally {
      busy.delete(type);
    }
  }
  async function launchSpec(type, id, config) {
    const validation = validate(type, config);
    if (!validation.valid)
      throw Object.assign(Error(validation.errors.join("; ")), {
        code: "INVALID_CONFIG",
      });
    if (!config.customPath) await prepare(type);
    const diagnostic = await inspect(type, config.customPath);
    if (diagnostic.status === "unavailable")
      throw Object.assign(Error(diagnostic.message), {
        code: diagnostic.code,
        path: diagnostic.path,
      });
    const workDir = path.join(userData, "processes", id);
    await fs.promises.mkdir(workDir, { recursive: true });
    const configPath = path.join(
      workDir,
      type === "xmrig" ? "config.json" : "config.ini",
    );
    const content =
      type === "xmrig"
        ? JSON.stringify(xmrigConfig(config, hostname), null, 2)
        : nanominerConfig(config, hostname);
    await fs.promises.writeFile(`${configPath}.tmp`, content, { mode: 0o600 });
    await fs.promises.rename(`${configPath}.tmp`, configPath);
    const args =
      type === "xmrig"
        ? [
            "--config",
            configPath,
            ...(config.threads > 0
              ? ["--threads", String(config.threads)]
              : []),
            ...parseArguments(config.additionalArgs),
          ]
        : [configPath];
    return { executable: diagnostic.path, args, cwd: workDir, diagnostic };
  }
  return { inspect, prepare, launchSpec, target: targetName(platform, arch) };
}
module.exports = { createRuntime, describeError };
