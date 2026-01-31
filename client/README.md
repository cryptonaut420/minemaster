# MineMaster Client

Cross-platform GUI wrapper for crypto mining software. Currently supports XMRig with an architecture designed to support multiple miners simultaneously.

## Features

- 🖥️ Cross-Platform (Linux/Windows/Mac)
- 📊 Integrated Console - View miner output directly in the GUI
- ⚙️ Easy Configuration - User-friendly interface for miner settings
- 🔄 Multi-Miner Support - Architecture supports running multiple miners simultaneously
- 🎯 XMRig Integration - Full support for XMRig configuration options

## Quick Start

```bash
cd /var/www/Ironclad/minemaster/client
npm install --legacy-peer-deps
npm start
```

That's it! The XMRig miner will be downloaded automatically.

## Installation Details

### Prerequisites

- Node.js (v16 or higher)
- npm

### Install

```bash
npm install --legacy-peer-deps
```

This will:
- Install all dependencies
- Automatically download XMRig v6.25.0 for your platform
- Set up miners in `miners/xmrig/`

### Development

```bash
npm start
```

Starts the React dev server and launches the Electron app.

### Build for Production

```bash
npm run build:electron    # Current platform
npm run build:all          # All platforms (Linux/Windows)
```

## Usage

1. **Configure Miner**:
   - Pool address (e.g., `pool.supportxmr.com:3333`)
   - Wallet address
   - Algorithm (default: RandomX for Monero)
   - Threads (0 = auto)

2. **Start Mining**: Click "▶ Start Mining"

3. **Stop Mining**: Click "⏹ Stop Mining"

## Configuration Options

- **Pool Address**: Mining pool URL and port
- **Wallet Address**: Your cryptocurrency wallet address
- **Algorithm**: rx/0, rx/wow, cn/r, ghostrider, etc.
- **Threads**: CPU threads (0 = auto-detect)
- **Custom Path**: Override default XMRig path if needed
- **Additional Arguments**: Extra XMRig command-line arguments

## Project Structure

```
client/
├── electron/           # Electron main process & miner management
├── src/               # React UI
│   ├── components/    # MinerConfig, MinerConsole
│   └── App.js        # Main application
├── miners/           # Miner binaries (downloaded, not committed)
├── scripts/          # download-miners.js
└── package.json
```

## Adding More Miners

To add nanominer or other mining software:

1. Edit `scripts/download-miners.js` - Add new miner definition
2. Update `electron/main.js` - Add miner process spawning logic
3. Update UI components - Add miner-specific config options

## Miner Download Script

Miners are downloaded via `scripts/download-miners.js` (runs automatically on install).

To manually re-download:
```bash
npm run setup
```

Binaries are **not committed to git** - only the download script is tracked.

## Troubleshooting

### Permission Errors (Linux/macOS)
```bash
sudo chown -R $USER:$USER /var/www/Ironclad/minemaster/client
```

### XMRig Not Starting
- Check pool address format
- Verify wallet address is correct
- On Linux: `chmod +x miners/xmrig/xmrig`
- On Windows: Run as Administrator for best performance

### Platform-Specific Notes

#### Windows

**System Monitoring**:
- CPU temperature requires compatible hardware/drivers
- NVIDIA GPU stats require nvidia-smi (included with NVIDIA drivers)
- AMD GPU stats require Adrenalin drivers

**Running Miners**:
- For best performance, run MineMaster as Administrator
- Windows Defender may flag mining software - add exception if needed
- Ensure GPU drivers are up to date

**Miner Downloads**:
- Downloads use PowerShell's `Expand-Archive` for extraction
- If download fails, manually download from releases pages

**Stopping Miners**:
- Uses `taskkill` for process termination
- May require administrator privileges for some operations

#### Linux

**System Monitoring**:
- CPU temperature read from `/sys/class/thermal/` or `/sys/class/hwmon/`
- AMD GPU stats read from `/sys/class/drm/cardX/device/`
- NVIDIA GPU stats require `nvidia-smi` command

**Running Miners**:
- May need to add miner binaries to exceptions for antivirus
- Use `chmod +x` to make downloaded binaries executable

**Stopping Miners**:
- Uses `SIGTERM` for graceful shutdown, `SIGKILL` as fallback
- Uses `pgrep`/`pkill` to find related processes

#### macOS

- NVIDIA support limited (no recent NVIDIA drivers for macOS)
- AMD GPU detection uses `systeminformation` library
- CPU temperature via SMC requires additional permissions

### TypeScript Errors
Already fixed - package.json uses TypeScript 4.9.5 compatible with react-scripts.

## License

XMRig is GPL-3.0 licensed. Downloaded from official releases: https://github.com/xmrig/xmrig
