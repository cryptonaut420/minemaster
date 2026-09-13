const fs = require("fs");
const path = require("path");
const os = require("os");
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
  engineFor,
  cpuThreads,
} = require("../../src/utils/miningConfig");
const { createWindowsDiagnostics } = require("./windowsDiagnostics");
function describeError(error, executable, platform = process.platform) {
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
    message:
      platform === "linux" &&
      ["ENOENT", "EACCES", "EPERM", "ENOEXEC"].includes(code)
        ? {
            ENOENT:
              executable && fs.existsSync(executable)
                ? "The miner file exists but Linux could not load it. Check its architecture and required dynamic loader/libraries for this distribution."
                : "A required miner file is missing. Use Check miner files, then Repair while the engine is stopped.",
            EACCES:
              "Linux denied executable access. Check the file's executable permission, directory access and whether the user-data filesystem is mounted noexec.",
            EPERM:
              "Linux denied this operation. Check file ownership, mount restrictions and host policy.",
            ENOEXEC:
              "Linux could not execute this binary format. Check the selected engine's platform and CPU architecture.",
          }[code]
        : messages[code] || error.message,
    path: executable || error.path || null,
    observedAt: new Date().toISOString(),
  };
}
function createRuntime({
  userData,
  bundledRoot,
  platform = process.platform,
  arch = process.arch,
  hostname,
  logicalCores = os.availableParallelism?.() || os.cpus().length,
  windowsDiagnostics = createWindowsDiagnostics({ platform }),
}) {
  const directory = (type) =>
    path.join(
      userData,
      "miners",
      type,
      releaseFor(type, platform, arch).version,
    );
  const busy = new Set();
  async function inspectFiles(type, customPath) {
    let executable, release;
    try {
      release = releaseFor(type, platform, arch);
      executable = customPath || path.join(directory(type), release.binary);
      if (customPath) {
        const stat = await fs.promises.stat(customPath);
        if (!stat.isFile())
          throw Error("Custom path must point to an executable file");
        if (platform !== "win32")
          await fs.promises.access(customPath, fs.constants.X_OK);
        return {
          status: "custom",
          engine: type,
          version: null,
          expectedVersion: release.version,
          path: executable,
          message:
            "Custom executable selected; upstream provenance and version are not verified",
          observedAt: new Date().toISOString(),
        };
      }
      await verifyDirectory(directory(type), release);
      if (platform !== "win32")
        await fs.promises.access(executable, fs.constants.X_OK);
      return {
        status: "ready",
        engine: type,
        version: release.version,
        expectedVersion: release.version,
        sha256: release.files[release.binary],
        expectedSha256: release.files[release.binary],
        sourceUrl: release.url,
        path: executable,
        message: "Verified upstream executable",
        observedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        status: "unavailable",
        engine: type,
        ...describeError(error, error.path || executable, platform),
        expectedVersion: release?.version || null,
        expectedSha256: release?.files[release.binary] || null,
        sourceUrl: release?.url || null,
      };
    }
  }
  async function inspect(type, customPath, { includeWindows = false } = {}) {
    const diagnostic = await inspectFiles(type, customPath);
    if (
      includeWindows &&
      platform === "win32" &&
      diagnostic.code !== "UNSUPPORTED_PLATFORM"
    ) {
      const release = releaseFor(type, platform, arch);
      const targets = customPath
        ? [customPath]
        : [
            path.join(directory(type), release.binary),
            path.join(bundledRoot, type, release.version, release.binary),
          ];
      if (!customPath && type === "xmrig")
        targets.push(
          ...targets.map((p) => path.join(path.dirname(p), "WinRing0x64.sys")),
        );
      diagnostic.windows = await windowsDiagnostics(targets);
    }
    return diagnostic;
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
    const engine = engineFor(type, config);
    if (!config.customPath) await prepare(engine);
    const diagnostic = await inspect(engine, config.customPath);
    if (diagnostic.status === "unavailable")
      throw Object.assign(Error(diagnostic.message), {
        code: diagnostic.code,
        path: diagnostic.path,
      });
    const workDir = path.join(userData, "processes", id);
    await fs.promises.mkdir(workDir, { recursive: true });
    const configPath = path.join(
      workDir,
      engine === "xmrig" ? "config.json" : "config.ini",
    );
    const content =
      engine === "xmrig"
        ? JSON.stringify(xmrigConfig(config, hostname), null, 2)
        : nanominerConfig(config, hostname, {
            cpu: type === "xmrig",
            logicalCores,
          });
    await fs.promises.writeFile(`${configPath}.tmp`, content, { mode: 0o600 });
    await fs.promises.rename(`${configPath}.tmp`, configPath);
    const args =
      engine === "xmrig"
        ? [
            "--config",
            configPath,
            ...(config.threads > 0
              ? ["--threads", String(config.threads)]
              : []),
            ...parseArguments(config.additionalArgs),
          ]
        : [configPath];
    return {
      executable: diagnostic.path,
      args,
      cwd: workDir,
      diagnostic,
      engine,
      effectiveSettings:
        type === "xmrig" && engine === "nanominer"
          ? { cpuThreads: cpuThreads(config, logicalCores), devFeePercent: 2 }
          : null,
    };
  }
  return { inspect, prepare, launchSpec, target: targetName(platform, arch) };
}
module.exports = { createRuntime, describeError };
