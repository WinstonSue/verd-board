---
'@sue/board-react-text': major
'@sue/verd-board-ui': major
'@sue/verd-board-app': major
---

Separate current file identity, entry source and ownership in workspace navigation. Replace ownership breadcrumbs with a current-file header, per-file return context and grouped direct embed locations across canvases and documents. Preserve the source view on return, identify repeated embeds, and keep independent or unorganized files discoverable.

Add `WorkspaceFileNavigation` and document-controller `locateFrameReference(targetFrameId, occurrence)`. Resolve document embeds against the current body and reject stale body revisions before selection. Route reference location and return through workspace Actions and editing receipts. Keep file formats and persistent workspace link addresses unchanged.
