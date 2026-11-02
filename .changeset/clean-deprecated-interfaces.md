---
'@sue/board-core': major
'@sue/verd-board-ui': major
'@sue/board-mind': patch
'@sue/board-uml': patch
'@sue/board-react': patch
'@sue/board-react-uml': patch
'@sue/verd-board-app': patch
'@sue/verd-board-agent': patch
'@sue/verd-board-docs': patch
---

Remove deprecated CellIndex.membersOf: use groupOf for group membership and domainOwnerOf for domain ownership. Preserve combined lookup precedence with parentOf, domainOwnerOf, then groupOf. Remove legacyThemeColors and the ignored fifth resolveThemeColor argument; use the four-argument resolver and explicit custom color sources. Replace the UI WorkspaceId alias with EditorKind.

Remove unused internal code and attachment scans, route Keep both through the registered workspace.resolve-conflict action, and synchronize bundled native project documentation and independent content release guidance.
