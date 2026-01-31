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

**Quick Build (current platform):**
```bash
npm run build:electron    # Build for current platform
```

**Platform-Specific Builds:**
```bash
npm run build:linux       # Linux AppImage (single portable file)
npm run build:windows     # Windows portable .exe (single file)
npm run build:mac         # macOS DMG
```

**Full Release Build:**
```bash
npm run dist              # Build Linux + Windows with all outputs
npm run dist -- --linux   # Linux only
npm run dist -- --windows # Windows only
npm run dist -- --clean   # Clean dist folder first
```

**Output files** are placed in `dist/`:
- `MineMaster-1.0.0-Linux.AppImage` - Linux portable (run directly, no install)
- `MineMaster-1.0.0-Windows-Portable.exe` - Windows portable (single file)
- `MineMaster-1.0.0-Windows-Setup.exe` - Windows installer (optional)

**Docker Build (recommended for cross-compilation):**
```bash
npm run dist:docker          # Linux + Windows (requires Docker)
npm run dist:docker:linux    # Linux AppImage only
npm run dist:docker:windows  # Windows only
```

Docker uses the `electronuserland/builder:wine` image which has all dependencies pre-configured - no need to install wine32 on your system.

**Cross-Compilation Notes:**
- **Recommended**: Use Docker for cross-compilation (no system deps needed)
- Building Windows from Linux natively requires wine32 (often has dependency issues)
- Building Linux from Windows requires WSL2 or a Linux VM
- Native builds on each platform produce the most reliable results

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
- CPU temperature supports multiple methods:
  - `systeminformation` library (works with Open Hardware Monitor / LibreHardwareMonitor)
  - WMI ThermalZone (may require admin privileges)
  - PowerShell CIM queries (modern Windows 10/11)
- NVIDIA GPU stats: Detected via `nvidia-smi` (included with NVIDIA drivers)
- AMD GPU stats: Detected via `systeminformation` (requires Adrenalin drivers)
- Integrated graphics (Intel UHD, AMD Vega) are automatically filtered out

**Running Miners**:
- For best performance, run MineMaster as Administrator
- Windows Defender may flag mining software - add exceptions for:
  - `miners/xmrig/xmrig.exe`
  - `miners/nanominer/nanominer.exe`
- Ensure GPU drivers are up to date
- Nanominer config files use Windows line endings for compatibility

**Miner Downloads**:
- ZIP files: PowerShell `Expand-Archive`
- TAR.GZ files: Native `tar` (Windows 10 1803+) with PowerShell fallback
- If download fails, manually download from releases pages

**Stopping Miners**:
- Uses `taskkill /T /F` for reliable process tree termination
- Handles orphaned child processes automatically
- May require administrator privileges for some operations

**Nanominer on Windows**:
- Ensure CUDA drivers are installed for NVIDIA GPUs
- OpenCL runtime required for AMD GPUs
- Config uses `noColor = true` to avoid ANSI escape code issues

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

### Common Windows Issues

**"Miner not starting"**:
1. Check Windows Defender hasn't quarantined the miner
2. Run MineMaster as Administrator
3. Ensure the miner binary exists in `miners/xmrig/` or `miners/nanominer/`

**"No GPU detected"**:
1. Update GPU drivers (NVIDIA: nvidia-smi must work, AMD: Adrenalin drivers)
2. Check Device Manager for GPU status
3. Integrated graphics are intentionally filtered out

**"CPU temperature not showing"**:
- Install Open Hardware Monitor or LibreHardwareMonitor
- Or run as Administrator (WMI access)

**"Miner won't stop"**:
1. Open Task Manager
2. End task for `xmrig.exe` or `nanominer.exe`
3. Check for orphaned `conhost.exe` processes

### TypeScript Errors
Already fixed - package.json uses TypeScript 4.9.5 compatible with react-scripts.

## License

XMRig is GPL-3.0 licensed. Downloaded from official releases: https://github.com/xmrig/xmrig
