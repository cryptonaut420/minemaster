# User Guide

Complete guide to using MineMaster for cryptocurrency mining.

## 📖 Table of Contents

1. [Getting Started](#getting-started)
2. [Dashboard Overview](#dashboard-overview)
3. [CPU Mining (XMRig)](#cpu-mining-xmrig)
4. [GPU Mining (Nanominer)](#gpu-mining-nanominer)
5. [Monitoring & Statistics](#monitoring--statistics)
6. [Configuration Management](#configuration-management)
7. [Best Practices](#best-practices)

## 🚀 Getting Started

### First Launch

When you first launch MineMaster:

1. **Dashboard** shows an overview of all miners and system information
2. **Two miners** are pre-configured:
   - XMRig CPU Miner (for CPU mining)
   - Nanominer GPU (for GPU mining)
3. **System information** displays your hardware specs

### Navigation

- **Dashboard**: Click "📊 Dashboard" in the sidebar
- **Miner Configuration**: Click on a miner name in the sidebar
- **Status Indicators**: 
  - 🟢 Green dot = Miner running
  - 🔴 Red dot = Miner stopped

## 📊 Dashboard Overview

The Dashboard is your central hub for monitoring all mining activities.

### Master Controls

**Play/Pause Button** (large circle):
- **▶ Play**: Starts all enabled miners
- **⏸ Pause**: Stops all running miners

### Miners Section

Each miner card displays:
- **Toggle Switch**: Enable/disable miner for bulk operations
- **Device Type**: CPU or GPU badge
- **Miner Name**: Descriptive name
- **Configuration**: Algorithm, coin, CPU usage %
- **Hashrate**: Current mining speed (or "Stopped")

**Enable/Disable Miners**:
- Toggle the switch to include/exclude miner from "Start All" operation
- Disabled miners are grayed out

### System Information

Real-time system statistics:

**Operating System Card**:
- Distribution name and version
- Platform and architecture

**CPU Card**:
- Processor model
- Current usage percentage
- Temperature (if available)

**Memory (RAM) Card**:
- Total RAM installed
- Current usage percentage
- Free memory

**GPU Card(s)**:
- GPU model and vendor
- Usage percentage
- Temperature
- VRAM usage (used / total)
- *Multiple GPUs shown as separate cards*

## 🖥️ CPU Mining (XMRig)

XMRig is used for CPU mining, primarily for RandomX-based coins like Monero.

### Configuration Panel

Click "XMRig CPU Miner" in the sidebar to access configuration.

#### Basic Settings

**Coin / Currency**:
- Enter the coin symbol (e.g., XMR, WOW, RTM)
- Used for identification only

**Algorithm**:
- **RandomX (rx/0)**: Monero (XMR)
- **RandomWOW (rx/wow)**: Wownero (WOW)
- **RandomARQ (rx/arq)**: ArQmA (ARQ)
- **CryptoNight R (cn/r)**: Older CryptoNight coins
- **CryptoNight Half (cn/half)**: Masari, Stellite
- **GhostRider**: Raptoreum (RTM)

**Pool Address**:
- Format: `pool.example.com:3333`
- Example: `pool.supportxmr.com:3333`
- Find pools at [miningpoolstats.stream](https://miningpoolstats.stream/)

**Wallet Address / Username**:
- Your cryptocurrency wallet address
- This is where you'll receive mined coins
- Must be a valid address for the coin you're mining

**Password**:
- Usually `x` or any value (most pools ignore this)
- Some pools use password for worker identification

#### Advanced Settings

**CPU Usage Slider**:
- **10%**: Uses 1-2 threads (minimal impact)
- **50%**: Uses half your CPU threads
- **100%**: Uses all CPU threads (maximum hashrate)
- Shows thread count: `(8 / 16 threads)` below slider

**Tip**: Start with 50-70% to leave resources for other tasks.

**Additional Arguments**:
- Expert option for custom XMRig flags
- Example: `--tls --keepalive`
- Leave blank if unsure

### System Information Display

Below the configuration, you'll see:
- Real-time CPU info
- Current CPU usage and temperature
- RAM usage statistics

### Starting CPU Mining

1. Fill in all required fields (pool, wallet, algorithm)
2. Adjust CPU usage slider to desired level
3. Click **▶ Start Mining** button
4. Console output appears below showing miner activity

### Monitoring CPU Mining

**Console Output** shows:
- Connection status to pool
- Accepted/rejected shares
- Current hashrate (e.g., `1234.5 H/s`)
- Temperature and fan speed (if supported)

**Expected Hashrate** (RandomX):
- Modern 8-core CPU: 4,000 - 8,000 H/s
- 16-core CPU: 10,000 - 20,000 H/s
- High-end CPUs (Ryzen 9, Threadripper): 20,000+ H/s

## 🎮 GPU Mining (Nanominer)

Nanominer is used for GPU mining across various algorithms.

### Configuration Panel

Click "Nanominer GPU" in the sidebar to access configuration.

#### Basic Settings

**Coin / Currency**:
- Enter coin symbol (e.g., ETH, RVN, ERG)
- Used for identification

**Algorithm**:
- **Ethash**: Ethereum Classic (ETC), Ubiq (UBQ)
- **Etchash**: Ethereum Classic (ETC) - latest
- **KawPow**: Ravencoin (RVN)
- **Autolykos**: Ergo (ERG)
- **Octopus (Conflux)**: Conflux (CFX)
- **Kaspa**: Kaspa (KAS)
- **Karlsenhash**: Karlsen (KLS)
- **Nexa**: Nexa

**Pool Address**:
- Format: `pool.example.com:1234`
- Example RVN: `rvn-eu1.nanopool.org:12433`
- Example ETC: `etc-eu1.nanopool.org:19999`

**Wallet Address**:
- Your cryptocurrency wallet address
- Must match the coin you're mining

**Rig Name** (optional):
- Worker identifier shown on pool dashboard
- Example: `worker1`, `gaming-pc`, `rig01`

#### GPU Configuration

MineMaster automatically detects your GPUs and displays them as cards.

**GPU Card displays**:
- GPU index and model (e.g., "GPU 0: AMD Radeon RX 6800")
- Current usage %
- Current temperature
- VRAM usage

**Checkbox**: Enable/disable specific GPU for mining

**Power Limit Slider** (per GPU):
- **50%**: Minimum power (cooler, lower hashrate)
- **75%**: Balanced (good efficiency)
- **100%**: Maximum power (highest hashrate, more heat)

**Multi-GPU Setup**:
- Each GPU can have individual power limits
- Select which GPUs to mine with
- Leave intensive GPUs disabled for gaming/work

### Starting GPU Mining

1. Configure coin, algorithm, pool, and wallet
2. Select GPUs to mine with
3. Adjust power limits (start with 75%)
4. Click **▶ Start Mining**
5. Monitor console output

### Monitoring GPU Mining

**Console Output** shows:
- GPU detection and initialization
- Hashrate per GPU
- Total hashrate
- Accepted/rejected shares
- Temperature warnings

**Expected Hashrate** (varies by algorithm):
- **RX 580 (8GB)**: ~30 MH/s Ethash, ~14 MH/s KawPow
- **RX 6800**: ~60 MH/s Ethash, ~28 MH/s KawPow
- **RTX 3070**: ~60 MH/s Ethash, ~30 MH/s KawPow
- **RTX 3090**: ~120 MH/s Ethash, ~50 MH/s KawPow

## 📈 Monitoring & Statistics

### Real-Time Monitoring

**In Application**:
- Dashboard shows current hashrate for all miners
- Console displays live miner output
- System stats update every 3 seconds

**On Pool Website**:
1. Visit your pool's website
2. Search for your wallet address
3. View detailed statistics:
   - Current hashrate
   - Average hashrate (24h)
   - Pending balance
   - Total paid
   - Worker status

**Example URLs**:
- Nanopool: `https://rvn.nanopool.org/account/YOUR_WALLET`
- SupportXMR: `https://supportxmr.com/#/dashboard`
- 2Miners: `https://rvn.2miners.com/account/YOUR_WALLET`

### Understanding Hashrate

**Hashrate Units**:
- **H/s**: Hashes per second (CPU mining)
- **kH/s**: Kilo hashes = 1,000 H/s
- **MH/s**: Mega hashes = 1,000,000 H/s (GPU mining)
- **GH/s**: Giga hashes = 1,000,000,000 H/s

**Variability**:
- Hashrate fluctuates ±10-20% normally
- Average over 10-15 minutes for accurate reading
- Pool reported hashrate may differ slightly

### Console Output Indicators

**Good Signs**:
- `[POOL] connected to pool`
- `[SHARES] accepted (X/Y)` where X > Y
- Steady hashrate numbers
- Low reject rate (<1%)

**Warning Signs**:
- `[ERROR] connection failed`
- High reject rate (>5%)
- `[WARNING] high temperature`
- Hashrate drops to zero

## ⚙️ Configuration Management

### Saving Configuration

MineMaster automatically saves your configuration:
- Saved to browser's `localStorage`
- Persists across app restarts
- Per-miner configuration

### Exporting Configuration

To back up your settings:
1. Open browser DevTools (F12 in dev mode)
2. Console → `localStorage.getItem('minemaster-config')`
3. Copy the JSON output
4. Save to a file

### Importing Configuration

To restore settings:
1. Open DevTools console
2. Run: `localStorage.setItem('minemaster-config', 'YOUR_JSON_HERE')`
3. Restart application

### Resetting Configuration

To clear all settings:
1. Stop all miners
2. Open DevTools console
3. Run: `localStorage.clear()`
4. Restart application

## 🎯 Best Practices

### Cooling & Temperature Management

**CPU Mining**:
- Keep CPU temperature below 80°C
- Ensure good case airflow
- Consider aftermarket CPU cooler for 24/7 mining
- Start with 50-70% CPU usage, increase if temps are safe

**GPU Mining**:
- Keep GPU temperature below 75°C for longevity
- Target 60-70°C for optimal balance
- Set fan curves to maintain target temperature
- Clean dust from GPU heatsinks regularly

### Power Efficiency

**Optimize Power Limits**:
- Start with 75% power limit
- Gradually increase while monitoring hashrate/watt
- Find sweet spot where hashrate/power ratio is best

**Example**:
- 100% power: 30 MH/s @ 150W = 0.20 MH/s per watt
- 75% power: 27 MH/s @ 110W = 0.25 MH/s per watt ✅ Better

### Pool Selection

Choose pools based on:
- **Fee**: Lower is better (0.5-1% typical)
- **Minimum Payout**: Match your expected earnings
- **Server Location**: Choose nearest region for lower latency
- **Reliability**: Check pool uptime and reputation

### Payment Thresholds

Set appropriate payout thresholds:
- **High hashrate** (>50 MH/s): 0.1-0.5 coin payouts
- **Medium hashrate** (10-50 MH/s): 0.05-0.1 coin payouts
- **Low hashrate** (<10 MH/s): Use pools with low minimums

### Security

**Wallet Safety**:
- ✅ Never share private keys
- ✅ Use official wallet software
- ✅ Enable 2FA on exchange wallets
- ✅ Backup wallet files securely
- ❌ Don't mine directly to exchange addresses (if possible)

**Application Security**:
- Download MineMaster from official sources only
- Verify miner binaries are from official releases
- Keep system and GPU drivers updated
- Use firewall rules to restrict miner network access

### Maintenance

**Daily**:
- Check miner is running
- Verify pool connection
- Monitor temperatures

**Weekly**:
- Review pool statistics
- Check for software updates
- Verify pending balance

**Monthly**:
- Clean computer case and GPU fans
- Reapply thermal paste if temperatures increasing
- Backup wallet and configuration

## 🐛 Common Issues

### Miner stops unexpectedly

**Causes**:
- Pool connection lost
- GPU driver crash
- Overheating

**Solutions**:
- Check internet connection
- Restart miner
- Update GPU drivers
- Improve cooling

### Low hashrate

**Causes**:
- Other applications using CPU/GPU
- Power limit too low
- Thermal throttling
- Wrong algorithm

**Solutions**:
- Close unnecessary applications
- Increase power limit
- Improve cooling
- Verify algorithm matches coin

### Rejected shares

**Causes**:
- Network latency too high
- Overclocking unstable
- Outdated miner

**Solutions**:
- Choose closer pool server
- Reduce overclock
- Update MineMaster and miners

### GPU not detected

**Causes**:
- Outdated drivers
- GPU disabled in BIOS
- OpenCL not installed

**Solutions**:
- Update GPU drivers
- Check BIOS settings
- Install OpenCL runtime

For more issues, see [Troubleshooting Guide](troubleshooting.md).

## 📱 Tips & Tricks

### Dual Mining

Some configurations allow mining two coins simultaneously:
- Set up XMRig for CPU (Monero)
- Set up Nanominer for GPU (Ravencoin)
- Start both miners
- Monitor system temperature carefully

### Night/Weekend Mining

For casual mining:
1. Set CPU usage to 50% for daily use
2. Increase to 100% at night
3. Adjust GPU power limits for silent operation

### Profitability Tracking

1. Note your hashrate from MineMaster
2. Visit [whattomine.com](https://whattomine.com/)
3. Enter your hashrate and power cost
4. Compare coin profitability
5. Switch to most profitable algorithm

### Remote Monitoring

Access pool dashboard from mobile:
- Bookmark your pool URL
- Check stats on-the-go
- Set up pool notifications/alerts (if available)

---

**Need more help?** Check the [FAQ](faq.md) or [Troubleshooting Guide](troubleshooting.md).

**Last Updated**: January 2026
