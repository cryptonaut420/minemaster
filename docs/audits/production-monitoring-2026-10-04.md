# Production monitoring follow-up — October 4, 2026 UTC

## Production evidence

Read-only production inspection began at 06:42 UTC (October 3, 23:42 Vancouver). Sixteen of 23 rigs were connected, all reporting client 1.4.18. Ten GPUs had current Quantus readings totaling approximately 1.85 GH/s; the summary explicitly retained missing/offline observations as partial coverage. The monitoring sweep was healthy with zero failed rig checks. No backend container errors appeared in the bounded preceding 30-minute log read.

- AAGZ-PG-FrontDesk remained on the same KRig launch from 18:39 UTC, about 12 hours earlier, reporting roughly 17.5 MH/s and 46 accepted / 0 rejected GPU shares.
- KAM_Z4 reported an unexpected KRig exit with code 0 at 02:16 UTC while Nanominer CPU continued. The last console total was 234.71 MH/s at 83°C. A monitoring event recorded the 85°C threshold around the exit; stored 30-second sensors showed cooling afterward. Neither the exit code nor these observations establish the cause. No automatic restart or protection change was attempted.
- PG_GH1, PG_Z3, PG_Z6 and PG_Z8 had stopped GPUs before their upgrade/profile delivery. Command results explicitly recorded `Process was not running`; they were not silently stopped by the conditional profile restart. PG_Z2 had an explicit successful whole-rig Stop before its update, which remained respected. Fleet state can change while the owner operates the admin.
- Nanominer CPU logs included SupportXMR saturation/shutdown messages, stale job IDs and intermittent write failures. The sampled context showed reconnects to SupportXMR and later fresh rates/accepted work; these logs are not evidence of local file deletion.

## Repairs

1. **Stopped errors missing from incidents.** A single terminal failure appeared on the rig row but fell outside running-only repeated-log and crash-loop rules. Added `miner_failure`, default enabled, for stopped enabled processes reporting an error in fresh telemetry. Paused/recovering/disabled/stale/offline cases are excluded. Existing maintenance suppression, incident resolution and full process diagnostics remain intact. No automatic recovery is authorized by this rule.
2. **Conditional delivery invented running intent.** `restartRunningOnly` commands wrote desired `running` even when the client correctly skipped a stopped process. Conditional delivery now preserves existing intent, including whole-rig and scope-specific Stop records. Explicit Play/Pause still updates intent normally. Historical intent records are not rewritten from ambiguous observations.
3. **CPU-only profile fallback overwritten.** The profile-command builder overwrote its caller's `config-update` override with `restart`, causing GPU-profile delivery on CPU-only inventory to fail hardware validation. The builder now honors that explicit fallback.
4. **Partial activity looked like full activity.** The shared rig reason identifies CPU mining with GPU stopped (or the reverse), while keeping stopped, disabled, paused, missing hardware and errors distinct. Mining status/counts and hash totals are unchanged.

## Validation

149 backend tests passed, including disposable-database command/activation and persistent-incident regressions. New cases cover preserved ALL/CPU/GPU intent, explicit starts, CPU-only activation, incident lifecycle/maintenance, disabled/paused/recovering and stale observations, and partial-mining descriptions. The first run reproduced the intent and missing-incident failures before the fixes. The admin production build passed. No client source, mining binary, installer, miner setting, or production mining command was changed in this pass.

Browser checks passed persistent failure incidents, the new rule toggle, CPU-mining/GPU-stopped display, backend outage feedback and a measured 390px viewport without horizontal overflow or page errors. The narrow monitoring screenshot was inspected. Only simulated commands were sent to the disposable loopback fixture.

Production deployment verification is recorded below after completion.
