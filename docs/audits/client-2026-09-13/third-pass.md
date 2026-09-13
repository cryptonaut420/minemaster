# Third desktop audit — 1.3.1

Completed September 13, 2026. This pass targets Windows/Linux lifecycle behavior, Nanominer CPU administration, debugging and application updates. No production fleet commands, mining processes, deployment, antivirus policy changes or fee modifications were performed.

## Repairs implemented

- Fixed an updater error/cancellation race during asynchronous miner shutdown: the controller rechecks the active attempt before installer handoff and holds new starts until preparation settles. Background download promise rejections are observed, and synchronous check failures can be retried.
- Bound atomic resume state to source/target versions and expiry. Old renderer reloads cannot consume new-version resume intent, and newer local Stop/Start actions suppress delayed resume.
- Added a Linux AppImage recovery copy before replacement, restoration when a reported failure leaves the original missing, and cleanup after the intended version starts. This is not an automatic rollback system for an unbootable replacement.
- Added capability-gated whole-rig app check/install commands, bounded update telemetry, admin status/error display and controls. Installer handoff stays pending; success requires registration of the target version. API access boundaries remain unchanged.
- Fixed admin-assigned passwords becoming permanent local overrides. Assignment ownership persists across reconnects. A CPU engine change clears the old engine's custom executable path. Ambiguous overrides from older profiles are retained for operator review.
- Made Stop reach the native manager while a Start is still preparing, added command deadline cancellation, and rechecked native startup observation before acknowledging success.
- Added bounded rotating native diagnostics and a desktop shortcut to open them. Renderer/process/update failures are recorded; logging failure does not block controls.
- Added Linux-specific executable/loader/permission diagnostics, corrected packaged file loading for paths containing special characters, and isolated OS/CPU refresh from GPU enumeration failure. Cached GPU inventory remains explicitly dated.
- Browser verification caught a CommonJS/ESM startup failure that a production build initially accepted; the assignment module now uses renderer-compatible ES module syntax.

## Validation

Client and backend regression suites pass (47 client tests and 65 backend tests, with overlap in shared native tests). New coverage includes update failures during preparation, background download rejection, version-bound resume, AppImage restore using plain text files, startup cancellation, configuration ownership, bounded logging, sensor isolation and remote update completion after a new-version registration. An admin Nanominer CPU revision is traced through assignment, command execution and native configuration generation while a fake GPU process retains its PID. Tests never execute mining binaries and the backend uses disposable MongoDB.

Renderer and admin production builds passed. Linux x64 and Windows x64 unpacked packaging passed; packaged native modules, renderer and version were compared against final source/build outputs. Packaging verified pinned engine hashes and retained supplied license files; Windows signing/resource editing was disabled for this cross-package check. These are unpacked artifact checks, not installer execution.

Loopback browser fixtures verified Linux and Windows startup, Nanominer CPU selection/thread/recovery settings, a visible simulated installer failure, admin update telemetry and forced whole-rig installation scope. The admin dialog was checked at a 640-pixel viewport; DOM bounds fit, but the screenshot surface clipped the right edge, so full visual validation remains limited. No live update or mining executable was launched.

## Remaining validation limits

Real Windows Defender behavior, Windows-native archive extraction, GPU drivers/sensors, CPU/GPU throughput and actual installed NSIS/AppImage update/relaunch behavior require operator-owned hardware. Linux cross-packaging does not prove Windows execution. Update feed publication/signing and a two-version upgrade exercise remain release checks. Native logs cannot guarantee a final flush on abrupt power loss. New update commands require upgraded clients; older clients are rejected explicitly.

Nanominer's documented RandomX fee remains 2%, and official XMRig remains 1%. XMRig permits a zero-donation source build, but no custom distribution was built, benchmarked or added to the verified release manifest. See [client guidance](../../../client/README.md#version-131-reliability-and-troubleshooting).
