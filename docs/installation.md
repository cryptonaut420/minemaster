# Installation Guide

This guide will walk you through installing MineMaster on your system.

## 📋 Prerequisites

Before installing MineMaster, ensure your system meets these requirements:

### System Requirements

**Minimum**:
- **OS**: Linux (Ubuntu 20.04+), Windows 10+, or macOS 10.14+
- **RAM**: 4 GB
- **Storage**: 500 MB free space
- **Node.js**: Version 16 or higher
- **npm**: Version 7 or higher

**Recommended**:
- **OS**: Linux (Ubuntu 22.04+) or Windows 11
- **RAM**: 8+ GB
- **Storage**: 2 GB free space (for mining software)
- **CPU**: Modern multi-core processor for CPU mining
- **GPU**: AMD or NVIDIA graphics card for GPU mining

### Platform-Specific Requirements

#### Linux
```bash
# Install Node.js (if not installed)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install build tools (for native modules)
sudo apt-get install -y build-essential

# For GPU mining
sudo apt-get install -y ocl-icd-libopencl1  # OpenCL support
```

#### Windows
- Download and install Node.js from [nodejs.org](https://nodejs.org/)
- Visual C++ Redistributable (usually pre-installed)

#### macOS
```bash
# Install Homebrew (if not installed)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install Node.js
brew install node
```

## 🚀 Installation Steps

### Method 1: Install from Source (Recommended for Development)

#### 1. Clone or Download the Repository

```bash
cd /var/www/Ironclad
git clone <repository-url> minemaster
cd minemaster/client
```

Or if you have the source already:
```bash
cd /var/www/Ironclad/minemaster/client
```

#### 2. Install Dependencies

```bash
npm install --legacy-peer-deps
```

**Note**: The `--legacy-peer-deps` flag is required due to peer dependency conflicts between React 18 and react-scripts 5.

**What this does**:
- Installs all Node.js dependencies
- Downloads XMRig and Nanominer binaries automatically
- Sets up the Electron environment

#### 3. Verify Installation

Check that miners were downloaded:
```bash
ls -la miners/xmrig/
ls -la miners/nanominer/
```

You should see the `xmrig` and `nanominer` executables.

#### 4. Set Executable Permissions (Linux/macOS)

```bash
chmod +x miners/xmrig/xmrig
chmod +x miners/nanominer/nanominer
```

#### 5. Launch MineMaster

```bash
npm start
```

This will:
- Start the React development server on port 3000
- Launch the Electron window
- Open DevTools (in development mode)

### Method 2: Install Pre-built Binary (Production)

#### 1. Download the Release

Download the appropriate package for your platform:
- **Linux**: `MineMaster-x.x.x.AppImage` or `minemaster_x.x.x_amd64.deb`
- **Windows**: `MineMaster-Setup-x.x.x.exe`
- **macOS**: `MineMaster-x.x.x.dmg`

#### 2. Install

**Linux (AppImage)**:
```bash
chmod +x MineMaster-*.AppImage
./MineMaster-*.AppImage
```

**Linux (DEB)**:
```bash
sudo dpkg -i minemaster_*.deb
sudo apt-get install -f  # Fix dependencies if needed
```

**Windows**:
- Double-click the `.exe` installer
- Follow the installation wizard

**macOS**:
- Open the `.dmg` file
- Drag MineMaster to Applications folder

#### 3. Launch

- **Linux**: Run from application menu or command line
- **Windows**: Start menu → MineMaster
- **macOS**: Applications → MineMaster

## 🔧 Post-Installation Setup

### 1. Generate or Import Wallet

#### Option A: Generate New Wallet (Monero Example)

```bash
cd /var/www/Ironclad/minemaster/client
npm run generate-config
```

This will:
- Generate a Monero wallet
- Generate a Ravencoin wallet
- Create configuration files
- Display wallet addresses and private keys

**⚠️ IMPORTANT**: Save the wallet files (`wallet-monero.json`, `wallet-ravencoin.json`) to a secure location and DELETE them from the project directory after backing up!

#### Option B: Use Existing Wallet

Create wallets using official tools:
- **Monero**: [getmonero.org](https://getmonero.org/downloads/)
- **Ravencoin**: [ravencoin.org](https://ravencoin.org/wallet/)
- **Ethereum Classic**: [ethereumclassic.org](https://ethereumclassic.org/)

### 2. Choose a Mining Pool

Popular pools:

**Monero (XMR)**:
- SupportXMR: `pool.supportxmr.com:3333`
- C3Pool: `xmr.c3pool.com:13333`
- HashVault: `pool.hashvault.pro:3333`

**Ravencoin (RVN)**:
- Nanopool: `rvn-eu1.nanopool.org:12433`
- 2Miners: `rvn.2miners.com:6060`
- Flypool: `rvn-eu1.flypool.org:3636`

**Ethereum Classic (ETC)**:
- Nanopool: `etc-eu1.nanopool.org:19999`
- 2Miners: `etc.2miners.com:1010`
- Ethermine: `etc.ethermine.org:4444`

See [pool-configuration.md](pool-configuration.md) for more options.

### 3. First Configuration

Launch MineMaster and configure your first miner:

#### For CPU Mining (XMRig):
1. Click on "XMRig CPU Miner" in the sidebar
2. Enter:
   - **Coin**: XMR
   - **Algorithm**: rx/0
   - **Pool Address**: `pool.supportxmr.com:3333`
   - **Wallet Address**: Your Monero wallet address
   - **Password**: x (default)
   - **CPU Usage**: Adjust slider (100% uses all threads)
3. Click "▶ Start Mining"

#### For GPU Mining (Nanominer):
1. Click on "Nanominer GPU" in the sidebar
2. Enter:
   - **Coin**: RVN
   - **Algorithm**: kawpow
   - **Pool Address**: `rvn-eu1.nanopool.org:12433`
   - **Wallet Address**: Your Ravencoin wallet address
   - **Rig Name**: (optional) worker name
3. Select GPUs to use
4. Adjust power limits per GPU
5. Click "▶ Start Mining"

## 🔍 Verification

### Check Miner is Running

1. **Dashboard**: Should show "Running" status with green dot
2. **Console Output**: Should display miner logs and hashrate
3. **System Monitor**: CPU/GPU usage should increase

### Check Pool Connection

Visit your pool's website and search for your wallet address. It may take 5-10 minutes for stats to appear.

**Example (Nanopool)**:
```
https://rvn.nanopool.org/account/YOUR_WALLET_ADDRESS
```

## 🛠️ Troubleshooting Installation

### npm install fails

**Error**: `EACCES: permission denied`
```bash
sudo chown -R $USER:$USER /var/www/Ironclad/minemaster
npm install --legacy-peer-deps
```

**Error**: `gyp ERR! build error`
```bash
# Linux
sudo apt-get install build-essential

# macOS
xcode-select --install
```

### Miner binaries not downloaded

Manually download and extract:

**XMRig**:
```bash
cd /var/www/Ironclad/minemaster/client
npm run setup
```

Or manually from: https://github.com/xmrig/xmrig/releases

**Nanominer**:
Manually from: https://github.com/nanopool/nanominer/releases

Extract to:
- `miners/xmrig/xmrig`
- `miners/nanominer/nanominer`

### Permission denied when starting miner

```bash
chmod +x miners/xmrig/xmrig
chmod +x miners/nanominer/nanominer
```

### App won't start on Linux

```bash
# AppImage
chmod +x MineMaster-*.AppImage

# Missing libraries
sudo apt-get install libgconf-2-4 libatk1.0-0 libatk-bridge2.0-0 \
                     libgdk-pixbuf2.0-0 libgtk-3-0 libgbm-dev
```

### GPU not detected

**AMD GPUs (Linux)**:
```bash
# Install ROCm or AMDGPU-PRO drivers
# Check GPU is visible
ls /sys/class/drm/card*/device/
```

**NVIDIA GPUs**:
```bash
# Install NVIDIA drivers
nvidia-smi  # Should list your GPU
```

**All Platforms**:
- Update graphics drivers to latest version
- Restart application after driver update

### Electron sandbox issues

If you see sandbox-related errors:
```bash
# Linux - Run without sandbox (development only)
npm start -- --no-sandbox
```

## 📦 Update & Uninstall

### Update to Latest Version

**From Source**:
```bash
cd /var/www/Ironclad/minemaster/client
git pull
npm install --legacy-peer-deps
npm start
```

**Pre-built Binary**:
- Download latest release
- Install over existing version (settings preserved)

### Uninstall

**Linux (DEB)**:
```bash
sudo apt-get remove minemaster
```

**Linux (AppImage)**:
```bash
rm MineMaster-*.AppImage
```

**Windows**:
- Control Panel → Programs → Uninstall MineMaster

**macOS**:
- Drag MineMaster from Applications to Trash

**Remove Configuration**:
```bash
# Linux/macOS
rm -rf ~/.config/minemaster  # App settings
rm -rf ~/Library/Application\ Support/minemaster  # macOS

# Windows
# Delete: %APPDATA%\minemaster
```

## 🔄 Reinstall Miners

If miners become corrupted or need updating:

```bash
cd /var/www/Ironclad/minemaster/client

# Remove old miners
rm -rf miners/xmrig/*
rm -rf miners/nanominer/*

# Re-download
npm run setup
```

## 🎓 Next Steps

After successful installation:
1. Read the [User Guide](user-guide.md) for detailed usage
2. Configure your miners in [Mining Configuration](mining-configuration.md)
3. Optimize performance with [Performance Guide](performance.md)

---

**Need Help?** Check [Troubleshooting](troubleshooting.md) or open an issue on GitHub.

**Last Updated**: January 2026
