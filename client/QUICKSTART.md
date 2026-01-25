# Quick Start

## Install & Run

```bash
cd /var/www/Ironclad/minemaster/client
npm install --legacy-peer-deps
npm start
```

Done! The app will open automatically and XMRig will be ready to use.

## Configure Your Miner

In the GUI:
- **Pool**: `pool.supportxmr.com:3333` (or your pool)
- **Wallet**: Your crypto wallet address
- **Algorithm**: `rx/0` (for Monero)
- **Threads**: `0` (auto-detect)

Click "▶ Start Mining" and you're mining!

## Example: Mining Monero

```
Pool: pool.supportxmr.com:3333
Wallet: YOUR_XMR_WALLET_ADDRESS
Password: x
Algorithm: rx/0
```

## Build for Distribution

```bash
npm run build:electron    # Creates Linux AppImage/deb
```

## Need Help?

See `README.md` for full documentation.
