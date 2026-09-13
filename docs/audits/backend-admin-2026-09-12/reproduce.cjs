#!/usr/bin/env node
// The baseline characterization results are preserved in reproduction-results.json.
// Current validation expects correct behavior rather than reproducing repaired bugs.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '../../..');
const tests = fs.readdirSync(path.join(root, 'server/test')).filter(name => name.endsWith('.test.js')).map(name => path.join(root, 'server/test', name));
const result = spawnSync(process.execPath, ['--test', ...tests], { cwd: root, stdio: 'inherit' });
process.exit(result.status ?? 1);
