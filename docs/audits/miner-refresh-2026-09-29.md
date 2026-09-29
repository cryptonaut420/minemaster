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

No miner or installer is executed during tests. This pass does not establish real Windows installation/relaunch, antivirus acceptance, driver compatibility or hashrate improvement. A published client download does not upgrade an already running miner: pre-1.4.9 clients need one installation request to adopt the new automatic policy, and custom executable paths are not replaced. No forced fleet update, repair, mining control or profile change is issued.

Initial pre-release checks passed: 98 client tests, 120 backend tests, both production builds, and official release freshness verification. Additional automatic-install/process/hardware tests were added afterward; final totals are recorded below. The real installed updater NSIS/AppImage implementations discover 1.4.8 then 1.4.9 using inert loopback downloads, reject corrupt next-release bytes, and consume version-bound 1.4.8 → 1.4.9 resume intent without executing an installer.

Browser checks used disposable fixtures: admin Quantus editing displays SRBMiner 3.7.0 and AMD/NVIDIA/Intel; the client engine form displays 3.7.0. The expanded admin form at a 390px outer viewport measured 379px content/scroll width, with no horizontal overflow. Simulated backend failure displays its outage explicitly and retains the unsaved draft. No UI layout or daily-control workflow was replaced.

Read-only production snapshot before deployment: 27 registrations, 13 connected Windows clients still on 1.4.7, five running SRBMiner Quantus GPUs reporting 3.6.7 and one running Nanominer CPU. Six stopped SRBMiner rigs retain the previously identified file/preparation errors (KAM_Z1, PGZ9, PG_GH1, PG_Z3, PG_Z6, PG_Z8); antivirus involvement remains unconfirmed. PG_Z4 and PG_Z7 were idle in this snapshot. No live command was sent.

Final release and deployment evidence follows below.


## Added automatic installation

The owner requested installation immediately after verified download, replacing the earlier explicit-only policy. The native controller now automatically enters the existing controlled stop/save/install path after both check and download settle. Manual retries remain available after failure/cancellation, and the same target is not retried automatically in a loop during that app session. Native Stop cancels preparing installation; no resume intent survives a failed/canceled handoff. The real updater feed/checksum test also exercises automatic handoff with an inert substitute and version-bound resume. This change cannot retrofit a running 1.4.7 agent: one installation of 1.4.9 is needed first.

## Complete retained production error review

A read-only database cursor reviewed all 87,608 retained error/warning records, covering September 22 16:25 UTC through September 29 13:48 UTC at capture time. There were no warning-level records. Raw logs expire after seven days and delivery is bounded/best-effort, so this is not lifetime history or proof of absent unreported errors. No live commands were sent.

- **87,484 OpenCL errors:** `GPU 1 OpenCL call error -49(106)` on PG_Z1 (29,410), PG_Z2 (28,659) and PG_Z3 (29,415), ending September 29 04:53 UTC. These belong to earlier Nanominer operation, not proof of a current SRBMiner failure. Hardware includes a generic AMD integrated adapter alongside the discrete card. The native/backend inventory incorrectly accepted `AMD Radeon(TM) Graphics` and bus `PCI` as stable mining hardware; both are corrected, with tests retaining discrete AMD/Intel cards and separate positional fallbacks. Invalid historical PCI placeholders are excluded from missing-GPU comparisons so correcting inventory cannot create a false hardware-loss alert. This does not silently choose Nanominer GPU indices. SRBMiner 3.7.0 excludes iGPUs by default upstream.
- **108 misleading startup errors:** Nanominer's normal `Never calling reboot.bat...` policy message across 18 rig records. Classification was fixed in 1.4.8; existing stored history is preserved.
- **Eight write errors:** KAM_Z1, PG_R1, PG_Z1, KamZ4, KAM_Z5. Context for the three current KAM_Z1 CPU occurrences shows a pool connection closing, a share write failing, then reconnection and accepted work/fresh rates. These are transient network/pool writes in that context, not evidence of a filesystem or Defender problem. The pool-disconnect/reconnect parser fix makes that state visible; raw error lines remain retained.
- **Six DAG allocation failures:** PG_GH1's GTX 1050 has 2 GB VRAM; the logged previous DAG required about 5.88 GB. That old workload cannot fit. Its current Quantus configuration is a different algorithm and does not validate compatibility until SRBMiner actually starts; current startup is blocked by the archive-preparation fault.
- **Two SRBMiner `0x2007` internal errors:** PG_Z4 and PG_Z7 at about September 29 13:45–13:48 UTC. Both logs then say `Restarting miner...`; PG_Z4's stream shows 3.6.7 starting again and reconnecting. Subsequent agent snapshots report these GPUs stopped/idle, with no matching admin command in that interval. The proprietary error's exact cause is unknown; no public upstream issue explanation was found. Local process-tree/driver checks are required after 3.7.0. A reproduced lifecycle gap is fixed: Node can emit parent `exit` before inherited output `close`; native diagnostics now report that unresolved state immediately and block duplicate launch, shared-file repair and update shutdown while output remains open. Synthetic tests cover delayed closure and eventual recovery; they do not prove complete Windows descendant containment.

The six current SRBMiner failures (KAM_Z1, PGZ9, PG_GH1, PG_Z3, PG_Z6, PG_Z8) retain `UNKNOWN` errors against temporary ZIP archive paths; 1.4.7 mislabeled these as executable launch failures. New stage/syscall diagnostics distinguish them. PG_Z4 additionally reports a roughly 168-second clock/receipt difference. Fourteen open incidents at capture time were disconnected agents, including old registrations; no records were deleted or acknowledged during the audit.

## Windows file blocking

Static inspection of the verified Windows SRBMiner 3.7.0, Nanominer 3.10.0 and XMRig 6.26.0 PE files found no embedded Authenticode certificate table. This does not itself establish maliciousness or a Defender decision. Signing MineMaster's wrapper would not sign those separate vendor executables. The package cleanup reduces unnecessary bundled old binaries/drivers but is not a guarantee against detection.

For a confirmed detection, use the existing exact-path diagnostic report and expected hash, inspect the matching Windows Protection History entry, then use the vendor/Microsoft review process for a suspected incorrect classification. On managed devices, the administrator can assess a narrowly scoped approved file/certificate policy after verifying the file; MineMaster does not alter antivirus settings, restore quarantined files repeatedly or rename binaries to evade detection. Microsoft explicitly includes cryptomining in enterprise PUA criteria, so a detection may reflect policy rather than a false positive. No file was submitted externally in this pass.

Sources: [Microsoft software developer FAQ](https://learn.microsoft.com/en-us/defender-xdr/developer-faq), [classification criteria](https://learn.microsoft.com/en-us/defender-xdr/criteria), [false-positive handling](https://learn.microsoft.com/en-us/defender-endpoint/defender-endpoint-false-positives-negatives).


Final browser checks also confirm the client shows a failed automatic install with a visible retry action, and the admin explains automatic installation versus the one-time migration needed by older clients. Fixtures use inert callbacks; no installer or miner ran.


## Additional pre-rollout pass

Publication was held at an unpublished draft when the owner requested another pass; no fleet installation command was sent. An additional diagnostic gap was fixed: explicit Windows checks now include at most two recently failed paths inside the selected engine's managed directory for 30 minutes in the current app session. This covers the temporary ZIP paths seen in production; cleanup can remove the file without removing its historical Defender record. Exact `containerfile:` archive records are recognized, and the checked path list is retained through native status, WebSocket, REST, desktop and admin views. Paths outside the engine directory are excluded; passive telemetry performs no Defender query. Tests cover scope, expiry, no implicit query, and API field preservation. Real PowerShell/Defender execution still requires a Windows machine.

No archive obfuscation, hardcoded-password encryption, filename camouflage or protection changes were introduced. Transparent, verified packaging and an operator's exact-file policy/review remain the approach.


The extra pass passed 107 client tests and 121 backend tests, with both production builds successful. The desktop fixture shows the exact executable/archive path list and preserves the caution that unavailable/no-match history does not establish permission. Automated tests cover scope/expiry and HTTP/WebSocket preservation. No real miner, installer or Windows PowerShell probe was executed.


## Final deployment and publication

Source `e62af57` is committed/pushed to master and deployed on tsqr. The running backend container is `4fb3b6c72b8379485d432c7a339925afe1818346c3c6e1bf6100e0e8820d57ce`. Rollback images preserve the preceding deployed code (`minemaster:before-1.4.9-final`) and the original 1.4.8 deployment (`minemaster:before-1.4.9`). Public readiness reports database/index readiness; authenticated health reports healthy monitoring with zero failed rigs. All 13 previously connected agents reconnected, with five GPU and one CPU processes still running and no before/after changes to mining enablement, engine, algorithm or desired/applied config versions. Six archive-preparation failures and 14 disconnected registrations remain; no repair, start/stop or update-install commands were issued.

[Client 1.4.9](https://github.com/cryptonaut420/minemaster/releases/tag/v1.4.9) was published on September 29 at 16:46:52 UTC from `e62af57`. The complete pipeline reran **107 client tests and 121 backend tests**, both web builds, current-upstream checks, packaged miner allowlist/hash checks and update-feed checks. All seven uploaded asset digests/sizes were verified before publication. Both public latest feeds exactly match the locally verified 1.4.9 feeds. Windows/Linux packaged native sources, manifests/catalogs and renderer provenance (`1.4.9+103.e62af57`) match the committed source.

The owner requested a further pass before fleet rollout; it was completed before publication. **Fleet installation remains on hold.** Existing connected clients report 1.4.7 and require one installation request before they adopt 1.4.9's automatic-install behavior. Publication alone does not change their running code. Real Windows install/relaunch, PowerShell/Defender behavior, driver compatibility and miner performance were not exercised; automated tests use inert files and fake processes.
