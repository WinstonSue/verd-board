# @sue/board-react-uml

## 2.1.0

### Major Changes

- 33dc37e: Introduce explicit, instance-scoped CellPlugin and FrameUIPlugin composition for Draw, Mind, Workflow, Architecture and UML. Domain kinds and models move out of core. FrameEditor composes a complete editor from one domain; FrameCanvas takes the same pluginSet used for previews, references and image export. Add the Draw React package and public per-package CSS entries; keep rich text built into React core and inject optional converters from the host.

  Pass the installed registry to independent domain-sensitive helpers. Reject unknown kinds before opening or importing files, with no normalization or writes. Duplicate plugin IDs and kind conflicts fail explicitly; runtime installation is unsupported. Preserve atomic transaction/history behavior and existing FrameFileV2/DocumentFileV1 serialized fields. See the native Architecture, React integration and migration documents for the next-major contract. No version bump or publication is performed in this change.

- 33dc37e: Unify editor toolbars, menus, shortcuts, command palettes, help and public user operations around instance-scoped Actions. Add the renderer-independent `@sue/board-react-actions` package. Replace discrete canvas/document controller mutation methods, plugin-local shortcuts, tool command callbacks and `CellUtil.keyboard` with shared action definitions, availability and execution. Capture original targets before focus or asynchronous transport changes; await actual host editing receipts and preserve cancellation, rejection and failure results.

  Add shared `WorkspaceTarget` codecs and stable single-Cell workspace links. Resolve Cell identity through the live owner index after cross-Frame moves, with the URL file ID as a hint/fallback. Replace legacy document-link exports and reveal props with common codecs, `FrameLinkHost`, abortable `revealTarget` and typed document navigation results. Temporarily expand required Mind ancestors through occurrence-local view projections; canonical content, undo history, other occurrences and exports remain unchanged.

  Map explicit standard and domain rich-text link slots once after copy/import/paste ownership is known, including custom UML plans. Custom `CellPastePlan` implementations must return `idMap`; inject protocol/text mappers into core registries without adding a core-to-common runtime dependency. Preserve `FrameFileV2`, `DocumentFileV1` and native bundle versions. See native React integration and migration documents for breaking API replacements. Prepare Changesets only; do not bump versions or publish as part of this change.

### Minor Changes

- 5571a9a: Add light and dark variants for Classic, Colorful, Soft, Retro, Fresh and Ocean while preserving existing theme IDs. Resolve canvas colors at render time, take over all unmarked component colors, and retain per-field custom color sources through edits, copying and inheritance. Adapt embedded documents, references and presentation without saving appearance into files or undo history. Image exports can use the current, light or dark appearance independently of their background choice and retain the full source content of selected references; existing third-party renderers retain legacy colors when appearance is omitted. Share domain color defaults across drawing and inspectors, add Mind branch reset, and distinguish explicitly authored Mermaid styles from renderer defaults.

  Make rich-text color provenance explicit with optional textStyle.attrs.colorSource. Unmarked and theme text inherits readable local colors in canvases, standalone documents and embedded documents; custom text keeps its literal color. Share the schema across previews and editors, preserve original literals and sources in HTML, record identical manual color choices, and clear only the color override when returning to the theme. Keep legacy third-party rendering and user workspace files unchanged; cover real legacy text marks, appearance switching, history, source roundtrips and image exports.

  Add five color roles, three emphasis levels and six coordinated categorical families to every theme appearance. Domain mappings distinguish workflow roles, architecture layers, UML classifiers and participants, drawing shape families, table headers and swimlanes. Share local fill/stroke/text resolution with inspectors and exports, preserve custom field overrides and Mind schemes, and document the actual palette values and swatches in the native architecture design.

- Prepare the application, SDK, UI and Agent together as 2.1.0 for this explicitly authorized early-stage release. This release includes the breaking API changes documented below; existing 2.0 consumers must follow the migration guide. Future releases retain the existing version rules. Local version preparation does not establish npm registry publication.

### Patch Changes

- b06ca40: Remove deprecated CellIndex.membersOf: use groupOf for group membership and domainOwnerOf for domain ownership. Preserve combined lookup precedence with parentOf, domainOwnerOf, then groupOf. Remove legacyThemeColors and the ignored fifth resolveThemeColor argument; use the four-argument resolver and explicit custom color sources. Replace the UI WorkspaceId alias with EditorKind.

  Remove unused internal code and attachment scans, route Keep both through the registered workspace.resolve-conflict action, and synchronize bundled native project documentation and independent content release guidance.

- 33dc37e: Improve connected-node spacing, architecture terminal allocation and frame-wide orthogonal routing. Add display-only line jumps, rounded elbows and local relationship highlighting while preserving authored paths and document formats.

  Keep relationship hints subordinate to selection and simplify automatic short connector stairs within a bounded crossing budget, preserving authored waypoints.

  Unify node, connector and arrow interaction outlines in opaque #6366f1 with scene-scaled widths (authored width + 1 for selection/editing, authored width for self-hover and direct relationships) and a shared light/dark soft shadow. Keep interaction paint independent of authored opacity, width, color and shadow, update only local leaves during zoom or hover, and omit interaction outlines and filters from image export.

  Strengthen the shared interaction shadow with a 0.75px shadow-only spread, 2.25px / 90% light halo and 1.25px / 65% dark halo, with half the effective local stroke width plus 12px screen-space filter padding. Verify actual shadow pixels beyond the interaction stroke across backgrounds and zoom levels.

  Replace authored outlines during interaction instead of layering color over the original stroke. Highlight isolated nodes and Frame/reference shells on self-hover, preserve dash patterns and arrow semantics, and restore authored stroke paint in image clones without changing the live canvas.

- 33dc37e: Introduce typed Schema settings panels, reusable geometry definitions and additive propertyPanels/settingsPanels plugin contributions. Migrate ordinary application, workspace, common and domain fields while retaining existing controls, commit timing, inheritance, transactions and history. Preserve concurrent host fields when applying inspector edits.

  Consume the separately maintained Settings SDK through published package versions. Candidate integration and consumer scripts accept a checksummed tarball manifest; publish the Schema runtime/SDK and pin its final versions before registry-only release verification. No version bump or publication is performed here.

- Updated dependencies [5571a9a]
- Updated dependencies [b06ca40]
- Updated dependencies [b06ca40]
- Updated dependencies
- Updated dependencies [b06ca40]
- Updated dependencies
- Updated dependencies [b06ca40]
- Updated dependencies
- Updated dependencies [33dc37e]
- Updated dependencies [33dc37e]
- Updated dependencies [b06ca40]
- Updated dependencies
- Updated dependencies [b06ca40]
- Updated dependencies [33dc37e]
- Updated dependencies [33dc37e]
- Updated dependencies
- Updated dependencies [33dc37e]
- Updated dependencies [33dc37e]
- Updated dependencies [33dc37e]
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @sue/board-core@2.1.0
  - @sue/board-react@2.1.0
  - @sue/board-uml@2.1.0

## Unreleased

新增 createUmlUIPlugin；独立 UML 调色板、属性、关系、时序图渲染与交互，不依赖产品或转换器。

本轮不升级版本或发布，随下一主版本交付；参见原生架构和迁移文档。

## 2.0.0

### Major Changes

- 首次发布：createUmlFrameExtensions，为 FrameCanvas 注册类图和时序图渲染与交互。

  统一发布 2.0.0；对比基线为阿里云实际发布的 1.0.0。安装、CSS 入口和可编译示例见随包 README。

### Minor Changes

- bb0fd66: Add native UML class and sequence diagram domains with editable members, relationships, multiplicities, ordered messages, activations, notes and nested alt/opt/loop fragments. Support Mermaid semantic import/export, shared runtime edge projection, native persistence, clipboard remapping and image export.

### Patch Changes

- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies [ba40661]
- Updated dependencies [b556617]
- Updated dependencies [6da91da]
- Updated dependencies [a587c8c]
- Updated dependencies [b556617]
- Updated dependencies [6da91da]
- Updated dependencies [40e4077]
- Updated dependencies [b556617]
- Updated dependencies [bb0fd66]
- Updated dependencies [b556617]
  - @sue/board-core@2.0.0
  - @sue/board-react@2.0.0
  - @sue/board-uml@2.0.0
