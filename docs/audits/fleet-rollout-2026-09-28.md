# Fleet rollout — September 28, 2026 (America/Vancouver)

## Shipped

- Client **1.4.7**, source `e3e8461`, reported build `1.4.7+94.e3e8461`. Windows installer/portable and Linux AppImage, both updater feeds, Windows blockmap and SHA256SUMS were verified locally and uploaded to a verified GitHub draft before publication. Release: [v1.4.7](https://github.com/cryptonaut420/minemaster/releases/tag/v1.4.7).
- Production backend/admin deployed on tsqr using its normal Docker deployment. Rollback image retained as `minemaster:before-1.4.7`. Profile cards show engine, algorithm, pool and wallet directly; fleet activation uses an explicit confirmation. Online running miners switch, paused miners stay paused, offline rigs retain an immutable approved assignment for reconnect. No fleet coin cutover was performed during verification.
- Dashboard **Client updates** checks every bound rig regardless of filters/pages, separates download from install, pins the requested release, and confirms current versions from connected client reports. A newer installed version cannot be mistaken for an outdated version when the release cache lags. Installation handoffs that remain active are distinguished from disconnected rigs.
- Daily GPU/CPU profitability review now runs inside the backend at 09:00 America/Vancouver. The first production review completed and Discord confirmed delivery. Subsequent deployments retained its completion marker without duplicate sends. It uses C$0.13/kWh; benchmark estimates exclude additional miner/pool fees and show coverage gaps. No automatic coin switching or Codex automation is enabled. See [monitor documentation](../profitability-monitor.md).

## Actual update outcome

The initial online target set contained **18 rigs: 17 Windows and the local Linux test client**. The local unpacked test client was replaced with the released AppImage and reports automatic updates supported.

**Confirmed on 1.4.7: 13 Windows rigs plus the local Linux client (14 total).** KAM_Z1 and KAM_Z6 first installed their staged 1.4.6 update, then 1.4.7. The remaining confirmed Windows rigs are PGZ9, PG_GH1, PG_R1, PG_R2, PG_Z1, PG_Z3, PG_Z4, PG_Z5, PG_Z6, PG_Z7 and PG_Z8. Running GPUs resumed after these installations; PG_GH1 still has no usable hashrate, a pre-existing problem.

**Unconfirmed/disconnected: KAM_Z2, KAM_Z3, KamZ4 and KAM_Z5.** Z2/Z3/Z4 acknowledged installer handoff for 1.4.7; Z5 acknowledged its staged intermediate 1.4.6 installer. They did not reconnect during the observed rollout. This is not proof of installation or proof that a particular antivirus blocked it. Inspecting the installer/app on those PCs needs local or independent remote-desktop access; the disconnected MineMaster agent cannot receive another command. Do not blindly replay installation commands.

A backend redeployment prematurely converted those four handoffs to outcome-unknown timeouts. The backend now preserves an acknowledged installer handoff across restart until its original deadline, without replay; a matching new registration remains mandatory. The existing terminal records were preserved, not rewritten as successful. Other commands retain the existing restart/unknown behavior, and expired/canceled installs remain terminal.

## Kamloops CPU investigation

Read-only miner diagnostics completed on all six initially connected Kamloops rigs. KAM_Z5/Z6 are missing the managed XMRig executable. Z1/Z2/Z3/Z4 have the expected upstream hash; their previous CPU runs exited with code 0 after successful RandomX initialization, without a clear fatal log message. The bounded exact-path Defender history queries returned no matching detections. That neither proves an antivirus cause nor rules out other policy/security software. The “huge pages unavailable” line does not establish the cause of exit.

GPU mining continued while these CPU processes were stopped. Compact admin warnings now identify CPU/GPU scope when known. KamZ4 separately reported 89°C GPU temperature before installation. CPU-engine switching was offered as an explicit operational choice; no automatic engine switch, quarantine-repair loop or antivirus changes were performed.

## Validation and limits

117 backend regressions, 85 client regressions and the admin build passed. Added coverage includes pinned update versions, numeric release comparison, installer handoff through backend restart, ordinary/expired command outcomes, profile activation snapshots/offline delivery, CPU isolation, Stop supersession, and profitability schedule/provider/Discord behavior. Browser fixtures covered profile activation, toasts, explicit failures and a measured 390px viewport. Production API/readiness and release metadata were verified; the production browser session requested login, so its authenticated UI was not claimed as browser-verified.

The owner-authorized Linux RTX 3060 Ti tests confirmed Quantus approximately 218–228 MH/s and Pearl approximately 54–55 TH/s with accepted shares. Stock power was about 199W GPU-only. These are brief samples, not optimized profitability or Windows hardware benchmarks. Pool-side Pearl worker attribution remains generic in the observed sample. Wallet queries worked and reported zero received balance at the final check; pool unpaid earnings are separate. See [coin rollout notes](../quantus-pearl-rollout.md).
