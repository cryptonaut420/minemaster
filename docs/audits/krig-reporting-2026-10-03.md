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
