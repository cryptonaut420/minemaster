# MineMaster daily profitability review

MineMaster's backend owns this scheduled job. It runs in the production Docker process, once each local day after **09:00 America/Vancouver**, with a one-minute scheduling tick and daylight-saving handling. A missed check runs after the server comes back that day. It needs no Codex/ChatGPT app, local desktop, or external cron. The mistakenly created Codex schedule was deleted.

## Configuration and operation

Set `PROFITABILITY_DISCORD_WEBHOOK` in the server's private `.env` and redeploy. The secret is not committed, returned by the API, or shown in the admin. Unset it to disable checks. MongoDB stores the latest result, daily completion marker, delivery receipt/error and a bounded job lease in `scheduledJobs`. Server restarts do not resend a completed day's alert. An uncertain Discord delivery is recorded without a blind automatic retry. There is no mining-control code in the job.

The Configurations page shows schedule, latest comparisons, coverage gaps and Discord delivery status. **Check profitability now** requests an additional manual review. Read-only API keys may read `GET /api/v1/profitability`; manage access is required for `POST /api/v1/profitability/check` (202 requested, 409 already running, 422 webhook missing). Missing database readiness remains a failure, never a successful empty report.

## Data and interpretation

- Source: public **Hashrate.no** GPU and CPU model pages, parsed once per distinct model, using **24-hour revenue in USD** and benchmark watts. A separately supplied WhatToMine/API key is not required. [Hashrate.no's structured API](https://hashrate.no/c/api) requires an account/API key; it is not used here.
- Currency: dated **Bank of Canada USD/CAD** daily observation, rejected if over seven days old. This accommodates weekends/holidays; the quote date is visible.
- Electricity: **C$0.13/kWh**. Daily estimate = provider 24h USD revenue × USD/CAD − device watts/1000 × 24 × C$0.13. Estimates are **before additional miner/pool fees**, and device power excludes the rest of the rig. They are screening estimates, not measured income or guaranteed net profit. The source does not supply a per-row observation timestamp; MineMaster records fetch time and rejects explicitly old HTTP cache responses.
- Compares fresh, running, unpaused processes' **actual launch coin/algorithm**, not global defaults. CPU and GPU are separate. Stopped/offline/stale rigs do not count as currently mining. Exact catalog model matching preserves Ti, mobile and GDDR6X differences. Unknown models/current coins become explicit coverage gaps; another model's numbers are never substituted.
- Quantus is QTC in its wallet/Kryptex, QUANTUS on WhatToMine and QUAN at Hashrate.no. **Hashrate.no QTC means Qubitcoin**, a different coin. Identity includes the algorithm.
- An alert requires a different coin with a positive electricity-adjusted estimate and improvement of at least **C$0.10/device/day and 10%**. Discord groups opportunities by model/current coin and reports up to five; all results remain in the admin/API. Saved-profile availability is shown; model/driver compatibility still needs a controlled test. No profile is applied automatically.
- A review also alerts on failed providers or missing coverage. Quiet complete reviews with no qualifying difference do not post an “all good” message. Fetches are bounded to 20 seconds/8 MiB each and 60 distinct model pages per run; each model is fetched once, sequentially, to limit provider load. HTML layout/currency validation failures are reported rather than guessed as zeros.

## Validation

Behavioral tests cover exact model and coin identity, 24-hour versus current revenue, currency/electricity math, missing/stale data, DST dates, daily deduplication, overlapping invocations, persistence, Discord failure/no blind retries, secret omission, and read/manage/revoked-key boundaries. Automated tests use a disposable database and fake Discord transport. Production readiness and first live scheduled-job result are recorded in the rollout notes after deployment.
