#!/bin/bash
# Build every updater target before exposing a verified GitHub release.
set -euo pipefail
cd "$(dirname "$0")"
if [ "$#" -gt 0 ]; then
  echo "Bump and commit the version before releasing. Usage: npm run release"
  exit 1
fi
command -v gh >/dev/null
command -v docker >/dev/null
gh auth status >/dev/null 2>&1
if [ "$(git branch --show-current)" != master ] || [ -n "$(git status --porcelain)" ]; then
  echo "Release from a clean, committed master checkout."
  exit 1
fi
VERSION=$(node -p "require('./package.json').version")
SOURCE_COMMIT=$(git rev-parse HEAD)
OUTPUT="dist/release-${VERSION}"
NOTES="../docs/releases/${VERSION}.md"
test -f "$NOTES"
if [ -e "$OUTPUT" ] || git rev-parse --verify "refs/tags/v${VERSION}" >/dev/null 2>&1; then
  echo "This release version already has artifacts or a tag; inspect it before retrying."
  exit 1
fi
npm test
npm --prefix ../server test
npm --prefix ../server/public run build
node scripts/download-miners.js --all
npm run build
docker run --rm \
  -v "$PWD:/project" \
  -v "$HOME/.cache/electron:/root/.cache/electron" \
  -v "$HOME/.cache/electron-builder:/root/.cache/electron-builder" \
  -w /project electronuserland/builder:wine \
  ./node_modules/.bin/electron-builder --linux AppImage --windows portable nsis \
  --x64 --publish never "-c.directories.output=$OUTPUT"
node scripts/verify-release.cjs "$OUTPUT" "$VERSION"
test "$(git rev-parse HEAD)" = "$SOURCE_COMMIT"
git diff --exit-code -- . ':!src/version.json'
git push origin master
git tag "v${VERSION}" "$SOURCE_COMMIT"
git push origin "v${VERSION}"
node scripts/publish-release.cjs "$OUTPUT" "$VERSION" "$NOTES"
