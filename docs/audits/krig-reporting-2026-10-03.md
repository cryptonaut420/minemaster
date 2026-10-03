# KRig reporting follow-up — October 3, 2026

## Live evidence

At 18:08 UTC, AAGZ-PG-FrontDesk remained connected on client 1.4.16. KRig 1.5.6 had run for approximately 24 minutes with a fresh 18,343,105 H/s API sample and 2 accepted / 0 rejected shares. Its independently collected console totals reported about 18.1–18.4 MH/s and the same counters. CPU Nanominer remained running at about 728 H/s. This validates rate units, accepted-share propagation, independent CPU/GPU state and current reporting on the GTX 1060 6GB; it does not establish overnight stability or future antivirus behavior.

The owner recalls about 18 MH/s on SRBMiner too. The available overnight SRBMiner logs show approximately 35–37 MH/s (initially up to 41 MH/s), while this KRig session reports about 18 MH/s. In the checked overnight window, 23 raw GPU samples exactly matched native log totals; history reported one contributing GPU process with roughly the same weighted rates, not twice the input. No MineMaster double counting was found in those samples. The earlier 18 MH/s observation remains unreconciled pending its time/context; these sessions do not establish an engine performance comparison. No fleet engine switch or hardware tuning was performed.

Production had four connected rigs during the read. KAM_Z1 retained archive/file-repair errors; KAM_Z3 and KAM_Z6 were stopped. No repair/start/stop commands were issued to those rigs. The production host's earlier high load had fallen, and read access recovered. The backend checkout contained the 1.4.17 source, but the running container still lacked its SSL validator; deployment had not completed.

## Findings and fixes

1. **Pool connection details missing for KRig.** Real `connected:` lines did not match the generic parser, so the admin showed no pool event despite mining. Added the exact KRig connection/disconnection format and startup version, preserving native observation time. Generic job messages do not invent connection endpoints.
2. **Incorrect native log severity.** KRig `fail:` startup messages without the words error/failed/fatal were classified as information. Explicit structured levels now map correctly; polling failures are warnings. Log data remains separate from API rate/share totals.
3. **Clock correction can permanently suppress API samples.** The API uptime check compared monotonic miner uptime with wall-clock elapsed time. A backward clock step made every subsequent result appear older than the owned process. Reproduced with a five-minute step; run age and warning throttling now use a monotonic clock. Frozen and foreign-run responses remain rejected, and original UTC timestamps remain unchanged. Backend reconciliation also stops a pre-correction future sample from pinning an older rate over fresh valid reports; genuinely delayed reports still retain the newer valid observation.
4. **Share counts lacked visible age.** Retained counters could look current after API loss or disconnect. Backend read models now compute share quality; desktop/admin display observation time and current/last-reported status. Missing, future and previous-run samples stay unavailable; original values are retained. Pool status is explicitly a last observed event.

## Validation and limits

149 client tests and 145 backend tests passed. New behavioral cases cover actual KRig log formats, severity, clock corrections in both directions, frozen/foreign uptime, original timestamps, desktop/API share-quality agreement, offline/paused/stale/invalid counters, and bounded clock tolerance. Existing fake-process lifecycle, update, command, access-boundary and disposable-database regressions passed. No mining executable was run by automated tests.

All four pinned miner versions matched official latest stable releases at the release check: KRig 1.5.6, SRBMiner 3.7.1, Nanominer 3.10.0 and XMRig 6.26.0. No miner binary upgrade is needed in this pass. Populated loopback UI fixtures passed current/stale share display, pool endpoint/time display, independent GPU Stop, backend outage feedback and measured 390px layout checks. Desktop and narrow screenshots were inspected. Both production builds passed. Packaging/publication and production deployment checks are recorded below when completed.

## Release and production verification

Published **1.4.18** as latest stable from client commit `ba0bb06` (display `1.4.18+128.ba0bb06`). Windows/Linux packaged runtime files matched the pinned manifests; native monitoring code and compiled renderer bytes matched the tested build. All seven uploaded assets matched local SHA-256 hashes/sizes before publication, and both public updater feeds were confirmed at 1.4.18. No miner executable or installer was executed in automated verification.

Backend commit `54ab8dc` deployed successfully on tsqr, including the additional future-sample reconciliation fix and the previously undeployed SSL validation. Deployment exit code was zero; the new container was `7fff65e862b188bded867eb648bac2e0fa7cfb52d311c5d11036b708d2a46179`. Public readiness confirmed database/index health, and the running container was checked for the clock fix and KRig's 60-second freshness metadata.

Continuing the authorized FrontDesk pilot, update-check command `618ad1f7-16c0-4e9c-87bc-4e948ad5a280` triggered normal automatic download/install. FrontDesk re-registered as 1.4.18 at 18:26 UTC and automatically resumed both CPU Nanominer and GPU KRig. At 18:27 UTC the GPU reported 18,703,221 H/s, and its console independently showed 18.70 MH/s. The previously missing pool event now correctly reported `stratum+ssl://qtc-us.kryptex.network:8049` with its original observation time. Both processes had no active error. Share counters reset to valid zero for the new runs; the preceding KRig run had reached 4 accepted / 0 rejected at 18:23 UTC. No manual start was used to hide an update-resume failure.

Global mining profiles and other rig engine assignments were not changed. KAM_Z1's previously reported miner-file/repair problems remain a separate operational issue. No OS protection changes, automatic quarantine restoration, clock changes or hardware tuning were performed. Sustained overnight behavior remains unverified.
