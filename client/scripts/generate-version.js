const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const packageJsonPath = path.join(rootDir, 'package.json');
const outputPath = path.join(rootDir, 'src', 'version.json');

function safeExec(command) {
  try {
    return execSync(command, { cwd: rootDir, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch (_) {
    return null;
  }
}

function main() {
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const baseVersion = pkg.version || '0.0.0';

  const commitCountRaw = safeExec('git rev-list --count HEAD');
  const commitHashRaw = safeExec('git rev-parse --short HEAD');

  const commitCount = Number.parseInt(commitCountRaw || '0', 10);
  const commitHash = commitHashRaw || 'nogit';
  const buildMetadata = `${Number.isFinite(commitCount) ? commitCount : 0}.${commitHash}`;
  const displayVersion = `${baseVersion}+${buildMetadata}`;

  const payload = {
    baseVersion,
    buildMetadata,
    displayVersion,
    commitCount: Number.isFinite(commitCount) ? commitCount : 0,
    commitHash,
    generatedAt: new Date().toISOString()
  };

  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  process.stdout.write(`[version] generated ${payload.displayVersion}\n`);
}

main();
