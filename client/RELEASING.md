# MineMaster Client — Releasing & Auto-Updates

## How Auto-Update Works

The MineMaster client uses `electron-updater` with GitHub Releases as the update source.
The repository is public: https://github.com/cryptonaut420/minemaster

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

Users can also manually trigger an update check by clicking the version badge in the header, or clicking "Retry" if an update error is shown.

## Prerequisites

- A **GitHub Personal Access Token** (fine-grained) with **Contents: Read and Write** permission on the `cryptonaut420/minemaster` repo
- Create the token at: https://github.com/settings/tokens
- Save it in `client/.env`:
  ```
  GH_TOKEN=ghp_your_token_here
  ```
- Node.js and npm installed
- Docker with the `electronuserland/builder:wine` image (for Windows cross-compilation)

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

### One command to build & publish everything:

```bash
npm run release
```

This single command:
1. Loads `GH_TOKEN` from `client/.env`
2. Downloads miners for all platforms
3. Builds the React app
4. Builds & publishes Linux AppImage (natively)
5. Builds & publishes Windows portable .exe + NSIS installer (via Docker)
6. Creates a GitHub Release tagged with the version (e.g., `v1.2.0`)
7. Uploads all artifacts + `latest.yml` / `latest-linux.yml` metadata files

The release appears directly in the [Releases section](https://github.com/cryptonaut420/minemaster/releases) on GitHub.

### Individual platform publishing (if needed):

```bash
# Linux AppImage only
npm run publish:linux

# Windows NSIS installer only (run from a Windows machine)
npm run publish:windows
```

### Build locally without publishing:

```bash
npm run build:linux              # Linux AppImage
npm run build:windows            # Windows Portable .exe
npm run build:windows-installer  # Windows NSIS Setup .exe
```

## Release Checklist

1. **Bump version:** `npm run bump:patch` (or minor/major)
2. **Commit the version change:** `git add -A && git commit -m "release v1.2.0"`
3. **Push to master:** `git push origin master`
4. **Publish:** `npm run release`
5. **Verify on GitHub:** Check that the release appears at https://github.com/cryptonaut420/minemaster/releases with the correct artifacts

## Verifying Auto-Update

After publishing a release:

1. Install an **older** NSIS version on Windows (or run an older AppImage on Linux)
2. Launch the app and wait ~15 seconds
3. The header should show "Preparing update vX.X.X..." then "Updating... XX%"
4. After download completes, miners stop, and the app restarts with the new version
5. Previously-running miners should auto-resume

You can also click the version badge in the header to manually trigger an update check at any time.

## Troubleshooting

**"Update failed" with Retry button:**
Click "Retry" or hover over the error badge to see the detailed error message. Check the app's developer console (Ctrl+Shift+I) for `[AutoUpdater]` log lines.

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
