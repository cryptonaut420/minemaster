# MineMaster Client — Releasing & Auto-Updates

## How Auto-Update Works

The MineMaster client uses `electron-updater` with GitHub Releases as the update source.

**Supported targets:**

| Platform | Build Type | Auto-Update | Notes |
|----------|-----------|-------------|-------|
| Windows  | NSIS Installer | Yes | Downloads new installer, runs silently, relaunches |
| Windows  | Portable .exe | No | User must download new version manually |
| Linux    | AppImage | Yes | Replaces AppImage in-place, relaunches |

**Update lifecycle:**
1. App checks for updates 15 seconds after launch, then every hour
2. If a newer version exists on GitHub Releases, the update downloads in the background (mining continues uninterrupted)
3. Once downloaded, all running miners are gracefully stopped (up to 15 seconds)
4. Which miners were running is saved to disk
5. The app quits, the installer runs silently, and the app relaunches
6. On relaunch, previously-running miners are automatically restarted

## Prerequisites

- The GitHub repository must be **public** (or you need a `GH_TOKEN` env var for private repos)
- You need a **GitHub Personal Access Token** with `repo` scope, exported as `GH_TOKEN`:
  ```bash
  export GH_TOKEN=ghp_your_token_here
  ```
- Node.js and npm installed
- For Windows cross-compilation from Linux: Docker with the `electronuserland/builder:wine` image

## Version Bumping

Before each release, bump the version in `package.json`:

```bash
# Patch: 1.1.0 -> 1.1.1 (bug fixes)
npm run bump:patch

# Minor: 1.1.0 -> 1.2.0 (new features)
npm run bump:minor

# Major: 1.1.0 -> 2.0.0 (breaking changes)
npm run bump:major
```

The `prebuild` hook automatically generates `src/version.json` with the version + git metadata, so the version displayed in the client header always reflects the build.

## Publishing a Release

### Option A: Publish from Linux (recommended for Linux + Windows)

**Linux AppImage only:**
```bash
export GH_TOKEN=ghp_your_token_here
npm run publish:linux
```

**Windows NSIS installer only (via Docker cross-compilation):**
```bash
export GH_TOKEN=ghp_your_token_here
npm run build
sudo docker run --rm \
  -e GH_TOKEN=$GH_TOKEN \
  -v "$(pwd):/project" \
  -v "$(pwd)/node_modules:/project/node_modules" \
  -v ~/.cache/electron:/root/.cache/electron \
  -v ~/.cache/electron-builder:/root/.cache/electron-builder \
  electronuserland/builder:wine \
  /bin/bash -c "cd /project && npx electron-builder --windows nsis --publish always"
```

**Both platforms at once:**
```bash
export GH_TOKEN=ghp_your_token_here
npm run publish:linux
# Then run the Docker command above for Windows
```

### Option B: Publish from Windows (for Windows builds)

```powershell
$env:GH_TOKEN = "ghp_your_token_here"
npm run publish:windows
```

### Option C: Build locally without publishing

Build distributable files to `dist/` without uploading to GitHub:

```bash
# All platforms (Linux native + Windows via Docker)
npm run release

# Or individually
npm run build:linux              # Linux AppImage
npm run build:windows            # Windows Portable .exe
npm run build:windows-installer  # Windows NSIS Setup .exe
```

## What `--publish always` Does

When you run `electron-builder --publish always`, it:

1. Builds the application
2. Creates a GitHub Release tagged with the version from `package.json` (e.g., `v1.2.0`)
3. Uploads the built artifacts (`.AppImage`, `.exe`)
4. Uploads `latest.yml` (Windows) and `latest-linux.yml` (Linux) — these are the metadata files that `electron-updater` reads to detect new versions

## Release Checklist

1. **Bump version:** `npm run bump:patch` (or minor/major)
2. **Commit the version change:** `git add -A && git commit -m "release v1.2.0"`
3. **Push to master:** `git push origin master`
4. **Ensure miners are downloaded for all platforms:** `node scripts/download-miners.js --all`
5. **Publish:**
   - Linux: `GH_TOKEN=... npm run publish:linux`
   - Windows: Use Docker command above (or publish from a Windows machine)
6. **Verify on GitHub:** Check that the release appears at `https://github.com/cryptonaut420/minemaster/releases` with the correct artifacts and `latest.yml`/`latest-linux.yml` files

## Verifying Auto-Update

After publishing a release:

1. Install an **older** NSIS version on Windows (or run an older AppImage on Linux)
2. Launch the app and wait ~15 seconds
3. The header should show "Preparing update vX.X.X..." then "Updating... XX%"
4. After download completes, miners stop, and the app restarts with the new version
5. Previously-running miners should auto-resume

## Troubleshooting

**"No published versions" error in logs:**
Normal on a fresh repo with no releases yet. The app silently retries.

**Auto-update not working on Windows portable:**
Expected — portable builds don't support auto-update. Only NSIS installs do.

**Auto-update not working on Linux (non-AppImage):**
Expected — only AppImage builds support auto-update. The `APPIMAGE` environment variable must be set (the AppImage runtime sets this automatically).

**Update downloads but doesn't install:**
Check that the GitHub Release has both the installer artifact AND the `latest.yml` / `latest-linux.yml` file. These metadata files are required for `electron-updater` to work.

**Windows Defender blocks xmrig/nanominer after update:**
Add an exclusion for the MineMaster install directory in Windows Security settings. Miner binaries are commonly flagged as false positives.

**Build fails with "Cannot find module 'electron-updater'":**
Run `npm install` to ensure dependencies are installed. `electron-updater` is a production dependency.
