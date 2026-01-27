# Frequently Asked Questions (FAQ)

## General Questions

### What is MineMaster?

MineMaster is a cross-platform desktop application that provides a user-friendly interface for cryptocurrency mining. It wraps popular mining software (XMRig, Nanominer) and provides easy configuration, real-time monitoring, and system statistics.

### Is MineMaster free?

Yes, MineMaster itself is free and open-source. However, mining software may have dev fees:
- **XMRig**: 0% by default (configurable donation level)
- **Nanominer**: Has built-in dev fee (check nanominer documentation)

### Is mining profitable?

It depends on:
- Your hardware (CPU/GPU power)
- Electricity costs
- Cryptocurrency prices
- Mining difficulty

Use [whattomine.com](https://whattomine.com/) to calculate profitability for your specific hardware and electricity rate.

**Reality Check**:
- Most hobby miners earn $1-10 per day
- Need to factor in electricity costs
- Better as learning experience than income source

### Is MineMaster safe?

Yes, MineMaster is safe:
- ✅ Uses official miner binaries from trusted sources
- ✅ Open-source code (you can review it)
- ✅ No data collection or telemetry
- ✅ Doesn't store wallet private keys
- ✅ All configuration stored locally

**Always**:
- Download from official sources only
- Verify checksums of downloaded miners
- Keep wallet private keys secure

## Installation & Setup

### Why use --legacy-peer-deps?

Due to peer dependency conflicts between React 18 and react-scripts 5. The flag tells npm to use older dependency resolution behavior. This is a known issue and doesn't affect functionality.

### Where are miner binaries stored?

```
client/miners/
├── xmrig/
│   └── xmrig
└── nanominer/
    └── nanominer
```

These directories are in `.gitignore` - binaries are downloaded during `npm install` via `postinstall` script.

### Can I use my own miner binaries?

Yes! In the configuration panel:
1. Enable "Custom Path" (advanced option)
2. Enter full path to your miner binary
3. MineMaster will use your binary instead

### Why does installation download miners automatically?

To simplify setup. The `postinstall` script (`scripts/download-miners.js`) downloads official releases from:
- XMRig: https://github.com/xmrig/xmrig/releases
- Nanominer: https://github.com/nanopool/nanominer/releases

You can disable this and download manually if preferred.

## Mining Questions

### What can I mine with CPU?

**Best Options**:
- **Monero (XMR)**: Most popular, RandomX algorithm
- **Wownero (WOW)**: RandomX variant
- **Raptoreum (RTM)**: GhostRider algorithm

**CPU mining works best with**:
- Modern CPUs (2019+)
- CPUs with AES-NI support
- High core count (8+ cores)
- Fast RAM (3200MHz+)

### What can I mine with GPU?

**Popular Options**:
- **Ravencoin (RVN)**: KawPow algorithm
- **Ethereum Classic (ETC)**: Etchash algorithm
- **Ergo (ERG)**: Autolykos algorithm
- **Conflux (CFX)**: Octopus algorithm

**GPU Requirements**:
- 4GB+ VRAM for most algorithms
- Updated drivers
- Good cooling

### Can I mine multiple coins simultaneously?

Yes! You can run:
- CPU miner (Monero) + GPU miner (Ravencoin) at the same time
- Different GPUs on different algorithms (with multiple nanominer instances)

Just start multiple miners from the Dashboard.

### How long until I get paid?

Depends on:
1. **Your hashrate**: Higher = faster
2. **Pool minimum payout**: Usually 0.1 for most coins
3. **Pool's payment schedule**: Varies by pool

**Typical Timeline**:
- High hashrate (>50 MH/s): Days
- Medium (5-10 MH/s): 1-2 weeks
- Low (<1 MH/s): Weeks to months

Check your pool's dashboard for estimates.

### Why is my hashrate lower than expected?

**Common Causes**:

**CPU**:
- Not using all threads (increase CPU usage %)
- Slow RAM (enable XMP/DOCP in BIOS)
- Huge pages not configured (Linux)
- Other applications using CPU

**GPU**:
- Power limit too low
- Thermal throttling (too hot)
- Old drivers
- Wrong algorithm

See [Troubleshooting Guide](troubleshooting.md) for fixes.

### What's a good hashrate?

**CPU (RandomX/Monero)**:
- Budget CPU (4-core): 2,000-4,000 H/s
- Mid-range (6-8 core): 5,000-10,000 H/s
- High-end (12-16 core): 15,000-25,000 H/s

**GPU (KawPow/Ravencoin)**:
- Entry GPU: 10-15 MH/s
- Mid-range: 20-30 MH/s
- High-end: 35-50 MH/s

**GPU (Ethash/ETC)**:
- Entry: 25-30 MH/s
- Mid-range: 50-70 MH/s
- High-end: 90-120 MH/s

### What's the reject rate?

Percentage of shares rejected by the pool. **Normal**: <1%

**If higher**:
- Network latency too high → choose closer server
- Overclocking unstable → reduce overclock
- Wrong difficulty → try different pool port

## Configuration

### Where is my configuration saved?

In browser's `localStorage`:
- Key: `minemaster-config`
- Location (dev mode): Browser's localStorage
- Persists across restarts

System info cached in `localStorage` as well.

### How do I backup my configuration?

**Method 1** (Dev mode):
```javascript
// Open DevTools (F12), Console tab
localStorage.getItem('minemaster-config')
// Copy output, save to file
```

**Method 2** (Manual):
- Note down your settings
- Take screenshots
- Keep pool/wallet info in password manager

### Can I import/export profiles?

Not yet built-in, but you can:
1. Manually copy localStorage data
2. Use browser import/export features
3. Feature request for profile management welcome!

### Why does my config reset?

Possible reasons:
- Browser cache cleared
- Running in incognito/private mode
- File permissions issue
- localStorage quota exceeded

## Performance & Optimization

### Should I mine at 100% CPU/GPU?

**Depends on use case**:

**24/7 mining rig**: Yes, 100%
**Daily PC**: No, 50-75% CPU, 75-85% GPU
**Gaming PC**: 10-25% when active, 100% idle

**Consider**:
- Electricity cost vs hashrate gain
- Hardware longevity
- Cooling capacity

### How do I reduce power consumption?

1. **Lower power limits**: 65-75% for GPUs
2. **Reduce CPU usage**: 50-75% threads
3. **Undervolt**: Use MSI Afterburner (advanced)
4. **Optimize**: Find efficiency sweet spot

**Example**: GPU at 75% power often gives 95% hashrate for 75% power.

### Will mining damage my hardware?

**Short answer**: Not if temperatures are safe

**Long answer**:
- Keep CPU <80°C, GPU <75°C
- Use quality PSU with headroom
- Ensure good airflow
- Regular maintenance (dust cleaning)

Mining actually generates less wear than gaming (constant load vs variable load). The main concern is heat - keep it cool!

### What's the difference between XMRig and Nanominer?

**XMRig**:
- CPU mining focused
- Optimized for RandomX (Monero)
- Also supports GhostRider, CryptoNight
- More mature for CPU mining

**Nanominer**:
- GPU mining focused
- Supports many algorithms
- Works with AMD and NVIDIA
- Good for Ethash, KawPow, Autolykos

## Wallets & Payouts

### Do I need a wallet?

Yes! Mining pools need a wallet address to send payments. Don't mine without setting up a wallet first.

### Can I mine to an exchange address?

**Possible but not recommended**:
- ✅ Some pools allow it
- ❌ Exchanges may have deposit issues
- ❌ If pool sends wrong amount, exchange won't help
- ❌ Security risk (not your keys, not your crypto)

**Best practice**: Mine to personal wallet, transfer to exchange when selling.

### How do I create a wallet?

**Official Wallets**:
- **Monero**: [getmonero.org/downloads](https://getmonero.org/downloads/)
- **Ravencoin**: [ravencoin.org/wallet](https://ravencoin.org/wallet/)
- **Ethereum Classic**: MetaMask, MyEtherWallet

**MineMaster generator**:
```bash
npm run generate-config
```
Generates test wallets (save the wallet files securely!).

### Where's my money?

**Check**:
1. **Pool dashboard**: Visit pool website, search your wallet
2. **Minimum payout**: Ensure you've reached threshold
3. **Payment schedule**: Some pools pay hourly, some daily
4. **Wallet sync**: Ensure wallet is fully synchronized

**Be patient**: First payout can take time depending on hashrate.

## Pools

### What's a mining pool?

A group of miners working together. When the pool finds a block, reward is split proportionally based on contributed work (shares).

**Without pool**: Solo mining - need enormous hashrate
**With pool**: Consistent smaller payouts

### How do I choose a pool?

**Factors**:
1. **Fee**: 0.5-1% is standard
2. **Minimum payout**: Match your hashrate
3. **Location**: Choose nearest server
4. **Size**: Medium pools good for decentralization
5. **Reputation**: Check pool reviews

**Popular Pools**:
- Monero: SupportXMR, C3Pool
- Ravencoin: Nanopool, 2Miners
- ETC: Ethermine, 2Miners

### What's the difference between PPLNS and PPS?

**PPLNS** (Pay Per Last N Shares):
- Pay when pool finds block
- Variance (lucky = more, unlucky = less)
- Usually lower fees
- Better for long-term mining

**PPS** (Pay Per Share):
- Fixed payment per share
- No variance, predictable
- Higher fees
- Good for short-term mining

Most pools use PPLNS.

## Troubleshooting

### Why can't I start mining?

Check:
1. [ ] Pool address format correct (`host:port`)
2. [ ] Wallet address valid
3. [ ] Miner binary has execute permissions
4. [ ] Internet connection working
5. [ ] Firewall not blocking miner

See [Troubleshooting Guide](troubleshooting.md) for detailed help.

### GPU not detected?

**Linux**:
```bash
# Check GPU present
lspci | grep -i vga

# AMD
sudo apt-get install ocl-icd-opencl-dev

# NVIDIA
sudo ubuntu-drivers autoinstall
```

**Windows**:
- Update GPU drivers
- Restart computer

### Console shows errors?

Common errors:

**"Connection failed"**:
- Check internet
- Try different pool
- Verify pool address

**"Invalid algorithm"**:
- Check algorithm matches coin
- Consult pool documentation

**"GPU not found"**:
- Update drivers
- Check GPU detected in system

**"Out of memory"**:
- Close other applications
- Reduce CPU threads
- Check RAM available

## Updates & Support

### How do I update MineMaster?

**From source**:
```bash
git pull
npm install --legacy-peer-deps
npm start
```

**Binary installation**:
- Download latest release
- Install over existing version
- Settings should persist

### How do I update miners?

```bash
# Re-download latest versions
cd client
npm run setup
```

Or manually download from:
- XMRig: https://github.com/xmrig/xmrig/releases
- Nanominer: https://github.com/nanopool/nanominer/releases

### Where can I get help?

1. **Documentation**: This docs folder
2. **GitHub Issues**: Technical problems
3. **Pool Discord**: Pool-specific questions
4. **Reddit**: r/MoneroMining, r/Ravencoin, etc.

### How can I contribute?

See [Development Guide](development.md):
- Submit bug reports
- Suggest features
- Contribute code
- Improve documentation

---

## Still have questions?

- Check [User Guide](user-guide.md) for detailed usage
- See [Troubleshooting](troubleshooting.md) for common issues
- Open an issue on GitHub
- Join community Discord/Reddit

**Last Updated**: January 2026
