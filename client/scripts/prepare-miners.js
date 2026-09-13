// electron-builder invokes this for the actual target, including cross-platform builds.
const { setupTarget } = require("./download-miners");
module.exports = async (context) => {
  const arch = { 0: "ia32", 1: "x64", 2: "armv7l", 3: "arm64", 4: "universal" }[
    context.arch
  ];
  await setupTarget(context.electronPlatformName, arch);
};
