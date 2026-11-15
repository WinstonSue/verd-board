# @sue/verd-board-app

## 2.1.1

### Patch Changes

- Extract the shared workspace SDK so third-party Node Agent consumers do not install product app/ui. Add the generic FrameCanvasPreview API while preserving product defaults and existing headless exports. Move Agent packages out of product and organize product UI source by responsibility without changing public entrypoints.

  Reserve the canvas label padding when sizing architecture layer headings so short Latin SDK names remain visible in standalone previews.

- Updated dependencies
  - @sue/verd-board-workspace@2.2.0
  - @sue/verd-board-agent-patterns@2.1.1
  - @sue/verd-board-ui@2.1.1
  - @sue/board-react-uml@2.1.1

## 2.1.0

### Major Changes

- b06ca40: Standardize bundled project and pattern workspaces with portable project context. Add explicit offline full updates with complete directory backups, restart recovery, retained project identity and terminal receipts, and instance generation checks that reject stale hosts and authoring plans.

  Use document navigation as the built-in project homepage and honor configured reading entries when no session has been saved. Preserve existing sessions and keep diagram navigation available through document links.

  Display the selected reading entry instead of hiding it behind the management homepage. Explain that installing the app preserves existing copies and that confirmed replacement opens the new navigation document.

  Move bilingual navigation to the workspace root and project diagrams into the diagrams directory. Consolidate navigation into reading indexes, replace document posters with compact source links, and permit existing plain text annotations in specialized scenes without adding them to scene layout membership.

- 33dc37e: Introduce explicit, instance-scoped CellPlugin and FrameUIPlugin composition for Draw, Mind, Workflow, Architecture and UML. Domain kinds and models move out of core. FrameEditor composes a complete editor from one domain; FrameCanvas takes the same pluginSet used for previews, references and image export. Add the Draw React package and public per-package CSS entries; keep rich text built into React core and inject optional converters from the host.

  Pass the installed registry to independent domain-sensitive helpers. Reject unknown kinds before opening or importing files, with no normalization or writes. Duplicate plugin IDs and kind conflicts fail explicitly; runtime installation is unsupported. Preserve atomic transaction/history behavior and existing FrameFileV2/DocumentFileV1 serialized fields. See the native Architecture, React integration and migration documents for the next-major contract. No version bump or publication is performed in this change.

- 33dc37e: Separate current file identity, entry source and ownership in workspace navigation. Replace ownership breadcrumbs with a current-file header, per-file return context and grouped direct embed locations across canvases and documents. Preserve the source view on return, identify repeated embeds, and keep independent or unorganized files discoverable.

  Add `WorkspaceFileNavigation` and document-controller `locateFrameReference(targetFrameId, occurrence)`. Resolve document embeds against the current body and reject stale body revisions before selection. Route reference location and return through workspace Actions and editing receipts. Keep file formats and persistent workspace link addresses unchanged.

- 33dc37e: Remember successfully opened desktop workspaces across restarts and reopen them from the workspace menu or startup recovery page. Preserve save protection, retain unavailable folders without recreating them, and migrate the previous workspace selection.
- 33dc37e: Unify editor toolbars, menus, shortcuts, command palettes, help and public user operations around instance-scoped Actions. Add the renderer-independent `@sue/board-react-actions` package. Replace discrete canvas/document controller mutation methods, plugin-local shortcuts, tool command callbacks and `CellUtil.keyboard` with shared action definitions, availability and execution. Capture original targets before focus or asynchronous transport changes; await actual host editing receipts and preserve cancellation, rejection and failure results.

  Add shared `WorkspaceTarget` codecs and stable single-Cell workspace links. Resolve Cell identity through the live owner index after cross-Frame moves, with the URL file ID as a hint/fallback. Replace legacy document-link exports and reveal props with common codecs, `FrameLinkHost`, abortable `revealTarget` and typed document navigation results. Temporarily expand required Mind ancestors through occurrence-local view projections; canonical content, undo history, other occurrences and exports remain unchanged.

  Map explicit standard and domain rich-text link slots once after copy/import/paste ownership is known, including custom UML plans. Custom `CellPastePlan` implementations must return `idMap`; inject protocol/text mappers into core registries without adding a core-to-common runtime dependency. Preserve `FrameFileV2`, `DocumentFileV1` and native bundle versions. See native React integration and migration documents for breaking API replacements. Prepare Changesets only; do not bump versions or publish as part of this change.

- b06ca40: Unify personal preferences and project configuration in a searchable settings center, with ordered reading entries, scoped defaults, save feedback and safe project field patches. Preserve existing settings entry actions and standalone settings wrappers.
- b06ca40: Reorganize workspace navigation, chart browsing, switching and quick open around compact lists and consistent dialogs. Consolidate settings sections, preserve drafts while searching, commit text and numeric values when editing finishes, and retain existing action IDs and stored workspace formats.

  Unify interface typography around system fonts and a 14px baseline, adopt neutral appearance tokens, and preserve legacy canvas paint. Share modal, icon, form and settings primitives; align workspace switching, sidebar navigation, management lists and content actions. Keep nested menus inside modal portal roots and add style and geometry regression checks.

- Show ordinary workspace resources at their real paths, consolidate durable resources under `.verdscrolls/resources`, and migrate existing resource stores without changing attachment addresses. WorkspaceHost implementations must provide readResource and support resourceWrites/resourceVersions separately from content entries.

  Keep AGENTS.md and agent.md guidance out of content navigation while preserving the original files for Agent tools.

  Treat every diagram as an independent file. Remove canvas ownership commands, indexes and UI interfaces; copying and exporting follow actual references. Legacy organization fields remain readable and inert.

### Minor Changes

- a63a1ad: Add a standalone agent authoring CLI and independently maintained native pattern library. Share editor schemas, workspace validation and journaled filesystem commits with Desktop, expose atomic batch authoring, and initialize an editable pattern workspace without overwriting user copies. Include real-renderer previews and a bundled authoring skill.
- Add self-contained native v2 resource packages with validated, atomic file and asset import and idempotent recovery. Declare host workspace capabilities, keep saved names consistent with history, and finish management-view navigation correctly. Make read-only doctor exit unsuccessfully when the workspace is unready. Preserve native/v1 imports and existing third-party host behavior.

  Keep automatic camera fits synchronized with initial viewport and toolbar measurements until user interaction takes over, without writing document content or changing manually positioned cameras.

  Read focused native text selections without changing content, and synchronize canvas selections before rendering controls so stale editor ranges cannot overwrite a newly moved caret. Preserve text history.

- b06ca40: Add document folding, LaTeX nodes, resource cards, local media and PDF reading with stable asset page links. Keep canvas label schemas separate. Store portable binary assets without base64, add PDF runtime assets and restrict external frames and workspace IPC.
- b06ca40: Publish native project documentation and pattern workspaces as independently versioned npm resources. Desktop checks compatible releases using local npm credentials, reminds without downloading, and prepares verified exact versions before the existing backed-up atomic replacement. Keep offline recovery and project identity intact.
- b06ca40: Add searchable internal links, a separate knowledge relationship index, and read-only related-content previews. Keep embed dependency/export behavior unchanged. Documents can preview link targets from the link picker; workspace documents and canvases support Alt-click previews and source navigation.
- b06ca40: Add slash insertion and paragraph actions, native writing templates, stable block anchors and live read-only excerpts, portable content properties and saved filters, local content checkpoints with preview/restore, conflict comparison and independent recovery copies, managed image assets, and folder/ZIP migration with portable export reports. Keep resource writes in WorkspaceSession, guard them with content versions, and clear recoverable snapshots when their source is permanently deleted.
- Add a local filesystem service for Web with the shared desktop workspace lifecycle, typed HTTP/SSE host, directory selection, Git remote sync, Agent tools and complete browser-workspace migration. Declare host storage explicitly and preserve desktop entry points.

  Clear source IndexedDB records after a successful validated migration, retain the complete backup, protect concurrent edits and leave current browser data intact when importing a backup file.

- Use root Git repositories for explicit file and workspace versions. Add local browser Git, native Desktop Git and fast-forward remote synchronization, same-commit previews, guarded restores, and reviewed history cleanup with explicit remote-provider follow-up states. Keep legacy snapshots readable while removing automatic recovery snapshots and automatic commits.
- Expose provider-independent file and directory version history, with Git storage configuration in workspace settings. Add explicit scope, opaque version identifiers, capability and error contracts, reviewed creation plans, stable directory history across moves, and guarded directory restores that preserve unrelated content and staging. Retain existing repositories and legacy snapshots.
- b06ca40: Initialize AI project discovery when a filesystem workspace opens: preserve user AGENTS prose, link versioned shared tools/specifications, expose project context and readiness, and provide read-only context/doctor plus explicit init/repair commands. Migrate legacy metadata atomically to .verdscrolls with journal/receipt/trash preservation and legacy-writer guards. Bundle a checksum-verified standalone Node runtime and complete CLI dependencies in Desktop resources; retain older deployed resource versions and bind pending plans to the resource build.
- b06ca40: Add workspace creation and history management, home and unified content navigation, portable favorites and manual ordering, batch file and directory organization with undo, and local full-text search.
- Maintain workspace prompt supplements and independently named custom Skills in settings as standard SKILL.md documents. Preserve YAML metadata and referenced resources, use conditional transactions with conflict-safe drafts and idempotent retries, discover external Skills, and activate custom instructions by description. Skill changes invalidate prepared plans; bundled workspace updates retain user Skills.

  Provide a standard Skill entrance for every default pattern, referencing its native rules and templates. View the common authoring Skill, selected pattern Skill, Markdown source and related rules directly from the prompt scope selector. Keep the common authoring document in the content package as its single source while retaining the existing shared runtime path. Include registered default Skills in bundled release manifests and exclude Skill internals from content navigation and Markdown imports.

- Prepare the application, SDK, UI and Agent together as 2.1.0 for this explicitly authorized early-stage release. This release includes the breaking API changes documented below; existing 2.0 consumers must follow the migration guide. Future releases retain the existing version rules. Local version preparation does not establish npm registry publication.

### Patch Changes

- 33dc37e: Add a readiness-driven content fade and a thin progress strip shown only after navigation waits longer than 300ms. Track captured editing barriers, target readiness and positioning without remounting editors, and cancel stale navigation feedback on replacement, failure or workspace changes. Respect reduced motion and preserve document and canvas view state.
- 5571a9a: Add light and dark variants for Classic, Colorful, Soft, Retro, Fresh and Ocean while preserving existing theme IDs. Resolve canvas colors at render time, take over all unmarked component colors, and retain per-field custom color sources through edits, copying and inheritance. Adapt embedded documents, references and presentation without saving appearance into files or undo history. Image exports can use the current, light or dark appearance independently of their background choice and retain the full source content of selected references; existing third-party renderers retain legacy colors when appearance is omitted. Share domain color defaults across drawing and inspectors, add Mind branch reset, and distinguish explicitly authored Mermaid styles from renderer defaults.

  Make rich-text color provenance explicit with optional textStyle.attrs.colorSource. Unmarked and theme text inherits readable local colors in canvases, standalone documents and embedded documents; custom text keeps its literal color. Share the schema across previews and editors, preserve original literals and sources in HTML, record identical manual color choices, and clear only the color override when returning to the theme. Keep legacy third-party rendering and user workspace files unchanged; cover real legacy text marks, appearance switching, history, source roundtrips and image exports.

  Add five color roles, three emphasis levels and six coordinated categorical families to every theme appearance. Domain mappings distinguish workflow roles, architecture layers, UML classifiers and participants, drawing shape families, table headers and swimlanes. Share local fill/stroke/text resolution with inspectors and exports, preserve custom field overrides and Mind schemes, and document the actual palette values and swatches in the native architecture design.

- b06ca40: Bound obstacle routing allocation, reuse prepared atomic transactions and topology indexes, and preserve unaffected workspace files and canvas state. Add opt-in layout dependency keys, shared spatial queries, geometry-based offscreen navigation, and buffered, staged mounting for large canvases.
- 8edcd06: Bundle system introduction and pattern workspaces with the app, make backups optional and discoverable, preserve presentation across internal links, and correct content tabs, storage locations and search snippets.
- b06ca40: Remove deprecated CellIndex.membersOf: use groupOf for group membership and domainOwnerOf for domain ownership. Preserve combined lookup precedence with parentOf, domainOwnerOf, then groupOf. Remove legacyThemeColors and the ignored fifth resolveThemeColor argument; use the four-argument resolver and explicit custom color sources. Replace the UI WorkspaceId alias with EditorKind.

  Remove unused internal code and attachment scans, route Keep both through the registered workspace.resolve-conflict action, and synchronize bundled native project documentation and independent content release guidance.

- Separate user authoring recommendations from executable Agent defaults, with independent catalogs and loading entries. Keep existing Agent exports, editable library identities and manual update behavior while routing product templates to the user source.

  Add repository-wide development checks, full CI and publishing gates, and version-bound reviews of Agent tooling, user recommendations and the system introduction. Require substantive introduction updates for product and standalone package releases, and isolate production E2E probe artifacts from normal web output.

- b06ca40: Add configurable rich text link activation, make readonly and presentation links clickable, and simplify the document toolbar with accessible responsive menus. Remove the document body focus outline while retaining control and node selection feedback.
- 33dc37e: Separate one-shot node layout and edge optimization from independently enabled session automation. Save one-shot optimized routes as editable points; preserve legacy strategy compatibility without implicit continuous work. Coalesce interaction previews and defer full routing until release, keeping automatic derived changes in the initiating transaction and undo entry.
- 33dc37e: Reduce tab switching and document opening work by caching workspace snapshots, isolating document page rendering, reusing editor setup, and checking native export dependencies without cloning files.
- b06ca40: Dismiss file menus reliably when clicking the canvas, add stable file link copying, and replace the persistent canvas text form with a themed selection-only formatting toolbar.
- Extract Port, Anchor and Terminal into independent core modules with shared attachment resolution, port availability and terminal editing. Rename PortSpec to Port and EdgeTerminal to Terminal. Replace relativeAnchor, portAnchor, edgeTerminalPosition, availableEdgePorts, snapEdgeTerminal, replaceEdgeTerminal and bindEdgeRouteTerminals with resolveAnchor, resolvePort, resolveTerminal, availablePorts, snapTerminal, replaceTerminal and bindRouteTerminals. resolveTerminal returns undefined for an unresolved host and accepts explicit facing or center policies for automatic attachments.

  All three resolvers return the shared ResolvedAnchor shape containing point and side. Callers that previously used the coordinate returned by relativeAnchor should read resolveAnchor(...).point.

  Migrate engine, React and product consumers to the new APIs without compatibility aliases. Preserve native JSON, port-and-anchor bindings, domain routing preferences and endpoint controls based on the connector's actual cached route.

- 33dc37e: Handle command palette shortcuts before editor key isolation and add opt-in root fallback for body/html focus after reload. Preserve nearest-scope routing and modal ownership, and keep document page actions alive through React StrictMode effect replay.
- Keep connectors and arrows fixed when ports appear, prioritize selected node or edge ports, and enlarge connection editing targets. Add non-blocking workflow port-direction guidance for agent authoring.
- 33dc37e: Introduce typed Schema settings panels, reusable geometry definitions and additive propertyPanels/settingsPanels plugin contributions. Migrate ordinary application, workspace, common and domain fields while retaining existing controls, commit timing, inheritance, transactions and history. Preserve concurrent host fields when applying inspector edits.

  Consume the separately maintained Settings SDK through published package versions. Candidate integration and consumer scripts accept a checksummed tarball manifest; publish the Schema runtime/SDK and pin its final versions before registry-only release verification. No version bump or publication is performed here.

- 33dc37e: Start a clearer 180ms opacity transition after the target editor is ready, independently of loading completion. Add immutable per-file persistence feedback and source-aware page save status so opening files and persisting navigation do not report unsaved content or change file save times. Keep workspace-level failures visible and handle in-flight edits, retries, moves, organization and conflict resolution.
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
- Updated dependencies [b06ca40]
- Updated dependencies [b06ca40]
- Updated dependencies [b06ca40]
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @sue/verd-board-ui@2.1.0
  - @sue/board-common@2.1.0
  - @sue/board-core@2.1.0
  - @sue/board-draw@2.1.0
  - @sue/board-mind@2.1.0
  - @sue/board-react-text@2.1.0
  - @sue/board-react-uml@2.1.0
  - @sue/verd-board-agent-patterns@2.1.0
  - @sue/board-uml@2.1.0
  - @sue/board-markdown-to-text@2.1.0
  - @sue/board-workflow@2.1.0
  - @sue/board-architecture@2.1.0
  - @sue/board-react-actions@2.1.0
  - @sue/board-layouts@2.1.0

## Unreleased

工作区、持久化、导入和实例运行时显式传递产品插件 registry；已有文件格式版本不变。

本轮不升级版本或发布，随下一主版本交付；参见原生架构和迁移文档。

## 2.0.0

### Major Changes

- b556617: 独立文档成为工作区一等文件类型：与画布共用文件树、标签页、存储、回收站与统一撤销历史。

  - 新增 `DocumentFileV1` 与 `WorkspaceFile` 联合类型；文档以 `.verd-doc.json` 持久化，正文复用 `BoardTextDocument`。三类 Host（内存 / Web IndexedDB / Desktop 文件系统）统一识别与读写文档；快照拆分为 `files`（画布）/ `documents` / `entries`。
  - `WorkspaceSession` 文件命令泛化：创建 / 更新 / 重命名 / 移动 / 回收 / 还原 / 复制 / 导入对两种文件类型生效；撤销历史带 `group` / `name` / `primaryFileId` / `selection` 元数据，连续同组编辑合并为一步，画布与文档共享同一时间线；保存队列修复版本链缺陷（已提交操作不再重复入队），`flush()` 对 I/O 失败返回 `false` 而非抛错。
  - 冲突与外部变更覆盖文档：外部写入同步进干净文档，脏文档标记 `conflicted`，`resolveConflict` 支持 keep-local / load-disk 且可撤销。
  - 新增 `DocumentEditor`（`@sue/board-react-text`）：连续页编辑、工具栏状态订阅、标题层级/TOC、查找替换、表格与自定义图片节点、IME 合成与输入分组；提供中央历史适配器时关闭本地 TipTap undo，undo/redo 恢复编辑器选区。
  - 新增 `DocumentPage`（`@sue/verd-board-ui`）：标题栏、保存状态、固定工具栏、可折叠目录、查找替换栏、表格操作、图片插入与 JSON/Markdown 导出菜单；`FileTree` / `WorkspaceTabs` / `WorkspaceEmpty` 支持文档的创建、图标与操作。
  - `WorkspaceApp` 接入共享历史适配器（同时传给 `VerdFrame` 与 `DocumentPage`）；注册 `host.onShutdown(flush)`，Desktop 退出前等待落盘，Web 增加 `pagehide` best-effort flush；导入接受 `.md`（生成新文档）与 `.verd-doc.json`，导出支持原生 JSON 与 Markdown，转换降级告警经 notice 横幅呈现。
  - 新包 `@sue/board-markdown-to-text`：remark/GFM 双向转换——标题、段落、强调/删除线、链接、图片、列表、引用、代码块、分隔线、表格；无法表达的结构降级为可读文本并返回告警，绝不静默丢弃。

  升级注意：`WorkspaceSessionSnapshot.files` 现在仅含画布，文档经 `documents` 访问；`tabs` 统一为 `{fileId}`（旧 `{frameId}` 自动归一化）；`VerdBoardApp` 仍由 `WorkspaceApp` 取代。

- 文件工作区与会话。VerdBoardApp 改为 WorkspaceApp({host})；WorkspaceHost、WorkspaceSession 统一保存/历史/冲突，支持 FrameFileV2 与 DocumentFileV1。旧 StorageAdapter 仍作为迁移边界保留。

  统一发布 2.0.0；对比基线为阿里云实际发布的 1.0.0。安装、CSS 入口和可编译示例见随包 README。

- b556617: 项目数据存储治理：画布按文件持久化，工作区取代平铺快照。

  - 每个可独立打开的 Frame 持久化为一份 `.verd.json`（FrameFileV2）；文件间以 `frame-reference` 引用壳互链，同一文件可被多处嵌入，壳几何/外观/思维导图偏移按实例保存，目标内容共享。
  - 新增 `WorkspaceHost` 存储抽象：Desktop 真实文件夹（事务日志崩溃恢复）、Web IndexedDB 虚拟目录；写入带 expectedVersion 条件提交，外部变更经订阅同步，冲突走 load-disk / keep-local / save-copy 显式解决。
  - 新增 `WorkspaceSession` 统一写入入口：命令经候选校验后原子提交，驱动统一撤销历史与去抖保存队列；支持文件创建/移动/回收区还原、普通引用复制与依赖闭包独立复制、导入导出。
  - 产品外壳 `WorkspaceApp`：文件树、`@ylib/tabs` 多标签（frameId 即标签身份）、工作区设置、空态与来源导航；首次启动自动迁移旧平铺存储为工作区文件。
  - 移除 `VerdBoardApp` 与平铺 manifest 保存队列（旧存储保留只读迁移路径）；`FrameCanvas` 新增引用渲染分支与按实例 mind 偏移。

  升级注意：旧平铺存储数据在首次打开时自动迁移到新工作区，原记录保留备份；`VerdBoardApp` 已删除，宿主改用 `WorkspaceApp` + `createDesktopWorkspaceHost`/`createWebWorkspaceHost`。

### Minor Changes

- d4ba734: 增加浅色、深色和跟随系统的应用外观偏好，在「我的」中即时切换并在本机保存。Web 和 Desktop 共用配色，独立文档适配深色；画布、嵌入文档与图像导出保留文件原有外观，不产生文件内容变更或撤销记录。
- b556617: Add fullscreen presentation of current canvas content in an independent read-only overlay using the same registry and render extensions with click-to-focus, overview, a laser pointer, and structural steps for mind maps and architecture layers. Exit restores the editing viewport; presentation state stays in memory without changing document history or saved files.

  Remove obsolete slide generation, persisted decks, speaker notes, ink, timers, autoplay, and audience-window protocols and preload/IPC plumbing. Ignore stale imported presentation fields without migration or proactive rewrites, and preserve node appearance FramePresentation hooks.

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
- 6da91da: 补齐文件夹整体回收与还原、回收项永久删除和清空能力；永久删除清理相关历史，三个宿主支持按回收项标识幂等提交。「我的」管理个人偏好，工作区设置提供基本设置和当前工作区回收站分栏；工作区设置和 Desktop 目录操作集中在顶部工作区名称菜单，页面一次返回原编辑器，保留现有偏好存储。

  文件树按真实路径显示所有画布、专业图和文档，所属画布下保留带标识的导航快捷入口，支持打开和定位源文件。图表库支持单图归属调整与撤销；两处入口共用文件身份、标签页及编辑器，无需存储迁移。

### Patch Changes

- ba40661: Render passive document references without editor instances, stage embedded previews across frames, and reuse unchanged canvas surfaces. Unify Frame shells and document reading/editing layout with lightweight inline editing.
- 6da91da: Move document reference navigation and inline editing controls into Frame title bars. Connect bulk tab closing and add persistent tab groups with shared file editors and legacy session migration.

  Keep tab menus stable while focused document titles commit, and retarget pending document writes during moves and renames so closing a group preserves unsaved edits.

- b556617: 工作区外壳视觉与交互修整：文件树行菜单（⋯ 与右键）、按深度缩进与类型图标、可折叠回收区；标签栏、图表库、整理预览与设置页统一为画布的 slate + 靛蓝风格；工作区设置改为独立全屏页（`WorkspaceSettings` 新增 `onBack`、`defaultName`，移除 `globalContent`），`FrameSettingsPage` 导出并支持 `backLabel`。修复工作区配置输入回滚，以及提交在途时改配置导致同批写入被丢弃；导入失败改为通知，不再替换整个工作区。
- Updated dependencies [d4ba734]
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
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
- Updated dependencies [b556617]
- Updated dependencies [b556617]
- Updated dependencies [bb0fd66]
- Updated dependencies
- Updated dependencies [b556617]
- Updated dependencies [b556617]
- Updated dependencies [6da91da]
  - @sue/verd-board-ui@2.0.0
  - @sue/board-architecture@2.0.0
  - @sue/board-common@2.0.0
  - @sue/board-core@2.0.0
  - @sue/board-draw@2.0.0
  - @sue/board-layouts@2.0.0
  - @sue/board-markdown-to-text@2.0.0
  - @sue/board-mind@2.0.0
  - @sue/board-react-uml@2.0.0
  - @sue/board-uml@2.0.0
  - @sue/board-workflow@2.0.0

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

- 135bf3f: Add whiteboard special components and exclusive mind editing, with per-document DAG or cyclic process connection rules.
- 8d6b923: Publish standard-document and projection canvases for mind, workflow, and architecture, and add Markdown/Mermaid conversions for those documents.
- 2086e7f: Add publishable Provider packages for controlled canvas, generic mind maps, and host-owned workflow graphs.
- 5638318: Share one workflow scene between the detail editor and whiteboard special components, and route edges by geometry unless a port was chosen explicitly.
- 2086e7f: Open exclusive Mind and Workflow editors from whiteboard living components instead of top-level product tabs.

### Patch Changes

- Updated dependencies [135bf3f]
- Updated dependencies [121841e]
- Updated dependencies [8d6b923]
- Updated dependencies [2086e7f]
- Updated dependencies [135bf3f]
- Updated dependencies [5638318]
- Updated dependencies [2086e7f]
  - @sue/verd-board-ui@1.0.0
  - @sue/board-workflow@1.0.0
  - @sue/board-mind@1.0.0
  - @sue/board-core@1.0.0
  - @sue/board-common@1.0.0
  - @sue/board-draw@1.0.0
  - @sue/board-architecture@1.0.0
  - @sue/board-layouts@1.0.0
