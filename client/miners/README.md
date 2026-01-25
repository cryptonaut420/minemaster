# Miners Directory

Mining binaries are **downloaded automatically** via `scripts/download-miners.js`.

## Current Miners

**XMRig v6.25.0** - Auto-downloaded for Linux/Windows/macOS

## Re-download Miners

```bash
npm run setup
```

## Manual Download

If automatic download fails, download from:
https://github.com/xmrig/xmrig/releases/tag/v6.25.0

Extract to `miners/xmrig/` and run:
```bash
chmod +x miners/xmrig/xmrig
```

## Adding New Miners

Edit `scripts/download-miners.js` and add to the `MINERS` object.
