# Changelog

## 2.0.0

### Major Changes

- Markdown 与 Mind FrameSnapshot 双向转换。保留前两个参数，新增第三个 MarkdownParseOptions；改进多根、深层列表、笔记与富文本往返。

  统一发布 2.0.0；对比基线为阿里云实际发布的 1.0.0。安装、CSS 入口和可编译示例见随包 README。

### Minor Changes

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
- Updated dependencies [a587c8c]
- Updated dependencies [b556617]
- Updated dependencies [6da91da]
- Updated dependencies [b556617]
- Updated dependencies [bb0fd66]
- Updated dependencies [b556617]
  - @sue/board-common@2.0.0
  - @sue/board-core@2.0.0
  - @sue/board-mind@2.0.0

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

### Patch Changes

- Updated dependencies [135bf3f]
- Updated dependencies [121841e]
- Updated dependencies [8d6b923]
- Updated dependencies [2086e7f]
- Updated dependencies [135bf3f]
  - @sue/board-mind@1.0.0
  - @sue/board-core@1.0.0

本包处于 VerdBoard monorepo 改造基线；历史独立版本记录已收束，避免与当前未发布状态混淆。

**文档**：请在仓库 [原生文档导航](../../../workspace/文档/文档导航.verd-doc.json) 下查阅设计与包索引。

## 0.0.1

预发布基线：尚未对外发布，API 与行为仍可能调整。
