# @sue/board-react-draw

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

- 5571a9a: Add light and dark variants for Classic, Colorful, Soft, Retro, Fresh and Ocean while preserving existing theme IDs. Resolve canvas colors at render time, take over all unmarked component colors, and retain per-field custom color sources through edits, copying and inheritance. Adapt embedded documents, references and presentation without saving appearance into files or undo history. Image exports can use the current, light or dark appearance independently of their background choice and retain the full source content of selected references; existing third-party renderers retain legacy colors when appearance is omitted. Share domain color defaults across drawing and inspectors, add Mind branch reset, and distinguish explicitly authored Mermaid styles from renderer defaults.

  Make rich-text color provenance explicit with optional textStyle.attrs.colorSource. Unmarked and theme text inherits readable local colors in canvases, standalone documents and embedded documents; custom text keeps its literal color. Share the schema across previews and editors, preserve original literals and sources in HTML, record identical manual color choices, and clear only the color override when returning to the theme. Keep legacy third-party rendering and user workspace files unchanged; cover real legacy text marks, appearance switching, history, source roundtrips and image exports.

  Add five color roles, three emphasis levels and six coordinated categorical families to every theme appearance. Domain mappings distinguish workflow roles, architecture layers, UML classifiers and participants, drawing shape families, table headers and swimlanes. Share local fill/stroke/text resolution with inspectors and exports, preserve custom field overrides and Mind schemes, and document the actual palette values and swatches in the native architecture design.

- Prepare the application, SDK, UI and Agent together as 2.1.0 for this explicitly authorized early-stage release. This release includes the breaking API changes documented below; existing 2.0 consumers must follow the migration guide. Future releases retain the existing version rules. Local version preparation does not establish npm registry publication.

### Patch Changes

- Extract Port, Anchor and Terminal into independent core modules with shared attachment resolution, port availability and terminal editing. Rename PortSpec to Port and EdgeTerminal to Terminal. Replace relativeAnchor, portAnchor, edgeTerminalPosition, availableEdgePorts, snapEdgeTerminal, replaceEdgeTerminal and bindEdgeRouteTerminals with resolveAnchor, resolvePort, resolveTerminal, availablePorts, snapTerminal, replaceTerminal and bindRouteTerminals. resolveTerminal returns undefined for an unresolved host and accepts explicit facing or center policies for automatic attachments.

  All three resolvers return the shared ResolvedAnchor shape containing point and side. Callers that previously used the coordinate returned by relativeAnchor should read resolveAnchor(...).point.

  Migrate engine, React and product consumers to the new APIs without compatibility aliases. Preserve native JSON, port-and-anchor bindings, domain routing preferences and endpoint controls based on the connector's actual cached route.

- 33dc37e: Improve connected-node spacing, architecture terminal allocation and frame-wide orthogonal routing. Add display-only line jumps, rounded elbows and local relationship highlighting while preserving authored paths and document formats.

  Keep relationship hints subordinate to selection and simplify automatic short connector stairs within a bounded crossing budget, preserving authored waypoints.

  Unify node, connector and arrow interaction outlines in opaque #6366f1 with scene-scaled widths (authored width + 1 for selection/editing, authored width for self-hover and direct relationships) and a shared light/dark soft shadow. Keep interaction paint independent of authored opacity, width, color and shadow, update only local leaves during zoom or hover, and omit interaction outlines and filters from image export.

  Strengthen the shared interaction shadow with a 0.75px shadow-only spread, 2.25px / 90% light halo and 1.25px / 65% dark halo, with half the effective local stroke width plus 12px screen-space filter padding. Verify actual shadow pixels beyond the interaction stroke across backgrounds and zoom levels.

  Replace authored outlines during interaction instead of layering color over the original stroke. Highlight isolated nodes and Frame/reference shells on self-hover, preserve dash patterns and arrow semantics, and restore authored stroke paint in image clones without changing the live canvas.

- Updated dependencies [5571a9a]
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
- Updated dependencies [b06ca40]
- Updated dependencies
- Updated dependencies [b06ca40]
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
  - @sue/board-common@2.1.0
  - @sue/board-core@2.1.0
  - @sue/board-draw@2.1.0
  - @sue/board-react@2.1.0

## Unreleased

### Major Changes

- 新增独立 Draw UI 插件：绘图工具、几何/图像/表格/泳道/路径渲染与交互、属性和公开 CSS 入口。通过 createDrawUIPlugin() 与 FrameEditor/createFramePluginSet 组合，不依赖其他领域、产品包或转换器。
- 本轮不升级版本或发布；随下一主版本交付。
