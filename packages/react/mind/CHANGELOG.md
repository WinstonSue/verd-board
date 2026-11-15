# @sue/board-react-mind

## 2.1.1

### Patch Changes

- Updated dependencies
  - @sue/board-react@2.2.0

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

- 5571a9a: Add light and dark variants for Classic, Colorful, Soft, Retro, Fresh and Ocean while preserving existing theme IDs. Resolve canvas colors at render time, take over all unmarked component colors, and retain per-field custom color sources through edits, copying and inheritance. Adapt embedded documents, references and presentation without saving appearance into files or undo history. Image exports can use the current, light or dark appearance independently of their background choice and retain the full source content of selected references; existing third-party renderers retain legacy colors when appearance is omitted. Share domain color defaults across drawing and inspectors, add Mind branch reset, and distinguish explicitly authored Mermaid styles from renderer defaults.

  Make rich-text color provenance explicit with optional textStyle.attrs.colorSource. Unmarked and theme text inherits readable local colors in canvases, standalone documents and embedded documents; custom text keeps its literal color. Share the schema across previews and editors, preserve original literals and sources in HTML, record identical manual color choices, and clear only the color override when returning to the theme. Keep legacy third-party rendering and user workspace files unchanged; cover real legacy text marks, appearance switching, history, source roundtrips and image exports.

  Add five color roles, three emphasis levels and six coordinated categorical families to every theme appearance. Domain mappings distinguish workflow roles, architecture layers, UML classifiers and participants, drawing shape families, table headers and swimlanes. Share local fill/stroke/text resolution with inspectors and exports, preserve custom field overrides and Mind schemes, and document the actual palette values and swatches in the native architecture design.

- b06ca40: Bound obstacle routing allocation, reuse prepared atomic transactions and topology indexes, and preserve unaffected workspace files and canvas state. Add opt-in layout dependency keys, shared spatial queries, geometry-based offscreen navigation, and buffered, staged mounting for large canvases.
- Extract Port, Anchor and Terminal into independent core modules with shared attachment resolution, port availability and terminal editing. Rename PortSpec to Port and EdgeTerminal to Terminal. Replace relativeAnchor, portAnchor, edgeTerminalPosition, availableEdgePorts, snapEdgeTerminal, replaceEdgeTerminal and bindEdgeRouteTerminals with resolveAnchor, resolvePort, resolveTerminal, availablePorts, snapTerminal, replaceTerminal and bindRouteTerminals. resolveTerminal returns undefined for an unresolved host and accepts explicit facing or center policies for automatic attachments.

  All three resolvers return the shared ResolvedAnchor shape containing point and side. Callers that previously used the coordinate returned by relativeAnchor should read resolveAnchor(...).point.

  Migrate engine, React and product consumers to the new APIs without compatibility aliases. Preserve native JSON, port-and-anchor bindings, domain routing preferences and endpoint controls based on the connector's actual cached route.

- 33dc37e: Improve connected-node spacing, architecture terminal allocation and frame-wide orthogonal routing. Add display-only line jumps, rounded elbows and local relationship highlighting while preserving authored paths and document formats.

  Keep relationship hints subordinate to selection and simplify automatic short connector stairs within a bounded crossing budget, preserving authored waypoints.

  Unify node, connector and arrow interaction outlines in opaque #6366f1 with scene-scaled widths (authored width + 1 for selection/editing, authored width for self-hover and direct relationships) and a shared light/dark soft shadow. Keep interaction paint independent of authored opacity, width, color and shadow, update only local leaves during zoom or hover, and omit interaction outlines and filters from image export.

  Strengthen the shared interaction shadow with a 0.75px shadow-only spread, 2.25px / 90% light halo and 1.25px / 65% dark halo, with half the effective local stroke width plus 12px screen-space filter padding. Verify actual shadow pixels beyond the interaction stroke across backgrounds and zoom levels.

  Replace authored outlines during interaction instead of layering color over the original stroke. Highlight isolated nodes and Frame/reference shells on self-hover, preserve dash patterns and arrow semantics, and restore authored stroke paint in image clones without changing the live canvas.

- 33dc37e: Introduce typed Schema settings panels, reusable geometry definitions and additive propertyPanels/settingsPanels plugin contributions. Migrate ordinary application, workspace, common and domain fields while retaining existing controls, commit timing, inheritance, transactions and history. Preserve concurrent host fields when applying inspector edits.

  Consume the separately maintained Settings SDK through published package versions. Candidate integration and consumer scripts accept a checksummed tarball manifest; publish the Schema runtime/SDK and pin its final versions before registry-only release verification. No version bump or publication is performed here.

- Updated dependencies [5571a9a]
- Updated dependencies [a63a1ad]
- Updated dependencies [b06ca40]
- Updated dependencies [b06ca40]
- Updated dependencies
- Updated dependencies [b06ca40]
- Updated dependencies
- Updated dependencies [b06ca40]
- Updated dependencies [b06ca40]
- Updated dependencies
- Updated dependencies [33dc37e]
- Updated dependencies [33dc37e]
- Updated dependencies [33dc37e]
- Updated dependencies [b06ca40]
- Updated dependencies
- Updated dependencies [b06ca40]
- Updated dependencies [b06ca40]
- Updated dependencies [b06ca40]
- Updated dependencies [33dc37e]
- Updated dependencies [33dc37e]
- Updated dependencies
- Updated dependencies [33dc37e]
- Updated dependencies [33dc37e]
- Updated dependencies [33dc37e]
- Updated dependencies [33dc37e]
- Updated dependencies
- Updated dependencies
- Updated dependencies [b06ca40]
- Updated dependencies
  - @sue/board-common@2.1.0
  - @sue/board-core@2.1.0
  - @sue/board-mind@2.1.0
  - @sue/board-react@2.1.0
  - @sue/board-react-text@2.1.0
  - @sue/board-layouts@2.1.0

## Unreleased

新增 createMindUIPlugin；完整 Mind 属性、设置、工具、渲染、快捷键、投影与实例平移策略归本包，配置和语言按编辑器隔离。

本轮不升级版本或发布，随下一主版本交付；参见原生架构和迁移文档。

## 2.0.0

### Major Changes

- createMindFrameExtensions 注册脑图渲染、树布局与交互；新增可选 MindMetricsOptions（maxNodeWidth、measureText），支持分支移动预览。

  统一发布 2.0.0；对比基线为阿里云实际发布的 1.0.0。安装、CSS 入口和可编译示例见随包 README。

### Minor Changes

- a587c8c: Mind 节点外侧按钮统一用于折叠或展开子节点，叶子节点不再显示新增按钮；使用 Tab 新增子节点、Enter 新增同级节点。中心主题支持保存折叠状态，新增或移入子节点时自动展开，并保持单步撤销。
- b556617: Mind 功能迭代：笔记文本配置、Mind 配色方案、整树布局、Markdown 双向转换。

  - 新增 `FrameView.mind.colorScheme`（default/colorful/soft/retro/dark/starry），缺省继承画布主题；颜色按"显式标记 > 分支继承 > 方案 > 画布主题 > 默认色板"在渲染时解析，不批量写节点，旧文件无需迁移。
  - `FramePresentation`/`FrameNodeAppearanceValue` 增加可选 `stroke` 字段，外观缓存同步比较。
  - 笔记文本分组支持字号（默认 13）、颜色与"跟随主题"、粗斜体/下划线/删除线、对齐，作用于整篇笔记并保留 marks；空笔记禁用文字控件并提示。
  - `cell-tree.ts` 新增整树事务 helper：`mindTreeRootId`/`mindTreeNodeIds`/`mindTreeLayout`/`setMindTreeLayout`/`setMindTreeRightNodeCount`/`mindLayoutBounds`/`offsetMindTreeRoots`/`stackMindTreeRoots`，一次事务更新根布局并清除后代与概要的局部覆盖（含折叠子树）。
  - Markdown 转换器拆分为 parse/richtext/serialize：多根、前言、跳级标题、合成中心（`fallbackTitle`）、嵌套列表、深层 7+ 级、引用块笔记（含标题/列表/代码块，不参与建树）、粗斜体/行内代码/链接 marks 往返；导出经 remark-stringify。
  - 产品入口：画布内导入预览追加、Mind 详情/引用菜单导出 Markdown（预览后复制或下载，不自动落盘）；多根导入纵向堆叠、追加置于现有内容右侧 80。文件树导入 `.md` 仍创建独立文档。

### Patch Changes

- Updated dependencies
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
  - @sue/board-common@2.0.0
  - @sue/board-core@2.0.0
  - @sue/board-mind@2.0.0
  - @sue/board-react@2.0.0

## 1.0.0

### Major Changes

- 121841e: Introduce the Cell/Frame API, domain registration extensions, and a unified FrameCanvas product entry. Persist assembled workspaces as immutable frame documents with a manifest commit point and migrate previous documents before opening them.

  Markdown and Mermaid converters now import and export FrameSnapshot directly. Product imports use the same native renderer for previews, and Electron waits for the workspace manifest commit before closing.

  FrameCanvas also exposes native SVG/PNG/JPEG export through its controller and frameSnapshotToImage, sharing the same renderer, layouts, selection closure and embedded frame coordinates. Product export options preserve transparent PNG and white JPEG behavior. SVG export keeps semantic bold marks. The selection toolbar stays clear of rotate handles, and embedded frame shells keep a hittable border inside the visible canvas.

  Mind summaries use native bracket rendering and transactional sibling endpoint editing in embedded and detail views, with range shrinkage and complete undo after topic deletion. Render extensions can read current layout geometry through FrameRenderContext.getGeometry.

  Remove the domain React Canvas, document Canvas, SceneGraphic, projection host and legacy style entrypoints. Domain React packages expose registration and rendering extensions for FrameCanvas.

  Remove the old BoardCanvas, ControlledBoard, Wrapper, renderer registry, element controller and element event plugins from board-react, including its legacy stylesheet entrypoint.

  Remove the engine BoardElement, BoardOperation, Board plugins, element renderers, document reducers and workflow key-prefix runtime. Domain engines expose native Cell utilities and commands. Legacy JSON schemas and forward converters are private to the application migration boundary; the former document conversion and storage APIs are removed. Text editor props no longer carry a Board runtime.

  Restore workflow auto layout as a native transaction, moving graph origins and fixed members together. Add transactional architecture layer ordering and ownership changes, retaining module interaction after sorting. Verify production Electron shutdown saves, restart recovery, legacy migration and disk failure retries with isolated user data.

  Add validated cut and system clipboard actions to FrameCanvas, preserving host acceptance and protected anchors. Restore multi-selection/group appearance, scoped SVG shadows, contiguous group layering, context actions and drawing/export shortcuts. Mind paste normalizes promoted roots, and native typing, expand and note shortcuts retain saved text.

  Restore batch typography and links, group and multi-selection dragging/alignment, document clear confirmation with protected scene anchors, Frame transfer through the canvas controller, select/duplicate/zoom shortcuts, grids, aspect presets, onboarding and stylus protection. Preserve effective layout coordinates during architecture property edits. New mind topics inherit typography with independent text identity and size-aware layout. Verify shared legacy domain copies, detached cyclic workflows, collision remapping and untouched migration backups through actual startup.

  Load the extracted native product stylesheet from both production application entrypoints. Anchor derived workflow layout at the fixed start event regardless of disconnected component ID order, preventing tasks from covering the protected start.

  Workspace manifests now write version 2. Readers still accept version 1 and repair it once. Frame records stay version 1. StorageAdapter may implement resetWorkspace: the host archives current data first, then installs an app-generated empty workspace. The save queue keeps enqueue, flush and dispose; flush waits until the latest sequence at call time, or a newer one, has been committed.

  Text editors accept autoFocus. The default remains focus-on-mount. Property fields pass false. planCellPaste plans a paste from the target store, frame, selection, optional mind target, offset, registry and displayed geometry, and returns operations plus the legal selection. Cell utils may implement requiresPasteOwner, pasteOwner, adjustPastedCell, rejectPaste and completePaste. Core does not import domain packages.

  Groups keep their field shape. Direct members may include nested groups and whiteboard arrows. Mermaid export rejects nested frames, groups and mind maps instead of omitting them.

  Canvas cameras are now memory-only: FrameView no longer contains viewport, navigation never commits a document or history entry, and reopening fits content. FrameCanvas adds autoFit and initialFocusCellId; detail returns focus the opened shell through an in-memory navigation trail. Legacy cameras are ignored and omitted from new saves/exports. Icon tooltips and rectangular marquee previews are restored, and stable scene geometry is cached across viewport changes.

- 135bf3f: Rename all publishable packages into the `@sue` scope while keeping board/verd-board identity prefixes (for example `@board/core` → `@sue/board-core`, `@verd-board/ui` → `@sue/verd-board-ui`).

### Minor Changes

- 8d6b923: Publish standard-document and projection canvases for mind, workflow, and architecture, and add Markdown/Mermaid conversions for those documents.
- 2086e7f: Add publishable Provider packages for controlled canvas, generic mind maps, and host-owned workflow graphs.

### Patch Changes

- Updated dependencies [135bf3f]
- Updated dependencies [121841e]
- Updated dependencies [8d6b923]
- Updated dependencies [2086e7f]
- Updated dependencies [135bf3f]
  - @sue/board-mind@1.0.0
  - @sue/board-core@1.0.0
  - @sue/board-common@1.0.0
  - @sue/board-react@1.0.0
