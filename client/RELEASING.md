# MineMaster desktop 1.4 — releasing and updates

## Build and verify

Run commands inside `client/`. Use the lockfile and Node 20 or later. The renderer build generates `src/version.json` from the package version and current Git metadata.

```bash
npm ci --legacy-peer-deps
npm test
npm run build
npm --prefix ../server test
npm --prefix ../server/public run build
```

Tests use fake native processes and disposable data. They never execute mining binaries. See [the audit](../docs/audits/client-2026-09-13/second-pass.md) for package checks and the remaining Windows/hardware trial.

The version is currently 1.4.5. For a later release, use `npm run bump:patch`, `bump:minor` or `bump:major`, then synchronize `package-lock.json` with `npm install --package-lock-only --ignore-scripts --legacy-peer-deps`. Review and commit source/version changes before the release build. Build metadata identifies the source commit used by the build.

Build locally without publishing:

```bash
npm run build:linux               # Linux AppImage
npm run build:windows             # Windows portable
npm run build:windows-installer   # Windows NSIS
npm run build:mac                 # macOS DMG, on a macOS builder
```

Windows cross builds require the existing Wine/container environment. macOS needs a macOS builder. A local unpacked package is only a layout check; it does not validate installer signing, SmartScreen reputation, successful miner launches or update installation.

## Miner distribution

`electron/mining/releases.json` pins XMRig 6.26.0 Nanominer 3.10.0 and SRBMiner-MULTI 3.6.7 with official URLs, archive SHA-256 and runtime-file SHA-256. The `beforePack` hook verifies/downloads the actual target's files, including cross builds. Nanominer and SRBMiner are available on Windows/Linux x64; XMRig also covers macOS x64/arm64. Only the requested platform/architecture is packaged.

Setup/repair lists the archive, then extracts only manifest-listed runtime files and supplied licenses. Optional drivers are not extracted into temporary directories or installed. Runtime replacement stages and verifies new files before swapping directories. The shared Nanominer or SRBMiner executable cannot be repaired while either CPU or GPU uses it. Versioned binaries remain outside Git and writable configurations stay in user data; see [the client guide](README.md).

Changing a pinned engine requires verifying the archive and every selected file, retaining licenses, updating supported configuration options, and rechecking every requested package target. Do not run the binaries during automated verification.

## Publishing

The configured GitHub release source is `cryptonaut420/minemaster`. Publishing needs repository access and a release token supplied through the build environment (`GH_TOKEN`), never embedded into the app. Runtime access to private release assets is a separate distribution concern; the publisher's token is not a client update solution.

For a complete Windows/Linux release, use `npm run release` from a clean, committed `master` checkout. Bump and commit the version/lockfile first and add `docs/releases/<version>.md`. The wrapper requires Docker access and an authenticated GitHub CLI (or `GH_TOKEN` in its environment); it no longer reads `client/.env` or bumps versions during publication.

Docker-generated output is returned to the invoking publisher before checksum generation. The wrapper runs both test suites and web builds, packages Windows NSIS/portable and Linux AppImage together with `--publish never` into a fresh version directory, and checks both update feeds against the actual SHA-512 hashes and sizes. It pushes master and an exact source tag, creates a draft with all seven assets, verifies the uploaded SHA-256 digests and sizes, then publishes it as latest. A build, upload or verification failure leaves no partial public release. Existing output/tag conflicts require inspection before retrying; do not overwrite a published release.

For a manually staged release, `node scripts/verify-release.cjs <directory> <version>` validates the complete asset set and writes `SHA256SUMS`; `node scripts/publish-release.cjs <directory> <version> <notes-file>` requires an existing pushed tag and performs draft/upload verification/publication. Also inspect packaged application source/version and miner hashes before publication. Cross-built packages do not establish Windows runtime or installer behavior.

The older `publish:linux` / `publish:windows` shortcuts publish immediately and independently; use the complete-release wrapper for fleet updates. Current macOS packaging produces DMGs; validate a complete signed/notarized macOS update feed on a Mac before promising automatic distribution there.

Keep signing credentials in the release environment. Authenticode signing helps publisher identity and reputation; it does not guarantee that Windows allows XMRig or Nanominer. Signing the wrapper does not sign a separate upstream miner executable. Do not alter the pinned upstream binaries while continuing to claim their original hashes.

## Update behavior

The app checks roughly 15 seconds after launch and hourly afterward, including when an older release is already downloaded. Manual checks also refresh the latest release; an unsuccessful refresh retains an already downloaded installer with a visible error. Installation cannot race a check. Windows NSIS installations and Linux AppImage runs support application installation; portable Windows, development runs and ordinary unpacked Linux directories report that installation is unavailable. The controller also supports packaged macOS apps subject to a valid platform update feed.

1. An available update downloads while mining continues.
2. The header offers **Install and restart**. Download completion alone does not stop miners or install anything.
3. An explicit installation blocks new launches, confirms every owned process stopped and atomically records which enabled processes may resume after the update.
4. A stop/save/install failure pauses installation and shows the error. Manual starts become available again. Failed installation removes resume intent, so an ordinary later startup cannot unexpectedly resume mining.
5. Following successful installation, previously running enabled processes are eligible to resume. Ordinary app startup does not start miners automatically.

Before rollout, test an older installed version on an operator-owned test rig: background download, explicit install, failed-stop recovery, successful relaunch and intended process resumption. Local fake-updater tests cannot establish real installer behavior.

## Windows blocks

Use **Check miner files** and expand the troubleshooting details. The diagnostic includes expected file identity and, when available, a read-only exact-path Defender history/signature check. Copy the diagnostic report and review the matching Windows Security entry. **Microsoft file review** opens the official submission page without uploading anything. A historical detection, unsigned file or missing history does not alone establish the current cause.

A CPU-engine change is an explicit configuration choice. Nanominer RandomX may run on machines where XMRig is blocked, but that is not guaranteed by packaging or signing. Resolve applicable device policy/detection review before repairing blocked files. No broad exclusions, protection changes, renamed binaries or quarantine-repair loops are part of the release process. See [Windows troubleshooting](README.md#windows-cpu-mining-blocked).

## 1.3.1 update verification

Installation may also be requested from the admin with whole-rig scope. Its command remains running through installer handoff and requires a registration with the requested new version before success. Exercise this with two actual releases before fleet rollout; a fake updater cannot prove NSIS/AppImage installation, signing, feed availability or relaunch behavior.

Resume state records source and target versions and expires after two hours. Old-app reloads cannot consume it. Linux AppImage updates first retain a sibling `.minemaster-backup`; failed replacement can restore a missing original, and successful target startup removes the recovery copy. Test writable/read-only install directories, low disk space, interrupted replacement and manual recovery. Portable/unpacked packages still cannot prove automatic installation. Application diagnostics are under user data in `logs/client.log` with one rotated predecessor.

## 1.4.5 verification

The regression suite exercises the installed `electron-updater` NSIS and AppImage download paths against a loopback HTTP feed with inert package bytes: 1.4.3 discovers 1.4.4, then refreshes to 1.4.5 without first installing the older download, and rejects a corrupt next download. It tests the source/target resume format and the controller's failed-stop/cancellation paths. It never launches an installer or miner; real Windows/Linux installation and relaunch remain hardware checks. See [the follow-up audit](../docs/audits/regression-repair-2026-09-15/follow-up.md).

Clients older than 1.4.5 that already downloaded an older release may still offer that cached installer. Install it and check again, or install the latest Windows Setup directly. Publishing 1.4.5 cannot change an already-running older updater.

## 1.4.6 verification

The inert-file download regression now refreshes 1.4.5 to 1.4.6 and validates the previously published resume-state format for that destination. Local and remote install calls pass the requested version through IPC; the native owner rejects a mismatched ready version before stopping miners. All draft, checksum, package and hardware-verification requirements above remain applicable.
