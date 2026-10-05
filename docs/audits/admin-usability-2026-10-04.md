# Admin usability follow-up — October 4, 2026

## Design and scope

This pass retains the existing fleet dashboard, mining performance emphasis, per-rig primary Play/Pause, history chart and whole-fleet controls. It concentrates on finding rigs and controlling a selected group. No miner, configuration delivery, statistics calculation or client-update execution logic changed.

The existing Segoe UI/system typography and palette are retained: background `#0d1117`, surface `#161b22`, border `#303a46`, text `#e6edf3`, active scope `#68bde9`, and warning `#ffe0ad`. Left-aligned filter controls sit between performance and the rig list. A sticky selection bar stays above that list, with actions wrapping into two columns on small screens. Color identifies selected views and action scope rather than adding decoration.

## Changes

- Added quick fleet views for all states, mining, stopped, needs attention and offline. They replace state/attention filters together while preserving search, group, tag and sorting. “Stopped” uses the existing `online` status; it does not claim to represent every connected rig.
- Visible removable filter tags expose filters previously hidden in the advanced panel. Clear filters and the empty-view action preserve sorting. Changing a filter clears the selected targets and pagination as before.
- Selection actions stay visible while scrolling: selected count, selected Play/Pause, advanced actions and clear selection. The page-selection checkbox now appears outside the desktop-only table header, works on mobile and shows partial selection. Whole-fleet controls retain their explicit separate scope.
- Saved views can be deleted. Saves produce a toast. Malformed/null preferences and unavailable browser storage no longer break the fleet; storage failures explain that the preference is temporary.
- The client-update list has its own name search and All rigs / Update needed / Needs review / Offline views with counts. These filter only the displayed update list; existing fleet update actions retain their full scope, stated explicitly next to the filters. Desktop rows separate rig, status and action; narrow screens stack them. Failed old attempts on a now-current client remain visible in history but alone do not mark that rig as needing review.
- Empty states offer direct reset actions. Backend outages remain errors rather than appearing as an empty successful result.

## Validation

155 backend regression tests passed, including focused checks for filter scope/sort preservation and broken/unavailable preference storage. The admin production build passed. Disposable browser checks covered combined search/status filtering, individual filter removal, empty results, selected Pause/Play without affecting other synthetic rigs, saved-view creation/deletion and feedback, update-list search/review scope, and disabled controls during a simulated backend outage. The 390px fixture was visually inspected; the selection bar was moved above the list after the first visual pass.

All command tests used simulated agents. No production mining, profile, repair or installation commands were issued. Real hardware behavior and installer behavior were not retested by this UI-only change.

## Deployment

Implementation `8a7906c` was pushed to master and deployed on tsqr with exit code 0. Container `dc937321323ccddac6c51d16558385519e2a8619db0e2ffc0bff06b19bf94876` serves the verified `Dashboard-BwvWntBa.js` bundle containing the new quick views. Public health reports database and index readiness. No client release is required.
