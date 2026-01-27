# Mining Configuration Guide

Comprehensive guide to configuring miners in MineMaster for various cryptocurrencies and algorithms.

## 📋 Table of Contents

1. [CPU Mining Configuration](#cpu-mining-configuration)
2. [GPU Mining Configuration](#gpu-mining-configuration)
3. [Algorithm Reference](#algorithm-reference)
4. [Pool Configuration](#pool-configuration)
5. [Wallet Setup](#wallet-setup)
6. [Performance Tuning](#performance-tuning)

## 🖥️ CPU Mining Configuration

### XMRig Miner

XMRig is optimized for RandomX and CryptoNight algorithms, primarily used for CPU mining.

#### Basic Configuration

**Required Fields**:
- **Coin**: Symbol of cryptocurrency (e.g., XMR, WOW, RTM)
- **Algorithm**: Mining algorithm (see below)
- **Pool Address**: Pool server URL and port
- **Wallet Address**: Your receiving address
- **Password**: Usually `x` (pool dependent)

**Optional Fields**:
- **CPU Usage**: 10-100% (thread allocation)
- **Additional Arguments**: Advanced XMRig flags

### Supported Algorithms (XMRig)

#### RandomX (rx/0) - Monero

**Best for**: Modern CPUs with AES support

**Configuration**:
```
Coin: XMR
Algorithm: rx/0
Pool: pool.supportxmr.com:3333
Algorithm Features:
  - Memory-hard (2GB+ RAM required per thread)
  - CPU-optimized (GPUs inefficient)
  - Favors AMD Ryzen, Intel i7/i9
```

**Expected Hashrate**:
- AMD Ryzen 5 3600: ~7,000 H/s
- AMD Ryzen 9 5950X: ~20,000 H/s
- Intel i9-12900K: ~18,000 H/s

**Pools**:
- SupportXMR: `pool.supportxmr.com:3333`
- C3Pool: `xmr.c3pool.com:13333`
- HashVault: `pool.hashvault.pro:3333`

#### RandomWOW (rx/wow) - Wownero

**Configuration**:
```
Coin: WOW
Algorithm: rx/wow
Pool: pool.wownero.com:3333
Similar to RandomX, slightly different variant
```

**Pools**:
- Wownero Pool: `pool.wownero.com:3333`

#### RandomARQ (rx/arq) - ArQmA

**Configuration**:
```
Coin: ARQ
Algorithm: rx/arq
Pool: arq.pool.com:3333
```

#### CryptoNight R (cn/r)

**Best for**: Legacy CryptoNight coins

**Configuration**:
```
Algorithm: cn/r
Less memory-intensive than RandomX
```

#### GhostRider - Raptoreum

**Best for**: CPUs with many threads

**Configuration**:
```
Coin: RTM
Algorithm: ghostrider
Pool: raptoreum.pool.com:3008
Very CPU-intensive, high power usage
```

**Expected Hashrate**:
- AMD Ryzen 9 5950X: ~9,000 H/s
- AMD Threadripper 3990X: ~40,000 H/s

### CPU Usage Configuration

**CPU Usage Slider**:
- **10%**: ~1-2 threads, minimal system impact
- **25%**: Quarter of threads, light mining
- **50%**: Half threads, balanced mining
- **75%**: Most threads, heavy mining
- **100%**: All threads, maximum hashrate

**Recommendations**:
- **Daily PC use**: 25-50%
- **Background mining**: 50-70%
- **Dedicated mining**: 100%
- **Gaming PC**: 10-25% while gaming, 100% idle

**Thread Calculation**:
```
threads = ceil(total_threads × (percentage / 100))
```

Example: 16-thread CPU at 50% = 8 threads

### Advanced XMRig Configuration

**Additional Arguments**:

```bash
# TLS connection
--tls

# Keep-alive for better pool connection
--keepalive

# Custom huge pages (Linux)
--hugepages=1024

# Disable GPU mining in XMRig
--no-opencl --no-cuda

# Verbose output
--verbose

# CPU affinity (pin threads to cores)
--cpu-affinity=0x5555

# Max CPU usage (alternative to thread count)
--cpu-max-threads-hint=50
```

**Example Combined**:
```
Additional Arguments: --tls --keepalive --verbose
```

## 🎮 GPU Mining Configuration

### Nanominer

Nanominer supports multiple GPU algorithms for various cryptocurrencies.

#### Basic Configuration

**Required Fields**:
- **Coin**: Cryptocurrency symbol
- **Algorithm**: See algorithm table below
- **Pool Address**: Pool server and port
- **Wallet Address**: Your receiving address

**Optional Fields**:
- **Rig Name**: Worker identifier
- **GPU Selection**: Which GPUs to use
- **Power Limits**: Per-GPU power restrictions

### Supported Algorithms (Nanominer)

#### Ethash - Ethereum Classic

**Configuration**:
```
Coin: ETC
Algorithm: ethash
Pool: etc-eu1.nanopool.org:19999
Memory: 4GB+ VRAM required
```

**Expected Hashrate**:
- RX 570 4GB: ~28 MH/s
- RX 580 8GB: ~30 MH/s
- RX 5700 XT: ~54 MH/s
- RX 6800: ~63 MH/s
- GTX 1660 Super: ~28 MH/s
- RTX 3060 Ti: ~60 MH/s
- RTX 3080: ~95 MH/s

**Pools**:
- Nanopool: `etc-eu1.nanopool.org:19999`
- 2Miners: `etc.2miners.com:1010`
- Ethermine: `etc.ethermine.org:4444`

#### Etchash - Ethereum Classic (Updated)

**Configuration**:
```
Coin: ETC
Algorithm: etchash
Pool: etc-eu1.nanopool.org:19999
Newer variant, slightly different DAG
```

#### KawPow - Ravencoin

**Configuration**:
```
Coin: RVN
Algorithm: kawpow
Pool: rvn-eu1.nanopool.org:12433
GPU-intensive, lower hashrate than Ethash
```

**Expected Hashrate**:
- RX 580: ~13 MH/s
- RX 5700 XT: ~23 MH/s
- RX 6800: ~28 MH/s
- GTX 1660 Super: ~13 MH/s
- RTX 3060 Ti: ~28 MH/s
- RTX 3080: ~45 MH/s

**Pools**:
- Nanopool: `rvn-eu1.nanopool.org:12433`
- 2Miners: `rvn.2miners.com:6060`
- Flypool: `rvn-eu1.flypool.org:3636`

#### Autolykos - Ergo

**Configuration**:
```
Coin: ERG
Algorithm: autolykos
Pool: ergo-eu1.nanopool.org:11111
Memory-hard, good for AMD cards
```

**Expected Hashrate**:
- RX 580: ~80 MH/s
- RX 6800: ~160 MH/s
- RTX 3080: ~250 MH/s

**Pools**:
- Nanopool: `ergo-eu1.nanopool.org:11111`
- Herominers: `ergo.herominers.com:1180`

#### Octopus - Conflux

**Configuration**:
```
Coin: CFX
Algorithm: conflux
Pool: cfx-eu1.nanopool.org:17777
Good for NVIDIA cards
```

**Expected Hashrate**:
- RX 6800: ~50 MH/s
- RTX 3080: ~80 MH/s

#### Kaspa

**Configuration**:
```
Coin: KAS
Algorithm: kaspa
Pool: pool.woolypooly.com:3112
```

#### Other Algorithms

- **TON**: `algorithm: ton`
- **Karlsenhash**: `algorithm: karlsenhash` (KLS coin)
- **Nexa**: `algorithm: nexa`

### GPU Selection

**All GPUs**:
- Leave GPU checkboxes empty/all checked
- Uses all detected GPUs

**Specific GPUs**:
- Check only GPUs you want to mine with
- Useful for:
  - Gaming PC (keep one GPU free)
  - Mixed GPU rigs (different algorithms per GPU)
  - Troubleshooting specific GPU

**Example**:
```
System has 3 GPUs:
- GPU 0: RX 6800 ✓ (selected)
- GPU 1: RTX 3070 ✓ (selected)
- GPU 2: GTX 1650 ☐ (not selected, for display)
```

### Power Limit Configuration

**Per-GPU Power Limits**:
- **50%**: Minimum, very efficient, ~60-70% hashrate
- **65%**: Efficient, ~85-90% hashrate
- **75%**: Balanced, ~95% hashrate
- **85%**: High performance, ~98% hashrate
- **100%**: Maximum, 100% hashrate, highest power

**Finding the Sweet Spot**:
1. Start at 75% power
2. Note hashrate and power consumption
3. Try 65%, 85%
4. Calculate MH/s per watt
5. Choose best efficiency point

**Example**:
```
RX 6800 Ethash:
- 100% power: 63 MH/s @ 150W = 0.42 MH/W
- 75% power: 60 MH/s @ 110W = 0.55 MH/W ✓ Better
- 50% power: 42 MH/s @ 80W = 0.53 MH/W
```

### Worker/Rig Name

**Purpose**:
- Identify different machines on pool dashboard
- Track per-rig statistics
- Manage mining farm

**Naming Convention**:
```
[Location]-[GPU Type]-[Number]

Examples:
- home-amd-01
- office-nvidia-02
- rig-mixed-03
```

## 📊 Algorithm Reference Table

### CPU Algorithms

| Algorithm | Coins | Memory | CPU Type | Difficulty |
|-----------|-------|--------|----------|------------|
| rx/0 | XMR | 2GB/thread | Modern | Medium |
| rx/wow | WOW | 2GB/thread | Modern | Medium |
| rx/arq | ARQ | 2GB/thread | Modern | Medium |
| cn/r | Various | 2MB/thread | Any | Low |
| cn/half | MSR, XTNC | 2MB/thread | Any | Low |
| ghostrider | RTM | 4MB/thread | Many cores | High |

### GPU Algorithms

| Algorithm | Coins | VRAM | GPU Type | Power |
|-----------|-------|------|----------|-------|
| ethash | ETC, UBQ | 4GB+ | All | High |
| etchash | ETC | 4GB+ | All | High |
| kawpow | RVN | 4GB+ | All | Very High |
| autolykos | ERG | 2GB+ | AMD prefer | Medium |
| octopus | CFX | 2GB+ | NVIDIA prefer | High |
| kaspa | KAS | 1GB+ | All | Medium |

## 🔌 Pool Configuration

### Choosing a Pool

**Factors to Consider**:
1. **Fee**: 0.5-1% is standard
2. **Minimum Payout**: Match your hashrate
3. **Server Location**: Choose nearest region
4. **Payment Method**: PPLNS, PPS, etc.
5. **Pool Size**: Balance between small and large

**Pool Size Trade-offs**:
- **Large pools**: Consistent payouts, more competition
- **Small pools**: Variable payouts, help decentralization

### Pool URL Format

```
[protocol]://[server]:[port]

Examples:
- pool.supportxmr.com:3333
- stratum+tcp://us.ravenminer.com:3838
- ssl://pool.hashvault.pro:443
```

**Ports**:
- Low difficulty: 3333, 5555
- High difficulty: 7777, 9999
- SSL/TLS: 443, 5555

### Regional Servers

Most pools offer regional servers:
- **EU**: Europe (eu1, eu2)
- **US**: United States (us1, us2, us-west, us-east)
- **Asia**: Asia Pacific (asia1, asia-ap)
- **Other**: Australia, Russia, Brazil, etc.

**Choose based on**:
- Lowest ping (<100ms best)
- Geographic proximity
- Local internet routing

## 💰 Wallet Setup

### Creating Wallets

#### Monero (XMR)

**Official Wallet**:
1. Download from [getmonero.org/downloads](https://getmonero.org/downloads/)
2. Install Monero GUI
3. Create new wallet
4. Save 25-word seed phrase (CRITICAL!)
5. Copy wallet address for mining

**Wallet Format**: `4xxxxx...` (95 characters)

**Alternative**: Use MineMaster's generator:
```bash
npm run generate-config
```

#### Ravencoin (RVN)

**Official Wallet**:
1. Download from [ravencoin.org/wallet](https://ravencoin.org/wallet/)
2. Install Ravencoin Core
3. Create new address
4. Backup wallet.dat file

**Wallet Format**: `Rxxxxx...` (34 characters, starts with R)

#### Ethereum Classic (ETC)

**Options**:
- MetaMask (browser extension)
- MyEtherWallet (web wallet)
- Trust Wallet (mobile)

**Wallet Format**: `0xxxxx...` (42 characters, starts with 0x)

#### Ergo (ERG)

**Official Wallet**:
- Yoroi (mobile/desktop)
- Ergo Node Wallet (full node)

**Wallet Format**: `9xxxxx...` (51 characters, starts with 9)

### Wallet Security

**Best Practices**:
1. ✅ **Backup seed phrases** - Write on paper, store securely
2. ✅ **Use hardware wallets** - Ledger, Trezor for large amounts
3. ✅ **Don't mine to exchanges** - Use personal wallet first
4. ✅ **Enable 2FA** - On exchange accounts
5. ✅ **Verify addresses** - Double-check before mining
6. ❌ **Never share private keys** - No one legitimate needs them
7. ❌ **Don't store online** - Cloud, email, messaging apps

## ⚡ Performance Tuning

### CPU Mining Optimization

**BIOS Settings**:
- Enable XMP/DOCP for RAM (faster=better)
- Disable SMT/Hyperthreading (sometimes faster)
- Enable AES-NI (required for RandomX)

**Operating System**:
```bash
# Linux - Huge pages (improves RandomX performance)
sudo sysctl -w vm.nr_hugepages=1280

# Disable CPU frequency scaling
sudo cpupower frequency-set -g performance
```

**MineMaster Settings**:
- Use 100% CPU for maximum hashrate
- Monitor temperature (<80°C)
- Close unnecessary applications

### GPU Mining Optimization

**Driver Updates**:
- AMD: Latest Adrenalin drivers
- NVIDIA: Latest Game Ready drivers

**Overclocking** (advanced):
- Increase memory clock (+100-500 MHz)
- Decrease core clock (-100-200 MHz for efficiency)
- Increase power limit if thermal headroom available

**Undervolting**:
- Lower voltage = less power, less heat
- Maintain hashrate while reducing power by 20-30%
- Use MSI Afterburner, AMD Wattman, or NVIDIA Inspector

**Cooling**:
- Set aggressive fan curves (70-80% fan speed)
- Improve case airflow
- Consider external fans for GPU rigs

### Configuration Examples

#### High Performance (Maximum Hashrate)
```
CPU Mining:
- CPU Usage: 100%
- Additional Args: --hugepages=1280

GPU Mining:
- All GPUs selected
- Power Limit: 100%
- Focus on raw hashrate
```

#### Efficient Mining (Best Watt/Hash Ratio)
```
CPU Mining:
- CPU Usage: 75%
- No additional args

GPU Mining:
- All GPUs selected
- Power Limit: 65-75%
- Find sweet spot per GPU
```

#### Silent Mining (Minimal Noise/Heat)
```
CPU Mining:
- CPU Usage: 25-50%

GPU Mining:
- Power Limit: 50-60%
- Manual fan curves: 40-50%
- Reduce heat and noise
```

## 🔍 Troubleshooting Configuration

### Low Hashrate

**CPU**:
- Check CPU usage in task manager
- Ensure AES-NI is enabled
- Try disabling SMT in BIOS
- Check RAM running at rated speed

**GPU**:
- Update drivers
- Increase power limit
- Check thermal throttling
- Verify VRAM not full

### High Rejection Rate

**Causes**:
- Network latency too high
- Overclocking unstable
- Wrong algorithm or difficulty

**Solutions**:
- Choose closer pool server
- Reduce overclock
- Try different pool
- Check wallet address is correct

### GPU Not Detected

**Check**:
```bash
# Linux
ls /sys/class/drm/card*/device/

# NVIDIA
nvidia-smi
```

**Solutions**:
- Update GPU drivers
- Check GPU is enabled in BIOS
- Verify OpenCL runtime installed
- Restart application

---

**Last Updated**: January 2026
