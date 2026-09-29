# September 29 miner refresh — 1.4.9

## Evidence and scope

The pool correctly identified SRBMiner 3.6.7 as outdated. Official GitHub stable-release metadata identifies SRBMiner 3.7.0 (September 28), Nanominer 3.10.0 and XMRig 6.26.0. Checked official sources:

- [SRBMiner 3.7.0](https://github.com/doktor83/SRBMiner-Multi/releases/tag/3.7.0)
- [Nanominer 3.10.0](https://github.com/nanopool/nanominer/releases/tag/v3.10.0)
- [XMRig 6.26.0](https://github.com/xmrig/xmrig/releases/tag/v6.26.0)

Both SRBMiner archive SHA-256 values match GitHub's release-asset digests. Only the executable and supplied ReadMe notices were extracted, and their file hashes were pinned. The algorithm catalog was compared with the supplied ReadMe; Quantus adds Intel vendor support. Existing one-algorithm CPU/GPU scope, foreground ownership, disabled MSR/watchdog behavior and driver exclusion remain unchanged. The versioned catalog does not prove old-client or individual-model compatibility.

## Repairs

1. **Current engine files:** SRBMiner 3.7.0 for Windows/Linux; other engines already current. Admin/client labels use their catalog version.
2. **Clean packaging:** the previous build copied a broad cached target tree, allowing obsolete versions or unexpected files into an installer. A clean allowlisted staging tree now contains only current manifest runtime files and receipts. Hash failure preserves the previous good staging tree. A separate gate verifies the packaged Windows/Linux resources before publication.
3. **Release freshness:** the complete release command checks all official latest stable releases, pinned archive identities and available upstream digests. Network/API failures or newer versions stop publication for deliberate review, rather than silently claiming freshness.
4. **Preparation diagnostics:** unavailable-file inspection retains its stage and OS operation through the launch-spec boundary. Working-directory/config/log writes get a configuration stage. Neither is misreported as an executable launch or established antivirus detection.
5. **Pool accuracy:** Nanominer's `Connected to pool:` was parsed as address `pool:`; reconnection now retains the actual endpoint. Closed/lost connections become disconnected with their original native observation time.

## Validation and limits

Focused regressions cover clean packaging with obsolete versions/extra driver files, corrupt source hashes and atomic preservation, packaged extra-file rejection, stale/changed/unavailable official metadata, file-inspection/configuration failures, pool endpoints/reconnects and original timestamps. Existing SRBMiner aggregate/current-zero parsing remains covered; synthetic 1m/15m/1h/6h average lines cannot overwrite current rates. No claim is made that synthetic output establishes every actual 3.7.0 log variant.

No miner or installer is executed during tests. This pass does not establish real Windows installation/relaunch, antivirus acceptance, driver compatibility or hashrate improvement. A published client download does not upgrade an already running miner: installation/restart remains explicit, and custom executable paths are not replaced. No forced fleet update, repair, mining control or profile change is issued.

Pre-release checks passed: 98 client tests, 120 backend tests, both production builds, and official release freshness verification. The real installed updater NSIS/AppImage implementations discover 1.4.8 then 1.4.9 using inert loopback downloads, reject corrupt next-release bytes, and consume version-bound 1.4.8 → 1.4.9 resume intent without executing an installer.

Browser checks used disposable fixtures: admin Quantus editing displays SRBMiner 3.7.0 and AMD/NVIDIA/Intel; the client engine form displays 3.7.0. The expanded admin form at a 390px outer viewport measured 379px content/scroll width, with no horizontal overflow. Simulated backend failure displays its outage explicitly and retains the unsaved draft. No UI layout or daily-control workflow was replaced.

Read-only production snapshot before deployment: 27 registrations, 13 connected Windows clients still on 1.4.7, five running SRBMiner Quantus GPUs reporting 3.6.7 and one running Nanominer CPU. Six stopped SRBMiner rigs retain the previously identified file/preparation errors (KAM_Z1, PGZ9, PG_GH1, PG_Z3, PG_Z6, PG_Z8); antivirus involvement remains unconfirmed. PG_Z4 and PG_Z7 were idle in this snapshot. No live command was sent.

Release and deployment results are recorded below after completion.
