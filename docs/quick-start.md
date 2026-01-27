# Quick Start Guide

Get up and running with MineMaster in 5 minutes!

## ⚡ Installation (2 minutes)

### Step 1: Install Prerequisites

**Linux**:
```bash
# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs build-essential
```

**Windows**:
- Download Node.js from [nodejs.org](https://nodejs.org/)
- Run installer

**macOS**:
```bash
brew install node
```

### Step 2: Install MineMaster

```bash
cd /var/www/Ironclad/minemaster/client
npm install --legacy-peer-deps
```

This will:
- ✅ Install dependencies
- ✅ Download XMRig (CPU miner)
- ✅ Download Nanominer (GPU miner)

### Step 3: Launch

```bash
npm start
```

MineMaster will open automatically!

## 🎯 First Mining Session (3 minutes)

### CPU Mining (Monero Example)

**1. Get a Wallet**

Option A - Generate one:
```bash
npm run generate-config
# Copy the wallet address shown
# SAVE the wallet file securely!
```

Option B - Use existing:
- Download official Monero wallet from [getmonero.org](https://getmonero.org/downloads/)
- Create wallet and copy address

**2. Configure Miner**

In MineMaster:
1. Click **"XMRig CPU Miner"** in sidebar
2. Fill in:
   - **Coin**: `XMR`
   - **Algorithm**: `rx/0` (already selected)
   - **Pool**: `pool.supportxmr.com:3333`
   - **Wallet**: `YOUR_WALLET_ADDRESS`
   - **Password**: `x`
   - **CPU Usage**: `50%` (for first run)
3. Click **"▶ Start Mining"**

**3. Monitor**

- ✅ Console shows miner output
- ✅ Hashrate appears after ~30 seconds
- ✅ Look for "accepted" shares

**Done!** You're mining Monero! 🎉

### GPU Mining (Ravencoin Example)

**1. Get a Wallet**

- Download Ravencoin Core from [ravencoin.org](https://ravencoin.org/wallet/)
- Or use generated one: `npm run generate-config`
- Copy your RVN address (starts with "R")

**2. Configure Miner**

1. Click **"Nanominer GPU"** in sidebar
2. Fill in:
   - **Coin**: `RVN`
   - **Algorithm**: `kawpow`
   - **Pool**: `rvn-eu1.nanopool.org:12433`
   - **Wallet**: `YOUR_RVN_ADDRESS`
   - **Rig Name**: `worker1` (optional)
3. Select GPUs to mine with (checkboxes)
4. Adjust power limits (start with 75%)
5. Click **"▶ Start Mining"**

**3. Monitor**

- ✅ Console shows GPU detection
- ✅ Hashrate per GPU appears
- ✅ Watch for "accepted" shares

**Done!** Your GPU is mining Ravencoin! 🚀

## 📊 Dashboard Overview

Click **"📊 Dashboard"** to see:
- All miners status
- Real-time hashrates
- System information (CPU, RAM, GPU)
- Temperature monitoring

**Master Controls**:
- **▶ Play Button**: Start all enabled miners
- **⏸ Pause Button**: Stop all miners

## 💡 Quick Tips

### Maximizing Hashrate

**CPU**:
- Increase CPU usage slider to 100%
- Enable huge pages (Linux):
  ```bash
  sudo sysctl -w vm.nr_hugepages=1280
  ```

**GPU**:
- Increase power limit to 85-100%
- Update GPU drivers
- Improve cooling

### Efficiency Mode

**For 24/7 mining**:
- CPU: 75% power
- GPU: 70-75% power limit
- Lower heat, lower power cost
- Only ~5-10% hashrate loss

### Check Your Earnings

Visit pool dashboard:
- **Monero**: `https://supportxmr.com/#/dashboard` → Enter wallet
- **Ravencoin**: `https://rvn.nanopool.org/account/YOUR_WALLET`

Stats appear after 5-10 minutes.

## 🛠️ Troubleshooting

### Miner won't start

```bash
# Fix permissions (Linux/macOS)
chmod +x miners/xmrig/xmrig
chmod +x miners/nanominer/nanominer
```

### No hashrate showing

- Wait 30-60 seconds for connection
- Check console for errors
- Verify pool address is correct
- Check wallet address format

### Low hashrate

**CPU**:
- Close other applications
- Increase CPU usage %
- Check temperature (<80°C)

**GPU**:
- Increase power limit
- Update drivers
- Check not thermal throttling

### GPU not detected

**Linux**:
```bash
# AMD
sudo apt-get install ocl-icd-opencl-dev

# NVIDIA
sudo ubuntu-drivers autoinstall
```

**Windows**:
- Update GPU drivers from AMD/NVIDIA website
- Restart computer

For more help: See [Troubleshooting Guide](troubleshooting.md)

## 📈 Next Steps

### Learn More
- [User Guide](user-guide.md) - Complete feature guide
- [Mining Configuration](mining-configuration.md) - Detailed setup
- [Performance](performance.md) - Optimization tips

### Try Other Coins

**CPU Mining**:
- Wownero (WOW) - Algorithm: `rx/wow`
- Raptoreum (RTM) - Algorithm: `ghostrider`

**GPU Mining**:
- Ethereum Classic (ETC) - Algorithm: `etchash`
- Ergo (ERG) - Algorithm: `autolykos`
- Conflux (CFX) - Algorithm: `conflux`

### Join Community
- Discord/Reddit for mining tips
- Pool chat for support
- GitHub for issues/features

## 🎓 Understanding Mining

### How It Works

1. **Your computer** solves complex math problems
2. **Pool** combines work from many miners
3. **Block found** → Pool gets reward
4. **Reward split** proportionally to your contribution
5. **Payout** sent to your wallet when threshold reached

### Profitability

Calculate at [whattomine.com](https://whattomine.com/):
1. Enter your hashrate
2. Enter electricity cost ($/kWh)
3. See daily profit estimate
4. Compare different coins

**Example**:
- CPU: 8,000 H/s RandomX = ~$0.50-1.00/day
- GPU: 30 MH/s KawPow = ~$0.75-1.50/day

*(Values vary with coin price and difficulty)*

### Payouts

**Typical Minimums**:
- Monero: 0.1 XMR (~$15-20)
- Ravencoin: 10 RVN (~$0.50-1)
- Ethereum Classic: 0.1 ETC (~$2-4)

**Timeline**:
- Low hashrate (<1000 H/s): Weeks to months
- Medium (5-10 MH/s): Days to weeks  
- High (>50 MH/s): Hours to days

## ⚡ Quick Reference

### Common Pool Addresses

**Monero (XMR)**:
```
pool.supportxmr.com:3333
xmr.c3pool.com:13333
```

**Ravencoin (RVN)**:
```
rvn-eu1.nanopool.org:12433
rvn.2miners.com:6060
```

**Ethereum Classic (ETC)**:
```
etc-eu1.nanopool.org:19999
etc.2miners.com:1010
```

### Algorithm Quick Reference

| Coin | Algorithm | Device |
|------|-----------|--------|
| XMR | rx/0 | CPU |
| WOW | rx/wow | CPU |
| RTM | ghostrider | CPU |
| RVN | kawpow | GPU |
| ETC | etchash | GPU |
| ERG | autolykos | GPU |
| CFX | conflux | GPU |

### Hashrate Units

- **H/s**: Hashes/second (CPU)
- **kH/s**: 1,000 H/s
- **MH/s**: 1,000,000 H/s (GPU)
- **GH/s**: 1,000,000,000 H/s

---

## 🎉 You're All Set!

Happy mining! 🚀

For detailed help, see the full [User Guide](user-guide.md).

**Questions?** Check [FAQ](faq.md) or [Troubleshooting](troubleshooting.md).

---

**Last Updated**: January 2026
