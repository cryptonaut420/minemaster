#!/bin/bash
#
# MineMaster - Build All Platforms
# Builds Linux AppImage + Windows .exe and outputs to dist/
#
# Usage: ./build-all.sh
#

set -e

cd "$(dirname "$0")"

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  MineMaster - Full Release Build"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Check Docker
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

# Clean dist folder
echo "🧹 Cleaning dist folder..."
rm -rf dist
mkdir -p dist
echo ""

# Ensure miners are downloaded for ALL target platforms (Linux + Windows)
echo "📥 Downloading miners for all platforms..."
node scripts/download-miners.js --all
echo ""

# Build React app
echo "🔨 Building React application..."
npm run build
echo ""

# Build Linux AppImage (locally - faster)
echo "🐧 Building Linux AppImage..."
npx electron-builder --linux AppImage
echo ""

# Build Windows via Docker
echo "🪟 Building Windows (via Docker)..."
sudo docker run --rm \
    -v "$(pwd):/project" \
    -v "$(pwd)/node_modules:/project/node_modules" \
    -v ~/.cache/electron:/root/.cache/electron \
    -v ~/.cache/electron-builder:/root/.cache/electron-builder \
    electronuserland/builder:wine \
    /bin/bash -c "cd /project && npx electron-builder --windows portable nsis"

# Fix ownership of files created by Docker (they'll be owned by root)
echo "🔧 Fixing file permissions..."
sudo chown -R $(id -u):$(id -g) dist/
echo ""

# Summary
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  ✅ Build Complete!"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Output files:"
for f in dist/*.AppImage dist/*.exe; do
    if [ -f "$f" ]; then
        size=$(du -h "$f" | cut -f1)
        echo "  📦 $(basename "$f") ($size)"
    fi
done
echo ""
echo "Location: $(pwd)/dist/"
echo ""
echo "To run:"
echo "  Linux:   ./dist/MineMaster-*-Linux.AppImage"
echo "  Windows: Copy the .exe to a Windows machine"
echo ""
echo "═══════════════════════════════════════════════════════════"
