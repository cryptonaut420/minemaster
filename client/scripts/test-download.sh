#!/bin/bash

# Test Script for Download Miners
# This simulates what happens when npm install is run

echo "════════════════════════════════════════════════════"
echo "  MineMaster - Testing Download Script"
echo "════════════════════════════════════════════════════"
echo ""

# Show current state
echo "📁 Current miners directory state:"
ls -la miners/xmrig/ 2>/dev/null || echo "  (empty)"
echo ""

# Run the download script
echo "🔽 Running download script..."
echo "   Command: node scripts/download-miners.js"
echo ""

if command -v node &> /dev/null; then
    node scripts/download-miners.js
    
    echo ""
    echo "════════════════════════════════════════════════════"
    echo "  ✓ Download Complete"
    echo "════════════════════════════════════════════════════"
    echo ""
    
    echo "📁 Final miners directory:"
    ls -lh miners/xmrig/
    echo ""
    
    echo "Binary details:"
    file miners/xmrig/xmrig 2>/dev/null || echo "  Binary not found"
else
    echo "❌ Node.js not found. Install Node.js to run this test."
    echo ""
    echo "On Ubuntu/Debian:"
    echo "  sudo apt install nodejs npm"
    echo ""
    echo "Or use nvm (recommended):"
    echo "  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash"
    echo "  nvm install node"
fi

echo ""
echo "════════════════════════════════════════════════════"
