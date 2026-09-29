# Stability follow-up — September 29

## Findings and fixes

Read-only production inspection found seven stopped CPU slots reporting a missing XMRig executable while configured for Nanominer. KAM_Z6's enabled CPU slot incorrectly masked working Quantus mining as a rig error. Startup was checking default engines from legacy slot names, not selected configuration. Client 1.4.11 removes this eager preparation/check loop; runtime launch and explicit maintenance continue verifying the chosen engine. Renderer and backend view logic ignore only explicitly mismatched stopped-engine file checks, preserving raw diagnostics and unrelated/active/ownership errors. API views retain the suppressed original as `reportedError`.

A delayed native file diagnosis could overwrite a newer launch or process failure. Diagnosis now checks entry identity, control generation and diagnostic identity before updating status, and cannot replace lifecycle failures. Failed Stop also remains in native status instead of disappearing on the next poll. Confirmed Stop clears resolved lifecycle failures without falsely declaring missing files repaired.

Desktop Stop All skipped slots believed stopped, preventing survivor cleanup on those slots. It now calls the native owner for both slots. Windows SRBMiner survivor matching unnecessarily required an absolute argv[0], even though the OS provides the resolved executable path. Basename argv[0] is now allowed only with the same strict managed image and per-slot log-path checks. Windows argument parsing also preserves boundaries after unquoted trailing backslashes. No kill-by-name, protection changes, custom-path adoption or automatic repair loop is introduced.

## Validation and limits

Behavioral regressions cover wrong-engine diagnostics, active/unrelated failures, late diagnosis after an engine launch, failed Stop persistence, file checks after exit, confirmed Stop clearing, basename restart matching, unrelated-process exclusion and Windows argument boundaries. Tests use fake native processes and disposable backend data. Both production builds and the complete release pipeline run before publication.

PG_Z7's earlier residual GPU load is not claimed resolved by these changes. Basename restart matching is a reproduced code gap, not proof that it explains that machine's other workload. Windows/Linux hardware and long-duration engine stability are not established by these tests. Existing client update behavior is retained; no forced fleet install or mining command is part of this audit.

## Deployment and release evidence

- Source commit: `b1eef39` on `master`. Client `1.4.11+111.b1eef39` published September 29 at 18:05 UTC with all seven Windows/Linux assets and both verified updater feeds. Packaged native lifecycle modules match source on both platforms.
- Release validation: 123 client tests and 135 backend tests passed; admin and client production builds passed. Official release checks confirmed SRBMiner 3.7.0, Nanominer 3.10.0 and XMRig 6.26.0 as the latest stable versions at publication. No miners or installers were executed by this validation.
- Backend deployed to tsqr in container `86b2dcb369991f8559fecafbc7ea31972b08ef158b164d0857b8948fb5346253`; rollback image `minemaster:before-1.4.11`. Database/index readiness passed and the monitoring sweep completed successfully with zero failed rigs.
- Read-only production verification after deployment: 13 agents online, seven Quantus GPU processes reporting valid samples totaling approximately 1.535 GH/s, plus one RandomX process at 1,218 H/s. KAM_Z6 correctly shows mining at approximately 257 MH/s; its unrelated historical XMRig file error remains available as `reportedError` and the original diagnostic. PG_Z7 still reported approximately 87 MH/s.
- Publication makes this release available to normal automatic update checks; it is not confirmation that every rig has installed it. No forced installation or live mining command was issued during this pass. No visual layout was changed or browser walkthrough performed.
