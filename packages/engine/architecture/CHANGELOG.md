# @sue/board-architecture

## 2.1.0

### Major Changes

- 33dc37e: Introduce explicit, instance-scoped CellPlugin and FrameUIPlugin composition for Draw, Mind, Workflow, Architecture and UML. Domain kinds and models move out of core. FrameEditor composes a complete editor from one domain; FrameCanvas takes the same pluginSet used for previews, references and image export. Add the Draw React package and public per-package CSS entries; keep rich text built into React core and inject optional converters from the host.

  Pass the installed registry to independent domain-sensitive helpers. Reject unknown kinds before opening or importing files, with no normalization or writes. Duplicate plugin IDs and kind conflicts fail explicitly; runtime installation is unsupported. Preserve atomic transaction/history behavior and existing FrameFileV2/DocumentFileV1 serialized fields. See the native Architecture, React integration and migration documents for the next-major contract. No version bump or publication is performed in this change.

### Minor Changes

- Prepare the application, SDK, UI and Agent together as 2.1.0 for this explicitly authorized early-stage release. This release includes the breaking API changes documented below; existing 2.0 consumers must follow the migration guide. Future releases retain the existing version rules. Local version preparation does not establish npm registry publication.

### Patch Changes

- Introduce scene geometry policies and detailed joint layout/routing plans. Enforce painted node clearance through routing and cleanup, retry placement with wider channels, preserve manual routes in background work, support cyclic process layout, and retain failed edge-only routes with diagnostics. Keep domain projections, endpoint semantics, undo and saved route provenance intact.
- 33dc37e: Improve connected-node spacing, architecture terminal allocation and frame-wide orthogonal routing. Add display-only line jumps, rounded elbows and local relationship highlighting while preserving authored paths and document formats.

  Keep relationship hints subordinate to selection and simplify automatic short connector stairs within a bounded crossing budget, preserving authored waypoints.

  Unify node, connector and arrow interaction outlines in opaque #6366f1 with scene-scaled widths (authored width + 1 for selection/editing, authored width for self-hover and direct relationships) and a shared light/dark soft shadow. Keep interaction paint independent of authored opacity, width, color and shadow, update only local leaves during zoom or hover, and omit interaction outlines and filters from image export.

  Strengthen the shared interaction shadow with a 0.75px shadow-only spread, 2.25px / 90% light halo and 1.25px / 65% dark halo, with half the effective local stroke width plus 12px screen-space filter padding. Verify actual shadow pixels beyond the interaction stroke across backgrounds and zoom levels.

  Replace authored outlines during interaction instead of layering color over the original stroke. Highlight isolated nodes and Frame/reference shells on self-hover, preserve dash patterns and arrow semantics, and restore authored stroke paint in image clones without changing the live canvas.

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

新增 createArchitecturePlugin；层/模块模型、排列、归属、级联删除与路由策略归领域所有。

本轮不升级版本或发布，随下一主版本交付；参见原生架构和迁移文档。

## 2.0.0

### Major Changes

- 原生架构层、模块、依赖与布局。新增 architectureLayerIds，模块 Util 移动支持新的上下文；现有画布工厂保留。

  统一发布 2.0.0；对比基线为阿里云实际发布的 1.0.0。安装、CSS 入口和可编译示例见随包 README。

### Minor Changes

- b556617: Add fullscreen presentation of current canvas content in an independent read-only overlay using the same registry and render extensions with click-to-focus, overview, a laser pointer, and structural steps for mind maps and architecture layers. Exit restores the editing viewport; presentation state stays in memory without changing document history or saved files.

  Remove obsolete slide generation, persisted decks, speaker notes, ink, timers, autoplay, and audience-window protocols and preload/IPC plumbing. Ignore stale imported presentation fields without migration or proactive rewrites, and preserve node appearance FramePresentation hooks.

### Patch Changes

- Updated dependencies
- Updated dependencies [a587c8c]
- Updated dependencies [b556617]
- Updated dependencies [6da91da]
- Updated dependencies [bb0fd66]
- Updated dependencies [b556617]
  - @sue/board-core@2.0.0

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

### Minor Changes

- 8d6b923: Publish standard-document and projection canvases for mind, workflow, and architecture, and add Markdown/Mermaid conversions for those documents.

### Patch Changes

- Updated dependencies [121841e]
- Updated dependencies [2086e7f]
- Updated dependencies [135bf3f]
  - @sue/board-core@1.0.0
