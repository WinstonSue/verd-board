---
'@sue/verd-board-app': patch
'@sue/verd-board-ui': patch
---

Add a readiness-driven content fade and a thin progress strip shown only after navigation waits longer than 300ms. Track captured editing barriers, target readiness and positioning without remounting editors, and cancel stale navigation feedback on replacement, failure or workspace changes. Respect reduced motion and preserve document and canvas view state.
