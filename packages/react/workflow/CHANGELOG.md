# @sue/board-react-workflow

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
- 5638318: Share one workflow scene between the detail editor and whiteboard special components, and route edges by geometry unless a port was chosen explicitly.

### Patch Changes

- 135bf3f: Add whiteboard special components and exclusive mind editing, with per-document DAG or cyclic process connection rules.
- Updated dependencies [135bf3f]
- Updated dependencies [121841e]
- Updated dependencies [8d6b923]
- Updated dependencies [2086e7f]
- Updated dependencies [135bf3f]
- Updated dependencies [5638318]
  - @sue/board-workflow@1.0.0
  - @sue/board-core@1.0.0
  - @sue/board-react@1.0.0
