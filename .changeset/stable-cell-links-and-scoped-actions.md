---
'@sue/board-common': major
'@sue/board-core': major
'@sue/board-draw': major
'@sue/board-mind': major
'@sue/board-uml': major
'@sue/board-react-actions': major
'@sue/board-react': major
'@sue/board-react-text': major
'@sue/board-react-draw': major
'@sue/board-react-mind': major
'@sue/board-react-workflow': major
'@sue/board-react-architecture': major
'@sue/board-react-uml': major
'@sue/verd-board-ui': major
'@sue/verd-board-app': major
---

Unify editor toolbars, menus, shortcuts, command palettes, help and public user operations around instance-scoped Actions. Add the renderer-independent `@sue/board-react-actions` package. Replace discrete canvas/document controller mutation methods, plugin-local shortcuts, tool command callbacks and `CellUtil.keyboard` with shared action definitions, availability and execution. Capture original targets before focus or asynchronous transport changes; await actual host editing receipts and preserve cancellation, rejection and failure results.

Add shared `WorkspaceTarget` codecs and stable single-Cell workspace links. Resolve Cell identity through the live owner index after cross-Frame moves, with the URL file ID as a hint/fallback. Replace legacy document-link exports and reveal props with common codecs, `FrameLinkHost`, abortable `revealTarget` and typed document navigation results. Temporarily expand required Mind ancestors through occurrence-local view projections; canonical content, undo history, other occurrences and exports remain unchanged.

Map explicit standard and domain rich-text link slots once after copy/import/paste ownership is known, including custom UML plans. Custom `CellPastePlan` implementations must return `idMap`; inject protocol/text mappers into core registries without adding a core-to-common runtime dependency. Preserve `FrameFileV2`, `DocumentFileV1` and native bundle versions. See native React integration and migration documents for breaking API replacements. Prepare Changesets only; do not bump versions or publish as part of this change.
