# @sue/board-react

## 2.0.0

### Major Changes

- 统一 FrameCanvas；1.0.0 已提供此入口。新增引用宿主、文档窗口、移动预览和控制器能力；保留 value/onChange 与 adapter/onIntent 两种模式。右键菜单改在松开鼠标后显示。

  统一发布 2.0.0；对比基线为阿里云实际发布的 1.0.0。安装、CSS 入口和可编译示例见随包 README。

- b556617: 项目数据存储治理：画布按文件持久化，工作区取代平铺快照。

  - 每个可独立打开的 Frame 持久化为一份 `.verd.json`（FrameFileV2）；文件间以 `frame-reference` 引用壳互链，同一文件可被多处嵌入，壳几何/外观/思维导图偏移按实例保存，目标内容共享。
  - 新增 `WorkspaceHost` 存储抽象：Desktop 真实文件夹（事务日志崩溃恢复）、Web IndexedDB 虚拟目录；写入带 expectedVersion 条件提交，外部变更经订阅同步，冲突走 load-disk / keep-local / save-copy 显式解决。
  - 新增 `WorkspaceSession` 统一写入入口：命令经候选校验后原子提交，驱动统一撤销历史与去抖保存队列；支持文件创建/移动/回收区还原、普通引用复制与依赖闭包独立复制、导入导出。
  - 产品外壳 `WorkspaceApp`：文件树、`@ylib/tabs` 多标签（frameId 即标签身份）、工作区设置、空态与来源导航；首次启动自动迁移旧平铺存储为工作区文件。
  - 移除 `VerdBoardApp` 与平铺 manifest 保存队列（旧存储保留只读迁移路径）；`FrameCanvas` 新增引用渲染分支与按实例 mind 偏移。

  升级注意：旧平铺存储数据在首次打开时自动迁移到新工作区，原记录保留备份；`VerdBoardApp` 已删除，宿主改用 `WorkspaceApp` + `createDesktopWorkspaceHost`/`createWebWorkspaceHost`。

### Minor Changes

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

- b556617: 独立文档成为工作区一等文件类型：与画布共用文件树、标签页、存储、回收站与统一撤销历史。

  - 新增 `DocumentFileV1` 与 `WorkspaceFile` 联合类型；文档以 `.verd-doc.json` 持久化，正文复用 `BoardTextDocument`。三类 Host（内存 / Web IndexedDB / Desktop 文件系统）统一识别与读写文档；快照拆分为 `files`（画布）/ `documents` / `entries`。
  - `WorkspaceSession` 文件命令泛化：创建 / 更新 / 重命名 / 移动 / 回收 / 还原 / 复制 / 导入对两种文件类型生效；撤销历史带 `group` / `name` / `primaryFileId` / `selection` 元数据，连续同组编辑合并为一步，画布与文档共享同一时间线；保存队列修复版本链缺陷（已提交操作不再重复入队），`flush()` 对 I/O 失败返回 `false` 而非抛错。
  - 冲突与外部变更覆盖文档：外部写入同步进干净文档，脏文档标记 `conflicted`，`resolveConflict` 支持 keep-local / load-disk 且可撤销。
  - 新增 `DocumentEditor`（`@sue/board-react-text`）：连续页编辑、工具栏状态订阅、标题层级/TOC、查找替换、表格与自定义图片节点、IME 合成与输入分组；提供中央历史适配器时关闭本地 TipTap undo，undo/redo 恢复编辑器选区。
  - 新增 `DocumentPage`（`@sue/verd-board-ui`）：标题栏、保存状态、固定工具栏、可折叠目录、查找替换栏、表格操作、图片插入与 JSON/Markdown 导出菜单；`FileTree` / `WorkspaceTabs` / `WorkspaceEmpty` 支持文档的创建、图标与操作。
  - `WorkspaceApp` 接入共享历史适配器（同时传给 `VerdFrame` 与 `DocumentPage`）；注册 `host.onShutdown(flush)`，Desktop 退出前等待落盘，Web 增加 `pagehide` best-effort flush；导入接受 `.md`（生成新文档）与 `.verd-doc.json`，导出支持原生 JSON 与 Markdown，转换降级告警经 notice 横幅呈现。
  - 新包 `@sue/board-markdown-to-text`：remark/GFM 双向转换——标题、段落、强调/删除线、链接、图片、列表、引用、代码块、分隔线、表格；无法表达的结构降级为可读文本并返回告警，绝不静默丢弃。

  升级注意：`WorkspaceSessionSnapshot.files` 现在仅含画布，文档经 `documents` 访问；`tabs` 统一为 `{fileId}`（旧 `{frameId}` 自动归一化）；`VerdBoardApp` 仍由 `WorkspaceApp` 取代。

- bb0fd66: Add native UML class and sequence diagram domains with editable members, relationships, multiplicities, ordered messages, activations, notes and nested alt/opt/loop fragments. Support Mermaid semantic import/export, shared runtime edge projection, native persistence, clipboard remapping and image export.

### Patch Changes

- ba40661: Render passive document references without editor instances, stage embedded previews across frames, and reuse unchanged canvas surfaces. Unify Frame shells and document reading/editing layout with lightweight inline editing.
- 6da91da: Move document reference navigation and inline editing controls into Frame title bars. Connect bulk tab closing and add persistent tab groups with shared file editors and legacy session migration.

  Keep tab menus stable while focused document titles commit, and retarget pending document writes during moves and renames so closing a group preserves unsaved edits.

- 40e4077: 画布右键菜单在松开鼠标后显示，右键拖动画布或取消操作时不再误弹菜单。
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies [ba40661]
- Updated dependencies [a587c8c]
- Updated dependencies [b556617]
- Updated dependencies [6da91da]
- Updated dependencies [b556617]
- Updated dependencies [bb0fd66]
- Updated dependencies [b556617]
  - @sue/board-common@2.0.0
  - @sue/board-core@2.0.0
  - @sue/board-react-text@2.0.0

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

- Updated dependencies [121841e]
- Updated dependencies [2086e7f]
- Updated dependencies [135bf3f]
  - @sue/board-core@1.0.0
  - @sue/board-common@1.0.0
  - @sue/board-react-text@1.0.0
