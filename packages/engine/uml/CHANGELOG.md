# @sue/board-uml

## 2.1.0

### Major Changes

- 33dc37e: Introduce explicit, instance-scoped CellPlugin and FrameUIPlugin composition for Draw, Mind, Workflow, Architecture and UML. Domain kinds and models move out of core. FrameEditor composes a complete editor from one domain; FrameCanvas takes the same pluginSet used for previews, references and image export. Add the Draw React package and public per-package CSS entries; keep rich text built into React core and inject optional converters from the host.

  Pass the installed registry to independent domain-sensitive helpers. Reject unknown kinds before opening or importing files, with no normalization or writes. Duplicate plugin IDs and kind conflicts fail explicitly; runtime installation is unsupported. Preserve atomic transaction/history behavior and existing FrameFileV2/DocumentFileV1 serialized fields. See the native Architecture, React integration and migration documents for the next-major contract. No version bump or publication is performed in this change.

- 33dc37e: Unify editor toolbars, menus, shortcuts, command palettes, help and public user operations around instance-scoped Actions. Add the renderer-independent `@sue/board-react-actions` package. Replace discrete canvas/document controller mutation methods, plugin-local shortcuts, tool command callbacks and `CellUtil.keyboard` with shared action definitions, availability and execution. Capture original targets before focus or asynchronous transport changes; await actual host editing receipts and preserve cancellation, rejection and failure results.

  Add shared `WorkspaceTarget` codecs and stable single-Cell workspace links. Resolve Cell identity through the live owner index after cross-Frame moves, with the URL file ID as a hint/fallback. Replace legacy document-link exports and reveal props with common codecs, `FrameLinkHost`, abortable `revealTarget` and typed document navigation results. Temporarily expand required Mind ancestors through occurrence-local view projections; canonical content, undo history, other occurrences and exports remain unchanged.

  Map explicit standard and domain rich-text link slots once after copy/import/paste ownership is known, including custom UML plans. Custom `CellPastePlan` implementations must return `idMap`; inject protocol/text mappers into core registries without adding a core-to-common runtime dependency. Preserve `FrameFileV2`, `DocumentFileV1` and native bundle versions. See native React integration and migration documents for breaking API replacements. Prepare Changesets only; do not bump versions or publish as part of this change.

### Minor Changes

- Prepare the application, SDK, UI and Agent together as 2.1.0 for this explicitly authorized early-stage release. This release includes the breaking API changes documented below; existing 2.0 consumers must follow the migration guide. Future releases retain the existing version rules. Local version preparation does not establish npm registry publication.

### Patch Changes

- b06ca40: Remove deprecated CellIndex.membersOf: use groupOf for group membership and domainOwnerOf for domain ownership. Preserve combined lookup precedence with parentOf, domainOwnerOf, then groupOf. Remove legacyThemeColors and the ignored fifth resolveThemeColor argument; use the four-argument resolver and explicit custom color sources. Replace the UI WorkspaceId alias with EditorKind.

  Remove unused internal code and attachment scans, route Keep both through the registered workspace.resolve-conflict action, and synchronize bundled native project documentation and independent content release guidance.

- Introduce scene geometry policies and detailed joint layout/routing plans. Enforce painted node clearance through routing and cleanup, retry placement with wider channels, preserve manual routes in background work, support cyclic process layout, and retain failed edge-only routes with diagnostics. Keep domain projections, endpoint semantics, undo and saved route provenance intact.
- Updated dependencies [5571a9a]
- Updated dependencies [b06ca40]
- Updated dependencies [b06ca40]
- Updated dependencies [b06ca40]
- Updated dependencies
- Updated dependencies [33dc37e]
- Updated dependencies [33dc37e]
- Updated dependencies
- Updated dependencies [b06ca40]
- Updated dependencies [33dc37e]
- Updated dependencies [33dc37e]
- Updated dependencies [33dc37e]
- Updated dependencies
- Updated dependencies
  - @sue/board-core@2.1.0

## Unreleased

新增 createUmlPlugin；UML 类型、事件引用、激活、片段归一化与粘贴重映射从 core 移入本包。

本轮不升级版本或发布，随下一主版本交付；参见原生架构和迁移文档。

## 2.0.0

### Major Changes

- 首次发布：UML 类图与时序图模型、工厂、命令、布局、关系校验和注册。首次发布版本随整套包为 2.0.0。

  统一发布 2.0.0；对比基线为阿里云实际发布的 1.0.0。安装、CSS 入口和可编译示例见随包 README。

### Minor Changes

- bb0fd66: Add native UML class and sequence diagram domains with editable members, relationships, multiplicities, ordered messages, activations, notes and nested alt/opt/loop fragments. Support Mermaid semantic import/export, shared runtime edge projection, native persistence, clipboard remapping and image export.

### Patch Changes

- Updated dependencies
- Updated dependencies [a587c8c]
- Updated dependencies [b556617]
- Updated dependencies [6da91da]
- Updated dependencies [bb0fd66]
- Updated dependencies [b556617]
  - @sue/board-core@2.0.0
