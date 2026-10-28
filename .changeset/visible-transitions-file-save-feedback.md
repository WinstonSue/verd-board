---
'@sue/verd-board-app': patch
'@sue/verd-board-ui': patch
---

Start a clearer 180ms opacity transition after the target editor is ready, independently of loading completion. Add immutable per-file persistence feedback and source-aware page save status so opening files and persisting navigation do not report unsaved content or change file save times. Keep workspace-level failures visible and handle in-flight edits, retries, moves, organization and conflict resolution.
