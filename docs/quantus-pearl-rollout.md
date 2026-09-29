# Quantus and Pearl readiness — September 28, 2026

## Implemented in this pass

- Saved coin profiles in the admin and authenticated REST API: complete managed settings, CPU/GPU separation, draft loading, unsaved-change confirmation, version-checked replacement/deletion and action toasts. See [API contract](backend-admin.md#configurations-and-rollout).
- Local Linux payout wallets created with the official Quantus CLI 2.3.0 (ML-DSA-87) and Oyster 1.4.8 mainnet wallet. Archives matched GitHub's SHA-256 digests. Recovery material and passwords remain in the owner's home directory, outside this repository. Quantus recovery export successfully unlocked the encrypted wallet. Oyster validated its address as owned. Its TLS RPC listens on loopback; the user service uses SPV. A consistent database backup was taken while Oyster was stopped, then it was restarted. No spending transaction was submitted.
- No mining binary was executed during software validation. No client engine version was changed in this pass.

## Engine and pool compatibility

Both GPU algorithms already exist in the pinned SRBMiner 3.6.7 catalog and Windows/Linux x64 launch adapter: Quantus uses `quantus`; Pearl uses `pearlhash`. Both catalog entries carry a 2% miner fee. Existing Nanominer/XMRig integrations do not support these algorithms. Source: [SRBMiner releases](https://github.com/doktor83/SRBMiner-Multi/releases).

Use a compatible Stratum pool first. [Kryptex Quantus](https://pool.kryptex.com/qtc) explicitly publishes the SRBMiner `quantus` command. North America: `qtc-us.kryptex.network:7049`, global backup `qtc.kryptex.network:7049`, normal PROP pool fee 2%, minimum payout 0.1 QTC. Use the ordinary receiving address, not a solo wormhole reward hash. QUANTUS on WhatToMine and QTC in the wallet/pool refer to this same project.

[Kryptex Pearl](https://pool.kryptex.com/prl) publishes the SRBMiner `pearlhash` command. North America: `prl-us.kryptex.network:7048`, global backup `prl.kryptex.network:7048`, normal PPS+ pool fee 2%, minimum payout 1 PRL. Both pools also publish TLS ports 8049/8048 respectively. Initial saved profiles use the TCP configuration explicitly shown in the SRBMiner instructions. Pool fees/endpoints were cross-checked against the public pool info API on this date.

Kryptex's Pearl page warns that old miners submit invalid shares following its algorithm change. [SRBMiner 3.5.3](https://github.com/doktor83/SRBMiner-Multi/releases/tag/3.5.3) includes a mandatory Pearl hard-fork update; bundled 3.6.7 is newer. This is source compatibility evidence, not proof of accepted shares on our hardware. SRBMiner also warns about a further proposed Pearl change that could reduce consumer GPU competitiveness; no activation date was verified here.

SRBMiner's newer 3.6.9 has Pearl efficiency improvements and Quantus improvements. 3.7.0 was released on the research date and changes displayed hashrate statistics. Do not bump the pin solely on a benchmark claim: check output parsing and installer manifests before publishing an updated client. Existing integration lacks Quantus QUIC certificate-pin configuration, so QUIC/solo-node connections are not interchangeable with the Stratum profiles above.

The RTX 3060 Ti path is documented. Do not treat AMD/NVIDIA catalog labels as universal architecture support. The live inventory includes GTX 1050/1080/1080 Ti, an offline RX 580, and older/offline client installations. [Krig](https://github.com/kryptex/krig-miner) documents Quantus on GTX 1080 and GTX 1660 and a 0% miner fee; [PeakMiner](https://github.com/peakminer/peakminer) documents Quantus on Pascal/GTX 10xx. Neither is integrated into MineMaster. Keep incompatible/unverified models on their existing profile until a measured alternative is ready.

## Controlled cutover procedure

1. Keep the current RVN pool, wallet and managed configuration as a named fallback; preserve CPU settings independently.
2. Confirm the owner has copied wallet recovery material to an offline backup. Receiving does not require either wallet to stay open.
3. Start the operational rollout with one connected RTX 3060 Ti, preferably PG_Z7 (last observed 1.4.5). Use the existing GPU-only config-delivery/restart workflow. A newer Stop remains authoritative.
4. Inspect the command's actual result, reported launch engine/algorithm/config version, fresh hashrate/power/temperature, logs and pool-side worker accepted shares. A successful process launch alone does not establish profitable mining. Worker attribution through SRBMiner's worker option also needs pool-side confirmation.
5. Collect a representative interval, compare pool payout estimates with observed power, and expand by compatible GPU model. Preserve stopped rigs and CPU state. Offline rigs cannot be remotely upgraded or confirmed until they reconnect.
6. If launch/shares/telemetry fail, explicitly load and deliver the saved RVN profile. Do not repeatedly restart a failing miner or auto-change antivirus settings.

At the initial inventory read, connected machines were principally 1.4.5, with KAM_Z1/KAM_Z6 still 1.4.3. Client update availability is not evidence that it installed. A backend deploy alone does not upgrade these machines.

## Profitability monitoring: design, not an enabled feature

Owner electricity assumption: **C$0.13/kWh**. Continuous 100 W costs C$0.312/day. Measure wall power where possible: GPU telemetry alone excludes CPU/system/PSU consumption. Today's user-supplied US$2.24/day QTC and US$1.55/day PRL quotes are calculator snapshots, not measured fleet income or guaranteed net profit.

[WhatToMine API](https://whattomine.com/api-docs) offers coin statistics, GPU algorithm benchmarks and calculations; authentication requires an API token, with plan-based monthly request limits. The [Kryptex public API](https://pool.kryptex.com/api) supplies pool/network stats and wallet/worker payout data. Its QTC `estimated_profit_day` was null during research; never turn missing estimates into zero profit or invent a conversion. The unit/fee semantics of provider estimates must be confirmed before integrating them.

The useful first version is recommendations plus explicit profile switching: store per-rig/per-engine/per-algorithm measured H/s, watts, sample period, rejection rate and observation time; display current/24-hour estimates and coverage. Convert USD revenue using a timestamped USD/CAD rate; deduct known miner/pool fees once, electricity and measured downtime. Rates for KawPow cannot be reused as Quantus/Pearl benchmarks. Keep algorithm totals separate.

Automatic switching should be explicitly opt-in per group with an approved profile allowlist, valid payout addresses, current price/difficulty data, a minimum sustained net advantage, minimum runtime/cooldown, switch frequency limit and staged rollback. Stale data should hold the current assignment, and Stop must cancel pending changes. Do not enable automated trading, exchange withdrawals or blind calculator-driven restarts.

Solo mining is possible, but requires measured algorithm hashrate and network difficulty to estimate variance. Pool mining is the initial recommendation for steadier payout cadence. Expected blocks/day = fleet algorithm H/s ÷ network H/s × 86400 ÷ block interval; use contemporaneous inputs, not RVN rates.

## Validation

106 backend regressions and 83 client regressions pass. Admin production build passes. Disposable browser checks cover save/load, unsaved-edit confirmation, CPU/GPU separation, toasts and visible server failure, including a measured 390 px viewport without horizontal overflow. No hardware mining or pool share acceptance was verified in this implementation pass. Deployment/profile-seeding status is recorded separately after completion.


## Deployment and preparation result

Admin/API commit `3268aa3` was pushed to master and deployed on tsqr through the normal Docker deployment. Public readiness reports the database and indexes ready. The rollback image is `minemaster:before-3268aa3`.

Created three live GPU profiles through the authenticated REST API: **Ravencoin · Original configuration**, **Quantus · Kryptex North America**, and **Pearl · Kryptex North America**. Both new profiles contain the owner's newly created local-wallet receiving address and a global backup pool. Verified global desired configurations stayed byte-for-byte unchanged during profile creation. No rig mining/update commands were issued and no new client release was published. Fleet cutover, hardware measurements, pool-side accepted shares and profitability automation remain the next stage.

Local wallet handoff instructions are in the owner's private `~/.local/share/minemaster-wallets/README.md`, alongside `receiving-addresses.json`. Private recovery material is not part of this repository or deployment.

## Local hardware validation and direct switching follow-up

The owner authorized a real production-connected test on the local Linux RTX 3060 Ti. The client is built as an unpacked application for this test; no new fleet client release is implied. Direct saved-profile delivery is now available without changing global defaults: select a profile, **Use for selected rigs**, choose targets, then deliver. Stopped processes stay stopped unless explicitly started separately.

`tools/minemaster-wallets` is a read-only convenience command installed locally as `~/.local/bin/minemaster-wallets`. It queries the official Quantus mainnet endpoint and the local Oyster wallet RPC, displays receiving addresses and pool links, and distinguishes query failure from zero. Confirmed both initial balances are zero. Quantus CLI 2.3.0 warns about a newer runtime (153 versus tested 149); balance reads worked, but spending compatibility has not been verified. Pearl's wallet runs as the user service `minemaster-pearl-wallet`. Pool unpaid earnings are separate from received wallet funds.

Direct-delivery validation: 107 backend regressions pass, including access, missing/stale profile versions, per-rig GPU assignment/CPU isolation, immutable snapshots, idempotent retries, Stop cancellation and reconnect retention. Admin build and populated browser profile delivery/toast checks pass.
