---
'@sue/board-react': minor
'@sue/board-react-workflow': minor
'@sue/board-react-mind': patch
'@sue/board-react-architecture': patch
'@sue/board-react-uml': patch
'@sue/verd-board-ui': patch
'@sue/verd-board-app': patch
---

Introduce typed Schema settings panels, reusable geometry definitions and additive propertyPanels/settingsPanels plugin contributions. Migrate ordinary application, workspace, common and domain fields while retaining existing controls, commit timing, inheritance, transactions and history. Preserve concurrent host fields when applying inspector edits.

Consume the separately maintained Settings SDK through published package versions. Candidate integration and consumer scripts accept a checksummed tarball manifest; publish the Schema runtime/SDK and pin its final versions before registry-only release verification. No version bump or publication is performed here.
