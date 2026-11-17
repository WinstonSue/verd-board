# Changelog

## 2.1.1

### Patch Changes

- Fix architecture container placement and relation routing, add independent text cards, unify theme color families and manual color preservation, improve document table controls and sidebar selection, and preserve conflicting legacy resources during migration. Stabilize document controls, port interactions, exports and isolated Web/Desktop validation; pin Electron 44.11.3 for cross-display window geometry.

## 2.1.0

### Major Changes

- b06ca40: Standardize bundled project and pattern workspaces with portable project context. Add explicit offline full updates with complete directory backups, restart recovery, retained project identity and terminal receipts, and instance generation checks that reject stale hosts and authoring plans.

  Use document navigation as the built-in project homepage and honor configured reading entries when no session has been saved. Preserve existing sessions and keep diagram navigation available through document links.

  Display the selected reading entry instead of hiding it behind the management homepage. Explain that installing the app preserves existing copies and that confirmed replacement opens the new navigation document.

  Move bilingual navigation to the workspace root and project diagrams into the diagrams directory. Consolidate navigation into reading indexes, replace document posters with compact source links, and permit existing plain text annotations in specialized scenes without adding them to scene layout membership.

- b06ca40: Remove deprecated CellIndex.membersOf: use groupOf for group membership and domainOwnerOf for domain ownership. Preserve combined lookup precedence with parentOf, domainOwnerOf, then groupOf. Remove legacyThemeColors and the ignored fifth resolveThemeColor argument; use the four-argument resolver and explicit custom color sources. Replace the UI WorkspaceId alias with EditorKind.

  Remove unused internal code and attachment scans, route Keep both through the registered workspace.resolve-conflict action, and synchronize bundled native project documentation and independent content release guidance.

- 33dc37e: Introduce explicit, instance-scoped CellPlugin and FrameUIPlugin composition for Draw, Mind, Workflow, Architecture and UML. Domain kinds and models move out of core. FrameEditor composes a complete editor from one domain; FrameCanvas takes the same pluginSet used for previews, references and image export. Add the Draw React package and public per-package CSS entries; keep rich text built into React core and inject optional converters from the host.

  Pass the installed registry to independent domain-sensitive helpers. Reject unknown kinds before opening or importing files, with no normalization or writes. Duplicate plugin IDs and kind conflicts fail explicitly; runtime installation is unsupported. Preserve atomic transaction/history behavior and existing FrameFileV2/DocumentFileV1 serialized fields. See the native Architecture, React integration and migration documents for the next-major contract. No version bump or publication is performed in this change.

- Extract Port, Anchor and Terminal into independent core modules with shared attachment resolution, port availability and terminal editing. Rename PortSpec to Port and EdgeTerminal to Terminal. Replace relativeAnchor, portAnchor, edgeTerminalPosition, availableEdgePorts, snapEdgeTerminal, replaceEdgeTerminal and bindEdgeRouteTerminals with resolveAnchor, resolvePort, resolveTerminal, availablePorts, snapTerminal, replaceTerminal and bindRouteTerminals. resolveTerminal returns undefined for an unresolved host and accepts explicit facing or center policies for automatic attachments.

  All three resolvers return the shared ResolvedAnchor shape containing point and side. Callers that previously used the coordinate returned by relativeAnchor should read resolveAnchor(...).point.

  Migrate engine, React and product consumers to the new APIs without compatibility aliases. Preserve native JSON, port-and-anchor bindings, domain routing preferences and endpoint controls based on the connector's actual cached route.

- 33dc37e: Unify editor toolbars, menus, shortcuts, command palettes, help and public user operations around instance-scoped Actions. Add the renderer-independent `@sue/board-react-actions` package. Replace discrete canvas/document controller mutation methods, plugin-local shortcuts, tool command callbacks and `CellUtil.keyboard` with shared action definitions, availability and execution. Capture original targets before focus or asynchronous transport changes; await actual host editing receipts and preserve cancellation, rejection and failure results.

  Add shared `WorkspaceTarget` codecs and stable single-Cell workspace links. Resolve Cell identity through the live owner index after cross-Frame moves, with the URL file ID as a hint/fallback. Replace legacy document-link exports and reveal props with common codecs, `FrameLinkHost`, abortable `revealTarget` and typed document navigation results. Temporarily expand required Mind ancestors through occurrence-local view projections; canonical content, undo history, other occurrences and exports remain unchanged.

  Map explicit standard and domain rich-text link slots once after copy/import/paste ownership is known, including custom UML plans. Custom `CellPastePlan` implementations must return `idMap`; inject protocol/text mappers into core registries without adding a core-to-common runtime dependency. Preserve `FrameFileV2`, `DocumentFileV1` and native bundle versions. See native React integration and migration documents for breaking API replacements. Prepare Changesets only; do not bump versions or publish as part of this change.

### Minor Changes

- 5571a9a: Add light and dark variants for Classic, Colorful, Soft, Retro, Fresh and Ocean while preserving existing theme IDs. Resolve canvas colors at render time, take over all unmarked component colors, and retain per-field custom color sources through edits, copying and inheritance. Adapt embedded documents, references and presentation without saving appearance into files or undo history. Image exports can use the current, light or dark appearance independently of their background choice and retain the full source content of selected references; existing third-party renderers retain legacy colors when appearance is omitted. Share domain color defaults across drawing and inspectors, add Mind branch reset, and distinguish explicitly authored Mermaid styles from renderer defaults.

  Make rich-text color provenance explicit with optional textStyle.attrs.colorSource. Unmarked and theme text inherits readable local colors in canvases, standalone documents and embedded documents; custom text keeps its literal color. Share the schema across previews and editors, preserve original literals and sources in HTML, record identical manual color choices, and clear only the color override when returning to the theme. Keep legacy third-party rendering and user workspace files unchanged; cover real legacy text marks, appearance switching, history, source roundtrips and image exports.

  Add five color roles, three emphasis levels and six coordinated categorical families to every theme appearance. Domain mappings distinguish workflow roles, architecture layers, UML classifiers and participants, drawing shape families, table headers and swimlanes. Share local fill/stroke/text resolution with inspectors and exports, preserve custom field overrides and Mind schemes, and document the actual palette values and swatches in the native architecture design.

- Introduce scene geometry policies and detailed joint layout/routing plans. Enforce painted node clearance through routing and cleanup, retry placement with wider channels, preserve manual routes in background work, support cyclic process layout, and retain failed edge-only routes with diagnostics. Keep domain projections, endpoint semantics, undo and saved route provenance intact.
- Prepare the application, SDK, UI and Agent together as 2.1.0 for this explicitly authorized early-stage release. This release includes the breaking API changes documented below; existing 2.0 consumers must follow the migration guide. Future releases retain the existing version rules. Local version preparation does not establish npm registry publication.

### Patch Changes

- b06ca40: Bound obstacle routing allocation, reuse prepared atomic transactions and topology indexes, and preserve unaffected workspace files and canvas state. Add opt-in layout dependency keys, shared spatial queries, geometry-based offscreen navigation, and buffered, staged mounting for large canvases.
- 33dc37e: Separate one-shot node layout and edge optimization from independently enabled session automation. Save one-shot optimized routes as editable points; preserve legacy strategy compatibility without implicit continuous work. Coalesce interaction previews and defer full routing until release, keeping automatic derived changes in the initiating transaction and undo entry.
- b06ca40: Reuse calculation-scoped hierarchy indexes for drag snap candidates and presentation visibility checks, removing quadratic whole-store scans from drag initialization and commit rendering. Preserve group, ancestor-lock, hidden-content and collapsed Mind semantics without caching mutable stores globally. Reuse pure topology, Workflow ownership and Mind branch reads within each synchronous full validation, clearing the context on completion or failure. Keep grouped Workflow and architecture layout conflicts visible through the shared lightweight availability check.
- 33dc37e: Add bounded deterministic one-shot route optimization, shared optimize/reset actions and a routing split button. Save optimized routes as editable orthogonal paths, preserving endpoint constraints and single-step undo. Continuous work requires an explicit session switch. Show canvas disabled reasons in accessible component tooltips instead of native browser titles.
- 33dc37e: Improve connected-node spacing, architecture terminal allocation and frame-wide orthogonal routing. Add display-only line jumps, rounded elbows and local relationship highlighting while preserving authored paths and document formats.

  Keep relationship hints subordinate to selection and simplify automatic short connector stairs within a bounded crossing budget, preserving authored waypoints.

  Unify node, connector and arrow interaction outlines in opaque #6366f1 with scene-scaled widths (authored width + 1 for selection/editing, authored width for self-hover and direct relationships) and a shared light/dark soft shadow. Keep interaction paint independent of authored opacity, width, color and shadow, update only local leaves during zoom or hover, and omit interaction outlines and filters from image export.

  Strengthen the shared interaction shadow with a 0.75px shadow-only spread, 2.25px / 90% light halo and 1.25px / 65% dark halo, with half the effective local stroke width plus 12px screen-space filter padding. Verify actual shadow pixels beyond the interaction stroke across backgrounds and zoom levels.

  Replace authored outlines during interaction instead of layering color over the original stroke. Highlight isolated nodes and Frame/reference shells on self-hover, preserve dash patterns and arrow semantics, and restore authored stroke paint in image clones without changing the live canvas.

- Move workflow starts independently without shifting other tasks or the legacy layout origin. Automatically assign nodes and groups to swimlanes only when fully contained, allowing boundary drops to release membership while preserving explicit assignment capacity checks.

## Unreleased

显式 CellPlugin/场景/关系策略；领域 kind、模型与 Draw 路径工具迁出 core。未知 kind 拒绝打开；同一 registry 用于独立辅助函数和原子运行时。

本轮不升级版本或发布，随下一主版本交付；参见原生架构和迁移文档。

## 2.0.0

### Major Changes

- CellStore、事务、历史、注册表与共享几何。新增 Frame/文档引用、NodeCell.name、UML 类型及命令支持；CellKind、Cell 等联合类型扩展，穷尽分支需更新。

  统一发布 2.0.0；对比基线为阿里云实际发布的 1.0.0。安装、CSS 入口和可编译示例见随包 README。

- b556617: 项目数据存储治理：画布按文件持久化，工作区取代平铺快照。

  - 每个可独立打开的 Frame 持久化为一份 `.verd.json`（FrameFileV2）；文件间以 `frame-reference` 引用壳互链，同一文件可被多处嵌入，壳几何/外观/思维导图偏移按实例保存，目标内容共享。
  - 新增 `WorkspaceHost` 存储抽象：Desktop 真实文件夹（事务日志崩溃恢复）、Web IndexedDB 虚拟目录；写入带 expectedVersion 条件提交，外部变更经订阅同步，冲突走 load-disk / keep-local / save-copy 显式解决。
  - 新增 `WorkspaceSession` 统一写入入口：命令经候选校验后原子提交，驱动统一撤销历史与去抖保存队列；支持文件创建/移动/回收区还原、普通引用复制与依赖闭包独立复制、导入导出。
  - 产品外壳 `WorkspaceApp`：文件树、`@ylib/tabs` 多标签（frameId 即标签身份）、工作区设置、空态与来源导航；首次启动自动迁移旧平铺存储为工作区文件。
  - 移除 `VerdBoardApp` 与平铺 manifest 保存队列（旧存储保留只读迁移路径）；`FrameCanvas` 新增引用渲染分支与按实例 mind 偏移。

  升级注意：旧平铺存储数据在首次打开时自动迁移到新工作区，原记录保留备份；`VerdBoardApp` 已删除，宿主改用 `WorkspaceApp` + `createDesktopWorkspaceHost`/`createWebWorkspaceHost`。

### Minor Changes

- a587c8c: Mind 节点外侧按钮统一用于折叠或展开子节点，叶子节点不再显示新增按钮；使用 Tab 新增子节点、Enter 新增同级节点。中心主题支持保存折叠状态，新增或移入子节点时自动展开，并保持单步撤销。
- b556617: Mind 功能迭代：笔记文本配置、Mind 配色方案、整树布局、Markdown 双向转换。

  - 新增 `FrameView.mind.colorScheme`（default/colorful/soft/retro/dark/starry），缺省继承画布主题；颜色按"显式标记 > 分支继承 > 方案 > 画布主题 > 默认色板"在渲染时解析，不批量写节点，旧文件无需迁移。
  - `FramePresentation`/`FrameNodeAppearanceValue` 增加可选 `stroke` 字段，外观缓存同步比较。
  - 笔记文本分组支持字号（默认 13）、颜色与"跟随主题"、粗斜体/下划线/删除线、对齐，作用于整篇笔记并保留 marks；空笔记禁用文字控件并提示。
  - `cell-tree.ts` 新增整树事务 helper：`mindTreeRootId`/`mindTreeNodeIds`/`mindTreeLayout`/`setMindTreeLayout`/`setMindTreeRightNodeCount`/`mindLayoutBounds`/`offsetMindTreeRoots`/`stackMindTreeRoots`，一次事务更新根布局并清除后代与概要的局部覆盖（含折叠子树）。
  - Markdown 转换器拆分为 parse/richtext/serialize：多根、前言、跳级标题、合成中心（`fallbackTitle`）、嵌套列表、深层 7+ 级、引用块笔记（含标题/列表/代码块，不参与建树）、粗斜体/行内代码/链接 marks 往返；导出经 remark-stringify。
  - 产品入口：画布内导入预览追加、Mind 详情/引用菜单导出 Markdown（预览后复制或下载，不自动落盘）；多根导入纵向堆叠、追加置于现有内容右侧 80。文件树导入 `.md` 仍创建独立文档。

- 6da91da: 原生项目文档迁入根工作区，并支持按稳定文件身份打开文档或画布及定位标题章节。

  - 独立文档提供标题锚点；DocumentPage 增加可选链接打开和导航请求接口，编辑态使用 Cmd/Ctrl 单击，只读态直接单击。
  - WorkspaceApp 支持可选工作区切换，保存成功后再更换会话；Host 可在激活后记住目录选择。
  - Desktop 使用内置项目工作区，新安装复制可编辑副本，已有资料与用户修改继续保留。
  - Markdown 行内代码按编辑器 schema 保留 code 标记，不能组合的外层格式返回明确降级告警。
  - 四类画布可放置独立文档引用，固定窗口中只读滚动全文；文档可插入原生画布预览，源文件内容共享并支持双向循环引用。
  - 文件副本及原生图文包携带完整嵌入闭包，统一重映射文档、画布和内部链接；项目导览拥有八张专题子图，并提供核心文档预览入口。
  - 后台快照若已被本地编辑或保存超越，等待队列落盘后重新读取，避免把自己的保存误报为外部冲突并阻断撤销。
  - 通用画布新增可编辑的 document-frame，与四类画布中的只读文档引用区分；双击正文编辑同一份源文档，撤销恢复原画布实例。八张专题子图补齐主文档卡和稳定章节链接。

- bb0fd66: Add native UML class and sequence diagram domains with editable members, relationships, multiplicities, ordered messages, activations, notes and nested alt/opt/loop fragments. Support Mermaid semantic import/export, shared runtime edge projection, native persistence, clipboard remapping and image export.

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

- 2086e7f: Add publishable Provider packages for controlled canvas, generic mind maps, and host-owned workflow graphs.

本包处于 VerdBoard monorepo 改造基线；历史独立版本记录已收束。

**文档**：请在仓库 [原生文档导航](../../../workspace/文档导航.verd-doc.json) 下查阅。

## 0.0.1

预发布基线：尚未对外发布。
