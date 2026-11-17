# @sue/verd-board-agent-patterns

## 2.1.2

### Patch Changes

- Fix architecture container placement and relation routing, add independent text cards, unify theme color families and manual color preservation, improve document table controls and sidebar selection, and preserve conflicting legacy resources during migration. Stabilize document controls, port interactions, exports and isolated Web/Desktop validation; pin Electron 44.11.3 for cross-display window geometry.

## 2.1.1

### Patch Changes

- Extract the shared workspace SDK so third-party Node Agent consumers do not install product app/ui. Add the generic FrameCanvasPreview API while preserving product defaults and existing headless exports. Move Agent packages out of product and organize product UI source by responsibility without changing public entrypoints.

  Reserve the canvas label padding when sizing architecture layer headings so short Latin SDK names remain visible in standalone previews.

## 2.1.0

### Major Changes

- Migrate executable Agent prose to standard Skills and Markdown references, separately from native user recommendations and execution templates. `catalog.guidePath` now points to Markdown. `loadPatternGuide` and `loadPatternGuides` return `AgentGuideSource { path, title, source }` instead of native documents; the singular default is the common writing guide. Render `source` in the host instead of accessing `guide.text`. Native template paths, identities and instantiation behavior remain unchanged. Settings renders the same Markdown source without maintaining JSON mirrors.

- b06ca40: Standardize bundled project and pattern workspaces with portable project context. Add explicit offline full updates with complete directory backups, restart recovery, retained project identity and terminal receipts, and instance generation checks that reject stale hosts and authoring plans.

  Use document navigation as the built-in project homepage and honor configured reading entries when no session has been saved. Preserve existing sessions and keep diagram navigation available through document links.

  Display the selected reading entry instead of hiding it behind the management homepage. Explain that installing the app preserves existing copies and that confirmed replacement opens the new navigation document.

  Move bilingual navigation to the workspace root and project diagrams into the diagrams directory. Consolidate navigation into reading indexes, replace document posters with compact source links, and permit existing plain text annotations in specialized scenes without adding them to scene layout membership.

### Minor Changes

- a63a1ad: Add a standalone agent authoring CLI and independently maintained native pattern library. Share editor schemas, workspace validation and journaled filesystem commits with Desktop, expose atomic batch authoring, and initialize an editable pattern workspace without overwriting user copies. Include real-renderer previews and a bundled authoring skill.
- Separate user authoring recommendations from executable Agent defaults, with independent catalogs and loading entries. Keep existing Agent exports, editable library identities and manual update behavior while routing product templates to the user source.

  Add repository-wide development checks, full CI and publishing gates, and version-bound reviews of Agent tooling, user recommendations and the system introduction. Require substantive introduction updates for product and standalone package releases, and isolate production E2E probe artifacts from normal web output.

- b06ca40: Publish native project documentation and pattern workspaces as independently versioned npm resources. Desktop checks compatible releases using local npm credentials, reminds without downloading, and prepares verified exact versions before the existing backed-up atomic replacement. Keep offline recovery and project identity intact.
- b06ca40: Add slash insertion and paragraph actions, native writing templates, stable block anchors and live read-only excerpts, portable content properties and saved filters, local content checkpoints with preview/restore, conflict comparison and independent recovery copies, managed image assets, and folder/ZIP migration with portable export reports. Keep resource writes in WorkspaceSession, guard them with content versions, and clear recoverable snapshots when their source is permanently deleted.
- Maintain workspace prompt supplements and independently named custom Skills in settings as standard SKILL.md documents. Preserve YAML metadata and referenced resources, use conditional transactions with conflict-safe drafts and idempotent retries, discover external Skills, and activate custom instructions by description. Skill changes invalidate prepared plans; bundled workspace updates retain user Skills.

  Provide a standard Skill entrance for every default pattern, referencing its native rules and templates. View the common authoring Skill, selected pattern Skill, Markdown source and related rules directly from the prompt scope selector. Keep the common authoring document in the content package as its single source while retaining the existing shared runtime path. Include registered default Skills in bundled release manifests and exclude Skill internals from content navigation and Markdown imports.

- Prepare the application, SDK, UI and Agent together as 2.1.0 for this explicitly authorized early-stage release. This release includes the breaking API changes documented below; existing 2.0 consumers must follow the migration guide. Future releases retain the existing version rules. Local version preparation does not establish npm registry publication.

### Patch Changes

- 8edcd06: Bundle system introduction and pattern workspaces with the app, make backups optional and discoverable, preserve presentation across internal links, and correct content tabs, storage locations and search snippets.
- Keep connectors and arrows fixed when ports appear, prioritize selected node or edge ports, and enlarge connection editing targets. Add non-blocking workflow port-direction guidance for agent authoring.
- Show ordinary workspace resources at their real paths, consolidate durable resources under `.verdscrolls/resources`, and migrate existing resource stores without changing attachment addresses. WorkspaceHost implementations must provide readResource and support resourceWrites/resourceVersions separately from content entries.

  Keep AGENTS.md and agent.md guidance out of content navigation while preserving the original files for Agent tools.

  Treat every diagram as an independent file. Remove canvas ownership commands, indexes and UI interfaces; copying and exporting follow actual references. Legacy organization fields remain readable and inert.

## 0.1.0

Initial agent authoring tools and native patterns.
