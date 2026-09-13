#!/bin/bash
# Verify the pinned release files without executing a miner.
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/download-miners.js "$@"
