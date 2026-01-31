#!/bin/bash
#
# MineMaster Docker Build Script
# Builds Linux and Windows releases using electron-builder's Docker image
#
# Usage:
#   ./scripts/build-docker.sh          # Build Linux + Windows
#   ./scripts/build-docker.sh linux    # Linux only
#   ./scripts/build-docker.sh windows  # Windows only
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# Check if Docker is available
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is required but not installed."
    echo "   Install Docker: https://docs.docker.com/get-docker/"
    exit 1
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  MineMaster Docker Build"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Build React app first (locally, since it's faster)
echo "🔨 Building React application..."
npm run build
echo ""

# Determine what to build
BUILD_TARGET="${1:-all}"

case "$BUILD_TARGET" in
    linux)
        DOCKER_CMD="--linux AppImage"
        echo "🐧 Building Linux AppImage via Docker..."
        ;;
    windows)
        DOCKER_CMD="--windows portable nsis"
        echo "🪟 Building Windows via Docker..."
        ;;
    all|*)
        DOCKER_CMD="--linux AppImage --windows portable nsis"
        echo "🐧🪟 Building Linux + Windows via Docker..."
        ;;
esac

echo ""

# Run electron-builder in Docker
# Uses the official electronuserland/builder image which has wine pre-configured
docker run --rm -ti \
    --env-file <(env | grep -iE 'DEBUG|NODE_|ELECTRON_|YARN_|NPM_|CI|CIRCLE|TRAVIS_TAG|TRAVIS|TRAVIS_REPO_|TRAVIS_BUILD_|TRAVIS_BRANCH|TRAVIS_PULL_REQUEST_|APPVEYOR_|CSC_|GH_|GITHUB_|BT_|AWS_|STRIP|BUILD_') \
    --env ELECTRON_CACHE="/root/.cache/electron" \
    --env ELECTRON_BUILDER_CACHE="/root/.cache/electron-builder" \
    -v "${PROJECT_DIR}:/project" \
    -v "${PROJECT_DIR}/node_modules:/project/node_modules" \
    -v ~/.cache/electron:/root/.cache/electron \
    -v ~/.cache/electron-builder:/root/.cache/electron-builder \
    electronuserland/builder:wine \
    /bin/bash -c "cd /project && npx electron-builder $DOCKER_CMD"

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  Build Complete!"
echo "═══════════════════════════════════════════════════════════"
echo ""

# List output files
if [ -d "dist" ]; then
    echo "Output files:"
    find dist -maxdepth 1 -type f \( -name "*.AppImage" -o -name "*.exe" -o -name "*.dmg" \) -exec ls -lh {} \; 2>/dev/null | awk '{print "  📦 " $NF " (" $5 ")"}'
    echo ""
    echo "Location: $PROJECT_DIR/dist/"
fi
echo ""
