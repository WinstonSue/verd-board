# @sue/board-react-actions

## 2.1.0

### Major Changes

- 33dc37e: Unify editor toolbars, menus, shortcuts, command palettes, help and public user operations around instance-scoped Actions. Add the renderer-independent `@sue/board-react-actions` package. Replace discrete canvas/document controller mutation methods, plugin-local shortcuts, tool command callbacks and `CellUtil.keyboard` with shared action definitions, availability and execution. Capture original targets before focus or asynchronous transport changes; await actual host editing receipts and preserve cancellation, rejection and failure results.

  Add shared `WorkspaceTarget` codecs and stable single-Cell workspace links. Resolve Cell identity through the live owner index after cross-Frame moves, with the URL file ID as a hint/fallback. Replace legacy document-link exports and reveal props with common codecs, `FrameLinkHost`, abortable `revealTarget` and typed document navigation results. Temporarily expand required Mind ancestors through occurrence-local view projections; canonical content, undo history, other occurrences and exports remain unchanged.

  Map explicit standard and domain rich-text link slots once after copy/import/paste ownership is known, including custom UML plans. Custom `CellPastePlan` implementations must return `idMap`; inject protocol/text mappers into core registries without adding a core-to-common runtime dependency. Preserve `FrameFileV2`, `DocumentFileV1` and native bundle versions. See native React integration and migration documents for breaking API replacements. Prepare Changesets only; do not bump versions or publish as part of this change.

### Minor Changes

- b06ca40: Add workspace creation and history management, home and unified content navigation, portable favorites and manual ordering, batch file and directory organization with undo, and local full-text search.
- Prepare the application, SDK, UI and Agent together as 2.1.0 for this explicitly authorized early-stage release. This release includes the breaking API changes documented below; existing 2.0 consumers must follow the migration guide. Future releases retain the existing version rules. Local version preparation does not establish npm registry publication.

### Patch Changes

- 33dc37e: Handle command palette shortcuts before editor key isolation and add opt-in root fallback for body/html focus after reload. Preserve nearest-scope routing and modal ownership, and keep document page actions alive through React StrictMode effect replay.
- b06ca40: Reorganize workspace navigation, chart browsing, switching and quick open around compact lists and consistent dialogs. Consolidate settings sections, preserve drafts while searching, commit text and numeric values when editing finishes, and retain existing action IDs and stored workspace formats.

  Unify interface typography around system fonts and a 14px baseline, adopt neutral appearance tokens, and preserve legacy canvas paint. Share modal, icon, form and settings primitives; align workspace switching, sidebar navigation, management lists and content actions. Keep nested menus inside modal portal roots and add style and geometry regression checks.

- Updated dependencies [5571a9a]
- Updated dependencies
- Updated dependencies [b06ca40]
- Updated dependencies [b06ca40]
- Updated dependencies [33dc37e]
- Updated dependencies
  - @sue/board-common@2.1.0

## 2.0.0

Shared action scopes, contextual keyboard routing, command palette and shortcut help for React hosts.
