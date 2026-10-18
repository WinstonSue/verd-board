---
'@sue/board-react': patch
'@sue/verd-board-ui': patch
'@sue/verd-board-app': patch
---

Move document reference navigation and inline editing controls into Frame title bars. Connect bulk tab closing and add persistent tab groups with shared file editors and legacy session migration.

Keep tab menus stable while focused document titles commit, and retarget pending document writes during moves and renames so closing a group preserves unsaved edits.
