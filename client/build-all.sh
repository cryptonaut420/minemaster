#!/bin/bash
#
# MineMaster - Build & Publish All Platforms
# Builds Linux AppImage + Windows .exe (portable + installer)
# and publishes everything to GitHub Releases.
#
# Prerequisites:
#   - GH_TOKEN env var set (GitHub Personal Access Token with repo scope)
#   - Docker installed (for Windows cross-compilation)
#
# Usage:
#   npm run release                    # Release current version
#   npm run release -- --bump patch    # Bump patch, then release
#   npm run release -- --bump minor    # Bump minor, then release
#   npm run release -- --bump major    # Bump major, then release
#

set -e

cd "$(dirname "$0")"

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  MineMaster - Full Release (Build + Publish)"
echo "═══════════════════════════════════════════════════════════"
echo ""

# ── Load .env if present ─────────────────────────────────────

if [ -f .env ]; then
    set -a
    source .env
    set +a
    echo "✅ Loaded .env"
fi

# ── Preflight checks ────────────────────────────────────────

if [ -z "$GH_TOKEN" ]; then
    echo "❌ GH_TOKEN is not set."
    echo "   Export a GitHub Personal Access Token with 'repo' scope:"
    echo "   export GH_TOKEN=ghp_your_token_here"
    exit 1
fi

if ! command -v docker &> /dev/null; then
    echo "❌ Docker is required for Windows builds."
    echo "   Install: https://docs.docker.com/get-docker/"
    exit 1
fi

# Check if Docker image exists, pull if not
if ! sudo docker image inspect electronuserland/builder:wine &> /dev/null; then
    echo "📥 Pulling Docker image (this may take a few minutes)..."
    sudo docker pull electronuserland/builder:wine
    echo ""
fi

# ── Version bump (optional) ─────────────────────────────────

BUMP_TYPE="patch"
while [[ $# -gt 0 ]]; do
    case "$1" in
        --bump)
            BUMP_TYPE="$2"
            shift 2
            ;;
        --no-bump)
            BUMP_TYPE=""
            shift
            ;;
        patch|minor|major)
            BUMP_TYPE="$1"
            shift
            ;;
        *)
            echo "❌ Unknown argument: $1"
            echo "   Usage: npm run release -- [patch|minor|major|--no-bump]"
            exit 1
            ;;
    esac
done

if [ -n "$BUMP_TYPE" ]; then
    if [[ "$BUMP_TYPE" != "patch" && "$BUMP_TYPE" != "minor" && "$BUMP_TYPE" != "major" ]]; then
        echo "❌ Invalid bump type: $BUMP_TYPE"
        echo "   Must be one of: patch, minor, major"
        exit 1
    fi

    OLD_VERSION=$(node -p "require('./package.json').version")
    echo "📦 Bumping version ($BUMP_TYPE)..."
    node scripts/bump-version.js "$BUMP_TYPE"
    VERSION=$(node -p "require('./package.json').version")
    echo "   ${OLD_VERSION} → ${VERSION}"
    echo ""
else
    VERSION=$(node -p "require('./package.json').version")
fi

echo "📋 Releasing: v${VERSION}"
echo ""

# ── Clean dist folder ───────────────────────────────────────

echo "🧹 Cleaning dist folder..."
rm -rf dist
mkdir -p dist
echo ""

# ── Download miners for all platforms ────────────────────────

echo "📥 Downloading miners for all platforms..."
node scripts/download-miners.js --all
echo ""

# ── Build React app ─────────────────────────────────────────

echo "🔨 Building React application..."
npm run build
echo ""

# ── Build & publish Linux AppImage (natively) ───────────────

echo "🐧 Building & publishing Linux AppImage..."
npx electron-builder --linux AppImage --publish always
echo ""

# ── Build & publish Windows via Docker ──────────────────────

echo "🪟 Building & publishing Windows portable + installer (via Docker)..."
sudo docker run --rm \
    -e GH_TOKEN="$GH_TOKEN" \
    -v "$(pwd):/project" \
    -v "$(pwd)/node_modules:/project/node_modules" \
    -v ~/.cache/electron:/root/.cache/electron \
    -v ~/.cache/electron-builder:/root/.cache/electron-builder \
    electronuserland/builder:wine \
    /bin/bash -c "cd /project && npx electron-builder --windows portable nsis --publish always"

# Fix ownership of files created by Docker (they'll be owned by root)
echo ""
echo "🔧 Fixing file permissions..."
sudo chown -R $(id -u):$(id -g) dist/
echo ""

# ── Summary ─────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  ✅ Release v${VERSION} Published!"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Published artifacts:"
for f in dist/*.AppImage dist/*.exe dist/*.yml; do
    if [ -f "$f" ]; then
        size=$(du -h "$f" | cut -f1)
        echo "  📦 $(basename "$f") ($size)"
    fi
done
echo ""
echo "GitHub Release: https://github.com/cryptonaut420/minemaster/releases/tag/v${VERSION}"
echo ""
echo "═══════════════════════════════════════════════════════════"
