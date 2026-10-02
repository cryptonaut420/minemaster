# Monitor sweep and updater ownership audit — October 2

## Reproduced and repaired

1. **Premature or delayed chart history expiry.** The periodic monitor compared original client observations with server time and used a fixed 60-second trigger. A rig three minutes behind could accrue its full hold before that time elapsed; a later Stop could not remove the watermark-protected excess. SRBMiner was also swept before its 120-second freshness interval ended. Ahead-clock rigs could miss timely final interval closure. Sweeps now compare in the last validated bounded report clock, including after disconnect, and close only expired observations at their exact engine-specific limit. This history-only offset does not refresh live telemetry or sensors. No original timestamp is rewritten.
2. **Missing-timestamp history transitions.** A status report that lost its observation timestamp used server time to finish its previous interval. The history writer now accepts the normalized report-time boundary from the status path. Stop, pause, missing-sample and removed-process transitions are exercised after a real monitor sweep through disposable WebSocket/database fixtures, for clocks three minutes ahead and behind. Each closes exactly its final 20 seconds, retains a single original raw sample and inserts no synthetic zero.
3. **Canceled install/check overlap.** Cancellation made the visible update state downloaded while asynchronous shutdown preparation still owned the install attempt. A new check could start upstream work during that cleanup. Checks now honor attempt ownership until preparation settles; canceled attempts return failure and remain explicit-retry only.
4. **Download outliving updater cleanup.** Cleanup during a pending check had no transfer to cancel yet. Its late result could create a new download watchdog after cleanup. Late transfers are now canceled immediately, their rejections are observed and no watchdog is scheduled. The closed check returns failure.

The monitor regression and both updater race regressions failed on the pre-fix source and passed after repair. Full suites passed: **131 client tests and 141 backend tests**. Backend tests use disposable MongoDB; updater tests use fake handoffs/inert files. The two suites share some native cases, so these are not counts of unique independent scenarios. No miner or installer was executed.

## Production observations and limits

The read-only snapshot during this pass contained 18 online rigs. Six were on 1.4.12, seven on 1.4.11 and five on older clients. Existing missing SRBMiner files, PG_R1's incomplete process closure and old XMRig CPU errors remain unresolved hardware/runtime checks. Backend monitoring reported healthy with zero failed rig checks. The new client is not claimed to repair those issues, and a rig's aggregate mining state does not prove its GPU is running.

No live mining, repair or forced-install command was sent. Existing chart buckets are not rewritten because original missing timing evidence cannot be recovered reliably. Real Windows update/relaunch and policy/driver/cooling checks remain on the [visit checklist](site-visit-2026-10-02.md). No UI controls, routes, access boundaries or protocol fields changed in this pass.

Release/deployment evidence will be recorded after the verified pipeline completes.
