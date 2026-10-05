# Fleet command and update controls — October 4, 2026

## Findings and changes

- The update overview previously queried only active installation commands. It omitted pending checks, competing mining controls, and terminal results. It now returns a bounded summary of the latest retained update attempt per rig and its pending control, excluding configuration/result payloads. Failures and timeouts remain visible after a browser refresh. Installation and check outcomes remain distinct.
- Ready/download-in-progress rigs could be offered another check; installations awaiting acknowledgement could still appear installable. Fresh download progress and pending controls now prevent duplicate update actions. Stale progress is explicitly unconfirmed; stale downloads cannot be installed. Commands awaiting expiry reconciliation remain blocked until reconciled.
- The panel now offers individual check/download and confirmed installation alongside fleet controls, download percentages, pending command deadlines, persistent dated outcomes, terminal-result toasts, and an Activity shortcut. The reviewed release is captured at confirmation and revalidated before dispatch. Fleet requests are bounded to eight rigs, use separate idempotency keys and a longer HTTP timeout, and retain partial/uncertain outcomes without automatic retries.
- A current-version badge previously hid an updater error. Version and updater health now remain separate: a current rig can expose a dated, expandable updater error and explicitly retry its check.
- The shared API provides the same status/readiness/history information for remote fleet management. Existing management access and command execution/confirmation rules are unchanged.

## Production observations

The initial read-only snapshot returned 11 online rigs, all on client 1.4.18. KAM_Z4 reported a GitHub HTTP 500 fetching the release feed at 23:15 UTC October 4. This is a failed release check, not evidence of an incomplete installation or a mining-process failure. No live miner starts/stops, repairs, or update commands were issued for verification.

## Validation

153 backend tests passed, including overlapping controls, downloading/stale/offline distinctions, latest retained command selection, safe field projection, current-version check failure/retry, database failure propagation, and read-only/expired/revoked API-key access boundaries. The admin production build passed. Disposable browser checks covered individual check and installation requests, successful check results and failed-check toasts, persistent failed installation results, download progress, current-version updater errors and a visually inspected 390px layout, the Activity shortcut, and disabled controls during a simulated backend outage. Fixture update failures and release metadata are deterministic and never execute an installer or miner.

No client source, engine binaries or installer behavior changed. Existing client 1.4.18 remains the stable release. Windows installation, recovery from external quarantine, and overnight hardware stability are not established by these synthetic tests.

## Deployment verification

Pushed implementation `d584ec8` to master and deployed via tsqr's project deployment script (exit 0). Container `4e3365ca86387af4eb5b4e8e3c776e48dea2d0e76eabd09c82ee7d4d551a7b91` contains the new service and built admin controls. Public health returned ready for database and indexes. The live release API returned HTTP 200 with the new fields on all 21 bound rigs; all 10 connected rigs reported 1.4.18 at that snapshot. PG_Z2's successful installation is retained in the panel's last attempt. KAM_Z4's subsequent check at 00:14:58 UTC October 5 had cleared its earlier GitHub error; it reported updater state idle and current client version. No live command was used to produce that recovery.
