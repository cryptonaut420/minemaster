const fs = require('fs');
const path = require('path');

const validBumps = new Set(['patch', 'minor', 'major']);
const bumpType = process.argv[2] || 'patch';

if (!validBumps.has(bumpType)) {
  process.stderr.write(`Invalid bump type "${bumpType}". Use one of: patch, minor, major\n`);
  process.exit(1);
}

const packageJsonPath = path.resolve(__dirname, '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

const currentVersion = packageJson.version;
const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(currentVersion || '');

if (!match) {
  process.stderr.write(`Unsupported version format "${currentVersion}". Expected x.y.z\n`);
  process.exit(1);
}

let [major, minor, patch] = match.slice(1).map(Number);

if (bumpType === 'major') {
  major += 1;
  minor = 0;
  patch = 0;
} else if (bumpType === 'minor') {
  minor += 1;
  patch = 0;
} else {
  patch += 1;
}

const nextVersion = `${major}.${minor}.${patch}`;
packageJson.version = nextVersion;

fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
process.stdout.write(`[version] bumped ${currentVersion} -> ${nextVersion} (${bumpType})\n`);
