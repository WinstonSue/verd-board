# @sue/verd-board-agent

## 2.1.1

### Patch Changes

- Extract the shared workspace SDK so third-party Node Agent consumers do not install product app/ui. Add the generic FrameCanvasPreview API while preserving product defaults and existing headless exports. Move Agent packages out of product and organize product UI source by responsibility without changing public entrypoints.

  Reserve the canvas label padding when sizing architecture layer headings so short Latin SDK names remain visible in standalone previews.

- Updated dependencies
  - @sue/verd-board-workspace@2.2.0
  - @sue/verd-board-agent-patterns@2.1.1

## 2.1.0

### Major Changes

- b06ca40: Standardize bundled project and pattern workspaces with portable project context. Add explicit offline full updates with complete directory backups, restart recovery, retained project identity and terminal receipts, and instance generation checks that reject stale hosts and authoring plans.

  Use document navigation as the built-in project homepage and honor configured reading entries when no session has been saved. Preserve existing sessions and keep diagram navigation available through document links.

  Display the selected reading entry instead of hiding it behind the management homepage. Explain that installing the app preserves existing copies and that confirmed replacement opens the new navigation document.

  Move bilingual navigation to the workspace root and project diagrams into the diagrams directory. Consolidate navigation into reading indexes, replace document posters with compact source links, and permit existing plain text annotations in specialized scenes without adding them to scene layout membership.

### Minor Changes

- a63a1ad: Add a standalone agent authoring CLI and independently maintained native pattern library. Share editor schemas, workspace validation and journaled filesystem commits with Desktop, expose atomic batch authoring, and initialize an editable pattern workspace without overwriting user copies. Include real-renderer previews and a bundled authoring skill.
- b06ca40: Add document folding, LaTeX nodes, resource cards, local media and PDF reading with stable asset page links. Keep canvas label schemas separate. Store portable binary assets without base64, add PDF runtime assets and restrict external frames and workspace IPC.
- b06ca40: Publish native project documentation and pattern workspaces as independently versioned npm resources. Desktop checks compatible releases using local npm credentials, reminds without downloading, and prepares verified exact versions before the existing backed-up atomic replacement. Keep offline recovery and project identity intact.
- b06ca40: Add slash insertion and paragraph actions, native writing templates, stable block anchors and live read-only excerpts, portable content properties and saved filters, local content checkpoints with preview/restore, conflict comparison and independent recovery copies, managed image assets, and folder/ZIP migration with portable export reports. Keep resource writes in WorkspaceSession, guard them with content versions, and clear recoverable snapshots when their source is permanently deleted.
- Add a local filesystem service for Web with the shared desktop workspace lifecycle, typed HTTP/SSE host, directory selection, Git remote sync, Agent tools and complete browser-workspace migration. Declare host storage explicitly and preserve desktop entry points.

  Clear source IndexedDB records after a successful validated migration, retain the complete backup, protect concurrent edits and leave current browser data intact when importing a backup file.

- Use root Git repositories for explicit file and workspace versions. Add local browser Git, native Desktop Git and fast-forward remote synchronization, same-commit previews, guarded restores, and reviewed history cleanup with explicit remote-provider follow-up states. Keep legacy snapshots readable while removing automatic recovery snapshots and automatic commits.
- Expose provider-independent file and directory version history, with Git storage configuration in workspace settings. Add explicit scope, opaque version identifiers, capability and error contracts, reviewed creation plans, stable directory history across moves, and guarded directory restores that preserve unrelated content and staging. Retain existing repositories and legacy snapshots.
- b06ca40: Initialize AI project discovery when a filesystem workspace opens: preserve user AGENTS prose, link versioned shared tools/specifications, expose project context and readiness, and provide read-only context/doctor plus explicit init/repair commands. Migrate legacy metadata atomically to .verdscrolls with journal/receipt/trash preservation and legacy-writer guards. Bundle a checksum-verified standalone Node runtime and complete CLI dependencies in Desktop resources; retain older deployed resource versions and bind pending plans to the resource build.
- Show ordinary workspace resources at their real paths, consolidate durable resources under `.verdscrolls/resources`, and migrate existing resource stores without changing attachment addresses. WorkspaceHost implementations must provide readResource and support resourceWrites/resourceVersions separately from content entries.

  Keep AGENTS.md and agent.md guidance out of content navigation while preserving the original files for Agent tools.

  Treat every diagram as an independent file. Remove canvas ownership commands, indexes and UI interfaces; copying and exporting follow actual references. Legacy organization fields remain readable and inert.

- Maintain workspace prompt supplements and independently named custom Skills in settings as standard SKILL.md documents. Preserve YAML metadata and referenced resources, use conditional transactions with conflict-safe drafts and idempotent retries, discover external Skills, and activate custom instructions by description. Skill changes invalidate prepared plans; bundled workspace updates retain user Skills.

  Provide a standard Skill entrance for every default pattern, referencing its native rules and templates. View the common authoring Skill, selected pattern Skill, Markdown source and related rules directly from the prompt scope selector. Keep the common authoring document in the content package as its single source while retaining the existing shared runtime path. Include registered default Skills in bundled release manifests and exclude Skill internals from content navigation and Markdown imports.

- Prepare the application, SDK, UI and Agent together as 2.1.0 for this explicitly authorized early-stage release. This release includes the breaking API changes documented below; existing 2.0 consumers must follow the migration guide. Future releases retain the existing version rules. Local version preparation does not establish npm registry publication.

### Patch Changes

- 8edcd06: Bundle system introduction and pattern workspaces with the app, make backups optional and discoverable, preserve presentation across internal links, and correct content tabs, storage locations and search snippets.
- b06ca40: Remove deprecated CellIndex.membersOf: use groupOf for group membership and domainOwnerOf for domain ownership. Preserve combined lookup precedence with parentOf, domainOwnerOf, then groupOf. Remove legacyThemeColors and the ignored fifth resolveThemeColor argument; use the four-argument resolver and explicit custom color sources. Replace the UI WorkspaceId alias with EditorKind.

  Remove unused internal code and attachment scans, route Keep both through the registered workspace.resolve-conflict action, and synchronize bundled native project documentation and independent content release guidance.

- Add self-contained native v2 resource packages with validated, atomic file and asset import and idempotent recovery. Declare host workspace capabilities, keep saved names consistent with history, and finish management-view navigation correctly. Make read-only doctor exit unsuccessfully when the workspace is unready. Preserve native/v1 imports and existing third-party host behavior.

  Keep automatic camera fits synchronized with initial viewport and toolbar measurements until user interaction takes over, without writing document content or changing manually positioned cameras.

  Read focused native text selections without changing content, and synchronize canvas selections before rendering controls so stale editor ranges cannot overwrite a newly moved caret. Preserve text history.

- Separate user authoring recommendations from executable Agent defaults, with independent catalogs and loading entries. Keep existing Agent exports, editable library identities and manual update behavior while routing product templates to the user source.

  Add repository-wide development checks, full CI and publishing gates, and version-bound reviews of Agent tooling, user recommendations and the system introduction. Require substantive introduction updates for product and standalone package releases, and isolate production E2E probe artifacts from normal web output.

- Introduce scene geometry policies and detailed joint layout/routing plans. Enforce painted node clearance through routing and cleanup, retry placement with wider channels, preserve manual routes in background work, support cyclic process layout, and retain failed edge-only routes with diagnostics. Keep domain projections, endpoint semantics, undo and saved route provenance intact.
- Keep connectors and arrows fixed when ports appear, prioritize selected node or edge ports, and enlarge connection editing targets. Add non-blocking workflow port-direction guidance for agent authoring.
- Updated dependencies [33dc37e]
- Updated dependencies [5571a9a]
- Updated dependencies [a63a1ad]
- Updated dependencies [b06ca40]
- Updated dependencies [b06ca40]
- Updated dependencies [8edcd06]
- Updated dependencies
- Updated dependencies [b06ca40]
- Updated dependencies [33dc37e]
- Updated dependencies
- Updated dependencies
- Updated dependencies [b06ca40]
- Updated dependencies [b06ca40]
- Updated dependencies
- Updated dependencies [33dc37e]
- Updated dependencies [33dc37e]
- Updated dependencies [33dc37e]
- Updated dependencies [b06ca40]
- Updated dependencies [b06ca40]
- Updated dependencies
- Updated dependencies [33dc37e]
- Updated dependencies [b06ca40]
- Updated dependencies [b06ca40]
- Updated dependencies [b06ca40]
- Updated dependencies
- Updated dependencies
- Updated dependencies [33dc37e]
- Updated dependencies [33dc37e]
- Updated dependencies
- Updated dependencies
- Updated dependencies [33dc37e]
- Updated dependencies [33dc37e]
- Updated dependencies [33dc37e]
- Updated dependencies [33dc37e]
- Updated dependencies [33dc37e]
- Updated dependencies
- Updated dependencies [b06ca40]
- Updated dependencies [33dc37e]
- Updated dependencies
- Updated dependencies [b06ca40]
- Updated dependencies [b06ca40]
- Updated dependencies [b06ca40]
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @sue/verd-board-app@2.1.0
  - @sue/verd-board-ui@2.1.0
  - @sue/board-common@2.1.0
  - @sue/board-core@2.1.0
  - @sue/board-draw@2.1.0
  - @sue/board-mind@2.1.0
  - @sue/board-react@2.1.0
  - @sue/board-react-text@2.1.0
  - @sue/board-mermaid-to-board@2.1.0
  - @sue/verd-board-agent-patterns@2.1.0
  - @sue/board-uml@2.1.0
  - @sue/board-markdown-to-text@2.1.0
  - @sue/board-workflow@2.1.0
  - @sue/board-architecture@2.1.0
  - @sue/board-layouts@2.1.0

## 0.1.0

Initial agent authoring tools and native patterns.
