# SRBMiner integration — desktop 1.4.0

Implemented on master, 2026-09-13. This report describes integration verification, not a successful hardware mining trial.

## Implemented

- Pinned SRBMiner-MULTI 3.6.7 for Windows/Linux x64, independently selectable in existing CPU and GPU slots. Previous engine choices are preserved.
- Matching client/admin algorithm catalogs from the pinned upstream README (69 rows), with canonical RandomX/Autolykos mappings, hardware vendors and developer fees. Catalog identity and CPU/GPU validation are regression tested.
- Managed pool failover, wallet/password/worker, TLS, keepalive, retry/job settings, CPU thread limits/priority/huge pages and GPU intensity. Engine-specific controls replace incompatible settings when switching. Local executable/old GPU indices are cleared on engine changes.
- API catalog endpoint, OpenAPI definitions, CPU/GPU capability gates, compatible assignment delivery and explicit failures for older clients. Registration/reporting remains unauthenticated; management/read access rules remain unchanged.
- Shared verified binaries with independent process directories and scope. Repair refuses either active instance. Existing Stop, command receipts, crash budget and cancellation ownership remain in charge; no miner-owned watchdog or MSR tuning.
- Aggregate H/s and version parsing feed existing process health/logging/API observations. No synthetic pool/share data is manufactured. Smaller desktop widths wrap control headers.

## Distribution evidence

Verified the official release asset digests against downloaded bytes, then used the actual managed installation/extraction code for both platform payloads. Installed files contain only the original executable, supplied `ReadMe.txt` notices and MineMaster's release marker. Optional Windows drivers and example scripts are excluded even from temporary extraction. Executables were never run.

- Linux archive SHA-256: `5589329ad985d26dbd0d5fda63d90b6564d3c12f8a8123b415b9c35e3637e3ae`
- Windows archive SHA-256: `957e21cc4dc043954d206b17a8c419e9f0ab81bdaa263aade6f5d931800aece3`
- Individual runtime-file digests: [release manifest](../../../client/electron/mining/releases.json).
- Upstream [release](https://github.com/doktor83/SRBMiner-Multi/releases/tag/3.6.7), [algorithm/fee catalog](https://github.com/doktor83/SRBMiner-Multi/blob/3.6.7/README.md), [parameters](https://github.com/doktor83/SRBMiner-Multi/blob/3.6.7/Parameters).

## Verification

- Client: 59 tests passed, including synthetic Linux/Windows launch specifications, pool argument delimiters/TLS, canonical algorithms, thread limits, repair exclusion, CPU/GPU independent Stop, admin CPU revision through native launch, version/TH/s/zero parsing and existing updater regressions.
- Server: 82 tests passed with disposable MongoDB/fake processes. Added catalog access boundary, old-client rejection, capable assignment delivery, SRBMiner telemetry and successful/failed command receipts.
- Client and admin production builds passed. The client package includes the catalog required by its native CommonJS configuration module.
- Loopback browser fixtures: saved SRBMiner CPU and Pearl GPU admin configurations; desktop selected both engines, showed simulated 7.25 kH/s CPU and 65 TH/s GPU, and stopped GPU independently. Checked populated configuration forms, API unavailable state and 640-pixel layouts; refreshed Linux fixture also exercised SRBMiner selection/start and displayed validation feedback for an invalid pool. All rigs/processes were synthetic.

## Remaining validation limits

No real pool session, accepted-share accounting, miner throughput, GPU model compatibility, Windows quarantine behavior, signed installer or installed-app upgrade was tested. SRBMiner-specific share counters and pool-side effective hashrate remain unavailable. These must not be presented as zero or measured earnings.

This integration is one algorithm per CPU/GPU process, using all engine-compatible GPUs for GPU scope. It does not expose arbitrary CLI options, multi-algorithm combinations, GPU index assignment, overclocking, a native miner API or special protocol options such as Quantus node certificate pinning. Upstream catalog inclusion alone does not prove a particular pool can be configured here. Windows/Linux x64 are the managed targets; macOS SRBMiner is unavailable.

Before fleet rollout, install the client on an operator-owned Windows and Linux test rig, verify the chosen pool/wallet/algorithm and actual accepted work, exercise scoped stop/restart and configuration changes with both engines active, and confirm the release/update packaging on those systems. No fleet configuration was changed or release published in this pass.

## Follow-up — 1.4.1

A second integration review fixed three concrete gaps:

1. Platform-only advertisement incorrectly included ARM64/unknown architectures. The preload now exposes native architecture; registration and the selector share a Windows/Linux x64 predicate. Native launch checks it before preparation or custom-file inspection. Tests cover Windows/Linux x64, ARM64, macOS and missing identity.
2. Both validators accepted GPU intensity on CPU or CPU priority on GPU, despite ignoring these settings at launch. Nondefault values now fail consistently; schema defaults remain compatible with existing saved profiles.
3. ANSI color sequences between the engine name and version prevented version recognition. Process-detail parsing now strips terminal colors, with a colored SRBMiner banner/rate regression.

Validation: 62 client tests and 83 server tests passed; client production build passed. Existing shared-process repair, Stop cancellation, command/API access, telemetry and update tests remained green. The browser fixture was extended with an architecture selector for synthetic checks. Browser verification confirmed disabled SRBMiner on ARM64, enabled selection on Linux x64, a populated 640-pixel layout and invalid-pool feedback. No miner binaries, production commands, installers or real hardware were exercised. The original hardware and pool-accounting limits remain.

## Reporting follow-up — 1.4.2

The last review found a transient desired/observed mismatch: after a confirmed Stop, old `activeConfig`, pool/share observations and running version remained in renderer state until native reconciliation. Changing the selected engine during that interval could report the new engine with the old algorithm. A shared stopped-state reset now runs on confirmed Stop, process exit and stopped native reconciliation. Snapshot creation independently enforces it without mutating renderer input; pending recovery and desired configuration are preserved. Running snapshots retain their actual launch engine/algorithm/revision. Negative rates are rejected by client snapshots.

Validation: 63 client and 84 server tests passed; client production build passed. Regressions cover stopped Nanominer-to-SRBMiner/Pearl transitions, old launch data removal, retained desired revision/recovery intent, live launch identity and client-to-backend normalization. No real hardware, mining binary or live fleet command was exercised. The previously documented pool acceptance, performance, installer and Windows detection limits remain.

Browser fixture verification additionally exercised start/stop on a synthetic GPU, switched the stopped process to SRBMiner/Pearl and confirmed no prior PID or algorithm remained in health details. Checked the populated 640-pixel configuration and invalid-pool failure feedback.
