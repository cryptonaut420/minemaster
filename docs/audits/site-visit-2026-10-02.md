# October 2 rig visit checklist

Use the live admin to confirm each machine's current state before acting. This list is based on the October 2 audit, not a guarantee that a fault is still present.

## Collect before changing anything

1. Match the rig name and client version with the admin. Note whether CPU and GPU are running separately, the selected engine, and the exact error.
2. In MineMaster, open **Diagnostic logs**. Preserve `client.log` and `client.log.previous` before restarting/reinstalling. From client 1.4.13, native start/parent-exit/Stop records include process/run IDs. Process logs are separate from these bounded application logs.
3. Use **Check miner files**, then **Copy diagnostic report** for the affected slot. On Windows this reads bounded history for the displayed exact paths. Save the path, error code, signature/history result and time. No matching Defender history is not proof that Windows permits execution.
4. Record GPU model, driver version, temperature and current workload. The admin's GPU power is sensor power, not whole-machine wall power. Do not treat an aggregate hashrate as proof that every GPU is working.

## Priority checks

- **KamZ4:** investigate the reported 90°C temperature and cooling. Check fans, airflow and actual sensor readings before extended load testing.
- **PG_Z2:** repeated `GPU 1 OpenCL call error -49(106)` while Nanominer reports aggregate KawPow work. Capture the exact console context and driver/device information. Miner index 1 is not guaranteed to equal admin array position 1; identify the physical card before changing anything.
- **PG_R1:** uncertain surviving-process state (`PROCESS_EXIT_PENDING`). Use Pause/Stop and verify its result; do not launch another copy while Stop remains unconfirmed. If cleanup fails, preserve logs and inspect the exact executable path/command line locally. MineMaster deliberately does not terminate unrelated programs by name.
- **KAM_Z1, PGZ9, PG_GH1, PG_Z3, PG_Z6, PG_Z8:** reported missing bundled SRBMiner files. Check the exact file path and Windows Security history. Resolve the device-policy/file availability issue deliberately before an explicit Repair. Stop every process sharing that engine first; Repair does not start mining. Do not disable protection or set broad exclusions as a troubleshooting shortcut.
- **KAM_Z2, KAM_Z3, KAM_Z5, KamZ4, PG_Z2:** older clients at the audit. Check whether they have since upgraded. Older than 1.4.9 requires an explicit installation to adopt automatic installation. Confirm the new version after relaunch, then separately confirm intended CPU/GPU state and fresh hashrate.

## After each repair

Verify the expected client and engine versions, intended profile, fresh algorithm-specific rate, and observed pool/share progress. Keep CPU/GPU control independent. Check for recurring errors and temperatures over several reporting intervals; SRBMiner aggregate output can be roughly 90 seconds apart. Record what actually changed and the result. A successful installer or file check alone does not prove mining is healthy.

No fleet repair, mining or forced-update command was issued while preparing this checklist. See [production audit](stability-2026-10-02.md) and [logging/history follow-up](logging-history-2026-10-02.md).

Later preparation snapshot: five online rigs had naturally reached 1.4.12, eight were still on 1.4.11 and five on older clients. KAM_Z1, PGZ9 and PG_Z8 no longer reported the prior file error after upgrading, but their SRBMiner GPU process was still stopped. Treat that as unverified GPU operation, not a confirmed file repair. KAM_Z1's mining status in this snapshot came from CPU mining.
