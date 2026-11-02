import { FrameVirtualLayer } from './frame-virtual-layer';
import { shouldActivateRichTextLink } from '@sue/board-react-text';
import {
  resolveBoardTheme,
  readableThemeText,
  type BoardAppearance,
  type ResolvedBoardTheme,
} from '@sue/board-core';
import {
  resolveFrameCellAppearance,
  type FrameThemeAppearanceContext,
  type FrameThemeAppearance,
  type ResolvedFrameCellAppearance,
} from './frame-appearance';
import {
  FrameThemeContext,
  FrameThemeGroup,
  frameThemeStyle,
  useFrameAppearance,
} from './frame-theme';
import {
  createFrameLayouts,
  sameGeometry,
  type FrameLayoutMemory,
} from './frame-scene-layout';
import {
  captureAutoCalculationScope,
  prepareAutoCalculation,
  pruneAutoCalculationConfig,
  useFrameAutoCalculation,
  type FrameAutoCalculationConfig,
} from './frame-auto-calculation';
import { FrameReferenceBoundary } from './frame-reference-boundary';
import { FrameContentVisibility } from './frame-content-visibility';
import { useFrameI18n } from './frame-i18n';
import {
  Alignment,
  createInlineText,
  isBoardTextDocument,
  sameBoardText,
  type ActionResult,
  type ActionState,
  type ActionInvocation,
  type BoundAction,
  type BoardTextDocument,
} from '@sue/board-common';
import {
  alignCells,
  applyCellOperations,
  planCellLayout,
  resolveCellArrangementScope,
  arrangementEdgeIds,
  rerouteEdges,
  optimizeEdges,
  optimizableEdgeIds,
  arrangementAvailability,
  assertRegisteredCellKinds,
  bindEdgeRouteTerminals,
  cellArrangementBounds,
  collectArrangementBlocks,
  copyCellFragment,
  createCellRegistry,
  changedCellIds,
  createCellRuntime,
  createDefaultShapeGeometryRegistry,
  createEdgeRoutingContext,
  frameEdgeCrossingJumps,
  curvePath,
  deleteCells,
  distanceToPolyline,
  distributeCells,
  edgeLabelLayout,
  edgePolyline,
  edgeRoutePoints,
  edgeTerminalPosition,
  fitFrameContent,
  flattenCurve,
  focusedCellIds,
  frameContentBounds,
  frameContentViewport,
  frameMinimumSize,
  frameScene,
  frameVisualBounds,
  groupAncestors,
  groupBounds,
  groupCells,
  groupHasLockedLeaf,
  groupLeafMembers,
  hitNodeShape,
  isDocumentCell,
  isDocumentFrameCell,
  isEdgeCell,
  isFrameCell,
  isFrameReferenceCell,
  isGroupCell,
  isNodeCell,
  moveEdgeRoutePoint,
  moveEdgeSegment,
  moveGroup,
  moveWhiteboardCells,
  nodeContentName,
  nodeShapeGeometry,
  nodeShapeSpec,
  normalizeCellPositionOperations,
  planCellPaste,
  polylineClosestPosition,
  polylinePath,
  portAnchor,
  relativeAnchor,
  replaceEdgeTerminal,
  resizeNodeGeometry,
  rotateNodeGeometry,
  roundNodeGeometry,
  roundNodePosition,
  selectionAllows,
  selectionObjectAtFocus,
  setCellsLocked,
  snapEdgeTerminal,
  stripFrameViewports,
  translateCellSelection,
  ungroupCells,
  unionCellBounds,
  type Cell,
  type CellChange,
  type CellFragment,
  type CellMoveContext,
  type CellOperation,
  type CellRegistry,
  type CellRuntime,
  type CellSelection,
  type CellStore,
  type CellTransaction,
  type EdgeCell,
  type FrameSnapshot,
  type NodeCell,
  type NodeGeometry,
  type Point,
  type RectangleClient,
  type ResizeHandle,
} from '@sue/board-core';
import { measureBoardText } from '@sue/board-react-text';
import {
  ActionScope,
  resolveActionShortcut,
  type ActionSource,
} from '@sue/board-react-actions';
import {
  createFrameActions,
  frameIntentActionResult,
  type FrameActionServices,
  type FrameSelectionOperation,
} from './frame-actions';
import {
  type FrameViewProjection,
  type FrameLinkHost,
  type FrameRevealRequest,
  type FrameRevealResult,
} from './frame-view-projection';
import {
  createContext,
  forwardRef,
  memo,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { snapArrangementDelta, type AlignmentGuide } from './frame-alignment';
import {
  createFrameCameraStore,
  type FrameNodeAppearanceValue,
} from './frame-camera-store';
import {
  FrameScenePreview,
  FrameNodeAppearance,
  FrameScaleContent,
  FrameInteractiveEdge,
  FrameStaticSceneContext,
  FrameReferenceCard,
  FrameDetailsButton,
  previewProjection,
} from './frame-scene';
import { FrameNodeInteraction } from './frame-relation-highlight';
import { frameSnapshotToImage, type FrameImageOptions } from './frame-export';
import {
  fitContentCandidates,
  fitContentOperations,
} from './frame-fit-content';
import {
  normalizeInteractionMultiplier,
  type FrameCanvasInteractionSettings,
} from './frame-interaction-settings';
import { createFrameLockResolver } from './frame-locks';
import { createFrameNativeEvents } from './frame-native-events';
import {
  frameCellUI,
  projectEmbeddedContent,
  referenceContentOffsets,
  updateContentOffset,
  type FramePluginSet,
  type FrameUIPlugin,
  type FrameActionContext,
  type FrameActionHost,
} from './frame-plugins';
import {
  FrameRichText,
  FrameRichTextPreviewContext,
  FrameRichTextLinkContext,
  FrameRichTextLinkPolicyContext,
} from './frame-rich-text';
import { frameSelectionWorldBounds } from './frame-selection-camera';
import { FrameSelectionHandles } from './frame-selection-handles';
import { FrameCellShadow, FrameStaticShadow } from './frame-shadow';
import { FrameShell } from './frame-shell';
import { FrameTextEditor } from './frame-text-editor';
import {
  frameTitleCss,
  FrameTitleEditor,
  frameTitleStyle,
} from './frame-title-editor';
import {
  interpolateViewport,
  prefersReducedMotion,
  PRESENTATION_CAMERA_MS,
  viewportForBounds,
  type ViewportInsets,
} from './frame-viewport';
import { createFrameWheelOwner, FrameWheelContext } from './frame-wheel';
import { PreviewMountProvider, usePreviewMount } from './preview-mount';
export type { FrameCanvasInteractionSettings } from './frame-interaction-settings';

export interface FrameRenderContext {
  appearance?: BoardAppearance;
  theme?: ResolvedBoardTheme;
  resolvedAppearance?: Readonly<ResolvedFrameCellAppearance>;
  selectionIds?: readonly string[];
  store: CellStore;
  viewProjection: FrameViewProjection;
  clearRevealOverrides?(ids?: readonly string[]): void;
  cell: Cell;
  geometry?: NodeGeometry;
  selected: boolean;
  pending: boolean;
  readonly: boolean;
  frameId: string;
  scale: number;
  hovered?: boolean;
  /** A visual-only drawing draft: no controls, focus or document actions. */
  preview?: boolean;
  /** Current layout geometry, including previews, in this mounted Frame. */
  getGeometry(id: string): NodeGeometry | undefined;
  select(): void;
  edit?(id: string): void;
  history(action: 'undo' | 'redo'): void;
  dispatch(transaction: CellTransaction): Promise<FrameIntentResult>;
  /** Continuous text submission joins the editing barrier without recursively starting an Action. */
  commitEditing?(transaction: CellTransaction): Promise<FrameIntentResult>;
}
export interface FramePresentation {
  fill?: string;
  color?: string;
  stroke?: string;
}
export interface FrameMovePreviewContext extends CellMoveContext {
  store: CellStore;
  cell: NodeCell;
  frameId: string;
  preview: NodeGeometry;
  scale: number;
}
export interface FrameMovePreview {
  operations: CellOperation[];
  ghost?: { parentId: string; cellIds: readonly string[] };
}
export interface FrameRenderExtension {
  /** Theme defaults for this kind; explicit per-field custom colors still win. */
  themeAppearance?: (
    context: FrameThemeAppearanceContext,
  ) => FrameThemeAppearance | undefined;
  plugin?: FrameUIPlugin;
  kind?: string;
  layout?: (
    store: CellStore,
    frameId: string,
    projection?: FrameViewProjection,
  ) => Map<string, NodeGeometry>;
  /** Complete immutable dependencies; omitted keys retain eager computation. */
  layoutCacheKey?: (
    store: CellStore,
    frameId: string,
    projection?: FrameViewProjection,
  ) => readonly unknown[];
  layoutEdgesCacheKey?: (
    store: CellStore,
    frameId: string,
    geometry: ReadonlyMap<string, NodeGeometry>,
  ) => readonly unknown[];
  /** Pure runtime projection of existing edges, shared by paint, hit testing and export. */
  layoutEdges?: (
    store: CellStore,
    frameId: string,
    geometry: ReadonlyMap<string, NodeGeometry>,
  ) => Map<string, EdgeCell>;
  render?: (context: FrameRenderContext) => ReactNode;
  /** Override only the outline, retaining native text, selection and editing. */
  renderShape?: (context: FrameRenderContext) => ReactNode;
  /**
   * Opt in to immutable outline caching. Include every renderShape dependency;
   * values are compared with Object.is. Camera/hover subscriptions remain live.
   */
  renderShapeCacheKey?: (context: FrameRenderContext) => readonly unknown[];
  textBounds?: (
    context: FrameRenderContext,
  ) => import('@sue/board-core').RectangleClient;
  presentation?: (context: FrameRenderContext) => FramePresentation | undefined;
  /** Hover controls. Wrappers are excluded from image export. */
  renderControls?: (context: FrameRenderContext) => ReactNode;
  visible?: (context: FrameRenderContext) => boolean;
  /** Opt in when model bounds remain authoritative for this Frame. */
  virtualizable?: (store: CellStore, frameId: string) => boolean;
  /** Pure move plan shared by the live preview and final drop. */
  previewMove?: (
    context: FrameMovePreviewContext,
  ) => FrameMovePreview | undefined;
}
export interface FrameCanvasViewState {
  canUndo: boolean;
  canRedo: boolean;
  pending: boolean;
  readonly: boolean;
  zoom: number;
  dragging: boolean;
  selectionScreenBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
}
export interface FrameAdapter<T> {
  toFrameSnapshot(value: T): FrameSnapshot;
}
export interface FrameOpenSource {
  sourceFileId: string;
  refId: string;
  occurrenceId: string;
}
export interface FrameInstanceQuery {
  ownerFileId: string;
  refId: string;
  targetFrameId: string;
  appearance: string[];
  /**
   * Occurrence that contains this reference. Read-only previews pass their
   * own id so the inner file inherits that read-only state.
   */
  parentOccurrenceId?: string;
}
export interface FrameInstanceBinding {
  occurrenceId: string;
  runtime: CellRuntime;
  /** Interior edits are rejected. Shell edits stay on the parent canvas. */
  readonly: boolean;
  /** Regular-canvas preview: offer 「打开编辑」 when the preview is empty. */
  preview: boolean;
}
export interface FrameReferenceSource {
  getSnapshot(frameId: string): FrameSnapshot | null;
  subscribe(listener: () => void): () => void;
}
export interface FrameInstanceHost {
  source?: FrameReferenceSource;
  /** Lookup only. Must not allocate or activate. */
  get(query: FrameInstanceQuery): FrameInstanceBinding | null;
  /** Mount lifecycle. Must not run during render. */
  acquire(
    query: FrameInstanceQuery,
    options?: { edit?: boolean },
  ): void | (() => void);
  release(query: FrameInstanceQuery): void;
  commit(
    occurrenceId: string,
    transaction: CellTransaction,
  ): Promise<FrameIntentResult>;
  updateContentOffset?(
    occurrenceId: string,
    rootId: string,
    offset: Point,
  ): void;
}
export type FrameIntentResult =
  { status: 'accepted' } | { status: 'rejected'; message?: string };
export interface FrameHistoryAdapter {
  undo(): void | Promise<unknown>;
  redo(): void | Promise<unknown>;
  /**
   * Real availability for toolbar state. Absent = legacy behavior where an
   * external adapter keeps the buttons enabled unconditionally.
   */
  canUndo?(): boolean;
  canRedo?(): boolean;
  /** True while a workspace commit is still in flight. */
  busy?(): boolean;
}
type FrameSelectionCommand = FrameSelectionOperation;
interface FrameViewServices {
  exportImage(options?: FrameImageOptions): Promise<Blob>;
  dispatch(transaction: CellTransaction): Promise<FrameIntentResult>;
  /** Screen point to canvas world coordinates, including the current camera. */
  clientToWorld(clientX: number, clientY: number): [number, number];
  setZoom(zoom: number): void;
  selectionScreenBounds(): FrameCanvasViewState['selectionScreenBounds'];
  fitBounds(
    bounds: RectangleClient,
    options?: {
      animate?: boolean;
      minZoom?: number;
      maxZoom?: number;
      insets?: ViewportInsets;
    },
  ): void;
  /** Fit mounted cells without changing selection. False when none are visible. */
  fitCells(
    ids: readonly string[],
    options?: {
      animate?: boolean;
      minZoom?: number;
      maxZoom?: number;
      insets?: ViewportInsets;
    },
  ): boolean;
  getContentBounds(): RectangleClient;
}
export interface FrameCanvasController {
  resolveAppearance(cellId: string): ResolvedFrameCellAppearance | undefined;
  readonly actionSource: ActionSource;
  getActionContext(): FrameActionContext;
  getActiveController(): FrameCanvasController;
  findOccurrence(occurrenceId: string): FrameCanvasController | null;
  getActionState(id: string, args?: unknown): ActionState;
  getAutoCalculation(): FrameAutoCalculationConfig;
  setAutoLayoutStyle(style: import('@sue/board-core').CellLayoutStyle): void;
  executeAction(
    id: string,
    args?: unknown,
    invocation?: ActionInvocation,
  ): Promise<ActionResult>;
  actions(): readonly BoundAction[];
  flushEditing(): Promise<FrameIntentResult>;
  captureDocumentEditingView(): FrameDocumentEditingView | null;
  restoreDocumentEditingView(
    view: FrameDocumentEditingView,
    signal?: AbortSignal,
  ): Promise<ActionResult>;
  revealTarget(request: FrameRevealRequest): Promise<FrameRevealResult>;
  clearRevealOverrides(ids?: readonly string[]): void;
  getViewProjection(): FrameViewProjection;
  getCamera(): { zoom: number; origination: Point };
  restoreCamera(camera: { zoom: number; origination: Point }): void;
  runtime: CellRuntime;
  dispatch(transaction: CellTransaction): Promise<FrameIntentResult>;
  exportImage(options?: FrameImageOptions): Promise<Blob>;
  clientToWorld(clientX: number, clientY: number): [number, number];
  selectionScreenBounds(): FrameCanvasViewState['selectionScreenBounds'];
  fitBounds: FrameViewServices['fitBounds'];
  fitCells: FrameViewServices['fitCells'];
  getContentBounds(): RectangleClient;
}
export interface FrameCanvasDrawingContext {
  zoom: number;
  /** Stable for the entire gesture, including the final commit. */
  idFor(key: string): string;
}
export type FrameCanvasTool =
  | { mode: 'select' | 'hand' | 'erase'; key?: string }
  | {
      mode: 'box' | 'path' | 'line' | 'polyline';
      key?: string;
      onComplete?(): void;
      /** Pure draft operations; these never enter the runtime or history. */
      preview?(
        store: CellStore,
        frameId: string,
        points: Point[],
        context: FrameCanvasDrawingContext,
      ): readonly CellOperation[];
      complete(
        store: CellStore,
        frameId: string,
        points: Point[],
        context?: FrameCanvasDrawingContext,
      ): CellOperation[];
    };
export interface FrameDocumentReferenceProps {
  referenceInteraction?: 'direct' | 'details';
  onOpenDetails?(open: () => void): void;
  kind: 'document-frame' | 'document-reference';
  annotation?: import('@sue/board-common').BoardTextDocument;
  ownerFrameId: string;
  cellId: string;
  readonly: boolean;
  editing: boolean;
  onExitEdit(): void;
  targetDocumentId: string;
  instanceId: string;
  suspended: boolean;
  exporting: boolean;
}
/** Adapter-owned state; the canvas does not depend on a document text schema. */
export interface FrameDocumentEditingView {
  cellId: string;
  state: unknown;
}
export interface FrameDocumentReferences {
  flushEditing?(instanceId: string): Promise<ActionResult>;
  captureEditingView?(instanceId: string): FrameDocumentEditingView | null;
  restoreEditingView?(
    view: FrameDocumentEditingView,
    activate: (instanceId: string) => void,
    signal?: AbortSignal,
  ): Promise<ActionResult>;
  editRequest?: { instanceId: string; nonce: number };
  /** Changes when preview dependencies change, including on a stable adapter. */
  readonly revision?: unknown;
  /** Stable dependency token for one occurrence, respecting its expansion path. */
  getRevision?(targetId: string, referenceSeen?: readonly string[]): unknown;
  title(targetDocumentId: string): string | undefined;
  /** Product controls rendered in the shell title bar, outside its document body. */
  renderHeaderActions?(props: FrameDocumentReferenceProps): ReactNode;
  render(props: FrameDocumentReferenceProps): ReactNode;
}
interface FrameCanvasCommon {
  /** Omit to retain legacy colors; supplied appearances never change the snapshot. */
  appearance?: BoardAppearance;
  referenceInteraction?: 'direct' | 'activate' | 'details';
  pluginSet?: FramePluginSet;
  documentReferences?: FrameDocumentReferences;
  exporting?: boolean;
  /** Device interaction preferences; camera-only, never written to the document. */
  interactionSettings?: FrameCanvasInteractionSettings;
  autoCalculation?: FrameAutoCalculationConfig;
  onAutoCalculationChange?(config: FrameAutoCalculationConfig): void;
  frameId?: string;
  registry?: CellRegistry;
  extensions?: readonly FrameRenderExtension[];
  readonly?: boolean;
  history?: FrameHistoryAdapter;
  className?: string;
  style?: CSSProperties;
  onSelectionChange?: (selection: CellSelection) => void;
  onOpenFrame?: (frameId: string, source?: FrameOpenSource) => void;
  /**
   * Product sessions inject the occurrence runtime. The canvas does not
   * replace it from `value` and does not keep a second content history.
   */
  runtime?: CellRuntime;
  /** Nested reference surfaces inherit the parent camera and ignore wheel pan. */
  surface?: 'root' | 'nested';
  /** DOM/clip scope so duplicate references do not share clip ids. */
  instanceId?: string;
  /** Hidden canvases stay mounted but do not take focus or shortcuts. */
  suspended?: boolean;
  /** Product reference instances. Absent hosts keep the assembled render path. */
  instanceHost?: FrameInstanceHost;
  onActiveInstance?: (occurrenceId: string | null) => void;
  onInstanceSelection?: (selection: CellSelection) => void;
  /** Nested surface: Escape after text edit returns to the reference shell. */
  onExitInstance?: () => void;
  embedShell?: {
    refId: string;
    geometry: import('@sue/board-core').NodeGeometry;
    offsets: ReadonlyMap<string, Point>;
    onContentOffset(rootId: string, offset: Point): void;
  };
  /** One-shot place mode. Click reports a world point; Escape cancels. */
  placing?: boolean;
  onPlace?: (point: Point) => void;
  onCancelPlace?: () => void;
  onReject?: (
    result: Extract<FrameIntentResult, { status: 'rejected' }>,
  ) => void;
  onViewStateChange?: (state: FrameCanvasViewState) => void;
  onCanvasContextMenu?: (point: [number, number] | null) => void;
  actionHost?: FrameActionHost;
  linkHost?: FrameLinkHost;
  overlays?: ReactNode;
  /** Fit once on each canvas entry. Offscreen image export opts out. */
  autoFit?: boolean;
  /**
   * Nested reference surfaces map this world point to the viewport origin so
   * shell-space content stays inside the foreignObject and receives hits.
   */
  viewportOrigin?: Point;
  /** Frames already entered through references. Stops a preview from looping. */
  referenceSeen?: readonly string[];
  /** Full appearance identity; cycle detection separately tracks target frame ids. */
  referenceAppearance?: readonly string[];
  /** An initial camera target only; it does not alter selection. */
  initialFocusCellId?: string;
  viewportInsets?: { top: number; right: number; bottom: number; left: number };
  tool?: FrameCanvasTool;
  /** Presentation blocks document edits while camera motion stays available. */
  inputMode?: 'edit' | 'present';
  /** A primary tap in present mode; embedded content reports its owning shell. */
  onPresentTap?: (cellId: string | null) => void;
}
export type FrameCanvasProps<T = FrameSnapshot> = FrameCanvasCommon &
  (
    | {
        value: FrameSnapshot;
        onChange?: (change: CellChange) => void;
        adapter?: never;
        onIntent?: never;
      }
    | {
        value: T;
        adapter: FrameAdapter<T>;
        onIntent?: (
          transaction: CellTransaction,
        ) => void | FrameIntentResult | Promise<void | FrameIntentResult>;
        onChange?: never;
      }
  );
const RuntimeContext = createContext<CellRuntime | null>(null);
function FrameCanvasProviders({
  theme,
  runtime,
  wheelOwner,
  children,
}: {
  theme: ResolvedBoardTheme;
  runtime: CellRuntime;
  wheelOwner: ReturnType<typeof createFrameWheelOwner>;
  children: ReactNode;
}) {
  return (
    <FrameThemeContext.Provider value={theme}>
      <RuntimeContext.Provider value={runtime}>
        <FrameWheelContext.Provider value={wheelOwner}>
          <PreviewMountProvider>{children}</PreviewMountProvider>
        </FrameWheelContext.Provider>
      </RuntimeContext.Provider>
    </FrameThemeContext.Provider>
  );
}
export const useFrameRuntime = (): CellRuntime => {
  const runtime = useContext(RuntimeContext);
  const staticScene = useContext(FrameStaticSceneContext);
  if (!runtime || staticScene)
    throw new Error('FrameCanvas context is missing');
  return runtime;
};
export const useFrameSelection = () => {
  const runtime = useFrameRuntime();
  useSyncExternalStore(
    runtime.subscribe,
    () => runtime.revision,
    () => runtime.revision,
  );
  return runtime.selection;
};

const OutlineParts = memo(function OutlineParts({
  parts,
}: {
  parts: readonly { d: string; fill?: string; strokeDasharray?: string }[];
}) {
  return (
    <>
      {parts.map((part, index) => (
        <path
          key={index}
          data-shape-part={index}
          d={part.d}
          fill={part.fill}
          strokeDasharray={part.strokeDasharray}
        />
      ))}
    </>
  );
});
const transactionId = () => globalThis.crypto.randomUUID();
const zeroOrigin: Point = [0, 0];
const noReferenceSubscription = () => () => {};
const drawingContext = (zoom: number): FrameCanvasDrawingContext => {
  const ids = new Map<string, string>();
  return {
    zoom,
    idFor(key) {
      let id = ids.get(key);
      if (!id) {
        id = transactionId();
        ids.set(key, id);
      }
      return id;
    },
  };
};
const rejectPreviewIntent = async (): Promise<FrameIntentResult> => ({
  status: 'rejected',
  message: 'Drawing previews cannot edit the document',
});
type DrawingTool = Extract<FrameCanvasTool, { complete: unknown }>;
interface ConnectionDraft {
  cellId: string;
  portId: string;
  frameId: string;
  key: string;
  id: string;
  kind: string;
  point: Point;
  target: EdgeCell['target'];
  scale: number;
}

const defaultCamera = (): import('@sue/board-core').Viewport => ({
  zoom: 1,
  origination: [0, 0],
});
export const FrameCanvas = forwardRef(function FrameCanvas<T>(
  suppliedProps: FrameCanvasProps<T>,
  ref: React.ForwardedRef<FrameCanvasController>,
) {
  const inheritedAppearance = useFrameAppearance();
  const combinedExtensions = useMemo(() => {
    const set = suppliedProps.pluginSet;
    if (!set) return suppliedProps.extensions;
    const extras = suppliedProps.extensions?.filter(
      (extension) => !set.extensions.includes(extension),
    );
    return extras?.length ? [...extras, ...set.extensions] : set.extensions;
  }, [suppliedProps.extensions, suppliedProps.pluginSet]);
  const props = {
    ...suppliedProps,
    appearance: suppliedProps.appearance ?? inheritedAppearance,
    registry: suppliedProps.pluginSet?.registry ?? suppliedProps.registry,
    extensions: combinedExtensions,
  };
  const snapshot = useMemo(() => {
    const projected = props.adapter
      ? props.adapter.toFrameSnapshot(props.value as T)
      : (props.value as FrameSnapshot);
    if (props.pluginSet)
      assertRegisteredCellKinds(projected.store, props.pluginSet.registry);
    return { store: stripFrameViewports(projected.store) };
  }, [props.value, props.adapter, props.pluginSet]);
  const runtimeRef = useRef<CellRuntime | null>(props.runtime ?? null);
  if (props.runtime) runtimeRef.current = props.runtime;
  else if (!runtimeRef.current)
    runtimeRef.current = createCellRuntime(
      snapshot,
      props.registry ?? createCellRegistry(),
    );
  const runtime = runtimeRef.current;
  const revision = useSyncExternalStore(
    runtime.subscribe,
    () => runtime.revision,
    () => runtime.revision,
  );
  const lockResolvers = useMemo(
    () => new WeakMap<CellStore, ReturnType<typeof createFrameLockResolver>>(),
    [],
  );
  const lockedByAncestor = useCallback(
    (store: CellStore, id: string) => {
      let resolve = lockResolvers.get(store);
      if (!resolve)
        lockResolvers.set(store, (resolve = createFrameLockResolver(store)));
      return resolve(id);
    },
    [lockResolvers],
  );
  const frameId = props.frameId ?? runtime.store.rootId;
  const [autoCalculation, setAutoCalculation] = useFrameAutoCalculation(
    frameId,
    props.autoCalculation,
    props.onAutoCalculationChange,
  );
  const autoCalculationRef = useRef(autoCalculation);
  autoCalculationRef.current = autoCalculation;
  const autoLayoutStyleRef = useRef<
    import('@sue/board-core').CellLayoutStyle | null
  >(null);
  useEffect(() => {
    const config = autoCalculationRef.current;
    const next = pruneAutoCalculationConfig(runtime.store, config);
    if (next !== config) {
      autoCalculationRef.current = next;
      setAutoCalculation(next);
    }
    // The setter follows the current controlled host or inherited session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime, revision, autoCalculation]);
  const [viewProjection, setViewProjection] = useState<FrameViewProjection>(
    () => ({
      identity: {},
      expandedCellIds: new Set(),
      purpose: props.exporting ? 'export' : 'interactive',
    }),
  );
  const viewProjectionRef = useRef(viewProjection);
  viewProjectionRef.current = viewProjection;
  const [revealHighlight, setRevealHighlight] = useState<string | null>(null);
  const [revealBounds, setRevealBounds] = useState<RectangleClient | null>(
    null,
  );
  const revealToken = useRef(0);
  const revealTargetRef = useRef<
    (request: FrameRevealRequest) => Promise<FrameRevealResult>
  >(async () => ({ status: 'cancelled', code: 'not-ready' }));
  const layoutReadyRef = useRef<FrameViewProjection>(viewProjection);
  const layoutWaiters = useRef(new Set<() => void>());
  const alive = useRef(true);
  const lifetime = useRef(new AbortController());
  const clearRevealOverrides = (ids?: readonly string[]) => {
    if (!ids) {
      revealToken.current++;
      setRevealHighlight(null);
      for (const done of layoutWaiters.current) done();
    }
    const next = ids
      ? new Set(
          [...viewProjectionRef.current.expandedCellIds].filter(
            (id) => !ids.includes(id),
          ),
        )
      : new Set<string>();
    if (next.size === viewProjectionRef.current.expandedCellIds.size) return;
    setViewProjection({
      identity: {},
      expandedCellIds: next,
      purpose: 'interactive',
    });
  };
  useEffect(() => {
    const invalid = [...viewProjectionRef.current.expandedCellIds].filter(
      (id) => !runtime.store.cells[id],
    );
    if (invalid.length) clearRevealOverrides(invalid);
  }, [runtime, revision]);
  const lastIntentPrediction = useRef<{
    before: CellStore;
    expected: CellStore;
    acknowledged?: boolean;
  } | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const keyboardSelectionRef = useRef<{
    ids: string[];
    focus: string[];
    accepted: boolean;
    created?: { key: string; frameId: string; onComplete?: () => void };
  } | null>(null);
  const keyboardEditRef = useRef<{
    id: string;
    label: string;
    accepted: boolean;
  } | null>(null);
  const connectingRef = useRef<ConnectionDraft | null>(null);
  const [connectionPreview, setConnectionPreview] =
    useState<ConnectionDraft | null>(null);
  const [documentEditing, setDocumentEditing] = useState<string | null>(null);
  const [activeReferenceId, setActiveReferenceId] = useState<string | null>(
    null,
  );
  const activeReferenceRef = useRef<string | null>(null);
  const activeReferenceTarget = useRef<string | null>(null);
  const activeSourceSnapshot = useSyncExternalStore(
    props.instanceHost?.source?.subscribe ?? noReferenceSubscription,
    () => {
      const ref = runtime.store.cells[activeReferenceId ?? ''];
      return isFrameReferenceCell(ref)
        ? (props.instanceHost?.source?.getSnapshot(ref.data.targetFrameId) ??
            null)
        : null;
    },
    () => null,
  );
  const inlineSequence = useRef(0);
  const inlineExitInFlight = useRef<Promise<boolean> | null>(null);
  const inlineDocumentViews = useRef(
    new Map<string, FrameDocumentEditingView>(),
  );
  const inlineRestoreAbort = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      inlineSequence.current++;
      inlineRestoreAbort.current?.abort();
    },
    [],
  );
  const inlineViews = useRef(
    new Map<
      string,
      {
        targetId: string;
        selection: CellSelection;
        camera: ReturnType<FrameCanvasController['getCamera']>;
      }
    >(),
  );

  const [editing, setEditingState] = useState<string | null>(null);
  const editingCellRef = useRef<string | null>(null);
  const textCommitRef = useRef<Promise<FrameIntentResult> | null>(null);
  const composingRef = useRef(false);
  const documentCommitRef = useRef<Promise<ActionResult> | null>(null);
  const nameSession = useRef<{ id: string; initial: string } | null>(null);
  const finishNameRef = useRef<
    (session: { id: string; initial: string }) => void
  >(() => {});
  const setEditing = useCallback(
    (next: string | null) => {
      if (next && next !== editingCellRef.current) textCommitRef.current = null;
      editingCellRef.current = next;
      const previous = nameSession.current;
      if (previous && previous.id !== next) {
        nameSession.current = null;
        finishNameRef.current(previous);
      }
      if (next && nameSession.current?.id !== next) {
        const cell = runtime.store.cells[next];
        if (isNodeCell(cell) && cell.name === undefined)
          nameSession.current = { id: next, initial: nodeContentName(cell) };
      }
      setEditingState(next);
    },
    [runtime],
  );
  const [dragging, setDragging] = useState(false);
  const spaceHandRef = useRef(false);
  useEffect(() => {
    const release = (event: KeyboardEvent) => {
      if (event.code === 'Space') spaceHandRef.current = false;
    };
    window.addEventListener('keyup', release);
    return () => window.removeEventListener('keyup', release);
  }, []);
  const rightDragRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);
  const presentTapRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    cellId: string | null;
  } | null>(null);
  const pointersRef = useRef(new Map<number, Point>());
  const pinchRef = useRef<{
    distance: number;
    zoom: number;
    origin: Point;
    center: Point;
  } | null>(null);
  const blockSinglePointerRef = useRef(false);
  const boundsRef = useRef<() => FrameCanvasViewState['selectionScreenBounds']>(
    () => null,
  );
  const [labelEditing, setLabelEditing] = useState<{
    id: string;
    index: number;
  } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const pointFromEventRef = useRef<
    (event: { clientX: number; clientY: number }) => Point
  >(() => [0, 0]);
  const worldRef = useRef<SVGGElement>(null);
  const viewportRectRef = useRef<
    Pick<DOMRect, 'left' | 'top' | 'width' | 'height'> | undefined
  >(undefined);
  const viewportRectDirty = useRef(true);
  const viewportAnimation = useRef(false);
  const lastViewportWheel = useRef(-Infinity);
  const captureViewportRect = useCallback((rect?: DOMRect) => {
    const measured = rect ?? svgRef.current?.getBoundingClientRect();
    if (measured)
      viewportRectRef.current = {
        left: measured.left,
        top: measured.top,
        width: measured.width,
        height: measured.height,
      };
    viewportRectDirty.current = false;
    return measured;
  }, []);
  const selectionProjectionRef = useRef<{
    frameId: string;
    selection: CellSelection;
    bounds: ReturnType<typeof frameSelectionWorldBounds>;
  } | null>(null);
  const displayedLayoutsRef = useRef(
    new Map<
      string,
      Pick<
        ReturnType<ReturnType<typeof createFrameLayouts>>,
        'store' | 'routing' | 'fitBounds' | 'getGeometry'
      >
    >(),
  );
  const refreshSelectionWorldBoundsRef = useRef(() => {});
  const paintCameraRef = useRef<
    (camera: import('@sue/board-core').Viewport) => void
  >(() => {});
  const publishViewStateRef = useRef(() => {});
  const viewStatePublishQueued = useRef(false);
  const propsRef = useRef(props);
  propsRef.current = props;
  const viewportIsAnimated = useCallback(() => {
    for (
      let node = svgRef.current?.parentElement;
      node;
      node = node.parentElement
    )
      if (
        node
          .getAnimations?.()
          .some((animation) => animation.playState === 'running')
      )
        return true;
    return false;
  }, []);
  const readViewportRect = () =>
    propsRef.current.surface === 'nested' ||
    viewportRectDirty.current ||
    viewportAnimation.current ||
    !viewportRectRef.current
      ? captureViewportRect()
      : viewportRectRef.current;
  const presenting = props.inputMode === 'present';
  const richTextLinkPolicy = useMemo(
    () => ({
      activation: props.interactionSettings?.linkActivation,
      readonly: props.readonly || presenting,
      locale: props.actionHost?.language,
    }),
    [
      props.interactionSettings?.linkActivation,
      props.readonly,
      presenting,
      props.actionHost?.language,
    ],
  );
  const editable =
    !presenting &&
    !props.readonly &&
    !runtime.store.cells[frameId]?.locked &&
    !lockedByAncestor(runtime.store, frameId) &&
    Boolean(props.onChange || props.onIntent);
  const applyKeyboardSelection = useCallback(() => {
    const request = keyboardSelectionRef.current;
    const focusId = request?.focus.at(-1);
    const inFocus = (id: string | undefined) =>
      !!focusId && !!id && focusedCellIds(runtime.store, focusId).includes(id);
    const resolveCreatedId = (id: string) => {
      const reference = Object.values(runtime.store.cells).find(
        (cell) => isFrameReferenceCell(cell) && cell.data.targetFrameId === id,
      );
      // A child frame is stored as its own file. The id the tool inserted
      // still exists as that file's root, but the board's selectable shell
      // is the reference.
      if (inFocus(id)) return id;
      if (reference && inFocus(reference.id)) return reference.id;
      return runtime.store.cells[id] ? id : reference?.id;
    };
    const ids = request?.ids.map(resolveCreatedId);
    if (
      request?.accepted &&
      ids?.every((id): id is string => !!id && !!runtime.store.cells[id])
    ) {
      keyboardSelectionRef.current = null;
      if (
        ids.every((id) =>
          focusedCellIds(runtime.store, request.focus.at(-1)!).includes(id),
        ) &&
        (!request.created ||
          (!propsRef.current.readonly &&
            request.created.frameId ===
              (propsRef.current.frameId ?? runtime.store.rootId) &&
            request.created.key ===
              (propsRef.current.tool?.key ??
                propsRef.current.tool?.mode ??
                'select')))
      ) {
        runtime.select({ focus: request.focus, ids });
        propsRef.current.onSelectionChange?.(runtime.selection);
        request.created?.onComplete?.();
      }
    }
    const edit = keyboardEditRef.current;
    if (
      edit?.accepted &&
      isNodeCell(runtime.store.cells[edit.id]) &&
      (runtime.store.cells[edit.id] as NodeCell).content?.label === edit.label
    ) {
      keyboardEditRef.current = null;
      setEditing(edit.id);
    }
  }, [runtime, setEditing]);
  useEffect(() => {
    if (props.runtime) {
      applyKeyboardSelection();
      return;
    }
    if (snapshot.store !== runtime.store) {
      runtime.replace(snapshot);
      propsRef.current.onSelectionChange?.(runtime.selection);
    }
    // Echoing the committed store must still apply a pending keyboard selection.
    applyKeyboardSelection();
  }, [snapshot, runtime, applyKeyboardSelection, props.runtime]);
  useEffect(() => {
    keyboardSelectionRef.current = null;
    keyboardEditRef.current = null;
    actionAfterToken.current = null;
    setEditing(null);
    // A read-only presentation can share an already mounted reference runtime.
    // Mounting it again would clear the editor's selection.
    if (!presenting || !props.runtime || runtime.mountedRootId !== frameId)
      runtime.mount(frameId);
    setLabelEditing(null);
  }, [runtime, frameId, setEditing, presenting, props.runtime]);
  useEffect(() => {
    if (props.readonly) {
      setEditing(null);
      setLabelEditing(null);
    }
  }, [props.readonly, setEditing]);
  useEffect(() => {
    const cell = editing ? runtime.store.cells[editing] : undefined;
    if (
      isNodeCell(cell) &&
      (cell.hidden ||
        !editable ||
        !selectionAllows(
          runtime.store,
          [cell.id],
          runtime.registry,
          'edit',
          runtime.mountedRootId,
        ))
    )
      setEditing(null);
  }, [editing, editable, runtime, revision, setEditing]);
  const operationFailureMessage = (error: unknown): string => {
    const message = error instanceof Error ? error.message : String(error);
    if (message !== 'layout-overlap') return message;
    return propsRef.current.actionHost?.language === 'en'
      ? 'Layout would overlap an outside or locked node. Nothing was changed; adjust the scope or positions and retry.'
      : '布局结果会与范围外或锁定节点重叠，未应用。请调整范围或位置后重试。';
  };
  const dispatchTransaction = async (
    transaction: CellTransaction,
    skipAuto: { layout?: boolean; edges?: boolean } = {},
  ): Promise<FrameIntentResult> => {
    const current = propsRef.current;
    const mountedFrameId = current.frameId ?? runtime.store.rootId;
    if (
      current.readonly ||
      runtime.store.cells[mountedFrameId]?.locked ||
      lockedByAncestor(runtime.store, mountedFrameId) ||
      (!current.onChange && !current.onIntent)
    )
      return { status: 'rejected', message: 'Canvas is readonly' };
    if (pendingRef.current)
      return { status: 'rejected', message: 'A transaction is pending' };
    try {
      const prepared = prepareAutoCalculation(
        runtime.store,
        transaction.operations,
        autoCalculationRef.current,
        runtime.registry,
        skipAuto,
      );
      transaction = { ...transaction, operations: prepared.operations };
      const expected = prepared.expected;
      lastIntentPrediction.current = { before: runtime.store, expected };
      const settleAutoConfig = () => {
        if (!alive.current || propsRef.current.suspended) return;
        const config = autoCalculationRef.current;
        const next = pruneAutoCalculationConfig(expected, config);
        if (next !== config) {
          autoCalculationRef.current = next;
          setAutoCalculation(next);
        }
      };
      if (!changedCellIds(runtime.store, expected).length)
        return { status: 'accepted' };
      if (current.adapter) {
        // Host mode never mutates its source or publishes a speculative state.
        pendingRef.current = true;
        setPending(true);
        const result = (await current.onIntent?.(transaction)) ?? {
          status: 'accepted' as const,
        };
        if (result.status === 'rejected') {
          current.onReject?.(result);
          setFailure(result.message ?? 'Edit rejected');
        } else settleAutoConfig();
        return result;
      }
      const change = runtime.transact(transaction, expected);
      current.onSelectionChange?.(runtime.selection);
      current.onChange?.(change);
      settleAutoConfig();
      setFailure(null);
      return { status: 'accepted' };
    } catch (error) {
      const result = {
        status: 'rejected' as const,
        message: operationFailureMessage(error),
      };
      current.onReject?.(result);
      setFailure(result.message);
      return result;
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };
  const dispatch = (
    transaction: CellTransaction,
    skipAuto?: { layout?: boolean; edges?: boolean },
  ) =>
    dispatchTransaction(
      {
        ...transaction,
        operations: normalizeCellPositionOperations(
          runtime.store,
          transaction.operations,
        ),
      },
      skipAuto,
    );
  finishNameRef.current = ({ id, initial }) => {
    const commit = () => {
      const cell = runtime.store.cells[id];
      if (
        !isNodeCell(cell) ||
        cell.name !== undefined ||
        propsRef.current.readonly ||
        !selectionAllows(
          runtime.store,
          [id],
          runtime.registry,
          'edit',
          runtime.mountedRootId,
        )
      )
        return;
      const final = nodeContentName(cell);
      if (final === initial) return;
      void dispatch({
        id: transactionId(),
        operations: [
          { type: 'replace_cell', cell: { ...cell, name: initial || final } },
        ],
      });
    };
    if (pendingRef.current) void textCommitRef.current?.then(commit);
    else commit();
  };
  const commitCreatedCells = (
    operations: CellOperation[],
    targetFrameId: string,
    tool: Extract<FrameCanvasTool, { complete: unknown }>,
  ) => {
    if (!operations.length) return;
    const ids = operations.flatMap((operation) =>
      operation.type === 'insert_cell' && operation.parentId === targetFrameId
        ? [operation.cell.id]
        : [],
    );
    const request = ids.length
      ? {
          ids,
          focus: [targetFrameId],
          accepted: false,
          created: {
            key: tool.key ?? tool.mode,
            frameId: targetFrameId,
            onComplete: tool.onComplete,
          },
        }
      : null;
    keyboardSelectionRef.current = request;
    void dispatch({ id: transactionId(), operations }).then((result) => {
      if (request && keyboardSelectionRef.current !== request) return;
      if (result.status !== 'accepted') {
        if (request) keyboardSelectionRef.current = null;
        return;
      }
      if (request) {
        request.accepted = true;
        applyKeyboardSelection();
      } else tool.onComplete?.();
    });
  };
  const editText = (cellId: string) => {
    const cell = runtime.store.cells[cellId];
    if (
      !editable ||
      pendingRef.current ||
      !isNodeCell(cell) ||
      cell.hidden ||
      !selectionAllows(
        runtime.store,
        [cellId],
        runtime.registry,
        'edit',
        runtime.mountedRootId,
      )
    )
      return;
    cancelInteractionRef.current();
    setEditing(cellId);
  };
  const publishHistory = (direction: 'undo' | 'redo') => {
    if (!editable || pending) return;
    if (props.history) {
      return props.history[direction]();
    }
    if (props.adapter) return;
    const entry =
      direction === 'undo'
        ? runtime.history.undos.at(-1)
        : runtime.history.redos.at(-1);
    setEditing(null);
    setLabelEditing(null);
    if (!entry) return;
    const next = runtime[direction]();
    props.onSelectionChange?.(runtime.selection);
    props.onChange?.({
      snapshot: next,
      transaction: {
        id: transactionId(),
        operations: direction === 'undo' ? entry.inverse : entry.forward,
      },
    });
  };
  const select = (
    id: string,
    focus: string[] = [frameId],
    additive = false,
  ): string => {
    keyboardSelectionRef.current = null;
    keyboardEditRef.current = null;
    for (const [at, parentId] of focus.entries()) {
      if (at > 0 && groupAncestors(runtime.store, parentId).length) {
        id = parentId;
        focus = focus.slice(0, at);
        break;
      }
    }
    const currentFocus = runtime.selection.focus;
    const focused = runtime.store.cells[currentFocus.at(-1) ?? ''];
    if (
      isGroupCell(focused) &&
      groupAncestors(runtime.store, id).includes(focused.id)
    )
      focus = currentFocus;
    id = selectionObjectAtFocus(runtime.store, id, focus.at(-1)!);
    const ids =
      additive &&
      JSON.stringify(focus) === JSON.stringify(runtime.selection.focus)
        ? runtime.selection.ids.includes(id)
          ? runtime.selection.ids.filter((current) => current !== id)
          : [...runtime.selection.ids, id]
        : [id];
    runtime.select({ focus, ids });
    props.onSelectionChange?.(runtime.selection);
    if (!ids.includes(editing ?? '')) setEditing(null);
    if (!labelEditing || !ids.includes(labelEditing.id)) setLabelEditing(null);
    return id;
  };
  const enterSelectedGroup = (cellId: string): boolean => {
    const selected = runtime.store.cells[runtime.selection.ids[0] ?? ''];
    if (!isGroupCell(selected)) return false;
    if (selected.locked || lockedByAncestor(runtime.store, selected.id))
      return true;
    const leaves = new Set(groupLeafMembers(runtime.store, selected.id));
    let representative = cellId;
    for (
      let parent = runtime.index.parentOf.get(representative);
      parent;
      parent = runtime.index.parentOf.get(parent)
    ) {
      if (leaves.has(parent)) {
        representative = parent;
        break;
      }
    }
    const focus = [...runtime.selection.focus, selected.id];
    runtime.select({
      focus,
      ids: [selectionObjectAtFocus(runtime.store, representative, selected.id)],
    });
    propsRef.current.onSelectionChange?.(runtime.selection);
    return true;
  };
  const clipboardText = (fragment: CellFragment) =>
    JSON.stringify({ format: 'verd-cells', version: 1, ...fragment });
  const selectContextCell = (id: string, focus: string[]) => {
    const groupId = selectionObjectAtFocus(
      runtime.store,
      id,
      runtime.selection.focus.at(-1)!,
    );
    if (
      runtime.selection.ids.includes(id) ||
      (groupId &&
        isGroupCell(runtime.store.cells[groupId]) &&
        runtime.selection.ids.includes(groupId))
    )
      return;
    select(id, focus);
  };
  const selectionHasLockedGroup = () =>
    runtime.selection.ids.some((id) => {
      const cell = runtime.store.cells[id];
      return isGroupCell(cell) && groupHasLockedLeaf(runtime.store, cell.id);
    });
  const clipboardFailure = (error: unknown): FrameIntentResult => {
    const result = {
      status: 'rejected' as const,
      message: operationFailureMessage(error),
    };
    propsRef.current.onReject?.(result);
    setFailure(result.message);
    return result;
  };
  const cutSelection = () => {
    const selected = runtime.selection.ids;
    const ids = selectionAllows(
      runtime.store,
      selected,
      runtime.registry,
      'delete',
      runtime.mountedRootId,
    )
      ? [...selected]
      : [];
    const operations = deleteCells(runtime.store, ids, {
      registry: runtime.registry,
    });
    applyCellOperations(runtime.store, operations, runtime.registry);
    return {
      ids,
      operations,
      fragment: copyCellFragment(runtime.store, ids, runtime.registry, {
        fileId: frameId,
      }),
    };
  };
  const focusFrameId = () =>
    [...runtime.selection.focus]
      .reverse()
      .find((id) => isFrameCell(runtime.store.cells[id])) ?? frameId;
  const selectInserted = async (
    operations: import('@sue/board-core').CellOperation[],
    result: FrameIntentResult,
  ) => {
    if (result.status !== 'accepted') return result;
    const ids = operations.flatMap((operation) =>
      operation.type === 'insert_cell' && isNodeCell(operation.cell)
        ? [operation.cell.id]
        : [],
    );
    if (ids.length) {
      runtime.select({ focus: runtime.selection.focus, ids });
      propsRef.current.onSelectionChange?.(runtime.selection);
    }
    return result;
  };
  const pasteFragment = (fragment: CellFragment) => {
    const parentId = focusFrameId();
    try {
      const plan = planCellPaste({
        fileId: frameId,
        store: runtime.store,
        frameId: parentId,
        selectionIds: runtime.selection.ids,
        fragment,
        allocateId: transactionId,
        offset: [20, 20],
        registry: runtime.registry,
        intent: 'paste',
        targetCellId:
          runtime.selection.ids.length === 1 &&
          frameCellUI(
            props.extensions,
            runtime.store.cells[runtime.selection.ids[0]]?.kind,
          ).pasteTarget
            ? runtime.selection.ids[0]
            : undefined,
      });
      const request = {
        ids: plan.selection.ids,
        focus: plan.selection.focus,
        accepted: false,
      };
      keyboardSelectionRef.current = request;
      return dispatch({
        id: transactionId(),
        operations: plan.operations,
      }).then((result) => {
        if (keyboardSelectionRef.current !== request) return result;
        if (result.status !== 'accepted') {
          keyboardSelectionRef.current = null;
          return result;
        }
        request.accepted = true;
        applyKeyboardSelection();
        return result;
      });
    } catch (error) {
      const result = {
        status: 'rejected' as const,
        message: error instanceof Error ? error.message : String(error),
      };
      setFailure(result.message);
      propsRef.current.onReject?.(result);
      return Promise.resolve(result);
    }
  };
  const viewportCenter = (): Point => {
    const rect = captureViewportRect();
    const { zoom = 1, origination = zeroOrigin } = cameraRef.current;
    return rect
      ? [
          origination[0] + rect.width / 2 / zoom,
          origination[1] + rect.height / 2 / zoom,
        ]
      : [...origination];
  };
  const insertExternal = async (
    source: { image?: File; text?: string },
    at: Point,
    clientX?: number,
    clientY?: number,
  ) => {
    const hitId =
      clientX !== undefined && clientY !== undefined
        ? document
            .elementFromPoint(clientX, clientY)
            ?.closest('[data-cell-id]')
            ?.getAttribute('data-cell-id')
        : runtime.selection.ids.length === 1
          ? runtime.selection.ids[0]
          : undefined;
    const hit = hitId ? runtime.store.cells[hitId] : undefined;
    if (source.image) {
      const url = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(source.image!);
      });
      const image = new Image();
      image.src = url;
      await image.decode();
      const scale = Math.min(1, 600 / image.width, 400 / image.height);
      const width = image.width * scale,
        height = image.height * scale;
      const context = {
        registry: runtime.registry,
        store: runtime.store,
        frameId: focusFrameId(),
        hit,
        at,
        image: { url, width, height },
        allocateId: transactionId,
      };
      for (const extension of props.extensions ?? []) {
        const operations = extension.plugin?.pasteImage?.(context);
        if (operations)
          return dispatch({ id: transactionId(), operations }).then((result) =>
            selectInserted(operations, result),
          );
      }
      return {
        status: 'rejected' as const,
        message: 'No installed plugin accepts images here',
      };
    }
    if (!source.text?.trim()) return { status: 'rejected' as const };
    for (const extension of props.extensions ?? []) {
      const operations = extension.plugin?.pasteText?.({
        registry: runtime.registry,
        store: runtime.store,
        frameId: focusFrameId(),
        hit,
        at,
        text: source.text,
        allocateId: transactionId,
      });
      if (operations)
        return dispatch({ id: transactionId(), operations }).then((result) =>
          selectInserted(operations, result),
        );
    }
    return {
      status: 'rejected' as const,
      message: 'No installed plugin accepts text here',
    };
  };
  const readClipboardText = (raw: string): CellFragment => {
    const payload = JSON.parse(raw);
    if (
      payload?.format !== 'verd-cells' ||
      payload.version !== 1 ||
      !payload.cells ||
      !Array.isArray(payload.ids)
    )
      throw new Error('Clipboard does not contain Verd cells');
    return payload;
  };
  const prepareClipboard = (
    action: 'copy' | 'cut' | 'paste',
  ): (() => Promise<FrameIntentResult>) => {
    const selection = JSON.stringify(runtime.selection);
    const valid = () =>
      alive.current &&
      !propsRef.current.suspended &&
      JSON.stringify(runtime.selection) === selection;
    if (action === 'paste') {
      const receipt = navigator.clipboard.readText().then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
      return async () => {
        try {
          const result = await receipt;
          if ('error' in result) throw result.error;
          if (!valid())
            return { status: 'rejected', message: 'Clipboard target changed' };
          return await pasteFragment(readClipboardText(result.value));
        } catch (error) {
          return clipboardFailure(error);
        }
      };
    }
    // Snapshot after the editing barrier; native ClipboardEvent payloads are
    // written synchronously by their transport and never enter this branch.
    return async () => {
      try {
        if (!valid())
          return { status: 'rejected', message: 'Clipboard target changed' };
        const source = runtime.store;
        const cut = action === 'cut' ? cutSelection() : null;
        if (cut && !cut.ids.length)
          return { status: 'rejected', message: 'No unlocked cells selected' };
        const fragment =
          cut?.fragment ??
          copyCellFragment(source, runtime.selection.ids, runtime.registry, {
            fileId: frameId,
          });
        await navigator.clipboard.writeText(clipboardText(fragment));
        if (!valid() || runtime.store !== source)
          return { status: 'rejected', message: 'Clipboard target changed' };
        if (!cut) return { status: 'accepted' };
        return await dispatch({
          id: transactionId(),
          operations: cut.operations,
        });
      } catch (error) {
        return clipboardFailure(error);
      }
    };
  };
  const selectionDisplayStore = () => {
    return frameLayouts(focusFrameId()).store;
  };
  const selectionCommandState = (
    command: FrameSelectionCommand,
  ): { enabled: boolean; reason?: string } => {
    if (pendingRef.current) return { enabled: false, reason: 'pending' };
    if (!editable)
      return {
        enabled: false,
        reason:
          propsRef.current.readonly ||
          presenting ||
          !(propsRef.current.onChange || propsRef.current.onIntent)
            ? 'readonly'
            : 'locked',
      };
    const store =
        command.type === 'align' ||
        command.type === 'distribute' ||
        command.type === 'layout'
          ? selectionDisplayStore()
          : runtime.store,
      selection = runtime.selection;
    if (
      command.type === 'layout' ||
      command.type === 'reroute' ||
      command.type === 'optimize-routes'
    ) {
      try {
        if (command.type === 'reroute' || command.type === 'optimize-routes') {
          const operations =
            command.type === 'optimize-routes'
              ? optimizableEdgeIds(
                  store,
                  arrangementEdgeIds(store, selection),
                  runtime.registry,
                )
              : rerouteEdges(
                  store,
                  arrangementEdgeIds(store, selection),
                  runtime.registry,
                );
          return {
            enabled: operations.length > 0,
            reason: operations.length
              ? undefined
              : command.type === 'reroute'
                ? 'no-routes-to-reset'
                : 'no-routes-to-optimize',
          };
        }
        const scope = resolveCellArrangementScope(store, selection);
        if (!scope.ids.length) return { enabled: false };
        return arrangementAvailability(
          store,
          scope.frameId,
          scope.ids,
          command,
          runtime.registry,
        );
      } catch (error) {
        return {
          enabled: false,
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    }
    if (command.type === 'align' || command.type === 'distribute')
      return arrangementAvailability(
        store,
        focusFrameId(),
        selection.ids,
        command,
        runtime.registry,
      );
    if (command.type === 'fit-content')
      return {
        enabled:
          fitContentCandidates(
            store,
            focusFrameId(),
            selection.ids,
            runtime.registry,
          ).length > 0,
      };
    if (command.type === 'lock' || command.type === 'unlock')
      return {
        enabled:
          setCellsLocked(store, selection.ids, command.type === 'lock').length >
            0 && !store.cells[focusFrameId()]?.locked,
      };
    if (command.type === 'ungroup')
      return {
        enabled:
          selection.ids.length > 0 &&
          selection.ids.every((id) => isGroupCell(store.cells[id])) &&
          ungroupCells(store, selection.ids).length > 0,
      };
    try {
      groupCells(
        store,
        focusFrameId(),
        selection.ids,
        '__new_group__',
        runtime.registry,
      );
      return { enabled: true };
    } catch (error) {
      return {
        enabled: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  };
  const executeSelectionCommand = async (
    command: FrameSelectionCommand,
  ): Promise<FrameIntentResult> => {
    if (command.type === 'fit-content') {
      if (!editable || pendingRef.current)
        return clipboardFailure(new Error('Command is unavailable'));
      const activeCommit = editing ? textCommitRef.current : null;
      if (editing) setEditing(null);
      const committed = await activeCommit;
      if (committed?.status === 'rejected') return committed;
    }
    const state = selectionCommandState(command);
    if (!state.enabled)
      return clipboardFailure(
        new Error(state.reason ?? 'Command is unavailable'),
      );
    try {
      const store =
          command.type === 'align' ||
          command.type === 'distribute' ||
          command.type === 'layout'
            ? selectionDisplayStore()
            : runtime.store,
        selection = runtime.selection;
      let operations: CellOperation[],
        nextIds = selection.ids;
      if (command.type === 'fit-content') {
        const family = svgRef.current
          ? getComputedStyle(svgRef.current).fontFamily
          : undefined;
        operations = fitContentOperations(
          store,
          focusFrameId(),
          selection.ids,
          runtime.registry,
          (text, width, fontSize) =>
            measureBoardText(text, width, fontSize, family),
        );
        if (!operations.length) return { status: 'accepted' };
      } else if (command.type === 'align')
        operations = alignCells(
          store,
          selection.ids,
          command.axis,
          runtime.registry,
        );
      else if (command.type === 'distribute')
        operations = distributeCells(
          store,
          selection.ids,
          command.axis,
          runtime.registry,
        );
      else if (command.type === 'layout')
        operations = planCellLayout(
          store,
          selection,
          command.style,
          runtime.registry,
        );
      else if (command.type === 'reroute' || command.type === 'optimize-routes')
        operations = (
          command.type === 'optimize-routes' ? optimizeEdges : rerouteEdges
        )(store, arrangementEdgeIds(store, selection), runtime.registry);
      else if (command.type === 'group') {
        const groupId = transactionId();
        operations = groupCells(
          store,
          focusFrameId(),
          selection.ids,
          groupId,
          runtime.registry,
        );
        nextIds = [groupId];
      } else if (command.type === 'ungroup') {
        nextIds = selection.ids.flatMap((id) => {
          const cell = store.cells[id];
          return isGroupCell(cell) ? cell.members : [];
        });
        operations = ungroupCells(store, selection.ids);
      } else
        operations = setCellsLocked(
          store,
          selection.ids,
          command.type === 'lock',
        );
      if (!operations.length) return { status: 'accepted' };
      const request = { ids: nextIds, focus: selection.focus, accepted: false };
      keyboardSelectionRef.current = request;
      const result = await dispatch(
        { id: transactionId(), operations },
        {
          layout: command.type === 'layout',
          edges:
            command.type === 'optimize-routes' || command.type === 'reroute',
        },
      );
      if (keyboardSelectionRef.current === request) {
        if (result.status === 'rejected') keyboardSelectionRef.current = null;
        else {
          request.accepted = true;
          applyKeyboardSelection();
        }
      }
      return result;
    } catch (error) {
      return clipboardFailure(error);
    }
  };
  const publicController = useRef<FrameCanvasController | null>(null);
  const activeControllerRef = useRef<FrameCanvasController | null>(null);
  const activatedOccurrences = useRef(new Map<string, FrameCanvasController>());
  const actionAfterToken = useRef<object | null>(null);
  const echoCancellations = useRef(new Set<() => void>());
  useEffect(() => {
    for (const cancel of echoCancellations.current) cancel();
    actionAfterToken.current = null;
  }, [frameId, props.suspended]);
  const flushEditing = async (): Promise<FrameIntentResult> => {
    if (composingRef.current)
      return { status: 'rejected', message: 'composing' };
    const child = activeControllerRef.current?.getActiveController();
    if (child && child !== publicController.current) {
      const result = await child.flushEditing();
      if (result.status === 'rejected') return result;
    }
    if (documentEditing) {
      const request =
        propsRef.current.documentReferences?.flushEditing?.(documentEditing);
      if (request) documentCommitRef.current = request;
    }
    {
      const result = await documentCommitRef.current;
      if (result && result.status !== 'completed' && result.status !== 'noop')
        return {
          status: 'rejected',
          message:
            'code' in result ? (result.message ?? result.code) : result.status,
        };
    }
    const active = svgRef.current?.querySelector<HTMLElement>(
      '[contenteditable="true"]',
    );
    active?.blur();
    setEditing(null);
    setLabelEditing(null);
    await Promise.resolve();
    const result = await textCommitRef.current;
    if (
      result?.status === 'accepted' &&
      lastIntentPrediction.current &&
      !lastIntentPrediction.current.acknowledged
    ) {
      const prediction = lastIntentPrediction.current;
      return awaitEcho(prediction.expected, prediction.before);
    }
    return result ?? { status: 'accepted' };
  };
  const awaitEcho = (
    expected: CellStore,
    before: CellStore,
  ): Promise<FrameIntentResult> => {
    const ids = [
      ...new Set([
        ...Object.keys(expected.cells),
        ...Object.keys(before.cells),
      ]),
    ].filter((id) => expected.cells[id] !== before.cells[id]);
    const matches = () =>
      ids.every(
        (id) =>
          JSON.stringify(runtime.store.cells[id]) ===
          JSON.stringify(expected.cells[id]),
      );
    if (!propsRef.current.adapter || matches()) {
      if (lastIntentPrediction.current?.expected === expected)
        lastIntentPrediction.current.acknowledged = true;
      return Promise.resolve({ status: 'accepted' });
    }
    return new Promise((resolve) => {
      const finish = (result: FrameIntentResult) => {
        if (
          result.status === 'accepted' &&
          lastIntentPrediction.current?.expected === expected
        )
          lastIntentPrediction.current.acknowledged = true;
        echoCancellations.current.delete(cancel);
        unsubscribe();
        lifetime.current.signal.removeEventListener('abort', cancel);
        resolve(result);
      };
      const cancel = () =>
        finish({ status: 'rejected', message: 'scope-disposed' });
      const unsubscribe = runtime.subscribe(() => {
        if (matches()) finish({ status: 'accepted' });
      });
      echoCancellations.current.add(cancel);
      lifetime.current.signal.addEventListener('abort', cancel, { once: true });
      if (!alive.current) cancel();
    });
  };
  const runOperations = async (
    operations: readonly CellOperation[],
    after?: {
      selectionIds?: readonly string[];
      editId?: string;
      restoreView?: boolean;
      normalizePositions?: boolean;
    },
  ): Promise<ActionResult> => {
    if (!alive.current || propsRef.current.suspended)
      return { status: 'cancelled', code: 'stale-context' };
    if (!operations.length) return { status: 'noop' };
    const targetFrameId = propsRef.current.frameId ?? runtime.store.rootId;
    const targetOccurrenceId = propsRef.current.instanceId;
    const before = runtime.store;
    const request = {};
    actionAfterToken.current = request;
    const result = await (
      after?.normalizePositions === false ? dispatchTransaction : dispatch
    )({
      id: transactionId(),
      operations,
      restoreView: after?.restoreView,
    });
    if (
      !alive.current ||
      propsRef.current.suspended ||
      targetFrameId !== (propsRef.current.frameId ?? runtime.store.rootId) ||
      targetOccurrenceId !== propsRef.current.instanceId
    )
      return { status: 'cancelled', code: 'stale-context' };
    if (result.status === 'rejected') return frameIntentActionResult(result);
    const expected =
      lastIntentPrediction.current?.before === before
        ? lastIntentPrediction.current.expected
        : runtime.store;
    const echo = await awaitEcho(expected, before);
    if (echo.status === 'rejected') return frameIntentActionResult(echo);
    if (actionAfterToken.current !== request) return { status: 'completed' };
    if (after?.selectionIds) {
      runtime.select({
        focus: runtime.selection.focus,
        ids: [...after.selectionIds],
      });
      propsRef.current.onSelectionChange?.(runtime.selection);
    }
    if (after?.editId && runtime.store.cells[after.editId])
      editText(after.editId);
    return { status: 'completed' };
  };
  const readActionContext = (): FrameActionContext => {
    const ids = [...runtime.selection.ids],
      cell = ids.length === 1 ? runtime.store.cells[ids[0]] : undefined;
    const readonly =
      !!propsRef.current.readonly ||
      !(propsRef.current.onChange || propsRef.current.onIntent);
    const locked =
      !!runtime.store.cells[frameId]?.locked ||
      (!!cell && (!!cell.locked || lockedByAncestor(runtime.store, cell.id)));
    return {
      surface: propsRef.current.actionHost ? 'product' : 'editor',
      tool: propsRef.current.tool ?? { mode: 'select' },
      interactionState:
        dragRef.current ||
        gestureRef.current ||
        edgeDragRef.current ||
        vectorDraftRef.current
          ? 'gesture'
          : editing || labelEditing || documentEditing || activeReferenceId
            ? 'editing'
            : 'idle',
      store: runtime.store,
      frameId: focusFrameId(),
      fileId: frameId,
      occurrenceId: propsRef.current.instanceId ?? frameId,
      mountEpoch: lifetime.current,
      appearancePath: propsRef.current.referenceAppearance ?? [],
      selectionIds: ids,
      selectionFocus: [...runtime.selection.focus],
      cell,
      language: propsRef.current.actionHost?.language ?? 'zh',
      readonly,
      pending: pendingRef.current,
      locked,
      disabled: readonly || pendingRef.current || locked,
      registry: runtime.registry,
      controller: publicController.current,
      allocateId: transactionId,
      dispatch: async (operations) => runOperations(operations),
      runOperations,
      setTool: propsRef.current.actionHost?.setTool,
      requestProperties: propsRef.current.actionHost?.requestProperties,
      propertyRequests: propsRef.current.actionHost?.propertyRequests,
      viewProjection: viewProjectionRef.current,
      clearRevealOverrides,
      executeAction: (id, args, invocation) =>
        actionRuntime.executeAction(id, args, invocation),
      getActionState: (id, args) => actionRuntime.getActionState(id, args),
    };
  };
  const contextReader = useRef(readActionContext);
  contextReader.current = readActionContext;
  const servicesReader = useRef<() => FrameActionServices>(() => {
    throw new Error('Canvas not mounted');
  });
  const actionRuntime = useMemo(
    () =>
      createFrameActions({
        getContext: () => contextReader.current(),
        refresh: (captured) => {
          if (
            !alive.current ||
            propsRef.current.suspended ||
            captured.controller?.runtime !== runtime
          )
            return null;
          const current = contextReader.current();
          if (
            captured.frameId !== current.frameId ||
            captured.fileId !== current.fileId ||
            captured.occurrenceId !== current.occurrenceId ||
            captured.mountEpoch !== current.mountEpoch
          )
            return null;
          if (
            captured.selectionIds.some((id) => !current.store.cells[id]) ||
            JSON.stringify(captured.selectionFocus) !==
              JSON.stringify(current.selectionFocus) ||
            JSON.stringify(captured.selectionIds) !==
              JSON.stringify(current.selectionIds)
          )
            return null;
          return current;
        },
        services: () => servicesReader.current(),
        definitions: () => [
          ...(propsRef.current.extensions ?? []).flatMap(
            (extension) => extension.plugin?.actions ?? [],
          ),
          ...(propsRef.current.actionHost?.actions ?? []).map((definition) => ({
            ...definition,
            getState: (c: FrameActionContext, a: unknown) =>
              propsRef.current.actionHost?.actions
                ?.find((d) => d.id === definition.id)
                ?.getState?.(c, a) ?? {},
            execute: (
              c: FrameActionContext,
              a: unknown,
              i: Parameters<typeof definition.execute>[2],
            ) =>
              propsRef.current
                .actionHost!.actions!.find((d) => d.id === definition.id)!
                .execute(c, a, i),
          })),
        ],
      }),
    [
      runtime,
      props.extensions,
      (props.actionHost?.actions ?? []).map((a) => a.id).join('|'),
    ],
  );
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      queueMicrotask(() => {
        if (!alive.current) {
          lifetime.current.abort();
          actionRuntime.dispose();
        }
      });
    };
  }, [actionRuntime]);
  const actionToolKey = props.tool?.key ?? props.tool?.mode ?? 'select';
  useEffect(() => {
    actionRuntime.invalidate();
  }, [
    actionRuntime,
    autoCalculation,
    revision,
    pending,
    props.readonly,
    viewProjection,
    actionToolKey,
  ]);
  const createViewServices = (): FrameViewServices => ({
    exportImage: (options) =>
      frameSnapshotToImage(
        { store: runtime.store },
        {
          ...options,
          appearance: options?.appearance ?? propsRef.current.appearance,
          frameId,
          registry: runtime.registry,
          extensions: propsRef.current.extensions,
          documentReferences: propsRef.current.documentReferences,
          referenceInteraction: propsRef.current.referenceInteraction,
          instanceHost: propsRef.current.instanceHost,
          className: propsRef.current.className,
          renderStyle: svgRef.current
            ? {
                fontFamily: getComputedStyle(svgRef.current).fontFamily,
                fontSize: getComputedStyle(svgRef.current).fontSize,
                fontWeight: getComputedStyle(svgRef.current).fontWeight,
                fontStyle: getComputedStyle(svgRef.current).fontStyle,
                lineHeight: getComputedStyle(svgRef.current).lineHeight,
                color: getComputedStyle(svgRef.current).color,
              }
            : undefined,
        },
      ),
    dispatch: dispatchTransaction,
    clientToWorld(clientX: number, clientY: number) {
      return pointFromEventRef.current({ clientX, clientY });
    },
    setZoom: (nextZoom) =>
      setViewport({
        zoom: Math.max(
          propsRef.current.inputMode === 'present' ? 0.01 : 0.1,
          Math.min(8, nextZoom),
        ),
        origination: cameraRef.current.origination ?? zeroOrigin,
      }),
    selectionScreenBounds: () => boundsRef.current(),
    fitBounds: (bounds, options) => fitWorldBounds(bounds, options),
    fitCells: (ids, options) => {
      const svg = svgRef.current;
      if (!svg) return false;
      const bounds = frameSelectionWorldBounds({
        allowUnmounted:
          isFrameCell(runtime.store.cells[frameId]) &&
          (runtime.store.cells[frameId] as import('@sue/board-core').FrameCell)
            .children.length >= 1000 &&
          !props.extensions?.some(
            (extension) =>
              extension.visible &&
              !extension.virtualizable?.(runtime.store, frameId),
          ),
        svg,
        world: worldRef.current,
        store: runtime.store,
        frameId,
        ids,
        parentOf: runtime.index.parentOf,
        layouts: (id) =>
          displayedLayoutsRef.current.get(id) ?? frameLayouts(id),
      });
      if (!bounds) return false;
      fitWorldBounds(bounds, options);
      return true;
    },
    getContentBounds: () => contentBounds(),
  });
  servicesReader.current = () => {
    const viewServices = createViewServices();
    return {
      getAutoCalculation: () => autoCalculationRef.current,
      toggleAutoCalculation: (kind) => {
        const config = autoCalculationRef.current;
        const next = { ...config };
        if (config[kind]) delete next[kind];
        else {
          const scope = captureAutoCalculationScope(
            runtime.store,
            runtime.selection,
          );
          if (kind === 'layout') {
            const scene = frameScene(
              runtime.store,
              scope.frameId,
              runtime.registry,
            );
            const defaultStyle =
              runtime.registry.scenes.find((definition) =>
                definition.anchorKinds.includes(scene ?? ''),
              )?.layouts?.[0]?.id ?? 'grid';
            next.layout = {
              scope,
              style: autoLayoutStyleRef.current ?? defaultStyle,
            };
          } else next.edges = { scope };
        }
        autoCalculationRef.current = next;
        setAutoCalculation(next);
      },
      selectionState: selectionCommandState,
      selectionExecute: async (command) => {
        const previous = lastIntentPrediction.current;
        const result = await executeSelectionCommand(command);
        if (
          result.status === 'accepted' &&
          lastIntentPrediction.current !== previous &&
          lastIntentPrediction.current
        ) {
          const prediction = lastIntentPrediction.current;
          return awaitEcho(prediction.expected, prediction.before);
        }
        return result;
      },
      movePlan: (targetFrameId) => {
        const laidOut = { ...runtime.store, cells: { ...runtime.store.cells } };
        Object.values(runtime.store.cells)
          .filter(isFrameCell)
          .forEach((frame) => {
            propsRef.current.extensions?.forEach((extension) =>
              extension
                .layout?.(runtime.store, frame.id)
                .forEach((geometry, id) => {
                  const node = laidOut.cells[id];
                  if (isNodeCell(node))
                    laidOut.cells[id] = {
                      ...node,
                      geometry: roundNodeGeometry(geometry),
                    };
                }),
            );
          });
        return moveWhiteboardCells(
          runtime.store,
          runtime.selection.ids,
          targetFrameId,
          laidOut,
          runtime.registry,
        );
      },
      prepareClipboard,
      settleClipboard: async (perform) => {
        const before = lastIntentPrediction.current;
        const result = await perform();
        if (
          result.status === 'accepted' &&
          lastIntentPrediction.current !== before &&
          lastIntentPrediction.current
        ) {
          const prediction = lastIntentPrediction.current;
          return awaitEcho(prediction.expected, prediction.before);
        }
        return result;
      },
      flushEditing,
      history: publishHistory,
      canHistory: (kind) =>
        !propsRef.current.readonly &&
        (propsRef.current.history
          ? kind === 'undo'
            ? (propsRef.current.history.canUndo?.() ?? true)
            : (propsRef.current.history.canRedo?.() ?? true)
          : kind === 'undo'
            ? runtime.history.undos.length > 0
            : runtime.history.redos.length > 0),
      fit: () => fitCanvas(),
      centerSelection: () => centerSelection(),
      centerState: () => {
        const hasBounds = !!boundsRef.current();
        const blocked = !!(
          dragging ||
          dragRef.current ||
          gestureRef.current ||
          edgeDragRef.current ||
          pinchRef.current ||
          rightDragRef.current?.moved
        );
        return {
          enabled: hasBounds && !blocked,
          reason: !hasBounds
            ? 'no-selection'
            : blocked
              ? 'interaction-active'
              : undefined,
        };
      },
      setZoom: viewServices.setZoom,
      getZoom: () => cameraRef.current.zoom ?? 1,
      select: (ids) => {
        runtime.select({ focus: runtime.selection.focus, ids: [...ids] });
        propsRef.current.onSelectionChange?.(runtime.selection);
      },
      exit: () => {
        const focus = runtime.selection.focus;
        runtime.select({
          focus: focus.length > 1 ? focus.slice(0, -1) : focus,
          ids: [],
        });
      },
      edit: editText,
      ...(propsRef.current.linkHost
        ? {
            copyLink: async () => {
              const id = runtime.selection.ids[0];
              if (runtime.selection.ids.length !== 1)
                return {
                  status: 'rejected' as const,
                  code: 'single-selection-required',
                };
              await navigator.clipboard.writeText(
                propsRef.current.linkHost!.createLink({ frameId, cellId: id }),
              );
              return { status: 'completed' as const };
            },
          }
        : {}),
    };
  };
  useImperativeHandle(ref ?? publicController, () => {
    const viewServices = createViewServices();
    const controller: FrameCanvasController = {
      runtime,
      resolveAppearance: (cellId) => {
        const store = runtime.store;
        const cell = store.cells[cellId];
        if (!cell) return undefined;
        const ownerId = runtime.index.parentOf.get(cellId) ?? frameId;
        const owner = store.cells[ownerId];
        return resolveFrameCellAppearance(
          {
            cell,
            store,
            frameId: ownerId,
            theme: resolveBoardTheme(
              isFrameCell(owner) ? owner.view?.theme : undefined,
              propsRef.current.appearance,
            ),
          },
          propsRef.current.extensions,
        );
      },
      dispatch: viewServices.dispatch,
      exportImage: viewServices.exportImage,
      clientToWorld: viewServices.clientToWorld,
      selectionScreenBounds: viewServices.selectionScreenBounds,
      fitBounds: viewServices.fitBounds,
      fitCells: viewServices.fitCells,
      getContentBounds: viewServices.getContentBounds,
      actionSource: actionRuntime,
      getActionContext: readActionContext,
      getActiveController: () =>
        activeControllerRef.current?.getActiveController() ??
        publicController.current!,
      findOccurrence: (id) => {
        if (!alive.current) return null;
        if (id === (propsRef.current.instanceId ?? frameId))
          return publicController.current;
        for (const child of activatedOccurrences.current.values()) {
          const found = child.findOccurrence(id);
          if (found) return found;
        }
        return null;
      },
      getAutoCalculation: () => autoCalculationRef.current,
      setAutoLayoutStyle: (style) => {
        autoLayoutStyleRef.current = style;
        const config = autoCalculationRef.current;
        if (config.layout && config.layout.style !== style) {
          const next = { ...config, layout: { ...config.layout, style } };
          autoCalculationRef.current = next;
          setAutoCalculation(next);
        }
      },
      getActionState: actionRuntime.getActionState,
      executeAction: actionRuntime.executeAction,
      actions: actionRuntime.actions,
      flushEditing,
      captureDocumentEditingView: () =>
        documentEditing
          ? (propsRef.current.documentReferences?.captureEditingView?.(
              documentEditing,
            ) ?? null)
          : null,
      restoreDocumentEditingView: (view, signal) => {
        if (!alive.current || signal?.aborted)
          return Promise.resolve({
            status: 'cancelled',
            code: 'stale-context',
          });
        const cell = runtime.store.cells[view.cellId];
        if (
          !isDocumentFrameCell(cell) ||
          cell.hidden ||
          propsRef.current.readonly ||
          propsRef.current.suspended ||
          !selectionAllows(
            runtime.store,
            [cell.id],
            runtime.registry,
            'edit',
            frameId,
          )
        )
          return Promise.resolve({
            status: 'cancelled',
            code: 'missing-document-occurrence',
          });
        const restore = propsRef.current.documentReferences?.restoreEditingView;
        if (!restore) return Promise.resolve({ status: 'noop' });
        const abort = new AbortController();
        const cancel = () => abort.abort();
        const signals = [lifetime.current.signal, ...(signal ? [signal] : [])];
        for (const source of signals) {
          if (source.aborted) abort.abort();
          else source.addEventListener('abort', cancel, { once: true });
        }
        return restore(
          view,
          (instanceId) => {
            documentCommitRef.current = null;
            setDocumentEditing(instanceId);
          },
          abort.signal,
        ).finally(() => {
          for (const source of signals)
            source.removeEventListener('abort', cancel);
        });
      },
      revealTarget: (request) => revealTargetRef.current(request),
      clearRevealOverrides,
      getViewProjection: () => viewProjectionRef.current,
      getCamera: () => ({
        zoom: cameraRef.current.zoom ?? 1,
        origination: [
          ...(cameraRef.current.origination ?? zeroOrigin),
        ] as Point,
      }),
      restoreCamera: (camera) => setViewport(camera, true),
    };
    publicController.current = controller;
    return controller;
  });
  const view = (
    runtime.store.cells[frameId] as import('@sue/board-core').FrameCell
  )?.view;
  const resolvedTheme = useMemo(
    () => resolveBoardTheme(view?.theme, props.appearance),
    [view?.theme, props.appearance],
  );
  const themeForFrame = useMemo(() => {
    const themes = new WeakMap<object, ResolvedBoardTheme>();
    return (frame: import('@sue/board-core').FrameCell) => {
      let theme = themes.get(frame);
      if (!theme)
        themes.set(
          frame,
          (theme = resolveBoardTheme(frame.view?.theme, props.appearance)),
        );
      return theme;
    };
  }, [props.appearance]);
  type Camera = import('@sue/board-core').Viewport;
  const cameraRef = useRef<Camera>(defaultCamera());
  const paintedCameraRef = useRef<Camera>(defaultCamera());
  const cameraStore = useMemo(
    () => createFrameCameraStore(defaultCamera(), frameId),
    [frameId],
  );
  useLayoutEffect(() => {
    const id = cameraStore.getHoveredId();
    if (id && (!runtime.store.cells[id] || runtime.store.cells[id].hidden))
      cameraStore.setHovered(null);
  }, [cameraStore, runtime, revision]);
  const [previewZoom, setPreviewZoom] = useState(1);
  const cameraOwnerRef = useRef(frameId);
  const cameraFrameRef = useRef<number | null>(null);
  const viewportMotionRef = useRef(0);
  const cancelCameraFrame = useCallback(() => {
    if (cameraFrameRef.current === null) return;
    if (typeof window.cancelAnimationFrame === 'function')
      window.cancelAnimationFrame(cameraFrameRef.current);
    else window.clearTimeout(cameraFrameRef.current);
    cameraFrameRef.current = null;
  }, []);
  const viewport =
    cameraOwnerRef.current === cameraStore.frameId
      ? cameraRef.current
      : defaultCamera();
  const zoom = viewport.zoom ?? 1;
  const origin = viewport.origination ?? zeroOrigin;
  paintCameraRef.current = (next) => {
    const scale = next.zoom ?? 1;
    const offset = next.origination ?? zeroOrigin;
    paintedCameraRef.current = {
      zoom: scale,
      origination: [offset[0], offset[1]],
    };
    const transform = `scale(${scale}) translate(${-offset[0]} ${-offset[1]})`;
    if (worldRef.current?.getAttribute('transform') !== transform)
      worldRef.current?.setAttribute('transform', transform);
    const svg = svgRef.current;
    if (svg) {
      const position = `${-offset[0] * scale}px ${-offset[1] * scale}px`;
      if (svg.style.backgroundPosition !== position)
        svg.style.backgroundPosition = position;
      if (view?.theme?.gridEnabled) {
        const size = Math.max(4, view.theme.gridSize ?? 20) * scale;
        const backgroundSize = `${size}px ${size}px`;
        if (svg.style.backgroundSize !== backgroundSize)
          svg.style.backgroundSize = backgroundSize;
      }
    }
  };
  const refreshCameraPreview = (next: Camera) => {
    if (
      vectorDraftRef.current ||
      connectingRef.current ||
      edgeDragRef.current ||
      eraserHoverRef.current ||
      (gestureRef.current && gestureRef.current.mode !== 'hand')
    )
      setPreviewZoom(next.zoom ?? 1);
  };
  const setViewport = (
    next: Camera,
    immediate = false,
    limits?: { minZoom?: number; maxZoom?: number },
    animated = false,
  ) => {
    if (!animated) viewportMotionRef.current += 1;
    if (
      !Number.isFinite(next.zoom ?? 1) ||
      !(next.origination ?? zeroOrigin).every(Number.isFinite)
    )
      return;
    const normalized = {
      zoom: Math.max(
        limits?.minZoom ??
          (propsRef.current.inputMode === 'present' ? 0.01 : 0.1),
        Math.min(limits?.maxZoom ?? 8, next.zoom ?? 1),
      ),
      origination: next.origination ?? zeroOrigin,
    };
    const previous = cameraRef.current;
    if (
      !immediate &&
      previous.zoom === normalized.zoom &&
      previous.origination?.every(
        (value, at) => value === normalized.origination[at],
      )
    )
      return;
    cameraRef.current = normalized;
    if (immediate) {
      cancelCameraFrame();
      paintCameraRef.current(normalized);
      cameraStore.publish(normalized);
      refreshCameraPreview(normalized);
      publishViewStateRef.current();
      return;
    }
    if (cameraFrameRef.current !== null) return;
    const paint = () => {
      cameraFrameRef.current = null;
      const next = cameraRef.current;
      // Camera motion reaches the DOM before notifying scale-sensitive leaves.
      paintCameraRef.current(next);
      cameraStore.publish(next);
      refreshCameraPreview(next);
      publishViewStateRef.current();
    };
    cameraFrameRef.current =
      typeof window.requestAnimationFrame === 'function'
        ? window.requestAnimationFrame(paint)
        : window.setTimeout(paint, 16);
  };
  // Finishing a pointer gesture only paints its last local camera. It never commits a document.
  const rememberGesture = setViewport;
  const commitGesture = () => setViewport(cameraRef.current, true);
  const moveViewport = (
    viewport: Camera,
    animate: boolean,
    limits?: { minZoom?: number; maxZoom?: number },
  ) => {
    const target = {
      zoom: viewport.zoom ?? 1,
      origination: [...(viewport.origination ?? zeroOrigin)] as Point,
    };
    if (!animate || prefersReducedMotion()) {
      setViewport(target, true, limits);
      return;
    }
    viewportMotionRef.current += 1;
    const token = viewportMotionRef.current;
    const from = {
      zoom: cameraRef.current.zoom ?? 1,
      origination: [...(cameraRef.current.origination ?? zeroOrigin)] as Point,
    };
    const start =
      typeof performance !== 'undefined' ? performance.now() : Date.now();
    const step = (now: number) => {
      if (token !== viewportMotionRef.current) return;
      const amount = Math.min(1, (now - start) / PRESENTATION_CAMERA_MS);
      setViewport(
        interpolateViewport(from, target, amount),
        true,
        limits,
        true,
      );
      if (amount < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  const fitWorldBounds = (
    bounds: RectangleClient,
    options?: {
      animate?: boolean;
      minZoom?: number;
      maxZoom?: number;
      insets?: ViewportInsets;
    },
  ) => {
    const rect = captureViewportRect();
    if (!rect || rect.width < 8 || rect.height < 8) return;
    const limits = {
      minZoom: options?.minZoom ?? (presenting ? 0.01 : 0.1),
      maxZoom: options?.maxZoom ?? 8,
    };
    const next = viewportForBounds(bounds, rect, options?.insets, limits);
    moveViewport(next, options?.animate !== false, limits);
  };
  const contentBounds = () => {
    const layout = frameLayouts(frameId);
    return frameContentBounds(layout.store, frameId, layout.routing);
  };
  const layoutMemory = useMemo(
    () => new Map<string, FrameLayoutMemory>(),
    [frameId, props.extensions, viewProjection.identity],
  );
  const frameLayouts = useMemo(
    () =>
      createFrameLayouts(
        runtime.store,
        props.extensions,
        undefined,
        frameId,
        layoutMemory,
        runtime.registry,
        viewProjection,
      ),
    [runtime.store, props.extensions, frameId, layoutMemory, viewProjection],
  );
  const centerSelection = () => {
    const svg = svgRef.current;
    if (
      !svg ||
      dragging ||
      dragRef.current ||
      gestureRef.current ||
      edgeDragRef.current ||
      pinchRef.current ||
      rightDragRef.current?.moved
    )
      return;
    const rect = captureViewportRect()!;
    if (rect.width < 8 || rect.height < 8) return;
    const bounds = frameSelectionWorldBounds({
      allowUnmounted:
        isFrameCell(runtime.store.cells[frameId]) &&
        (runtime.store.cells[frameId] as import('@sue/board-core').FrameCell)
          .children.length >= 1000 &&
        !props.extensions?.some(
          (extension) =>
            extension.visible &&
            !extension.virtualizable?.(runtime.store, frameId),
        ),
      svg,
      world: worldRef.current,
      store: runtime.store,
      frameId,
      ids: runtime.selection.ids,
      parentOf: runtime.index.parentOf,
      layouts: (id) => displayedLayoutsRef.current.get(id) ?? frameLayouts(id),
    });
    if (!bounds) return;
    const insets = propsRef.current.viewportInsets ?? {
      top: 40,
      right: 40,
      bottom: 40,
      left: 40,
    };
    const width = Math.max(1, rect.width - insets.left - insets.right),
      height = Math.max(1, rect.height - insets.top - insets.bottom),
      zoom = cameraRef.current.zoom ?? 1;
    setViewport(
      {
        zoom,
        origination: [
          bounds.x + bounds.width / 2 - (insets.left + width / 2) / zoom,
          bounds.y + bounds.height / 2 - (insets.top + height / 2) / zoom,
        ],
      },
      true,
    );
  };
  revealTargetRef.current = async (request) => {
    const token = ++revealToken.current;
    const cancelled = () =>
      !alive.current ||
      request.signal?.aborted ||
      token !== revealToken.current;
    for (const done of layoutWaiters.current) done();
    if (cancelled())
      return {
        status: 'cancelled',
        code: request.signal?.aborted ? 'aborted' : 'unmounted',
      };
    const cell = runtime.store.cells[request.cellId];
    if (!cell) return { status: 'unavailable', code: 'missing-cell' };
    if (cell.hidden) return { status: 'unavailable', code: 'hidden' };
    setRevealHighlight(null);
    const expanded = new Set<string>();
    for (const extension of propsRef.current.extensions ?? [])
      for (const id of extension.plugin?.prepareReveal?.(
        runtime.store,
        cell.id,
      ) ?? [])
        expanded.add(id);
    const next: FrameViewProjection = {
      identity: {},
      expandedCellIds: expanded,
      purpose: 'interactive',
    };
    setViewProjection(next);
    await new Promise<void>((resolve) => {
      const done = () => {
        if (layoutReadyRef.current !== next && !cancelled()) return;
        layoutWaiters.current.delete(done);
        request.signal?.removeEventListener('abort', done);
        lifetime.current.signal.removeEventListener('abort', done);
        resolve();
      };
      layoutWaiters.current.add(done);
      request.signal?.addEventListener('abort', done, { once: true });
      lifetime.current.signal.addEventListener('abort', done, { once: true });
      done();
    });
    if (cancelled()) return { status: 'cancelled', code: 'superseded' };
    const latestCell = runtime.store.cells[request.cellId];
    if (!latestCell) return { status: 'unavailable', code: 'missing-cell' };
    if (latestCell.hidden) return { status: 'unavailable', code: 'hidden' };
    const frames: string[] = [];
    let owner = runtime.index.parentOf.get(cell.id);
    const seen = new Set<string>();
    while (owner && !seen.has(owner)) {
      seen.add(owner);
      frames.unshift(owner);
      if (owner === frameId) break;
      owner = runtime.index.parentOf.get(owner);
    }
    if (frames[0] !== frameId)
      return { status: 'unavailable', code: 'unsupported' };
    const groups = groupAncestors(runtime.store, cell.id).reverse();
    try {
      runtime.select({ focus: [...frames, ...groups], ids: [cell.id] });
    } catch {
      return { status: 'unavailable', code: 'unsupported' };
    }
    const svg = svgRef.current;
    if (!svg) return { status: 'cancelled', code: 'unmounted' };
    const bounds = frameSelectionWorldBounds({
      allowUnmounted:
        isFrameCell(runtime.store.cells[frameId]) &&
        (runtime.store.cells[frameId] as import('@sue/board-core').FrameCell)
          .children.length >= 1000 &&
        !props.extensions?.some(
          (extension) =>
            extension.visible &&
            !extension.virtualizable?.(runtime.store, frameId),
        ),
      includeEdges: true,
      svg,
      world: worldRef.current,
      store: runtime.store,
      frameId,
      ids: [cell.id],
      parentOf: runtime.index.parentOf,
      layouts: (id) => displayedLayoutsRef.current.get(id) ?? frameLayouts(id),
    });
    if (!bounds) return { status: 'unavailable', code: 'unrenderable' };
    const rect = captureViewportRect();
    if (!rect) return { status: 'unavailable', code: 'unrenderable' };
    const insets = propsRef.current.viewportInsets ?? {
      top: 40,
      right: 40,
      bottom: 40,
      left: 40,
    };
    const currentZoom = cameraRef.current.zoom ?? 1;
    const zoom = Math.max(
      Number.EPSILON,
      Math.min(
        currentZoom,
        Math.max(1, rect.width - insets.left - insets.right) /
          Math.max(1, bounds.width),
        Math.max(1, rect.height - insets.top - insets.bottom) /
          Math.max(1, bounds.height),
      ),
    );
    setViewport(
      {
        zoom,
        origination: [
          bounds.x +
            bounds.width / 2 -
            (insets.left + (rect.width - insets.left - insets.right) / 2) /
              zoom,
          bounds.y +
            bounds.height / 2 -
            (insets.top + (rect.height - insets.top - insets.bottom) / 2) /
              zoom,
        ],
      },
      true,
      { minZoom: Number.EPSILON },
    );
    propsRef.current.onSelectionChange?.(runtime.selection);
    setRevealBounds(bounds);
    setRevealHighlight(cell.id);
    return { status: 'revealed', cellId: cell.id };
  };
  useEffect(() => {
    if (!revealHighlight) return;
    const timer = setTimeout(() => setRevealHighlight(null), 1200);
    return () => clearTimeout(timer);
  }, [revealHighlight]);
  const fitCanvas = (focusCellId?: string) => {
    const frame = runtime.store.cells[frameId];
    const svg = svgRef.current;
    if (!isFrameCell(frame) || !svg) return;
    const rect = captureViewportRect()!;
    if (rect.width < 8 || rect.height < 8) return;
    cancelCameraFrame();
    const layout = frameLayouts(frameId);
    let bounds = frameContentBounds(layout.store, frameId, layout.routing);
    if (focusCellId) {
      const shell = Array.from(svg.querySelectorAll('[data-cell-kind="frame"]'))
        .find((node) => node.getAttribute('data-cell-id') === focusCellId)
        ?.querySelector<SVGRectElement>(':scope > rect');
      const world = svg.querySelector<SVGGElement>('[data-frame-world]');
      const matrix = shell?.getScreenCTM?.();
      const inverse = world?.getScreenCTM?.()?.inverse();
      if (shell && matrix && inverse && typeof DOMPoint !== 'undefined') {
        const x = Number(shell.getAttribute('x') ?? 0),
          y = Number(shell.getAttribute('y') ?? 0);
        const w = Number(shell.getAttribute('width')),
          h = Number(shell.getAttribute('height'));
        const corners = [
          [x, y],
          [x + w, y],
          [x, y + h],
          [x + w, y + h],
        ].map(([px, py]) =>
          new DOMPoint(px, py).matrixTransform(matrix).matrixTransform(inverse),
        );
        const left = Math.min(...corners.map((point) => point.x)),
          top = Math.min(...corners.map((point) => point.y));
        bounds = {
          x: left,
          y: top,
          width: Math.max(...corners.map((point) => point.x)) - left,
          height: Math.max(...corners.map((point) => point.y)) - top,
        };
      } else if (frame.children.includes(focusCellId)) {
        const node = frameLayouts(frameId).store.cells[focusCellId];
        if (isFrameCell(node) && !node.hidden)
          bounds = frameVisualBounds(node.geometry);
      }
    }
    if (!frame.children.length && !frame.groups.length) {
      setViewport(defaultCamera(), true);
      return;
    }
    const insets = props.viewportInsets ?? {
      top: 40,
      right: 40,
      bottom: 40,
      left: 40,
    };
    const width = Math.max(1, rect.width - insets.left - insets.right),
      height = Math.max(1, rect.height - insets.top - insets.bottom);
    const nextZoom = Math.min(
      1,
      width / Math.max(1, bounds.width),
      height / Math.max(1, bounds.height),
    );
    setViewport(
      {
        zoom: Math.max(0.1, nextZoom),
        origination: [
          bounds.x -
            (width / nextZoom - bounds.width) / 2 -
            insets.left / nextZoom,
          bounds.y -
            (height / nextZoom - bounds.height) / 2 -
            insets.top / nextZoom,
        ],
      },
      true,
    );
  };
  const refreshSelectionWorldBounds = useCallback(() => {
    const svg = svgRef.current;
    if (!svg || cameraOwnerRef.current !== frameId) return;
    selectionProjectionRef.current = {
      frameId,
      selection: runtime.selection,
      bounds: frameSelectionWorldBounds({
        allowUnmounted:
          isFrameCell(runtime.store.cells[frameId]) &&
          (runtime.store.cells[frameId] as import('@sue/board-core').FrameCell)
            .children.length >= 1000 &&
          !props.extensions?.some(
            (extension) =>
              extension.visible &&
              !extension.virtualizable?.(runtime.store, frameId),
          ),
        svg,
        world: worldRef.current,
        store: runtime.store,
        frameId,
        ids: runtime.selection.ids,
        parentOf: runtime.index.parentOf,
        layouts: (id) =>
          displayedLayoutsRef.current.get(id) ?? frameLayouts(id),
      }),
    };
  }, [runtime, frameId, frameLayouts]);
  const projectSelectionBounds = (
    camera: Camera,
  ): FrameCanvasViewState['selectionScreenBounds'] => {
    const cache = selectionProjectionRef.current;
    const rect = viewportRectRef.current;
    if (
      !cache ||
      cache.frameId !== frameId ||
      cache.selection !== runtime.selection ||
      !cache.bounds ||
      !rect
    )
      return null;
    const bounds = cache.bounds;
    const { zoom = 1, origination: origin = zeroOrigin } = camera;
    return {
      x: rect.left + (bounds.x - origin[0]) * zoom,
      y: rect.top + (bounds.y - origin[1]) * zoom,
      width: bounds.width * zoom,
      height: bounds.height * zoom,
    };
  };
  boundsRef.current = () => {
    // Explicit controller queries retain fresh DOM positioning semantics.
    captureViewportRect();
    refreshSelectionWorldBounds();
    return projectSelectionBounds(cameraRef.current);
  };
  const fitRef = useRef(fitCanvas);
  fitRef.current = fitCanvas;
  useLayoutEffect(() => {
    cancelCameraFrame();
    cameraOwnerRef.current = frameId;
    const nestedOrigin = propsRef.current.viewportOrigin;
    cameraRef.current = nestedOrigin
      ? { zoom: 1, origination: [nestedOrigin[0], nestedOrigin[1]] }
      : defaultCamera();
    selectionProjectionRef.current = null;
    pointersRef.current.clear();
    pinchRef.current = null;
    blockSinglePointerRef.current = false;
    rightDragRef.current = null;
    gestureRef.current = null;
    dragRef.current = null;
    edgeDragRef.current = null;
    vectorDraftRef.current = null;
    cancelInteractionRef.current();
    paintCameraRef.current(cameraRef.current);
    cameraStore.publish(cameraRef.current);
    publishViewStateRef.current();
    let initialized = propsRef.current.autoFit === false;
    const fitIfNeeded = () => {
      const rect = captureViewportRect();
      if (initialized) {
        publishViewStateRef.current();
        return;
      }
      if (!rect || rect.width < 8 || rect.height < 8) return;
      initialized = true;
      fitRef.current(propsRef.current.initialFocusCellId);
    };
    fitIfNeeded();
    const observer =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(fitIfNeeded);
    if (svgRef.current) observer?.observe(svgRef.current);
    return () => {
      observer?.disconnect();
      viewportMotionRef.current += 1;
      cancelCameraFrame();
    };
  }, [frameId, cancelCameraFrame, cameraStore, captureViewportRect]);
  const nestedOriginX = props.viewportOrigin?.[0];
  const nestedOriginY = props.viewportOrigin?.[1];
  useLayoutEffect(() => {
    if (nestedOriginX === undefined || nestedOriginY === undefined) return;
    const current = cameraRef.current.origination ?? [0, 0];
    if (current[0] === nestedOriginX && current[1] === nestedOriginY) return;
    cameraRef.current = {
      ...cameraRef.current,
      zoom: 1,
      origination: [nestedOriginX, nestedOriginY],
    };
    paintCameraRef.current(cameraRef.current);
    cameraStore.publish(cameraRef.current);
  }, [nestedOriginX, nestedOriginY, cameraStore]);
  useLayoutEffect(() => {
    // A concurrent React commit must not restore an older camera over a newer pan.
    paintCameraRef.current(cameraRef.current);
  });
  const wheelHandlerRef = useRef<(event: WheelEvent) => void>(() => {});
  wheelHandlerRef.current = (event) => {
    const camera = cameraRef.current;
    const currentZoom = camera.zoom ?? 1;
    const currentOrigin = camera.origination ?? zeroOrigin;
    if (event.ctrlKey || event.metaKey) {
      const time = performance.now();
      if (time - lastViewportWheel.current > 250) {
        viewportRectDirty.current = true;
        viewportAnimation.current = viewportIsAnimated();
      }
      lastViewportWheel.current = time;
      const rect = readViewportRect();
      if (!rect) return;
      const nextZoom = Math.max(
        propsRef.current.inputMode === 'present' ? 0.01 : 0.1,
        Math.min(
          8,
          currentZoom *
            Math.exp(
              -event.deltaY *
                0.01 *
                normalizeInteractionMultiplier(
                  propsRef.current.interactionSettings?.zoomSensitivity,
                ),
            ),
        ),
      );
      const position = [event.clientX - rect.left, event.clientY - rect.top];
      setViewport({
        zoom: nextZoom,
        origination: [
          currentOrigin[0] + position[0] / currentZoom - position[0] / nextZoom,
          currentOrigin[1] + position[1] / currentZoom - position[1] / nextZoom,
        ],
      });
    } else {
      setViewport({
        zoom: currentZoom,
        origination: [
          currentOrigin[0] + event.deltaX / currentZoom,
          currentOrigin[1] + event.deltaY / currentZoom,
        ],
      });
    }
  };
  const wheelOwner = useMemo(
    () => createFrameWheelOwner((event) => wheelHandlerRef.current(event)),
    [],
  );
  useLayoutEffect(() => {
    if (props.surface === 'nested' || props.suspended || props.exporting)
      return undefined;
    const svg = svgRef.current;
    if (svg) {
      const refresh = () => {
        viewportAnimation.current = viewportIsAnimated();
        captureViewportRect();
      };
      svg.addEventListener('pointerenter', refresh);
      svg.addEventListener('focusin', refresh);
      const release = wheelOwner.register(svg);
      return () => {
        release();
        svg.removeEventListener('pointerenter', refresh);
        svg.removeEventListener('focusin', refresh);
      };
    }
    return undefined;
  }, [
    wheelOwner,
    captureViewportRect,
    viewportIsAnimated,
    props.surface,
    props.suspended,
    props.exporting,
  ]);
  useEffect(() => {
    const affectsViewport = (target: EventTarget | null) =>
      target === window ||
      target === document ||
      (target instanceof Element &&
        !!svgRef.current &&
        target.contains(svgRef.current));
    const refreshViewport = (event: Event) => {
      if (event.type === 'scroll' && !affectsViewport(event.target)) return;
      captureViewportRect();
      publishViewStateRef.current();
    };
    const invalidate = () => {
      viewportRectDirty.current = true;
    };
    const animationChanged = (event: Event) => {
      if (!affectsViewport(event.target)) return;
      invalidate();
      viewportAnimation.current = true;
      lastViewportWheel.current = -Infinity;
    };
    // Ancestor changes move a viewport without necessarily resizing its SVG.
    const observer =
      typeof MutationObserver === 'undefined'
        ? undefined
        : new MutationObserver(invalidate);
    for (
      let node = svgRef.current?.parentElement;
      node;
      node = node.parentElement
    )
      observer?.observe(node, {
        attributes: true,
        attributeFilter: [
          'style',
          'class',
          'hidden',
          'transform',
          'x',
          'y',
          'width',
          'height',
          'viewBox',
        ],
        childList: true,
      });
    const motionEvents = [
      'animationstart',
      'animationend',
      'animationcancel',
      'transitionrun',
      'transitionend',
      'transitioncancel',
    ];
    motionEvents.forEach((name) =>
      document.addEventListener(name, animationChanged, true),
    );
    window.addEventListener('scroll', refreshViewport, true);
    window.addEventListener('resize', refreshViewport);
    return () => {
      observer?.disconnect();
      motionEvents.forEach((name) =>
        document.removeEventListener(name, animationChanged, true),
      );
      window.removeEventListener('scroll', refreshViewport, true);
      window.removeEventListener('resize', refreshViewport);
    };
  }, [captureViewportRect]);
  const viewKey = useRef('');
  publishViewStateRef.current = () => {
    if (cameraOwnerRef.current !== frameId) return;
    const adapter = propsRef.current.history;
    const next: FrameCanvasViewState = {
      canUndo: adapter
        ? (adapter.canUndo?.() ?? true)
        : runtime.history.undos.length > 0,
      canRedo: adapter
        ? (adapter.canRedo?.() ?? true)
        : runtime.history.redos.length > 0,
      pending: pending || !!adapter?.busy?.(),
      readonly: !editable,
      zoom: paintedCameraRef.current.zoom ?? 1,
      dragging,
      selectionScreenBounds: projectSelectionBounds(paintedCameraRef.current),
    };
    const key = JSON.stringify(next);
    if (viewKey.current === key) return;
    viewKey.current = key;
    propsRef.current.onViewStateChange?.(next);
  };
  useEffect(() => publishViewStateRef.current());
  const pointFromEvent = (event: {
    clientX: number;
    clientY: number;
  }): Point => {
    const rect = readViewportRect()!;
    const camera = cameraRef.current;
    const scale = camera.zoom ?? 1,
      offset = camera.origination ?? zeroOrigin;
    return [
      (event.clientX - rect.left) / scale + offset[0],
      (event.clientY - rect.top) / scale + offset[1],
    ];
  };
  pointFromEventRef.current = pointFromEvent;
  const dragSequence = useRef(0);
  const dragRef = useRef<{
    sessionId: number;
    pointerId: number;
    id: string;
    ids?: string[];
    collapseId?: string;
    start: Point;
    original: NodeGeometry;
    canonicalOriginal?: NodeGeometry;
    focus: string[];
    scale: number;
    geometry: Map<string, NodeGeometry>;
    mode?: 'move' | 'resize' | 'rotate' | 'content-pan';
    panFrameId?: string;
    /** Reference occurrence the pan belongs to; offsets write to its shell. */
    panRefId?: string;
    contentOffset?: Point;
    handle?: ResizeHandle;
    localStart?: Point;
    pointerMatrix?: DOMMatrix;
    snapBounds?: RectangleClient;
    snapTargets?: RectangleClient[];
    frameId?: string;
  } | null>(null);
  const shapeGeometry = useMemo(createDefaultShapeGeometryRegistry, []);
  type DragPreview = { sessionId: number; id: string; geometry: NodeGeometry };
  const previewRef = useRef<DragPreview | null>(null);
  const [previewState, setPreviewState] = useState<DragPreview | null>(null);
  const [moveGhost, setMoveGhost] = useState<{
    sessionId: number;
    id: string;
    frameId: string;
    source: CellStore;
    key: string;
    plan: FrameMovePreview;
  } | null>(null);
  const preview =
    previewState &&
    previewState.sessionId === dragRef.current?.sessionId &&
    previewState.id === dragRef.current?.id
      ? previewState.geometry
      : null;
  const previewPaintFrame = useRef<number | null>(null);
  const previewPaintJobs = useRef(new Map<string, () => void>());
  const schedulePreviewPaint = (key: string, job: () => void) => {
    previewPaintJobs.current.set(key, job);
    if (previewPaintFrame.current !== null) return;
    previewPaintFrame.current = requestAnimationFrame(() => {
      previewPaintFrame.current = null;
      const jobs = [...previewPaintJobs.current.values()];
      previewPaintJobs.current.clear();
      jobs.forEach((paint) => paint());
    });
  };
  useEffect(
    () => () => {
      if (previewPaintFrame.current !== null)
        cancelAnimationFrame(previewPaintFrame.current);
      previewPaintJobs.current.clear();
    },
    [],
  );
  const setPreview = (geometry: NodeGeometry | null) => {
    const drag = dragRef.current;
    const next =
      drag && geometry
        ? { sessionId: drag.sessionId, id: drag.id, geometry }
        : null;
    previewRef.current = next;
    if (next) schedulePreviewPaint('geometry', () => setPreviewState(next));
    else {
      if (previewPaintFrame.current !== null)
        cancelAnimationFrame(previewPaintFrame.current);
      previewPaintFrame.current = null;
      previewPaintJobs.current.clear();
      setPreviewState(null);
      setMoveGhost(null);
    }
  };
  const resolveMovePreview = (
    drag: NonNullable<typeof dragRef.current>,
    geometry: NodeGeometry,
    point: Point,
  ) => {
    if (drag.ids || (drag.mode && drag.mode !== 'move')) return;
    const cell = runtime.store.cells[drag.id];
    const owner = runtime.index.parentOf.get(drag.id);
    if (!isNodeCell(cell) || !owner) return;
    const extension = propsRef.current.extensions?.find(
      (extension) =>
        (!extension.kind || extension.kind === cell.kind) &&
        extension.previewMove,
    );
    return extension?.previewMove?.({
      store: runtime.store,
      cell,
      frameId: owner,
      preview: geometry,
      geometry: drag.geometry,
      point,
      scale: cameraStore.getZoom() * drag.scale,
    });
  };
  const paintMoveGhost = (
    drag: NonNullable<typeof dragRef.current>,
    geometry: NodeGeometry,
    point: Point,
  ) => {
    const plan = resolveMovePreview(drag, geometry, point);
    if (!plan?.ghost || !plan.operations.length) {
      setMoveGhost(null);
      return;
    }
    const owner = runtime.index.parentOf.get(drag.id)!;
    const key = JSON.stringify(plan);
    setMoveGhost((previous) =>
      previous?.sessionId === drag.sessionId &&
      previous.source === runtime.store &&
      previous.key === key
        ? previous
        : {
            sessionId: drag.sessionId,
            id: drag.id,
            frameId: owner,
            source: runtime.store,
            key,
            plan,
          },
    );
  };
  const updateMoveGhost = (
    drag: NonNullable<typeof dragRef.current>,
    geometry: NodeGeometry,
    point: Point,
  ) => {
    schedulePreviewPaint('ghost', () => paintMoveGhost(drag, geometry, point));
  };
  const moveGhostScene = useMemo(() => {
    if (
      !moveGhost ||
      moveGhost.source !== runtime.store ||
      moveGhost.sessionId !== dragRef.current?.sessionId ||
      moveGhost.id !== dragRef.current.id
    )
      return null;
    try {
      const operations = normalizeCellPositionOperations(
        runtime.store,
        moveGhost.plan.operations,
      );
      const store = applyCellOperations(
        runtime.store,
        operations,
        runtime.registry,
      );
      return {
        store,
        children: moveGhost.plan.ghost!.cellIds,
        preview: true,
        layouts: createFrameLayouts(
          store,
          props.extensions,
          undefined,
          frameId,
          undefined,
          runtime.registry,
          viewProjection,
          frameLayouts,
        ),
      };
    } catch {
      return null;
    }
  }, [
    moveGhost,
    runtime.store,
    runtime.registry,
    props.extensions,
    frameId,
    frameLayouts,
    viewProjection,
  ]);
  const [alignmentGuides, paintAlignmentGuides] = useState<AlignmentGuide[]>(
    [],
  );
  const setAlignmentGuides = (guides: AlignmentGuide[]) => {
    if (!dragRef.current) paintAlignmentGuides(guides);
    else schedulePreviewPaint('guides', () => paintAlignmentGuides(guides));
  };
  const edgeDragRef = useRef<{
    cell: EdgeCell;
    start: Point;
    localStart: Point;
    scale: number;
    frameId: string;
    store: CellStore;
    points: Point[];
    mode: 'source' | 'target' | 'point' | 'segment' | 'label';
    index: number;
  } | null>(null);
  const [edgePreview, setEdgePreview] = useState<EdgeCell | null>(null);
  const edgePendingPreviewRef = useRef<EdgeCell | null>(null);
  const gestureRef = useRef<{
    mode: FrameCanvasTool['mode'];
    dragPanSpeed?: number;
    key?: string;
    frameId?: string;
    tool?: DrawingTool;
    context?: FrameCanvasDrawingContext;
    points: Point[];
    erased: Set<string>;
    origin: Point;
    zoom: number;
    additive: boolean;
    focus?: string[];
  } | null>(null);
  const [gesturePreview, setGesturePreview] = useState<Point[]>([]);
  const eraserHoverRef = useRef<Point | null>(null);
  const vectorDraftRef = useRef<{
    points: Point[];
    hover?: Point;
    frameId: string;
    tool: DrawingTool;
    key: string;
    context: FrameCanvasDrawingContext;
  } | null>(null);
  const draftPaintRef = useRef<number | null>(null);
  const cancelDraftPaint = () => {
    if (draftPaintRef.current === null) return;
    if (typeof window.cancelAnimationFrame === 'function')
      window.cancelAnimationFrame(draftPaintRef.current);
    else window.clearTimeout(draftPaintRef.current);
    draftPaintRef.current = null;
  };
  const scheduleDraftPaint = () => {
    if (draftPaintRef.current !== null) return;
    const paint = () => {
      draftPaintRef.current = null;
      const vector = vectorDraftRef.current;
      setGesturePreview(
        vector
          ? [...vector.points, ...(vector.hover ? [vector.hover] : [])]
          : [
              ...(gestureRef.current?.points ??
                (propsRef.current.tool?.mode === 'erase' &&
                eraserHoverRef.current
                  ? [eraserHoverRef.current]
                  : [])),
            ],
      );
      setConnectionPreview(
        connectingRef.current ? { ...connectingRef.current } : null,
      );
      setEdgePreview(edgePendingPreviewRef.current);
    };
    draftPaintRef.current =
      typeof window.requestAnimationFrame === 'function'
        ? window.requestAnimationFrame(paint)
        : window.setTimeout(paint, 16);
  };
  const clearDraftPaint = () => {
    cancelDraftPaint();
    setGesturePreview([]);
    setConnectionPreview(null);
  };
  const clearNodeDrag = () => {
    dragRef.current = null;
    setDragging(false);
    setPreview(null);
    setAlignmentGuides([]);
  };
  const cancelInteraction = () => {
    gestureRef.current = null;
    eraserHoverRef.current = null;
    vectorDraftRef.current = null;
    connectingRef.current = null;
    edgeDragRef.current = null;
    edgePendingPreviewRef.current = null;
    rightDragRef.current = null;
    clearNodeDrag();
    setEdgePreview(null);
    clearDraftPaint();
  };
  const cancelInteractionRef = useRef(cancelInteraction);
  cancelInteractionRef.current = cancelInteraction;
  const finishDocumentEditing = (instanceId: string) => {
    const request =
      propsRef.current.documentReferences?.flushEditing?.(instanceId) ??
      Promise.resolve({ status: 'noop' } as ActionResult);
    documentCommitRef.current = request;
    return request.then((result) => {
      if (
        alive.current &&
        (result.status === 'completed' || result.status === 'noop')
      )
        setDocumentEditing((current) =>
          current === instanceId ? null : current,
        );
      return result;
    });
  };
  useEffect(() => {
    inlineSequence.current++;
    inlineRestoreAbort.current?.abort();
    activeReferenceRef.current = null;
    activeReferenceTarget.current = null;
    setActiveReferenceId(null);
    inlineViews.current.clear();
    inlineDocumentViews.current.clear();
  }, [props.instanceHost, frameId]);
  const finishInlineEditing = (restoreFocus = true): Promise<boolean> => {
    if (inlineExitInFlight.current) return inlineExitInFlight.current;
    inlineRestoreAbort.current?.abort();
    const task = (async () => {
      const currentId = activeReferenceRef.current;
      if (currentId) {
        const previousController = activeControllerRef.current;
        const child = previousController?.getActiveController();
        const result = child
          ? await child.flushEditing()
          : { status: 'accepted' as const };
        if (!alive.current) return false;
        if (result.status === 'rejected') {
          setFailure(result.message ?? 'Edit rejected');
          return false;
        }
        if (activeReferenceRef.current !== currentId) return true;
        if (child)
          inlineViews.current.set(currentId, {
            targetId: child.runtime.store.rootId,
            selection: child.runtime.selection,
            camera: child.getCamera(),
          });
        activeControllerRef.current = null;
        if (child)
          for (const [key, controller] of activatedOccurrences.current)
            if (controller === child || controller === previousController)
              activatedOccurrences.current.delete(key);
        activeReferenceRef.current = null;
        setActiveReferenceId(null);
        propsRef.current.onActiveInstance?.(null);
        if (restoreFocus) {
          runtime.select({ focus: [frameId], ids: [currentId] });
          propsRef.current.onSelectionChange?.(runtime.selection);
          svgRef.current?.focus({ preventScroll: true });
        }
      }
      if (documentEditing) {
        const view =
          propsRef.current.documentReferences?.captureEditingView?.(
            documentEditing,
          );
        if (view) inlineDocumentViews.current.set(documentEditing, view);
        const result = await finishDocumentEditing(documentEditing);
        if (!alive.current) return false;
        if (result.status !== 'completed' && result.status !== 'noop') {
          setFailure(
            'message' in result
              ? (result.message ?? 'Edit rejected')
              : 'Edit rejected',
          );
          return false;
        }
      }
      return true;
    })().catch((error) => {
      setFailure(error instanceof Error ? error.message : String(error));
      return false;
    });
    inlineExitInFlight.current = task;
    void task.then(() => {
      if (inlineExitInFlight.current === task)
        inlineExitInFlight.current = null;
    });
    return task;
  };
  const activateInlineReference = async (
    cellId: string,
    documentInstance?: string,
  ) => {
    const token = ++inlineSequence.current;
    const cell = runtime.store.cells[cellId];
    if (
      propsRef.current.readonly ||
      propsRef.current.suspended ||
      !cell ||
      !selectionAllows(
        runtime.store,
        [cellId],
        runtime.registry,
        'edit',
        frameId,
      )
    )
      return;
    if (isFrameReferenceCell(cell) && !propsRef.current.instanceHost) {
      propsRef.current.onOpenFrame?.(cell.data.targetFrameId, {
        sourceFileId: frameId,
        refId: cellId,
        occurrenceId: `${frameId}/${cellId}`,
      });
      return;
    }
    if (
      isFrameReferenceCell(cell) &&
      propsRef.current.instanceHost?.source &&
      !propsRef.current.instanceHost.source.getSnapshot(cell.data.targetFrameId)
    )
      return;
    if (activeReferenceRef.current === cellId && !inlineExitInFlight.current)
      return;
    if (
      !(await finishInlineEditing(false)) ||
      token !== inlineSequence.current ||
      !alive.current ||
      propsRef.current.suspended ||
      propsRef.current.readonly ||
      !selectionAllows(
        runtime.store,
        [cellId],
        runtime.registry,
        'edit',
        frameId,
      )
    )
      return;
    const current = runtime.store.cells[cellId];
    if (
      !current ||
      (isFrameReferenceCell(cell) &&
        (!isFrameReferenceCell(current) ||
          current.data.targetFrameId !== cell.data.targetFrameId ||
          (propsRef.current.instanceHost?.source &&
            !propsRef.current.instanceHost.source.getSnapshot(
              cell.data.targetFrameId,
            ))))
    )
      return;
    runtime.select({ focus: [frameId], ids: [cellId] });
    propsRef.current.onSelectionChange?.(runtime.selection);
    if (documentInstance) {
      documentCommitRef.current = null;
      setDocumentEditing(documentInstance);
      const saved = inlineDocumentViews.current.get(documentInstance);
      if (saved) {
        const abort = new AbortController();
        inlineRestoreAbort.current = abort;
        void propsRef.current.documentReferences?.restoreEditingView?.(
          saved,
          (instance) => {
            if (token === inlineSequence.current) setDocumentEditing(instance);
          },
          abort.signal,
        );
      }
    } else {
      activeReferenceRef.current = cellId;
      activeReferenceTarget.current = isFrameReferenceCell(cell)
        ? cell.data.targetFrameId
        : null;
      setActiveReferenceId(cellId);
    }
  };
  const openReferenceDetails = async (open: () => void) => {
    ++inlineSequence.current;
    if (await finishInlineEditing(false)) open();
  };
  useEffect(() => {
    if (
      props.referenceInteraction !== 'activate' ||
      (!activeReferenceId && !documentEditing)
    )
      return;
    const outside = (event: globalThis.PointerEvent) => {
      const target = event.target as Element;
      const within =
        target
          .closest?.('[data-inline-reference-id]')
          ?.getAttribute('data-inline-reference-id') ===
        activeReferenceRef.current;
      const documentWithin =
        !!documentEditing &&
        target
          .closest?.('[data-document-frame-instance]')
          ?.getAttribute('data-document-frame-instance') === documentEditing;
      if (
        within ||
        documentWithin ||
        !target.closest?.('svg[data-surface="root"]')
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      const targetId = target
        .closest?.('[data-cell-id]')
        ?.getAttribute('data-cell-id');
      ++inlineSequence.current;
      void finishInlineEditing().then((ok) => {
        if (
          ok &&
          targetId &&
          runtime.index.parentOf.get(targetId) === frameId
        ) {
          runtime.select({ focus: [frameId], ids: [targetId] });
          propsRef.current.onSelectionChange?.(runtime.selection);
        }
      });
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [activeReferenceId, documentEditing, props.referenceInteraction]);
  useEffect(() => {
    if (!activeReferenceId) return;
    const shell = runtime.store.cells[activeReferenceId];
    const missing =
      !shell ||
      (isFrameReferenceCell(shell) &&
        activeReferenceTarget.current !== shell.data.targetFrameId) ||
      (isFrameReferenceCell(shell) &&
        props.instanceHost?.source &&
        !props.instanceHost.source.getSnapshot(shell.data.targetFrameId));
    if (missing) {
      inlineSequence.current++;
      activeReferenceRef.current = null;
      setActiveReferenceId(null);
      activeControllerRef.current = null;
      activatedOccurrences.current.clear();
      propsRef.current.onActiveInstance?.(null);
      return;
    }
    if (props.suspended || props.readonly || shell.locked)
      void finishInlineEditing(false);
  }, [
    activeReferenceId,
    activeSourceSnapshot,
    props.suspended,
    props.readonly,
    revision,
  ]);
  const activeToolKey = props.tool?.key ?? props.tool?.mode ?? 'select';
  useEffect(() => {
    if (documentEditing) {
      if (propsRef.current.referenceInteraction === 'activate')
        void finishInlineEditing(false);
      else void finishDocumentEditing(documentEditing);
    }
  }, [activeToolKey, props.readonly, props.suspended]);
  const documentEditRequest = props.documentReferences?.editRequest;
  useEffect(() => {
    if (documentEditRequest) {
      documentCommitRef.current = null;
      setDocumentEditing(documentEditRequest.instanceId);
    }
  }, [documentEditRequest?.nonce, documentEditRequest?.instanceId]);
  useEffect(() => {
    if (!documentEditing || props.referenceInteraction === 'activate') return;
    const leave = (event: PointerEvent) => {
      const target = event.target as Element;
      if (
        target
          .closest?.('[data-document-frame-instance]')
          ?.getAttribute('data-document-frame-instance') !== documentEditing
      )
        void finishDocumentEditing(documentEditing);
    };
    document.addEventListener('pointerdown', leave, true);
    return () => document.removeEventListener('pointerdown', leave, true);
  }, [documentEditing]);
  useLayoutEffect(() => {
    cancelInteractionRef.current();
    const request = keyboardSelectionRef.current;
    if (
      request?.created &&
      (request.created.key !== activeToolKey ||
        request.created.frameId !== frameId ||
        props.readonly)
    )
      keyboardSelectionRef.current = null;
  }, [activeToolKey, frameId, props.readonly]);
  useEffect(
    () => () => {
      cancelDraftPaint();
      keyboardSelectionRef.current = null;
    },
    [],
  );
  useEffect(() => {
    const connection = connectingRef.current;
    if (!connection) return;
    const source = runtime.store.cells[connection.cellId];
    if (
      !isNodeCell(source) ||
      source.hidden ||
      source.locked ||
      runtime.index.parentOf.get(connection.cellId) !== connection.frameId ||
      !source.ports?.some(
        (port) => port.id === connection.portId && port.direction !== 'input',
      )
    )
      cancelInteractionRef.current();
  }, [runtime.store, runtime]);

  const finishVectorDraft = (includeHover = false) => {
    const zoom = cameraRef.current.zoom ?? 1;
    const draft = vectorDraftRef.current;
    if (!draft) return;
    const points = draft.points.map((point) => [...point] as Point);
    if (
      includeHover &&
      draft.hover &&
      Math.hypot(
        draft.hover[0] - points.at(-1)![0],
        draft.hover[1] - points.at(-1)![1],
      ) >
        0.5 / zoom
    )
      points.push(draft.hover);
    vectorDraftRef.current = null;
    clearDraftPaint();
    if (points.length >= 2 && !propsRef.current.readonly) {
      try {
        const operations = draft.tool.complete(
          runtime.store,
          draft.frameId,
          points,
          { ...draft.context, zoom: cameraRef.current.zoom ?? 1 },
        );
        commitCreatedCells(operations, draft.frameId, draft.tool);
      } catch (error) {
        setFailure(error instanceof Error ? error.message : String(error));
      }
    }
  };
  const eraseAt = (point: Point) => {
    const zoom = cameraRef.current.zoom ?? 1;
    const frame = runtime.store.cells[frameId];
    if (!isFrameCell(frame)) return;
    const radius = 10 / zoom;
    frameLayouts(frameId)
      .query({
        x: point[0] - radius,
        y: point[1] - radius,
        width: radius * 2,
        height: radius * 2,
      })
      .forEach((id) => {
        const cell = frameLayouts(frameId).store.cells[id];
        if (isEdgeCell(cell) && !cell.locked && !cell.hidden) {
          const layout = frameLayouts(frameId);
          const points = edgePolyline(
            layout.store,
            cell,
            undefined,
            layout.routing,
          );
          if (
            distanceToPolyline(
              point,
              cell.route.mode === 'curve' ? flattenCurve(points) : points,
            ) <=
            10 / zoom
          )
            gestureRef.current?.erased.add(id);
          return;
        }
        if (
          !isNodeCell(cell) ||
          cell.locked ||
          cell.hidden ||
          isFrameCell(cell)
        )
          return;
        const util = runtime.registry.get(cell.kind);
        const hit =
          util && 'hitTest' in util
            ? (util as import('@sue/board-core').NodeUtil).hitTest(
                runtime.store,
                cell,
                point,
                10 / zoom,
              )
            : hitNodeShape(cell, point, 10 / zoom);
        if (hit) gestureRef.current?.erased.add(id);
      });
  };
  const commitEditingTab = () => {
    const id = editing;
    if (!id) return;
    void flushEditing().then((result) => {
      if (result.status === 'accepted' && runtime.store.cells[id]) {
        const match = resolveActionShortcut(actionRuntime.actions(), {
          key: 'Tab',
          ctrlKey: false,
          metaKey: false,
          altKey: false,
          shiftKey: false,
          repeat: false,
        } as KeyboardEvent);
        if (match.status === 'matched')
          void actionRuntime.executeAction(match.action.id);
      }
    });
  };

  const updateEdgeDrag = (
    event: React.PointerEvent<SVGElement>,
    capture = true,
  ): EdgeCell | null => {
    const zoom = cameraRef.current.zoom ?? 1;
    const edgeDrag = edgeDragRef.current;
    if (!edgeDrag) return null;
    const rootPoint = pointFromEvent(event),
      point: Point = [
        edgeDrag.localStart[0] +
          (rootPoint[0] - edgeDrag.start[0]) / edgeDrag.scale,
        edgeDrag.localStart[1] +
          (rootPoint[1] - edgeDrag.start[1]) / edgeDrag.scale,
      ];
    if (
      edgeDrag.mode === 'label' &&
      !edgePendingPreviewRef.current &&
      Math.hypot(
        rootPoint[0] - edgeDrag.start[0],
        rootPoint[1] - edgeDrag.start[1],
      ) *
        zoom <
        3
    )
      return null;
    if (capture && !svgRef.current?.hasPointerCapture(event.pointerId))
      svgRef.current?.setPointerCapture(event.pointerId);
    let next = edgeDrag.cell;
    if (edgeDrag.mode === 'point' || edgeDrag.mode === 'segment')
      next = bindEdgeRouteTerminals(edgeDrag.store, next, edgeDrag.points);
    if (edgeDrag.mode === 'source' || edgeDrag.mode === 'target')
      next = replaceEdgeTerminal(
        edgeDrag.store,
        next,
        edgeDrag.mode,
        snapEdgeTerminal(
          edgeDrag.store,
          edgeDrag.frameId,
          point,
          edgeDrag.mode,
          next.kind,
          12 / (zoom * edgeDrag.scale),
          runtime.registry,
        ),
      );
    else if (edgeDrag.mode === 'point')
      next = moveEdgeRoutePoint(next, edgeDrag.points, edgeDrag.index, point);
    else if (edgeDrag.mode === 'segment')
      next = moveEdgeSegment(next, edgeDrag.points, edgeDrag.index, point);
    else
      next = {
        ...next,
        labels: next.labels?.map((label, at) =>
          at === edgeDrag.index
            ? {
                ...label,
                position: polylineClosestPosition(
                  next.route.mode === 'curve'
                    ? flattenCurve(edgeDrag.points)
                    : edgeDrag.points,
                  point,
                ),
              }
            : label,
        ),
      };
    const operation = normalizeCellPositionOperations(edgeDrag.store, [
      { type: 'replace_cell', cell: next },
    ])[0];
    if (operation.type === 'replace_cell' && isEdgeCell(operation.cell))
      next = operation.cell;
    edgePendingPreviewRef.current = next;
    return next;
  };
  const draftScene = useMemo(() => {
    // Only active drafts invalidate this memo on zoom; input may start at any scale.
    const currentZoom = cameraRef.current.zoom ?? previewZoom;
    const state = vectorDraftRef.current ?? gestureRef.current;
    const tool = state?.tool;
    if (!gesturePreview.length || !tool?.preview || !state?.context)
      return null;
    try {
      const operations = normalizeCellPositionOperations(
        runtime.store,
        tool.preview(runtime.store, frameId, gesturePreview, {
          ...state.context,
          zoom: currentZoom,
        }),
      );
      const children = operations.flatMap((operation) =>
        operation.type === 'insert_cell' && operation.parentId === frameId
          ? [operation.cell.id]
          : [],
      );
      if (!children.length) return null;
      const store = applyCellOperations(
        runtime.store,
        operations,
        runtime.registry,
      );
      const base = frameLayouts(frameId);
      return {
        store,
        children,
        preview: true,
        layouts: createFrameLayouts(
          store,
          props.extensions,
          {
            frameId,
            geometry: base.baseGeometry,
          },
          frameId,
          undefined,
          runtime.registry,
        ),
      };
    } catch {
      return null;
    }
  }, [
    gesturePreview,
    previewZoom,
    runtime.store,
    runtime.registry,
    frameId,
    frameLayouts,
    props.extensions,
  ]);
  const makeConnectionEdge = (
    connection: ConnectionDraft,
    target = connection.target,
  ): EdgeCell => ({
    id: connection.id,
    kind: connection.kind,
    cellType: 'edge',
    source: { cellId: connection.cellId, portId: connection.portId },
    target,
    route: { mode: 'auto' },
    data: frameCellUI(props.extensions, connection.kind).edgeData,
  });
  const connectionScene = useMemo(() => {
    if (!connectionPreview) return null;
    const base = frameLayouts(connectionPreview.frameId);
    const frame = base.store.cells[connectionPreview.frameId];
    if (
      !isFrameCell(frame) ||
      !frame.children.includes(connectionPreview.cellId)
    )
      return null;
    const source = base.store.cells[connectionPreview.cellId];
    if (!isNodeCell(source) || source.hidden || source.locked) return null;
    const terminal = connectionPreview.target;
    const target =
      'cellId' in terminal ? base.store.cells[terminal.cellId] : undefined;
    const edge = makeConnectionEdge(
      connectionPreview,
      'cellId' in terminal &&
        (!isNodeCell(target) ||
          target.hidden ||
          target.locked ||
          !frame.children.includes(target.id))
        ? { point: connectionPreview.point }
        : terminal,
    );
    // A free terminal is intentionally valid for rendering a pending domain edge.
    const store = {
      ...base.store,
      cells: {
        ...base.store.cells,
        [edge.id]: edge,
        [frame.id]: { ...frame, children: [...frame.children, edge.id] },
      },
    };
    return {
      store,
      children: [edge.id],
      preview: true,
      layouts: createFrameLayouts(
        store,
        props.extensions,
        {
          frameId: frame.id,
          geometry: base.baseGeometry,
        },
        frameId,
        undefined,
        runtime.registry,
      ),
    };
  }, [connectionPreview, frameLayouts, props.extensions, frameId]);
  const updateConnection = (event: React.PointerEvent<SVGElement>) => {
    const zoom = cameraRef.current.zoom ?? 1;
    const connection = connectingRef.current;
    if (!connection) return;
    const group = Array.from(
      svgRef.current?.querySelectorAll<SVGGElement>(
        '[data-frame-content-id]',
      ) ?? [],
    ).find(
      (node) =>
        node.getAttribute('data-frame-content-id') === connection.frameId,
    );
    const matrix = group?.getScreenCTM?.()?.inverse();
    const local =
      matrix && typeof DOMPoint !== 'undefined'
        ? new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix)
        : null;
    const point: Point = local ? [local.x, local.y] : pointFromEvent(event);
    const base = frameLayouts(connection.frameId),
      store = base.store;
    let target = snapEdgeTerminal(
      store,
      connection.frameId,
      point,
      'target',
      connection.kind,
      12 /
        (matrix ? 1 / Math.hypot(matrix.a, matrix.b) : zoom * connection.scale),
      runtime.registry,
      (() => {
        const radius =
          12 /
          (matrix
            ? 1 / Math.hypot(matrix.a, matrix.b)
            : zoom * connection.scale);
        return base.query({
          x: point[0] - radius,
          y: point[1] - radius,
          width: 2 * radius,
          height: 2 * radius,
        });
      })(),
    );
    if (!('cellId' in target) || !target.portId) target = { point };
    if ('cellId' in target) {
      const node = store.cells[target.cellId];
      const portId = target.portId;
      const port = isNodeCell(node)
        ? node.ports?.find((port) => port.id === portId)
        : undefined;
      const edge = makeConnectionEdge(connection, target);
      const frame = store.cells[connection.frameId];
      if (!port || port.direction === 'output' || !isFrameCell(frame))
        target = { point };
      else {
        const candidate = {
          ...store,
          cells: {
            ...store.cells,
            [edge.id]: edge,
            [frame.id]: { ...frame, children: [...frame.children, edge.id] },
          },
        };
        if (runtime.registry.validateEdge(candidate, edge)) target = { point };
      }
    }
    connection.point = point;
    connection.target = target;
    scheduleDraftPaint();
  };
  const edgeDragMode = edgeDragRef.current?.mode;
  const snapTerminals = useMemo(
    () => [
      ...(draftScene?.children.flatMap((id) => {
        const cell = draftScene.store.cells[id];
        return isEdgeCell(cell) ? [cell.source, cell.target] : [];
      }) ?? []),
      ...(connectionPreview
        ? [
            {
              cellId: connectionPreview.cellId,
              portId: connectionPreview.portId,
            },
            connectionPreview.target,
          ]
        : []),
      ...(edgePreview &&
      edgeDragRef.current &&
      ['source', 'target'].includes(edgeDragMode ?? '')
        ? [edgeDragMode === 'source' ? edgePreview.source : edgePreview.target]
        : []),
    ],
    [draftScene, connectionPreview, edgePreview, edgeDragMode],
  );
  const textCache = useRef(
    new WeakMap<object, { plainText: string; document: BoardTextDocument }>(),
  );
  const emptyText = useMemo(() => createInlineText(''), []);
  const plainTextDocument = useCallback(
    (key: object | undefined, plainText: string) => {
      if (!key) return emptyText;
      const cached = textCache.current.get(key);
      if (cached?.plainText === plainText) return cached.document;
      const document = createInlineText(plainText);
      textCache.current.set(key, { plainText, document });
      return document;
    },
    [emptyText],
  );
  // Cached scene events must forward to the latest props and interaction state.
  const sceneActionsRef = useRef({
    dispatch,
    select,
    selectContextCell,
    publishHistory,
    pointFromEvent,
    selectionHasLockedGroup,
    enterSelectedGroup,
    scheduleDraftPaint,
    clearDraftPaint,
    commitEditingTab,
    editText,
    makeConnectionEdge,
  });
  sceneActionsRef.current = {
    dispatch,
    select,
    selectContextCell,
    publishHistory,
    pointFromEvent,
    selectionHasLockedGroup,
    enterSelectedGroup,
    scheduleDraftPaint,
    clearDraftPaint,
    commitEditingTab,
    editText,
    makeConnectionEdge,
  };
  const sceneActions = useMemo(
    () => ({
      dispatch: (...args: Parameters<typeof dispatch>) =>
        sceneActionsRef.current.dispatch(...args),
      select: (...args: Parameters<typeof select>) =>
        sceneActionsRef.current.select(...args),
      selectContextCell: (...args: Parameters<typeof selectContextCell>) =>
        sceneActionsRef.current.selectContextCell(...args),
      publishHistory: (...args: Parameters<typeof publishHistory>) =>
        sceneActionsRef.current.publishHistory(...args),
      pointFromEvent: (...args: Parameters<typeof pointFromEvent>) =>
        sceneActionsRef.current.pointFromEvent(...args),
      enterSelectedGroup: (...args: Parameters<typeof enterSelectedGroup>) =>
        sceneActionsRef.current.enterSelectedGroup(...args),
      selectionHasLockedGroup: (
        ...args: Parameters<typeof selectionHasLockedGroup>
      ) => sceneActionsRef.current.selectionHasLockedGroup(...args),
      scheduleDraftPaint: (...args: Parameters<typeof scheduleDraftPaint>) =>
        sceneActionsRef.current.scheduleDraftPaint(...args),
      clearDraftPaint: (...args: Parameters<typeof clearDraftPaint>) =>
        sceneActionsRef.current.clearDraftPaint(...args),
      commitEditingTab: (...args: Parameters<typeof commitEditingTab>) =>
        sceneActionsRef.current.commitEditingTab(...args),
      editText: (...args: Parameters<typeof editText>) =>
        sceneActionsRef.current.editText(...args),
      makeConnectionEdge: (...args: Parameters<typeof makeConnectionEdge>) =>
        sceneActionsRef.current.makeConnectionEdge(...args),
      publishViewStateAfterCommit: () => {
        if (viewStatePublishQueued.current) return;
        viewStatePublishQueued.current = true;
        queueMicrotask(() => {
          viewStatePublishQueued.current = false;
          if (svgRef.current) {
            refreshSelectionWorldBoundsRef.current();
            publishViewStateRef.current();
          }
        });
      },
    }),
    [],
  );
  const nativeContentCache = useMemo(
    () =>
      new Map<
        string,
        { cellId: string; inputs: readonly unknown[]; content: ReactNode }
      >(),
    [frameId],
  );
  const nativeEvents = useMemo(createFrameNativeEvents, [frameId]);
  const nativeContent = useCallback(
    (
      id: string,
      inputs: readonly unknown[],
      render: () => ReactNode,
      purpose = 'body',
    ) => {
      inputs = [props.appearance, ...inputs];
      const key = `${id}:${purpose}`;
      const old = nativeContentCache.get(key);
      if (
        old &&
        old.inputs.length === inputs.length &&
        old.inputs.every((input, at) => Object.is(input, inputs[at]))
      )
        return old.content;
      const content = render();
      nativeContentCache.set(key, { cellId: id, inputs, content });
      return content;
    },
    [nativeContentCache, props.appearance],
  );
  useEffect(() => {
    for (const [key, entry] of nativeContentCache)
      if (!runtime.store.cells[entry.cellId]) nativeContentCache.delete(key);
    nativeEvents.prune((id) => !!runtime.store.cells[id]);
  }, [revision, runtime, nativeContentCache, nativeEvents]);
  const renderFrame = useCallback(
    function renderFrame(
      id: string,
      focus: string[],
      embedded = false,
      parentScale = 1,
      scene?: {
        appearance?: BoardAppearance;
        store: CellStore;
        layouts: ReturnType<typeof createFrameLayouts>;
        preview: boolean;
        static?: boolean;
        children?: readonly string[];
        overrides?: ReadonlyMap<string, NodeGeometry>;
      },
      shellGeometry?: NodeGeometry,
      /**
       * Set when this frame renders inside a frame-reference occurrence:
       * `refId` receives per-occurrence content-pan writes, `offsets` carries
       * that occurrence's saved content pan offsets, and `seen` guards
       * against reference cycles reaching this frame again.
       */
      occurrence?: {
        refId?: string;
        offsets?: ReadonlyMap<string, Point>;
        seen?: ReadonlySet<string>;
        /** Prefix for clip-path ids so duplicate references stay unique. */
        scope?: string;
      },
    ): ReactNode {
      const drawingPreview = scene?.preview ?? false;
      const staticScene = scene?.static ?? false;
      const renderEditable = !staticScene && !drawingPreview && editable;
      const nodePreview = drawingPreview || staticScene ? null : preview;
      const store = scene?.store ?? runtime.store,
        frame = store.cells[id];
      if (!isFrameCell(frame)) return null;
      const appearance = scene?.appearance ?? props.appearance;
      const theme =
        appearance === props.appearance
          ? themeForFrame(frame)
          : resolveBoardTheme(frame.view?.theme, appearance);
      const base = (scene?.layouts ?? frameLayouts)(id);
      const displayedFrame = shellGeometry
        ? { ...frame, geometry: shellGeometry }
        : dragRef.current?.id === id && nodePreview
          ? { ...frame, geometry: nodePreview }
          : frame;
      const contentPan =
        !staticScene && dragRef.current?.mode === 'content-pan';
      const projection =
        embedded && (shellGeometry || (contentPan && nodePreview))
          ? projectEmbeddedContent(
              props.extensions,
              store,
              displayedFrame,
              base.baseGeometry,
              base.fitBounds,
              contentPan && nodePreview && dragRef.current?.panFrameId === id
                ? new Map([
                    [
                      dragRef.current.id,
                      [
                        (dragRef.current.contentOffset?.[0] ?? 0) +
                          nodePreview.x -
                          dragRef.current.original.x,
                        (dragRef.current.contentOffset?.[1] ?? 0) +
                          nodePreview.y -
                          dragRef.current.original.y,
                      ] as Point,
                    ],
                  ])
                : (occurrence?.offsets ?? undefined),
            )
          : { geometry: base.geometry, offsets: base.contentOffsets };
      const contentOffsets = projection.offsets;
      const geometry =
        scene?.overrides || (dragRef.current && nodePreview && !contentPan)
          ? new Map(projection.geometry)
          : projection.geometry;
      scene?.overrides?.forEach((bounds, id) => geometry.set(id, bounds));
      if (dragRef.current && nodePreview && !contentPan) {
        const dragged = store.cells[dragRef.current.id];
        if (isGroupCell(dragged)) {
          for (const operation of translateCellSelection(
            base.store,
            [dragged.id],
            [
              nodePreview.x - dragRef.current.original.x,
              nodePreview.y - dragRef.current.original.y,
            ],
            runtime.registry,
          ))
            if (operation.type === 'replace_cell' && isNodeCell(operation.cell))
              geometry.set(operation.cell.id, operation.cell.geometry);
        } else geometry.set(dragRef.current.id, nodePreview);
      }
      const geometryChanged = geometry !== base.geometry;
      const laidOut = geometryChanged
        ? { ...base.store, cells: { ...base.store.cells } }
        : base.store;
      if (geometryChanged)
        geometry.forEach((g, key) => {
          const node = store.cells[key];
          if (isNodeCell(node)) laidOut.cells[key] = { ...node, geometry: g };
        });
      if (
        dragRef.current &&
        (dragRef.current.ids || isGroupCell(store.cells[dragRef.current.id])) &&
        nodePreview &&
        dragRef.current.focus.includes(id)
      ) {
        const delta: Point = [
          nodePreview.x - dragRef.current.original.x,
          nodePreview.y - dragRef.current.original.y,
        ];
        for (const operation of translateCellSelection(
          base.store,
          dragRef.current.ids ?? [dragRef.current.id],
          delta,
          runtime.registry,
        )) {
          if (operation.type !== 'replace_cell') continue;
          laidOut.cells[operation.cell.id] = operation.cell;
          if (isNodeCell(operation.cell))
            geometry.set(operation.cell.id, operation.cell.geometry);
        }
      }
      const lightweightRouting = !!(
        dragRef.current &&
        nodePreview &&
        !drawingPreview
      );
      const routing = geometryChanged
        ? createEdgeRoutingContext(
            laidOut,
            id,
            undefined,
            base.routing,
            runtime.registry,
            { preview: lightweightRouting },
          )
        : base.routing;
      if (!drawingPreview && !staticScene)
        displayedLayoutsRef.current.set(id, {
          store: laidOut,
          routing,
          fitBounds: base.fitBounds,
          getGeometry: (cellId) => {
            const node = laidOut.cells[cellId];
            return isNodeCell(node)
              ? (geometry.get(cellId) ?? node.geometry)
              : undefined;
          },
        });
      const fitted = embedded
        ? fitFrameContent(
            displayedFrame,
            lightweightRouting ||
              props.extensions?.some((extension) =>
                extension.plugin?.fitLayoutBounds?.(store, id),
              )
              ? base.fitBounds
              : frameContentBounds(laidOut, id, routing),
          )
        : { scale: 1, offset: [0, 0] as Point };
      const placement =
        Number.isFinite(fitted.scale) &&
        fitted.scale > 0 &&
        fitted.offset.every(Number.isFinite)
          ? fitted
          : { scale: 1, offset: [0, 0] as Point };
      const crossingJumps =
        drawingPreview || lightweightRouting
          ? undefined
          : frameEdgeCrossingJumps(laidOut, id, routing);
      const relationEdges = new Map<string, string[]>();
      for (const cellId of frame.children) {
        const edge = laidOut.cells[cellId];
        if (!isEdgeCell(edge) || edge.hidden) continue;
        for (const terminal of [edge.source, edge.target])
          if ('cellId' in terminal) {
            const connected = relationEdges.get(terminal.cellId) ?? [];
            connected.push(cellId);
            relationEdges.set(terminal.cellId, connected);
          }
      }
      const resolvedAppearances = new Map<Cell, ResolvedFrameCellAppearance>();
      const appearanceForCell = (cell: Cell) => {
        let visual = resolvedAppearances.get(cell);
        if (!visual) {
          visual = resolveFrameCellAppearance(
            { cell, store, frameId: id, theme },
            props.extensions,
          );
          resolvedAppearances.set(cell, visual);
        }
        return visual;
      };
      const contextForCell = (
        cell: Cell,
        bounds?: NodeGeometry,
      ): FrameRenderContext => ({
        appearance,
        theme,
        resolvedAppearance: appearanceForCell(cell),
        store,
        viewProjection: staticScene ? previewProjection : viewProjection,
        clearRevealOverrides: staticScene ? undefined : clearRevealOverrides,
        cell: store.cells[cell.id] ?? cell,
        geometry: bounds,
        selectionIds: staticScene ? [] : runtime.selection.ids,
        selected:
          !staticScene &&
          !drawingPreview &&
          !presenting &&
          runtime.selection.ids.includes(cell.id),
        pending,
        readonly:
          staticScene ||
          !renderEditable ||
          !!cell.locked ||
          lockedByAncestor(store, cell.id),
        preview: drawingPreview,
        frameId: id,
        scale:
          (staticScene ? 1 : cameraStore.getZoom()) *
          parentScale *
          placement.scale,
        hovered:
          !staticScene &&
          !drawingPreview &&
          !presenting &&
          cameraStore.isHovered(cell.id),
        getGeometry: geometryChanged
          ? (cellId: string) => {
              const node = store.cells[cellId];
              return isNodeCell(node)
                ? (geometry.get(cellId) ?? node.geometry)
                : undefined;
            }
          : base.getGeometry,
        select: () => {
          if (!drawingPreview && !staticScene)
            sceneActions.select(cell.id, focus);
        },
        edit: (id: string) => {
          if (!drawingPreview && !staticScene) sceneActions.editText(id);
        },
        history: (action: 'undo' | 'redo') => {
          if (!drawingPreview && !staticScene)
            void actionRuntime.executeAction(`canvas.history.${action}`);
        },
        commitEditing:
          drawingPreview || staticScene
            ? rejectPreviewIntent
            : (transaction) => {
                const request = sceneActions.dispatch(transaction);
                textCommitRef.current = request;
                return request;
              },
        dispatch:
          drawingPreview || staticScene
            ? rejectPreviewIntent
            : async (transaction) => {
                const result = await actionRuntime.executeAction(
                  'canvas.apply-operations',
                  {
                    operations: transaction.operations,
                    restoreView: transaction.restoreView,
                  },
                );
                return result.status === 'completed' || result.status === 'noop'
                  ? { status: 'accepted' }
                  : {
                      status: 'rejected',
                      message:
                        'code' in result
                          ? (result.message ?? result.code)
                          : result.status,
                    };
              },
      });
      const contextAtZoom = (
        context: FrameRenderContext,
        scale: number,
      ): FrameRenderContext => ({
        ...context,
        scale: scale * parentScale * placement.scale,
        hovered:
          !staticScene &&
          !drawingPreview &&
          cameraStore.isHovered(context.cell.id),
      });
      const renderCellBody = (
        cellId: string,
        layer: 'body' | 'controls' = 'body',
      ) => {
        const cell =
          !drawingPreview && edgePreview?.id === cellId
            ? edgePreview
            : laidOut.cells[cellId];
        if (!cell || cell.hidden) return null;
        const selected =
            !staticScene &&
            !drawingPreview &&
            !presenting &&
            runtime.selection.ids.includes(cellId),
          bounds = isNodeCell(cell)
            ? (geometry.get(cellId) ?? cell.geometry)
            : undefined;
        const extension = props.extensions?.find(
          (extension) =>
            (!extension.kind || extension.kind === cell.kind) &&
            extension.render,
        );
        const context = contextForCell(cell, bounds);
        if (
          layer === 'controls' &&
          (staticScene || props.referenceInteraction === 'details')
        )
          return null;

        if (layer === 'controls') {
          if (drawingPreview || staticScene) return null;
          const extensions = props.extensions?.filter(
            (extension) =>
              (!extension.kind || extension.kind === cell.kind) &&
              extension.renderControls,
          );
          if (!extensions?.length) return null;
          return (
            <FrameScaleContent
              key={`${cellId}-controls`}
              camera={cameraStore}
              cellId={drawingPreview ? undefined : cellId}
              render={(scale) => {
                const current = contextAtZoom(context, scale);
                const nodes = extensions.map((extension, index) => {
                  const controls = extension.renderControls?.(current);
                  return controls ? (
                    <g key={index} data-frame-export-exclude>
                      {controls}
                    </g>
                  ) : null;
                });
                if (!nodes.some(Boolean)) return null;
                return (
                  <g
                    transform={
                      bounds?.rotation
                        ? `rotate(${(bounds.rotation * 180) / Math.PI} ${bounds.x + bounds.width / 2} ${bounds.y + bounds.height / 2})`
                        : undefined
                    }
                  >
                    {nodes}
                  </g>
                );
              }}
            />
          );
        }
        const capabilities = runtime.registry.get(cell.kind);
        const allowed =
          capabilities && 'capabilities' in capabilities
            ? (
                capabilities as import('@sue/board-core').BaseCellUtil
              ).capabilities(
                store,
                cell,
                isFrameCell(cell) || isFrameReferenceCell(cell)
                  ? runtime.index.parentOf.has(cellId) && cellId !== frameId
                    ? 'embedded'
                    : 'root'
                  : embedded
                    ? 'embedded'
                    : 'root',
              )
            : {
                resize: !cell.locked,
                rotate: !cell.locked && !isFrameCell(cell),
              };
        const beginGeometryEdit = (
          event: React.PointerEvent<SVGElement>,
          mode: 'resize' | 'rotate',
          handle?: ResizeHandle,
        ) => {
          event.stopPropagation();
          event.preventDefault();
          if (
            !renderEditable ||
            pendingRef.current ||
            !bounds ||
            cell.locked ||
            !selectionAllows(
              runtime.store,
              [cellId],
              runtime.registry,
              mode,
              runtime.mountedRootId,
            ) ||
            parentScale * placement.scale <= 0
          )
            return;
          sceneActions.select(cellId, focus, false);
          const offset =
            28 /
            Math.max(
              0.02,
              (cameraRef.current.zoom ?? 1) * parentScale * placement.scale,
            );
          setDragging(true);
          setPreview(null);
          dragRef.current = {
            sessionId: ++dragSequence.current,
            pointerId: event.pointerId,
            id: cellId,
            start: sceneActions.pointFromEvent(event),
            original: bounds,
            canonicalOriginal:
              base.baseGeometry.get(cellId) ??
              (isNodeCell(cell) ? cell.geometry : bounds),
            focus,
            scale: parentScale * placement.scale,
            geometry,
            mode,
            handle,
            localStart: relativeAnchor(bounds, [
              0.5,
              -offset / (bounds.height || 1),
            ]),
          };
          svgRef.current?.setPointerCapture(event.pointerId);
        };
        const beginFrameMove = (event: React.PointerEvent<SVGElement>) => {
          if (
            (event.target as Element).closest('a[href]') &&
            shouldActivateRichTextLink(event, {
              activation: propsRef.current.interactionSettings?.linkActivation,
              readonly: propsRef.current.readonly || presenting,
            })
          )
            return;
          event.stopPropagation();
          activeControllerRef.current = null;
          propsRef.current.onActiveInstance?.(null);
          if (drawingPreview) return;
          if (event.button !== 0) {
            sceneActions.selectContextCell(cellId, focus);
            return;
          }
          if (event.shiftKey) sceneActions.select(cellId, focus, true);
          else sceneActions.selectContextCell(cellId, focus);
          if (
            renderEditable &&
            !pendingRef.current &&
            !cell.locked &&
            !sceneActions.selectionHasLockedGroup() &&
            selectionAllows(
              runtime.store,
              runtime.selection.ids,
              runtime.registry,
              'move',
              runtime.mountedRootId,
            ) &&
            bounds &&
            parentScale * placement.scale > 0
          ) {
            event.preventDefault();
            setDragging(true);
            setPreview(null);
            dragRef.current = {
              sessionId: ++dragSequence.current,
              pointerId: event.pointerId,
              collapseId:
                !event.shiftKey && runtime.selection.ids.length > 1
                  ? cellId
                  : undefined,
              ids:
                runtime.selection.ids.length > 1 &&
                !props.extensions?.some((extension) =>
                  extension.plugin?.fitLayoutBounds?.(store, id),
                )
                  ? [...runtime.selection.ids]
                  : undefined,
              id:
                runtime.selection.ids.length === 1 &&
                isGroupCell(store.cells[runtime.selection.ids[0]])
                  ? runtime.selection.ids[0]
                  : cellId,
              start: sceneActions.pointFromEvent(event),
              original: bounds,
              focus,
              scale: parentScale * placement.scale,
              geometry,
            };
          }
        };
        if (
          (staticScene || props.referenceInteraction === 'details') &&
          bounds &&
          (isDocumentCell(cell) ||
            isFrameReferenceCell(cell) ||
            isFrameCell(cell))
        ) {
          const document = isDocumentCell(cell);
          const targetId = document
            ? cell.data.targetDocumentId
            : isFrameReferenceCell(cell)
              ? cell.data.targetFrameId
              : cell.id;
          return (
            <g key={cellId}>
              <FrameReferenceCard
                id={cellId}
                targetId={targetId}
                geometry={bounds}
                document={document}
                title={
                  isBoardTextDocument(cell.content?.text) &&
                  cell.content.text.plainText
                    ? cell.content.text.plainText
                    : (cell.name ?? cell.content?.label)
                }
                appearance={cell.appearance}
                active={!staticScene && (selected || editing === cellId)}
                titleHidden={!staticScene && editing === cellId}
                onPointerDown={staticScene ? undefined : beginFrameMove}
                onTitleDoubleClick={
                  staticScene
                    ? undefined
                    : (event) => {
                        event.stopPropagation();
                        sceneActions.editText(cellId);
                      }
                }
                source={propsRef.current.instanceHost?.source}
                getTitle={
                  document
                    ? () => propsRef.current.documentReferences?.title(targetId)
                    : undefined
                }
                onOpen={
                  document
                    ? undefined
                    : () =>
                        propsRef.current.onOpenFrame?.(targetId, {
                          sourceFileId: id,
                          refId: cellId,
                          occurrenceId: `${id}/${cellId}`,
                        })
                }
                actions={
                  document
                    ? propsRef.current.documentReferences?.renderHeaderActions?.(
                        {
                          kind: cell.kind as
                            'document-frame' | 'document-reference',
                          ownerFrameId: id,
                          cellId,
                          readonly: true,
                          editing: false,
                          onExitEdit: () => {},
                          targetDocumentId: targetId,
                          instanceId: `${id}/${cellId}`,
                          suspended: false,
                          exporting: !!propsRef.current.exporting,
                          referenceInteraction: 'details',
                          onOpenDetails: (open) => {
                            void openReferenceDetails(open);
                          },
                        },
                      )
                    : undefined
                }
              />
              {selected && renderEditable && !cell.locked && (
                <FrameScaleContent
                  camera={cameraStore}
                  cellId={cellId}
                  render={(zoom) => (
                    <FrameSelectionHandles
                      id={cellId}
                      geometry={bounds}
                      scale={zoom * parentScale * placement.scale}
                      resize={allowed.resize}
                      rotate={false}
                      inset
                      outline={false}
                      onStart={beginGeometryEdit}
                    />
                  )}
                />
              )}
            </g>
          );
        }

        if (isDocumentCell(cell)) {
          const shell = bounds ?? cell.geometry;
          const contentBounds = frameContentViewport(shell);
          const instanceId = `${occurrence?.scope ?? propsRef.current.instanceId ?? frameId}/${cellId}`;
          const documentReadonly =
            !isDocumentFrameCell(cell) ||
            !renderEditable ||
            !!cell.locked ||
            lockedByAncestor(store, cell.id) ||
            !!propsRef.current.exporting ||
            !!propsRef.current.suspended;
          const documentIsEditing =
            !documentReadonly && documentEditing === instanceId;
          const exitDocumentEdit = () => {
            if (propsRef.current.referenceInteraction === 'activate') {
              void finishInlineEditing().then((ok) => {
                if (ok) {
                  sceneActions.select(cellId, focus, false);
                  svgRef.current?.focus({ preventScroll: true });
                }
              });
              return;
            }
            void finishDocumentEditing(instanceId).then((result) => {
              if (result.status === 'completed' || result.status === 'noop') {
                sceneActions.select(cellId, focus, false);
                svgRef.current?.focus({ preventScroll: true });
              }
            });
          };
          const title =
            cell.name ??
            propsRef.current.documentReferences?.title(
              cell.data.targetDocumentId,
            ) ??
            '文档引用';
          const referenceProps: FrameDocumentReferenceProps = {
            onOpenDetails: (open) => {
              void openReferenceDetails(open);
            },
            referenceInteraction:
              props.referenceInteraction === 'activate' ||
              props.referenceInteraction === 'details'
                ? 'details'
                : 'direct',
            kind: cell.kind,
            ownerFrameId: id,
            cellId,
            annotation: isBoardTextDocument(cell.content?.text)
              ? cell.content.text
              : undefined,
            readonly: documentReadonly,
            editing: documentIsEditing,
            onExitEdit: exitDocumentEdit,
            targetDocumentId: cell.data.targetDocumentId,
            instanceId,
            suspended: !!propsRef.current.suspended,
            exporting: !!propsRef.current.exporting,
          };
          const headerActions = propsRef.current.exporting
            ? null
            : propsRef.current.documentReferences?.renderHeaderActions?.(
                referenceProps,
              );
          const documentBody = nativeContent(
            cellId,
            [
              ...(propsRef.current.documentReferences?.getRevision
                ? [
                    propsRef.current.documentReferences.getRevision(
                      cell.data.targetDocumentId,
                    ),
                  ]
                : [
                    runtime.store,
                    propsRef.current.documentReferences,
                    propsRef.current.documentReferences?.revision,
                  ]),
              cell.kind,
              cell.data.targetDocumentId,
              referenceProps.annotation,
              referenceProps.referenceInteraction,
              documentReadonly,
              documentIsEditing,
              instanceId,
              id,
              propsRef.current.suspended,
              propsRef.current.exporting,
              JSON.stringify(focus),
            ],
            () =>
              propsRef.current.documentReferences?.render(referenceProps) ?? (
                <div style={{ padding: 12 }}>
                  文档未解析 · {cell.data.targetDocumentId}
                </div>
              ),
            `document-body:${instanceId}`,
          );
          return (
            <g
              key={cellId}
              data-cell-id={cellId}
              data-cell-kind={cell.kind}
              data-document-frame-instance={instanceId}
            >
              <FrameShell
                camera={cameraStore}
                scale={parentScale * placement.scale}
                geometry={shell}
                appearance={cell.appearance}
                active={!drawingPreview && (selected || documentIsEditing)}
                titleId={drawingPreview ? undefined : cellId}
                title={
                  <div title={title} style={{ height: '100%' }}>
                    <FrameRichText
                      text={plainTextDocument(cell, title)}
                      style={frameTitleStyle(selected || documentIsEditing)}
                    />
                  </div>
                }
                actions={headerActions}
                onPointerDown={beginFrameMove}
              >
                <foreignObject
                  {...contentBounds}
                  style={{ overflow: 'hidden' }}
                >
                  <div
                    style={{ height: '100%' }}
                    data-document-preview-body={
                      documentIsEditing ||
                      !isDocumentFrameCell(cell) ||
                      documentReadonly
                        ? ''
                        : undefined
                    }
                    onPointerDown={(event) => {
                      if (
                        !isDocumentFrameCell(cell) ||
                        documentIsEditing ||
                        documentReadonly ||
                        ((event.target as Element).closest('a[href]') &&
                          shouldActivateRichTextLink(event, {
                            activation:
                              propsRef.current.interactionSettings
                                ?.linkActivation,
                            readonly: documentReadonly,
                          })) ||
                        (event.target as Element).closest(
                          'button, input, select, [data-frame-text-toolbar]',
                        )
                      )
                        return;
                      event.preventDefault();
                      beginFrameMove(
                        event as unknown as React.PointerEvent<SVGElement>,
                      );
                    }}
                    onDoubleClick={(event) => {
                      if (
                        documentReadonly ||
                        ((event.target as Element).closest('a[href]') &&
                          shouldActivateRichTextLink(event, {
                            activation:
                              propsRef.current.interactionSettings
                                ?.linkActivation,
                            readonly: documentReadonly,
                          })) ||
                        (event.target as Element).closest('button')
                      )
                        return;
                      event.preventDefault();
                      event.stopPropagation();
                      sceneActions.select(cellId, focus, false);
                      if (propsRef.current.referenceInteraction === 'activate')
                        void activateInlineReference(cellId, instanceId);
                      else {
                        documentCommitRef.current = null;
                        setDocumentEditing(instanceId);
                      }
                    }}
                    onClickCapture={(event) => {
                      if (
                        documentIsEditing ||
                        documentReadonly ||
                        ((event.target as Element).closest('a[href]') &&
                          shouldActivateRichTextLink(event, {
                            activation:
                              propsRef.current.interactionSettings
                                ?.linkActivation,
                            readonly: documentReadonly,
                          })) ||
                        (event.target as Element).closest('button') ||
                        event.metaKey ||
                        event.ctrlKey
                      )
                        return;
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                  >
                    <FrameContentVisibility
                      exporting={propsRef.current.exporting}
                      editing={documentIsEditing}
                    >
                      {documentBody}
                    </FrameContentVisibility>
                  </div>
                </foreignObject>
              </FrameShell>
            </g>
          );
        }
        if (isFrameCell(cell)) {
          const shellBounds = bounds ?? cell.geometry;
          const contentBounds = frameContentViewport(shellBounds);
          const active = !drawingPreview && (selected || editing === cellId);
          return (
            <g
              key={cellId}
              data-cell-id={drawingPreview ? undefined : cellId}
              data-draft-cell-id={drawingPreview ? cellId : undefined}
              data-cell-kind={drawingPreview ? undefined : 'frame'}
              data-draft-cell-kind={drawingPreview ? 'frame' : undefined}
            >
              <FrameShell
                camera={cameraStore}
                scale={parentScale * placement.scale}
                geometry={shellBounds}
                appearance={cell.appearance}
                active={active}
                titleId={drawingPreview ? undefined : cellId}
                titleHidden={
                  !drawingPreview &&
                  editing === cellId &&
                  renderEditable &&
                  selectionAllows(
                    runtime.store,
                    [cellId],
                    runtime.registry,
                    'edit',
                    runtime.mountedRootId,
                  )
                }
                title={
                  <FrameRichText
                    text={
                      isBoardTextDocument(cell.content?.text) &&
                      cell.content.text.plainText
                        ? cell.content.text
                        : plainTextDocument(
                            cell,
                            cell.content?.label || 'Frame',
                          )
                    }
                    style={frameTitleStyle(active)}
                  />
                }
                onPointerDown={beginFrameMove}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  if (!sceneActions.enterSelectedGroup(cellId))
                    propsRef.current.onOpenFrame?.(cellId);
                }}
                onTitleDoubleClick={(event) => {
                  event.stopPropagation();
                  if (
                    !drawingPreview &&
                    !sceneActions.enterSelectedGroup(cellId)
                  )
                    sceneActions.editText(cellId);
                }}
              >
                {contentBounds.width > 0 &&
                  contentBounds.height > 0 &&
                  renderFrame(
                    cellId,
                    [...focus, cellId],
                    true,
                    parentScale * placement.scale,
                    scene ? { ...scene, children: undefined } : undefined,
                    bounds,
                    occurrence,
                  )}
              </FrameShell>
              {selected && renderEditable && !cell.locked && bounds && (
                <FrameScaleContent
                  camera={cameraStore}
                  cellId={drawingPreview ? undefined : cellId}
                  render={(zoom) => (
                    <FrameSelectionHandles
                      id={cellId}
                      geometry={bounds}
                      scale={zoom * parentScale * placement.scale}
                      resize={
                        allowed.resize &&
                        frameCellUI(props.extensions, cell.kind)
                          .resizeHandles !== false
                      }
                      rotate={false}
                      inset
                      outline={false}
                      onStart={beginGeometryEdit}
                    />
                  )}
                />
              )}
            </g>
          );
        }
        if (isFrameReferenceCell(cell)) {
          const shellBounds = bounds ?? cell.geometry;
          const contentBounds = frameContentViewport(shellBounds);
          const active = !drawingPreview && (selected || editing === cellId);
          const targetId = cell.data.targetFrameId;
          const target = laidOut.cells[targetId];
          const seen = new Set(
            occurrence?.seen ?? propsRef.current.referenceSeen ?? [id],
          );
          seen.add(id);
          const resolved = isFrameCell(target) && !seen.has(targetId);
          const title =
            cell.name ?? (isFrameCell(target) ? target.name : undefined);
          const label =
            title ??
            (isFrameCell(target) || propsRef.current.instanceHost
              ? 'Frame'
              : '引用缺失');
          const appearance = [
            ...(propsRef.current.referenceAppearance ?? [id]),
            cellId,
          ];
          const referenceSeen = [...seen, targetId];
          const host = propsRef.current.instanceHost;
          const referenceRevision =
            props.referenceInteraction === 'activate'
              ? (host?.source?.getSnapshot(targetId) ?? target)
              : propsRef.current.documentReferences?.getRevision?.(
                  targetId,
                  referenceSeen,
                );
          const activated =
            props.referenceInteraction === 'activate' &&
            activeReferenceId === cellId &&
            !props.exporting;
          const openDetails = () => {
            void openReferenceDetails(() =>
              propsRef.current.onOpenFrame?.(targetId, {
                sourceFileId: id,
                refId: cellId,
                occurrenceId: `${id}/${cellId}`,
              }),
            );
          };

          const instanceSurface =
            host &&
            !drawingPreview &&
            !seen.has(targetId) &&
            (props.referenceInteraction !== 'activate' || activated)
              ? nativeContent(
                  cellId,
                  [
                    ...(propsRef.current.documentReferences?.getRevision
                      ? [referenceRevision]
                      : [
                          runtime.store,
                          propsRef.current.documentReferences,
                          propsRef.current.documentReferences?.revision,
                        ]),
                    host,
                    props.referenceInteraction,
                    activated,
                    activated ? props.tool : undefined,
                    activated ? props.actionHost : undefined,
                    props.history,
                    propsRef.current.exporting,
                    id,
                    targetId,
                    propsRef.current.instanceId,
                    JSON.stringify(appearance),
                    JSON.stringify(referenceSeen),
                    JSON.stringify(focus),
                    contentBounds.width,
                    contentBounds.height,
                    shellBounds.width,
                    shellBounds.height,
                    referenceContentOffsets(props.extensions, cell),
                    propsRef.current.suspended,
                    propsRef.current.readonly,
                    propsRef.current.inputMode,
                    runtime.registry,
                    propsRef.current.extensions,
                  ],
                  () => (
                    <FrameReferenceSurface
                      edit={activated}
                      tool={activated ? props.tool : undefined}
                      actionHost={activated ? props.actionHost : undefined}
                      history={activated ? props.history : undefined}
                      interactionSettings={props.interactionSettings}
                      documentReferences={propsRef.current.documentReferences}
                      exporting={propsRef.current.exporting}
                      linkHost={propsRef.current.linkHost}
                      host={host}
                      ownerFileId={id}
                      refId={cellId}
                      targetFrameId={targetId}
                      parentOccurrenceId={propsRef.current.instanceId}
                      appearance={[
                        ...(propsRef.current.referenceAppearance ?? [id]),
                        cellId,
                      ]}
                      seen={referenceSeen}
                      bounds={frameContentViewport({
                        ...shellBounds,
                        x: 0,
                        y: 0,
                      })}
                      shellGeometry={{ ...shellBounds, x: 0, y: 0 }}
                      offsets={referenceContentOffsets(props.extensions, cell)}
                      suspended={propsRef.current.suspended}
                      readonly={propsRef.current.readonly}
                      inputMode={propsRef.current.inputMode}
                      registry={runtime.registry}
                      extensions={propsRef.current.extensions}
                      onOpen={openDetails}
                      onOpenFrame={(...args) => {
                        void openReferenceDetails(() =>
                          propsRef.current.onOpenFrame?.(...args),
                        );
                      }}
                      onActivate={(occurrenceId, childController) => {
                        if (childController) {
                          activeControllerRef.current = childController;
                          activatedOccurrences.current.set(
                            occurrenceId,
                            childController,
                          );
                          if (activated) {
                            const saved = inlineViews.current.get(cellId);
                            if (saved) {
                              if (
                                saved.targetId ===
                                childController.runtime.store.rootId
                              ) {
                                childController.runtime.select({
                                  focus: [saved.targetId],
                                  ids: saved.selection.ids.filter(
                                    (id) =>
                                      !!childController.runtime.store.cells[
                                        id
                                      ] &&
                                      !childController.runtime.store.cells[id]
                                        .hidden,
                                  ),
                                });
                                childController.restoreCamera(saved.camera);
                              }
                              inlineViews.current.delete(cellId);
                            }
                          }
                        }
                        propsRef.current.onActiveInstance?.(occurrenceId);
                      }}
                      onBackgroundTap={() => {
                        if (activated) return;
                        activeControllerRef.current = null;
                        propsRef.current.onActiveInstance?.(
                          propsRef.current.surface === 'nested'
                            ? (propsRef.current.instanceId ?? null)
                            : null,
                        );
                        sceneActions.selectContextCell(cellId, focus);
                        svgRef.current?.focus({ preventScroll: true });
                      }}
                      onSelection={(selection) =>
                        propsRef.current.onInstanceSelection?.(selection)
                      }
                      onExit={() => {
                        if (activated) {
                          void finishInlineEditing();
                          return;
                        }
                        activeControllerRef.current = null;
                        propsRef.current.onActiveInstance?.(null);
                        sceneActions.selectContextCell(cellId, focus);
                        svgRef.current?.focus();
                      }}
                    />
                  ),
                  `reference-surface:${JSON.stringify(appearance)}`,
                )
              : null;
          return (
            <g
              key={cellId}
              data-cell-id={drawingPreview ? undefined : cellId}
              data-draft-cell-id={drawingPreview ? cellId : undefined}
              data-inline-reference-id={activated ? cellId : undefined}
              data-cell-kind={drawingPreview ? undefined : 'frame-reference'}
              data-draft-cell-kind={drawingPreview ? 'frame' : undefined}
            >
              <FrameShell
                camera={cameraStore}
                scale={parentScale * placement.scale}
                geometry={shellBounds}
                appearance={cell.appearance}
                active={active}
                unresolved={!resolved && !propsRef.current.instanceHost}
                titleId={drawingPreview ? undefined : cellId}
                titleHidden={
                  !drawingPreview &&
                  editing === cellId &&
                  renderEditable &&
                  selectionAllows(
                    runtime.store,
                    [cellId],
                    runtime.registry,
                    'edit',
                    runtime.mountedRootId,
                  )
                }
                actions={
                  props.referenceInteraction === 'activate' ? (
                    <FrameDetailsButton
                      onOpen={openDetails}
                      disabled={
                        host?.source
                          ? !host.source.getSnapshot(targetId)
                          : !isFrameCell(target)
                      }
                    />
                  ) : undefined
                }
                title={
                  <FrameRichText
                    text={
                      isBoardTextDocument(cell.content?.text) &&
                      cell.content.text.plainText
                        ? cell.content.text
                        : plainTextDocument(cell, label)
                    }
                    style={frameTitleStyle(active)}
                  />
                }
                onPointerDown={beginFrameMove}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  if (props.referenceInteraction === 'activate') {
                    void activateInlineReference(cellId);
                    return;
                  }
                  if (!sceneActions.enterSelectedGroup(cellId))
                    propsRef.current.onOpenFrame?.(targetId, {
                      sourceFileId: id,
                      refId: cellId,
                      occurrenceId: `${occurrence?.scope ?? propsRef.current.instanceId ?? id}/${cellId}`,
                    });
                }}
                onTitleDoubleClick={(event) => {
                  event.stopPropagation();
                  if (
                    !drawingPreview &&
                    !sceneActions.enterSelectedGroup(cellId)
                  )
                    sceneActions.editText(cellId);
                }}
              >
                {props.referenceInteraction === 'activate' && !activated ? (
                  <g
                    transform={`translate(${shellBounds.x} ${shellBounds.y})`}
                    onPointerDown={beginFrameMove}
                    onDoubleClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (!propsRef.current.readonly)
                        void activateInlineReference(cellId);
                    }}
                  >
                    <FrameReferenceBoundary
                      revision={referenceRevision}
                      language={propsRef.current.actionHost?.language ?? 'zh'}
                      onOpen={openDetails}
                      bounds={frameContentViewport({
                        ...shellBounds,
                        x: 0,
                        y: 0,
                      })}
                    >
                      <FrameScenePreview
                        source={host?.source}
                        fallback={store}
                        targetFrameId={targetId}
                        geometry={{ ...shellBounds, x: 0, y: 0 }}
                        registry={runtime.registry}
                        extensions={props.extensions}
                        exporting={props.exporting}
                        offsets={
                          new Map(
                            Object.entries(
                              referenceContentOffsets(props.extensions, cell) ??
                                {},
                            ),
                          )
                        }
                        render={(staticInput, geometry, offsets) =>
                          renderFrame(
                            targetId,
                            [targetId],
                            true,
                            1,
                            staticInput,
                            geometry,
                            {
                              refId: cellId,
                              offsets,
                              scope: `${id}/${cellId}`,
                            },
                          )
                        }
                      />
                    </FrameReferenceBoundary>
                  </g>
                ) : propsRef.current.instanceHost &&
                  !drawingPreview &&
                  !seen.has(targetId) &&
                  contentBounds.width > 0 &&
                  contentBounds.height > 0 ? (
                  <g transform={`translate(${shellBounds.x} ${shellBounds.y})`}>
                    {instanceSurface}
                  </g>
                ) : (
                  resolved &&
                  contentBounds.width > 0 &&
                  contentBounds.height > 0 &&
                  renderFrame(
                    targetId,
                    [...focus, cellId],
                    true,
                    parentScale * placement.scale,
                    scene ? { ...scene, children: undefined } : undefined,
                    shellBounds,
                    {
                      refId: cellId,
                      offsets: new Map(
                        Object.entries(
                          referenceContentOffsets(props.extensions, cell) ?? {},
                        ),
                      ),
                      seen: new Set([...seen, targetId]),
                      scope: `${occurrence?.scope ?? propsRef.current.instanceId ?? id}/${cellId}`,
                    },
                  )
                )}
                {!(
                  propsRef.current.instanceHost &&
                  !drawingPreview &&
                  !seen.has(targetId) &&
                  contentBounds.width > 0 &&
                  contentBounds.height > 0
                ) &&
                  !resolved && (
                    <g data-frame-missing>
                      <rect
                        {...contentBounds}
                        fill="rgba(148, 163, 184, 0.08)"
                        stroke="#cbd5e1"
                        strokeDasharray="4 4"
                        vectorEffect="non-scaling-stroke"
                      />
                      <text
                        x={contentBounds.x + contentBounds.width / 2}
                        y={contentBounds.y + contentBounds.height / 2}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fill="#94a3b8"
                        fontSize={13}
                        pointerEvents="none"
                      >
                        {seen.has(targetId)
                          ? '已在当前预览路径中展示，可打开原图'
                          : '引用缺失'}
                      </text>
                    </g>
                  )}
              </FrameShell>
              {selected && renderEditable && !cell.locked && bounds && (
                <FrameScaleContent
                  camera={cameraStore}
                  cellId={drawingPreview ? undefined : cellId}
                  render={(zoom) => (
                    <FrameSelectionHandles
                      id={cellId}
                      geometry={bounds}
                      scale={zoom * parentScale * placement.scale}
                      resize={allowed.resize}
                      rotate={false}
                      inset
                      outline={false}
                      onStart={beginGeometryEdit}
                    />
                  )}
                />
              )}
            </g>
          );
        }
        if (isEdgeCell(cell)) {
          const sourceGeometry =
            'cellId' in cell.source
              ? context.getGeometry(cell.source.cellId)
              : undefined;
          const targetGeometry =
            'cellId' in cell.target
              ? context.getGeometry(cell.target.cellId)
              : undefined;
          const routeRouting =
            routing.preview &&
            (!('cellId' in cell.source) ||
              sourceGeometry === base.getGeometry(cell.source.cellId)) &&
            (!('cellId' in cell.target) ||
              targetGeometry === base.getGeometry(cell.target.cellId))
              ? base.routing
              : routing;
          let route = base.routes.get(cellId);
          if (
            !route ||
            route.cell !== cell ||
            route.routing !== routeRouting ||
            route.sourceGeometry !== sourceGeometry ||
            route.targetGeometry !== targetGeometry
          ) {
            const source = edgeTerminalPosition(
              store,
              cell.source,
              cell.target,
              geometry,
            );
            const target = edgeTerminalPosition(
              store,
              cell.target,
              cell.source,
              geometry,
            );
            const points = edgeRoutePoints(cell, source, target, routeRouting);
            const reusable =
              route?.cell === cell && route.points === points
                ? route
                : undefined;
            route = {
              cell,
              sourceGeometry,
              targetGeometry,
              routing: routeRouting,
              points,
              markers: reusable?.markers,
              labelPoints: reusable
                ? reusable.labelPoints
                : cell.route.mode === 'curve'
                  ? flattenCurve(points)
                  : points,
              path: reusable
                ? reusable.path
                : cell.route.mode === 'curve'
                  ? curvePath(points)
                  : polylinePath(points),
            };
            base.routes.set(cellId, route);
          }
          const { points, labelPoints } = route;
          const beginEdgeEdit = (
            event: React.PointerEvent<SVGElement>,
            mode: 'source' | 'target' | 'point' | 'segment' | 'label',
            localStart: Point,
            index = 0,
          ) => {
            event.stopPropagation();
            event.preventDefault();
            if (
              frameCellUI(props.extensions, cell.kind).editEdge === false ||
              (frameCellUI(props.extensions, cell.kind).editEdgeLabel ===
                false &&
                mode === 'label')
            ) {
              sceneActions.select(cellId, focus, event.shiftKey);
              return;
            }
            if (
              !renderEditable ||
              pendingRef.current ||
              cell.locked ||
              parentScale * placement.scale <= 0
            )
              return;
            edgeDragRef.current = {
              cell: store.cells[cellId] as EdgeCell,
              start: sceneActions.pointFromEvent(event),
              localStart,
              scale: parentScale * placement.scale,
              frameId: id,
              store: laidOut,
              points,
              mode,
              index,
            };
            setDragging(true);
            if (mode !== 'label')
              svgRef.current?.setPointerCapture(event.pointerId);
          };
          const markerData = cell.data as
            { sourceMarker?: string; targetMarker?: string } | undefined;
          const isBranch =
            frameCellUI(props.extensions, cell.kind).branch === true;
          const readableEdge =
            runtime.registry.get(cell.kind)?.routable !== false;
          const interactiveEndpoint = (terminal: EdgeCell['source']) => {
            if (!('cellId' in terminal) || !terminal.portId || !editable)
              return;
            const node = store.cells[terminal.cellId];
            if (
              !isNodeCell(node) ||
              node.locked ||
              lockedByAncestor(store, node.id) ||
              !node.ports?.some((p) => p.id === terminal.portId)
            )
              return;
            return {
              id: node.id,
              radius: 5 + (node.appearance?.strokeWidth ?? 1.5) / 2,
              visible:
                runtime.selection.ids.includes(node.id) ||
                snapTerminals.some(
                  (t) => 'cellId' in t && t.cellId === node.id,
                ),
            };
          };
          const shadowPoints = [
            ...points,
            ...(cell.labels ?? []).flatMap((_, at) => {
              const { bounds } = edgeLabelLayout(
                cell,
                at,
                labelPoints,
                routing,
              );
              return [
                [bounds.x, bounds.y],
                [bounds.x + bounds.width, bounds.y + bounds.height],
              ] as Point[];
            }),
          ];
          const minX = Math.min(...shadowPoints.map((point) => point[0])) - 12,
            minY = Math.min(...shadowPoints.map((point) => point[1])) - 12;
          const shadowBounds = {
            x: minX,
            y: minY,
            width:
              Math.max(...shadowPoints.map((point) => point[0])) - minX + 12,
            height:
              Math.max(...shadowPoints.map((point) => point[1])) - minY + 12,
          };
          const visual = context.resolvedAppearance ?? appearanceForCell(cell);
          const stroke = visual.strokeColor ?? '#64748b';
          return (
            <g
              key={cellId}
              data-cell-id={drawingPreview ? undefined : cellId}
              data-draft-cell-id={drawingPreview ? cellId : undefined}
              data-cell-kind={drawingPreview ? undefined : cell.kind}
              data-draft-cell-kind={drawingPreview ? cell.kind : undefined}
              onPointerEnter={() => {
                if (!drawingPreview && readableEdge)
                  cameraStore.setHovered(cellId);
              }}
              onPointerLeave={() => {
                if (readableEdge) cameraStore.leave(cellId);
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
                if (sceneActions.enterSelectedGroup(cellId)) return;
                if (
                  !renderEditable ||
                  !selectionAllows(
                    runtime.store,
                    [cellId],
                    runtime.registry,
                    'edit',
                    runtime.mountedRootId,
                  ) ||
                  pendingRef.current
                )
                  return;
                const target = (event.target as Element).closest(
                  '[data-edge-label]',
                );
                const index = Number(
                  target?.getAttribute('data-edge-label') ?? 0,
                );
                if (!cell.labels?.length)
                  void sceneActions.dispatch({
                    id: transactionId(),
                    operations: [
                      {
                        type: 'replace_cell',
                        cell: {
                          ...(runtime.store.cells[cellId] as EdgeCell),
                          labels: [{ text: '', position: 0.5 }],
                        },
                      },
                    ],
                  });
                setEditing(null);
                setLabelEditing({ id: cellId, index });
              }}
              onPointerDown={(event) => {
                event.stopPropagation();
                if (event.button !== 0) {
                  sceneActions.selectContextCell(cellId, focus);
                  return;
                }
                sceneActions.select(cellId, focus, event.shiftKey);
                const selectedGroup =
                  runtime.store.cells[runtime.selection.ids[0] ?? ''];
                const groupGeometry = isGroupCell(selectedGroup)
                  ? groupBounds(base.store, selectedGroup.id)
                  : undefined;
                if (
                  renderEditable &&
                  !pendingRef.current &&
                  runtime.selection.ids.length === 1 &&
                  isGroupCell(selectedGroup) &&
                  groupGeometry &&
                  selectionAllows(
                    runtime.store,
                    [selectedGroup.id],
                    runtime.registry,
                    'move',
                    runtime.mountedRootId,
                  )
                ) {
                  setDragging(true);
                  setPreview(null);
                  dragRef.current = {
                    sessionId: ++dragSequence.current,
                    pointerId: event.pointerId,
                    id: selectedGroup.id,
                    start: sceneActions.pointFromEvent(event),
                    original: groupGeometry,
                    focus,
                    scale: parentScale * placement.scale,
                    geometry: new Map(geometry),
                  };
                }
              }}
            >
              <FrameCellShadow
                shadow={cell.appearance?.shadow}
                bounds={shadowBounds}
              >
                {(filter) => (
                  <>
                    {(() => {
                      const fallback = (
                        <>
                          <FrameInteractiveEdge
                            id={cellId}
                            camera={cameraStore}
                            scale={parentScale * placement.scale}
                            bounds={{
                              x: shadowBounds.x - 4,
                              y: shadowBounds.y - 4,
                              width: shadowBounds.width + 8,
                              height: shadowBounds.height + 8,
                            }}
                            filter={filter}
                            interactive={readableEdge}
                            selected={selected || labelEditing?.id === cellId}
                            points={points}
                            sourceId={
                              readableEdge && 'cellId' in cell.source
                                ? cell.source.cellId
                                : undefined
                            }
                            targetId={
                              readableEdge && 'cellId' in cell.target
                                ? cell.target.cellId
                                : undefined
                            }
                            jumps={crossingJumps?.get(cellId)}
                            rounded={
                              readableEdge &&
                              (cell.route.mode === 'auto' ||
                                cell.route.mode === 'orthogonal')
                            }
                            relatedSelected={
                              readableEdge &&
                              runtime.selection.ids.some(
                                (selectedId) =>
                                  ('cellId' in cell.source &&
                                    selectedId === cell.source.cellId) ||
                                  ('cellId' in cell.target &&
                                    selectedId === cell.target.cellId),
                              )
                            }
                            curve={cell.route.mode === 'curve'}
                            source={interactiveEndpoint(cell.source)}
                            target={interactiveEndpoint(cell.target)}
                            markerKinds={[
                              markerData?.sourceMarker ?? 'none',
                              markerData?.targetMarker ??
                                (isBranch ? 'none' : 'arrow'),
                            ]}
                            appearance={cell.appearance}
                            stroke={stroke}
                            preview={drawingPreview}
                          >
                            {cell.labels?.map((label, at) => {
                              const { point, bounds: labelBounds } =
                                edgeLabelLayout(cell, at, labelPoints, routing);
                              if (
                                !staticScene &&
                                !drawingPreview &&
                                labelEditing?.id === cellId &&
                                labelEditing.index === at
                              )
                                return (
                                  <foreignObject
                                    key={at}
                                    data-edge-label-editor={at}
                                    x={labelBounds.x}
                                    y={labelBounds.y}
                                    width={labelBounds.width}
                                    height={labelBounds.height}
                                    stroke="none"
                                    style={{ overflow: 'visible' }}
                                  >
                                    <FrameTextEditor
                                      text={
                                        isBoardTextDocument(label.richText)
                                          ? label.richText
                                          : plainTextDocument(label, label.text)
                                      }
                                      style={{
                                        color: theme.adaptive
                                          ? readableThemeText(
                                              theme.background,
                                              visual.textColor ?? theme.text,
                                            )
                                          : stroke,
                                      }}
                                      readonly={!renderEditable}
                                      onClose={() => setLabelEditing(null)}
                                      onExitKey={() => svgRef.current?.focus()}
                                      onHistory={sceneActions.publishHistory}
                                      onChange={({ newText }) => {
                                        const authored =
                                          runtime.store.cells[cellId];
                                        if (!isEdgeCell(authored)) return;
                                        const next =
                                          frameCellUI(
                                            props.extensions,
                                            authored.kind,
                                          ).editableMarker === true && at > 0
                                            ? {
                                                ...authored,
                                                data: {
                                                  ...(authored.data as object),
                                                  [label.position === 0.12
                                                    ? 'sourceMultiplicity'
                                                    : 'targetMultiplicity']:
                                                    newText.plainText,
                                                },
                                              }
                                            : {
                                                ...authored,
                                                labels: (authored.labels?.length
                                                  ? authored.labels
                                                  : [{ text: '' }]
                                                ).map((previous, index) =>
                                                  index === at
                                                    ? {
                                                        ...previous,
                                                        text: newText.plainText,
                                                        richText: newText,
                                                      }
                                                    : previous,
                                                ),
                                              };
                                        const request = sceneActions.dispatch({
                                          id: transactionId(),
                                          operations: [
                                            {
                                              type: 'replace_cell',
                                              cell: next,
                                            },
                                          ],
                                        });
                                        textCommitRef.current = request;
                                        return request;
                                      }}
                                    />
                                  </foreignObject>
                                );
                              return (
                                <g
                                  key={at}
                                  data-edge-label={at}
                                  onPointerDown={(event) =>
                                    beginEdgeEdit(event, 'label', point, at)
                                  }
                                >
                                  <rect
                                    x={labelBounds.x}
                                    y={labelBounds.y}
                                    width={labelBounds.width}
                                    height={labelBounds.height}
                                    fill="transparent"
                                    stroke="none"
                                  />
                                  <foreignObject
                                    x={labelBounds.x}
                                    y={labelBounds.y}
                                    width={labelBounds.width}
                                    height={labelBounds.height}
                                    pointerEvents="none"
                                  >
                                    <FrameRichText
                                      text={
                                        isBoardTextDocument(label.richText)
                                          ? label.richText
                                          : plainTextDocument(label, label.text)
                                      }
                                      style={{
                                        color: theme.adaptive
                                          ? readableThemeText(
                                              theme.background,
                                              visual.textColor ?? theme.text,
                                            )
                                          : stroke,
                                      }}
                                    />
                                  </foreignObject>
                                </g>
                              );
                            })}
                          </FrameInteractiveEdge>
                        </>
                      );
                      return extension?.render ? (
                        <FrameScaleContent
                          camera={cameraStore}
                          cellId={drawingPreview ? undefined : cellId}
                          render={(scale) => {
                            const rendered = extension.render!(
                              contextAtZoom(context, scale),
                            );
                            return rendered == null ? (
                              fallback
                            ) : (
                              <g
                                filter={filter}
                                opacity={cell.appearance?.opacity}
                              >
                                {rendered}
                              </g>
                            );
                          }}
                        />
                      ) : (
                        fallback
                      );
                    })()}
                  </>
                )}
              </FrameCellShadow>
              <g
                data-frame-node-interaction-slot
                data-frame-export-exclude="interaction-slot"
              />
              {selected &&
                renderEditable &&
                !cell.locked &&
                labelEditing?.id !== cellId &&
                !!runtime.registry.get(cell.kind)?.canConnect && (
                  <FrameScaleContent
                    camera={cameraStore}
                    cellId={drawingPreview ? undefined : cellId}
                    render={(zoom) => (
                      <g
                        data-edge-controls={cellId}
                        fill="#fff"
                        stroke="#6366f1"
                        strokeWidth={1}
                      >
                        {(['source', 'target'] as const).map((end) => {
                          const point =
                            end === 'source' ? points[0] : points.at(-1)!;
                          return (
                            <circle
                              key={end}
                              data-edge-endpoint={end}
                              cx={point[0]}
                              cy={point[1]}
                              r={
                                6 /
                                Math.max(
                                  0.02,
                                  zoom * parentScale * placement.scale,
                                )
                              }
                              vectorEffect="non-scaling-stroke"
                              onPointerDown={(event) =>
                                beginEdgeEdit(event, end, point)
                              }
                            />
                          );
                        })}
                        {points.slice(1, -1).map((point, at) => (
                          <circle
                            key={at}
                            data-edge-route-point={at + 1}
                            cx={point[0]}
                            cy={point[1]}
                            r={
                              4 /
                              Math.max(
                                0.02,
                                zoom * parentScale * placement.scale,
                              )
                            }
                            vectorEffect="non-scaling-stroke"
                            onPointerDown={(event) =>
                              beginEdgeEdit(event, 'point', point, at + 1)
                            }
                          />
                        ))}
                        {points.slice(1).map((point, at) => {
                          const previous = points[at],
                            middle: Point = [
                              (point[0] + previous[0]) / 2,
                              (point[1] + previous[1]) / 2,
                            ],
                            size =
                              6 /
                              Math.max(
                                0.02,
                                zoom * parentScale * placement.scale,
                              );
                          return (
                            <rect
                              key={at}
                              data-edge-segment={at}
                              x={middle[0] - size / 2}
                              y={middle[1] - size / 2}
                              width={size}
                              height={size}
                              vectorEffect="non-scaling-stroke"
                              onPointerDown={(event) =>
                                beginEdgeEdit(event, 'segment', middle, at)
                              }
                            />
                          );
                        })}
                      </g>
                    )}
                  />
                )}
            </g>
          );
        }
        if (!bounds || !isNodeCell(cell)) return null;
        const outline =
          typeof bounds.outline === 'object'
            ? bounds.outline.kind
            : bounds.outline;
        let cachedOutline = base.outlines.get(cellId);
        if (
          !cachedOutline ||
          (cachedOutline.geometry !== bounds &&
            !sameGeometry(cachedOutline.geometry, bounds)) ||
          cachedOutline.registry !== shapeGeometry
        ) {
          const pathGeometry = nodeShapeGeometry(
            bounds.outline ?? 'roundRectangle',
            shapeGeometry,
          );
          cachedOutline = {
            geometry: bounds,
            registry: shapeGeometry,
            spec: nodeShapeSpec(bounds.outline ?? 'roundRectangle', bounds),
            pathGeometry,
            textBounds: pathGeometry?.textBounds?.(bounds) ?? bounds,
            parts: pathGeometry
              ? (pathGeometry.parts?.(bounds) ?? [
                  { d: pathGeometry.path(bounds) },
                ])
              : [],
          };
          base.outlines.set(cellId, cachedOutline);
        }
        const { spec, pathGeometry, parts: shapeParts } = cachedOutline;
        const textExtension = props.extensions?.find(
          (extension) =>
            (!extension.kind || extension.kind === cell.kind) &&
            extension.textBounds,
        );
        const defaultTextBounds = cachedOutline.textBounds;
        const shapeExtension = props.extensions?.find(
          (extension) =>
            (!extension.kind || extension.kind === cell.kind) &&
            extension.renderShape,
        );
        const shapeCacheKey = shapeExtension?.renderShapeCacheKey?.(context);
        const visual = context.resolvedAppearance ?? appearanceForCell(cell);
        const label = cell.content?.label ?? '';
        const presentationExtensions = props.extensions?.filter(
          (extension) =>
            (!extension.kind || extension.kind === cell.kind) &&
            extension.presentation,
        );
        const computeAppearance = (scale: number): FrameNodeAppearanceValue => {
          const current = contextAtZoom(context, scale);
          const presentation = presentationExtensions
            ?.map((extension) => extension.presentation?.(current))
            .find(Boolean);
          return {
            bounds: textExtension?.textBounds?.(current) ?? defaultTextBounds,
            fill: presentation?.fill,
            color: presentation?.color,
            stroke: presentation?.stroke,
          };
        };
        const text = isBoardTextDocument(cell.content?.text)
          ? cell.content.text
          : plainTextDocument(cell.content, label);
        const renderAppearance = ({
          bounds: textBounds,
          fill,
          color,
          stroke,
        }: FrameNodeAppearanceValue) => {
          const textStyle = {
            fontSize:
              (cell.data as { fontSize?: number })?.fontSize ??
              frameCellUI(props.extensions, cell.kind).defaultFontSize ??
              16,
            color:
              color ??
              (theme.adaptive
                ? readableThemeText(
                    (fill ?? visual.fill) === 'none' ||
                      (fill ?? visual.fill) === 'transparent'
                      ? theme.background
                      : (fill ?? visual.fill ?? theme.background),
                    visual.textColor ?? theme.text,
                  )
                : '#0f172a'),
          };
          const createFallback = () => (
            <>
              {(() => {
                const defaultOutline = pathGeometry ? (
                  <OutlineParts parts={shapeParts ?? []} />
                ) : outline === 'ellipse' ? (
                  <ellipse
                    cx={bounds.x + bounds.width / 2}
                    cy={bounds.y + bounds.height / 2}
                    rx={bounds.width / 2}
                    ry={bounds.height / 2}
                  />
                ) : spec.kind === 'polygon' ? (
                  <polygon points={spec.points} />
                ) : (
                  <rect
                    x={spec.x}
                    y={spec.y}
                    width={spec.width}
                    height={spec.height}
                    rx={spec.rx}
                    ry={spec.ry}
                  />
                );
                return (
                  <g data-frame-node-outline>
                    {shapeExtension?.renderShape ? (
                      <FrameScaleContent
                        camera={cameraStore}
                        cellId={drawingPreview ? undefined : cellId}
                        render={(scale) =>
                          shapeExtension.renderShape!(
                            contextAtZoom(context, scale),
                          ) ?? defaultOutline
                        }
                      />
                    ) : (
                      defaultOutline
                    )}
                  </g>
                );
              })()}
              {(staticScene || drawingPreview || editing !== cellId) && (
                <foreignObject
                  x={textBounds.x + 8}
                  y={textBounds.y + 4}
                  width={Math.max(1, textBounds.width - 16)}
                  height={Math.max(1, textBounds.height - 8)}
                  stroke="none"
                >
                  <FrameRichText
                    text={text}
                    style={textStyle}
                    defaultAlign={
                      frameCellUI(props.extensions, cell.kind)
                        .defaultTextAlignment === 'left'
                        ? Alignment.left
                        : undefined
                    }
                  />
                </foreignObject>
              )}
            </>
          );
          const fallback =
            drawingPreview || (shapeExtension && !shapeCacheKey)
              ? createFallback()
              : nativeContent(
                  cellId,
                  [
                    context.cell,
                    theme,
                    bounds,
                    shapeExtension,
                    ...(shapeCacheKey ?? []),
                    shapeParts,
                    text,
                    textBounds.x,
                    textBounds.y,
                    textBounds.width,
                    textBounds.height,
                    textStyle.color,
                    editing === cellId,
                  ],
                  createFallback,
                );
          const content = extension?.render ? (
            <FrameScaleContent
              camera={cameraStore}
              cellId={drawingPreview ? undefined : cellId}
              render={(scale) =>
                extension.render!(contextAtZoom(context, scale)) ?? fallback
              }
            />
          ) : (
            fallback
          );
          const createShadow = () => (
            <FrameStaticShadow
              shadow={cell.appearance?.shadow}
              bounds={bounds}
              content={content}
              opacity={cell.appearance?.opacity}
            />
          );
          const shadowedContent =
            drawingPreview || extension?.render
              ? createShadow()
              : nativeContent(
                  cellId,
                  [
                    content,
                    bounds,
                    cell.appearance?.shadow,
                    cell.appearance?.opacity,
                  ],
                  createShadow,
                  'shadow',
                );
          return (
            <g
              key={cellId}
              data-cell-id={drawingPreview ? undefined : cellId}
              data-draft-cell-id={drawingPreview ? cellId : undefined}
              data-cell-kind={drawingPreview ? undefined : cell.kind}
              data-draft-cell-kind={drawingPreview ? cell.kind : undefined}
              fill={fill ?? visual.fill ?? '#fff'}
              data-node-shape={bounds.outline}
              stroke={stroke ?? visual.strokeColor ?? '#64748b'}
              strokeWidth={cell.appearance?.strokeWidth ?? 1.5}
              strokeDasharray={
                cell.appearance?.strokeStyle === 'dashed'
                  ? '8 4'
                  : cell.appearance?.strokeStyle === 'dotted'
                    ? '2 4'
                    : undefined
              }
              onPointerEnter={(event) => {
                if (
                  !drawingPreview &&
                  (event.target as Element)
                    .closest('[data-cell-id]')
                    ?.getAttribute('data-cell-id') === cellId
                )
                  cameraStore.setHovered(cellId);
              }}
              onPointerLeave={() => cameraStore.leave(cellId)}
              transform={
                bounds.rotation
                  ? `rotate(${(bounds.rotation * 180) / Math.PI} ${bounds.x + bounds.width / 2} ${bounds.y + bounds.height / 2})`
                  : undefined
              }
              onDragStart={(event) => event.preventDefault()}
              onPointerDown={(event) => {
                event.stopPropagation();
                if (event.button !== 0) {
                  sceneActions.selectContextCell(cellId, focus);
                  return;
                }
                if (event.shiftKey) sceneActions.select(cellId, focus, true);
                else sceneActions.selectContextCell(cellId, focus);
                const util = runtime.registry.get(cell.kind);
                const canMove =
                  frameCellUI(props.extensions, cell.kind).pointerMove ===
                    true ||
                  (util && 'capabilities' in util
                    ? (
                        util as import('@sue/board-core').BaseCellUtil
                      ).capabilities(
                        store,
                        cell,
                        embedded ? 'embedded' : 'root',
                      ).move
                    : frameCellUI(props.extensions, cell.kind).pointerMove !==
                      false);
                // Mind topics report move:false, so a multi-selection cannot be
                // translated. A pointer on one topic still has to collapse that
                // selection on click and reorder that topic on drag.
                const selectionCanMove = selectionAllows(
                  runtime.store,
                  runtime.selection.ids,
                  runtime.registry,
                  'move',
                  runtime.mountedRootId,
                );
                if (
                  renderEditable &&
                  canMove &&
                  !pendingRef.current &&
                  !cell.locked &&
                  !sceneActions.selectionHasLockedGroup() &&
                  (selectionCanMove ||
                    frameCellUI(props.extensions, cell.kind).pointerMove ===
                      true ||
                    (embedded &&
                      frameCellUI(props.extensions, cell.kind).embeddedPan ===
                        true)) &&
                  parentScale * placement.scale > 0
                ) {
                  event.preventDefault();
                  setDragging(true);
                  setPreview(null);
                  dragRef.current = {
                    sessionId: ++dragSequence.current,
                    pointerId: event.pointerId,
                    mode:
                      embedded &&
                      frameCellUI(props.extensions, cell.kind).embeddedPan ===
                        true
                        ? 'content-pan'
                        : undefined,
                    panFrameId:
                      embedded &&
                      frameCellUI(props.extensions, cell.kind).embeddedPan ===
                        true
                        ? id
                        : undefined,
                    panRefId:
                      embedded &&
                      frameCellUI(props.extensions, cell.kind).embeddedPan ===
                        true
                        ? occurrence?.refId
                        : undefined,
                    contentOffset: contentOffsets.get(cellId),
                    collapseId:
                      !event.shiftKey && runtime.selection.ids.length > 1
                        ? cellId
                        : undefined,
                    ids:
                      selectionCanMove &&
                      runtime.selection.ids.length > 1 &&
                      !props.extensions?.some((extension) =>
                        extension.plugin?.fitLayoutBounds?.(store, id),
                      )
                        ? [...runtime.selection.ids]
                        : undefined,
                    id:
                      runtime.selection.ids.length === 1 &&
                      isGroupCell(store.cells[runtime.selection.ids[0]])
                        ? runtime.selection.ids[0]
                        : cellId,
                    start: sceneActions.pointFromEvent(event),
                    original: bounds,
                    focus,
                    scale: parentScale * placement.scale,
                    pointerMatrix: (
                      event.currentTarget
                        .parentElement as unknown as SVGGraphicsElement
                    )
                      ?.getScreenCTM?.()
                      ?.inverse(),
                    geometry: new Map(
                      frame.children.map((id) => {
                        const node = store.cells[id];
                        return [
                          id,
                          geometry.get(id) ??
                            (isNodeCell(node) ? node.geometry : bounds),
                        ];
                      }),
                    ),
                  };
                }
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
                if (sceneActions.enterSelectedGroup(cellId)) return;
                if (renderEditable) sceneActions.editText(cellId);
              }}
            >
              {shadowedContent}
              <g
                data-frame-node-interaction-slot
                data-frame-export-exclude="interaction-slot"
              />
              {selected &&
                renderEditable &&
                !cell.locked &&
                editing !== cellId && (
                  <FrameScaleContent
                    camera={cameraStore}
                    cellId={drawingPreview ? undefined : cellId}
                    render={(zoom) => (
                      <FrameSelectionHandles
                        id={cellId}
                        geometry={bounds}
                        scale={zoom * parentScale * placement.scale}
                        resize={
                          allowed.resize &&
                          frameCellUI(props.extensions, cell.kind)
                            .resizeHandles !== false
                        }
                        rotate={allowed.rotate}
                        outline={false}
                        onStart={beginGeometryEdit}
                      />
                    )}
                  />
                )}
              {!drawingPreview &&
                renderEditable &&
                !cell.locked &&
                !lockedByAncestor(store, cell.id) && (
                  <FrameScaleContent
                    camera={cameraStore}
                    cellId={cell.id}
                    render={() =>
                      selected ||
                      cameraStore.isHovered(cell.id) ||
                      snapTerminals.some(
                        (t) => 'cellId' in t && t.cellId === cell.id,
                      ) ? (
                        <g data-frame-export-exclude>
                          {cell.ports?.map((port) => {
                            const point = portAnchor(
                              { ...bounds, rotation: 0 },
                              port,
                            ).point;
                            return (
                              <circle
                                key={port.id}
                                data-port-id={port.id}
                                cx={point[0]}
                                cy={point[1]}
                                r={5}
                                data-port-active={
                                  snapTerminals.some(
                                    (terminal) =>
                                      'cellId' in terminal &&
                                      terminal.cellId === cell.id &&
                                      terminal.portId === port.id,
                                  )
                                    ? 'true'
                                    : undefined
                                }
                                fill={
                                  snapTerminals.some(
                                    (terminal) =>
                                      'cellId' in terminal &&
                                      terminal.cellId === cell.id &&
                                      terminal.portId === port.id,
                                  )
                                    ? '#6366f1'
                                    : '#fff'
                                }
                                stroke="#6366f1"
                                onPointerDown={(event) => {
                                  event.stopPropagation();
                                  if (
                                    !renderEditable ||
                                    cell.locked ||
                                    event.button !== 0
                                  )
                                    return;
                                  if (pendingRef.current) return;
                                  const start = connectingRef.current;
                                  if (!start) {
                                    if (port.direction === 'input') return;
                                    const source = portAnchor(
                                      bounds,
                                      port,
                                    ).point;
                                    connectingRef.current = {
                                      cellId: cell.id,
                                      portId: port.id,
                                      frameId: id,
                                      key: activeToolKey,
                                      id: transactionId(),
                                      kind:
                                        frameCellUI(props.extensions, cell.kind)
                                          .edgeKind ?? '',
                                      point: source,
                                      target: { point: source },
                                      scale: parentScale * placement.scale,
                                    };
                                    sceneActions.scheduleDraftPaint();
                                    return;
                                  }
                                  if (
                                    id !== start.frameId ||
                                    port.direction === 'output' ||
                                    (cell.id === start.cellId &&
                                      port.id === start.portId)
                                  )
                                    return;
                                  const edge = sceneActions.makeConnectionEdge(
                                    start,
                                    {
                                      cellId: cell.id,
                                      portId: port.id,
                                    },
                                  );
                                  try {
                                    const operations: CellOperation[] = [
                                      {
                                        type: 'insert_cell',
                                        parentId: id,
                                        cell: edge,
                                      },
                                    ];
                                    applyCellOperations(
                                      runtime.store,
                                      operations,
                                      runtime.registry,
                                    );
                                    connectingRef.current = null;
                                    sceneActions.clearDraftPaint();
                                    void sceneActions.dispatch({
                                      id: transactionId(),
                                      operations,
                                    });
                                  } catch (error) {
                                    // An explicit invalid terminal ends this gesture, so other
                                    // nodes remain selectable after the rejection.
                                    connectingRef.current = null;
                                    sceneActions.clearDraftPaint();
                                    const result = {
                                      status: 'rejected' as const,
                                      message:
                                        error instanceof Error
                                          ? error.message
                                          : String(error),
                                    };
                                    setFailure(result.message);
                                    propsRef.current.onReject?.(result);
                                  }
                                }}
                              />
                            );
                          })}
                        </g>
                      ) : null
                    }
                  />
                )}
              {!staticScene && !drawingPreview && editing === cellId && (
                <foreignObject
                  x={textBounds.x + 8}
                  y={textBounds.y + 4}
                  width={Math.max(1, textBounds.width - 16)}
                  height={Math.max(1, textBounds.height - 8)}
                  stroke="none"
                  style={{ overflow: 'visible' }}
                  opacity={cell.appearance?.opacity}
                >
                  <FrameTextEditor
                    text={text}
                    defaultAlign={
                      frameCellUI(props.extensions, cell.kind)
                        .defaultTextAlignment === 'left'
                        ? Alignment.left
                        : undefined
                    }
                    style={textStyle}
                    readonly={context.readonly || pending}
                    onClose={() => setEditing(null)}
                    onExitKey={() => svgRef.current?.focus()}
                    onTab={sceneActions.commitEditingTab}
                    onHistory={sceneActions.publishHistory}
                    onChange={(change) => {
                      const current = runtime.store.cells[cellId];
                      if (
                        !isNodeCell(current) ||
                        !selectionAllows(
                          runtime.store,
                          [cellId],
                          runtime.registry,
                          'edit',
                          runtime.mountedRootId,
                        )
                      )
                        return Promise.resolve({ status: 'rejected' as const });
                      const previous = isBoardTextDocument(
                        current.content?.text,
                      )
                        ? current.content.text
                        : createInlineText(current.content?.label ?? '');
                      if (sameBoardText(previous, change.newText)) return;
                      const request = sceneActions.dispatch({
                        id: transactionId(),
                        operations: [
                          {
                            type: 'replace_cell',
                            deferName: true,
                            cell: {
                              ...current,
                              name:
                                current.name ??
                                (nameSession.current?.initial || undefined),
                              content: {
                                ...current.content,
                                label: change.newText.plainText,
                                text: change.newText,
                              },
                            },
                          },
                        ],
                      });
                      textCommitRef.current = request;
                      return request;
                    }}
                  />
                </foreignObject>
              )}
            </g>
          );
        };
        if (
          !drawingPreview &&
          !scene &&
          !selected &&
          editing !== cellId &&
          !textExtension &&
          !presentationExtensions?.length &&
          (!shapeExtension || shapeCacheKey) &&
          !extension?.render
        ) {
          const render = () =>
            renderAppearance(computeAppearance(cameraStore.getZoom()));
          nativeEvents.setRender(cellId, render);
          return nativeContent(
            cellId,
            [
              context.cell,
              theme,
              bounds,
              shapeExtension,
              ...(shapeCacheKey ?? []),
              renderEditable,
              context.readonly,
              pending,
              snapTerminals,
              connectionPreview,
              activeToolKey,
              id,
              JSON.stringify(focus),
              parentScale * placement.scale,
            ],
            () => nativeEvents.update(cellId, render()),
            'shell',
          );
        }
        return textExtension || presentationExtensions?.length ? (
          <FrameNodeAppearance
            key={cellId}
            camera={cameraStore}
            cellId={drawingPreview ? undefined : cellId}
            compute={computeAppearance}
            render={renderAppearance}
          />
        ) : (
          renderAppearance(computeAppearance(cameraStore.getZoom()))
        );
      };
      const renderCell = (
        cellId: string,
        layer: 'body' | 'controls' = 'body',
      ) => {
        let node = renderCellBody(cellId, layer);
        const cell =
          !drawingPreview && edgePreview?.id === cellId
            ? edgePreview
            : laidOut.cells[cellId];
        if (!node || !cell) return node;
        const connected = relationEdges.get(cellId);
        if (
          layer === 'body' &&
          !staticScene &&
          !drawingPreview &&
          isNodeCell(cell)
        )
          node = (
            <FrameNodeInteraction
              key={cellId}
              camera={cameraStore}
              cellId={cellId}
              scale={parentScale * placement.scale}
              edgeIds={connected}
              bounds={geometry.get(cellId) ?? cell.geometry}
              baseWidth={
                cell.appearance?.strokeWidth ??
                (isFrameCell(cell) ||
                isFrameReferenceCell(cell) ||
                isDocumentCell(cell)
                  ? 1
                  : 1.5)
              }
              primary={
                runtime.selection.ids.includes(cellId) ||
                editing === cellId ||
                documentEditing ===
                  `${occurrence?.scope ?? propsRef.current.instanceId ?? frameId}/${cellId}`
              }
              enabled={!presenting && !props.exporting}
              relatedSelected={
                connected?.some((edgeId) =>
                  runtime.selection.ids.includes(edgeId),
                ) ?? false
              }
            >
              {node}
            </FrameNodeInteraction>
          );
        if (
          layer === 'body' &&
          !staticScene &&
          !drawingPreview &&
          isEdgeCell(cell) &&
          props.extensions?.some(
            (extension) =>
              (!extension.kind || extension.kind === cell.kind) &&
              extension.render,
          )
        ) {
          const points = base.routes.get(cellId)?.points ?? [];
          const x = Math.min(...points.map((point) => point[0]));
          const y = Math.min(...points.map((point) => point[1]));
          const edgeBounds = {
            x: x - 16,
            y: y - 16,
            width: Math.max(...points.map((point) => point[0])) - x + 32,
            height: Math.max(...points.map((point) => point[1])) - y + 32,
          };
          const terminals = [cell.source, cell.target].flatMap((terminal) =>
            'cellId' in terminal ? [terminal.cellId] : [],
          );
          if (points.length)
            node = (
              <FrameNodeInteraction
                key={cellId}
                camera={cameraStore}
                cellId={cellId}
                kind="edge"
                scale={parentScale * placement.scale}
                edgeIds={terminals}
                bounds={edgeBounds}
                baseWidth={cell.appearance?.strokeWidth ?? 2}
                enabled={!presenting && !props.exporting}
                primary={
                  runtime.selection.ids.includes(cellId) ||
                  labelEditing?.id === cellId
                }
                relatedSelected={terminals.some((terminal) =>
                  runtime.selection.ids.includes(terminal),
                )}
              >
                {node}
              </FrameNodeInteraction>
            );
        }
        const extensions = props.extensions?.filter(
          (extension) =>
            (!extension.kind || extension.kind === cell.kind) &&
            extension.visible,
        );
        if (!extensions?.length) return node;
        const context = contextForCell(
          cell,
          isNodeCell(cell)
            ? (geometry.get(cellId) ?? cell.geometry)
            : undefined,
        );
        return (
          <FrameScaleContent
            key={`${cellId}-${layer}-visible`}
            camera={cameraStore}
            cellId={drawingPreview ? undefined : cellId}
            onVisibilityCommit={sceneActions.publishViewStateAfterCommit}
            render={(scale) =>
              extensions.every((extension) =>
                extension.visible!(contextAtZoom(context, scale)),
              )
                ? node
                : null
            }
          />
        );
      };
      return (
        <FrameThemeGroup
          theme={theme}
          data-board-appearance={theme.adaptive ? theme.appearance : undefined}
          data-frame-content-id={drawingPreview ? undefined : id}
          data-draft-frame-content-id={drawingPreview ? id : undefined}
          transform={`translate(${placement.offset[0]} ${placement.offset[1]}) scale(${placement.scale})`}
        >
          {theme.adaptive &&
            embedded &&
            (() => {
              const plate = frameContentViewport(displayedFrame.geometry);
              return (
                <rect
                  data-frame-theme-background
                  x={(plate.x - placement.offset[0]) / placement.scale}
                  y={(plate.y - placement.offset[1]) / placement.scale}
                  width={plate.width / placement.scale}
                  height={plate.height / placement.scale}
                  fill={theme.background}
                  stroke="none"
                  pointerEvents="none"
                />
              );
            })()}
          {!staticScene &&
            !drawingPreview &&
            !presenting &&
            frame.groups.map((groupId) => {
              const group = store.cells[groupId];
              if (
                !isGroupCell(group) ||
                !runtime.selection.ids.includes(groupId)
              )
                return null;
              const bounds = groupBounds(laidOut, groupId);
              if (!bounds) return null;
              const { x, y, width, height } = bounds;
              return (
                <rect
                  key={groupId}
                  data-cell-id={groupId}
                  data-frame-export-exclude
                  pointerEvents="none"
                  x={x - 4}
                  y={y - 4}
                  width={width + 8}
                  height={height + 8}
                  fill="none"
                  stroke="#6366f1"
                  strokeDasharray="4 3"
                />
              );
            })}
          <FrameVirtualLayer
            camera={cameraStore}
            svg={svgRef}
            ids={scene?.children ?? frame.children}
            query={base.query}
            pinned={[
              editing ?? '',
              activeReferenceId ?? '',
              labelEditing?.id ?? '',
              edgePreview?.id ?? '',
              ...(documentEditing
                ? frame.children.filter((cellId) =>
                    documentEditing.endsWith('/' + cellId),
                  )
                : []),
              ...(dragging
                ? [...runtime.selection.ids, dragRef.current?.id ?? ''].flatMap(
                    (id) =>
                      isGroupCell(store.cells[id])
                        ? groupLeafMembers(store, id)
                        : [id],
                  )
                : []),
            ]}
            enabled={
              id === frameId &&
              !staticScene &&
              !drawingPreview &&
              !props.exporting &&
              frame.children.length >= 1000 &&
              !props.extensions?.some(
                (extension) =>
                  extension.visible &&
                  !extension.virtualizable?.(runtime.store, frameId),
              )
            }
          >
            {(cellId) => {
              const body = renderCell(cellId);
              if (
                staticScene ||
                drawingPreview ||
                id !== frameId ||
                !gestureRef.current?.erased.has(cellId)
              )
                return body;
              const cell = laidOut.cells[cellId];
              const bounds = isNodeCell(cell)
                ? (geometry.get(cellId) ?? cell.geometry)
                : undefined;
              return (
                <g key={cellId} data-erase-candidate={cellId}>
                  <g data-erase-dim opacity={0.35}>
                    {body}
                  </g>
                  <FrameScaleContent
                    camera={cameraStore}
                    cellId={drawingPreview ? undefined : cellId}
                    render={(zoom) => (
                      <g
                        data-frame-export-exclude
                        pointerEvents="none"
                        fill="none"
                        stroke="#ef4444"
                        strokeWidth={2 / (zoom * parentScale * placement.scale)}
                      >
                        {bounds ? (
                          <rect {...bounds} />
                        ) : isEdgeCell(cell) ? (
                          <path
                            d={
                              cell.route.mode === 'curve'
                                ? curvePath(
                                    edgePolyline(
                                      laidOut,
                                      cell,
                                      geometry,
                                      routing,
                                    ),
                                  )
                                : polylinePath(
                                    edgePolyline(
                                      laidOut,
                                      cell,
                                      geometry,
                                      routing,
                                    ),
                                  )
                            }
                          />
                        ) : null}
                      </g>
                    )}
                  />
                </g>
              );
            }}
          </FrameVirtualLayer>
          {!drawingPreview &&
            dragRef.current?.frameId === id &&
            alignmentGuides.length > 0 && (
              <g
                data-alignment-guides
                data-frame-export-exclude
                pointerEvents="none"
                aria-hidden="true"
                stroke="#3b82f6"
                strokeDasharray="4 3"
              >
                {alignmentGuides.map((guide) => (
                  <line
                    key={guide.axis}
                    data-alignment-guide={guide.axis}
                    vectorEffect="non-scaling-stroke"
                    strokeWidth={1}
                    x1={guide.axis === 'x' ? guide.position : guide.start}
                    x2={guide.axis === 'x' ? guide.position : guide.end}
                    y1={guide.axis === 'y' ? guide.position : guide.start}
                    y2={guide.axis === 'y' ? guide.position : guide.end}
                  />
                ))}
              </g>
            )}
          {!staticScene && !drawingPreview && (
            <FrameVirtualLayer
              camera={cameraStore}
              svg={svgRef}
              ids={frame.children}
              query={base.query}
              pinned={[
                editing ?? '',
                labelEditing?.id ?? '',
                edgePreview?.id ?? '',
                activeReferenceId ?? '',
              ]}
              enabled={
                id === frameId &&
                !props.exporting &&
                frame.children.length >= 1000 &&
                !props.extensions?.some(
                  (extension) =>
                    extension.visible &&
                    !extension.virtualizable?.(runtime.store, frameId),
                )
              }
            >
              {(cellId) => renderCell(cellId, 'controls')}
            </FrameVirtualLayer>
          )}
          {!drawingPreview &&
            moveGhostScene &&
            moveGhost?.frameId === id &&
            moveGhost.plan.ghost &&
            (() => {
              const parentId = moveGhost.plan.ghost.parentId;
              const parent = geometry.get(parentId);
              if (!parent) return null;
              return (
                <FrameRichTextPreviewContext.Provider value={true}>
                  <g
                    data-move-drop-preview
                    data-drawing-preview="move-drop"
                    data-frame-export-exclude
                    aria-hidden="true"
                    pointerEvents="none"
                  >
                    <rect
                      data-move-drop-target={parentId}
                      x={parent.x - 3}
                      y={parent.y - 3}
                      width={parent.width + 6}
                      height={parent.height + 6}
                      rx={5}
                      fill="none"
                      stroke="#6366f1"
                      strokeWidth={2}
                      vectorEffect="non-scaling-stroke"
                      transform={
                        parent.rotation
                          ? `rotate(${(parent.rotation * 180) / Math.PI} ${parent.x + parent.width / 2} ${parent.y + parent.height / 2})`
                          : undefined
                      }
                    />
                    <g data-move-ghost={moveGhost.id} opacity={0.35}>
                      {renderFrame(
                        id,
                        focus,
                        false,
                        parentScale * placement.scale,
                        {
                          ...moveGhostScene,
                          overrides: new Map([[parentId, parent]]),
                        },
                      )}
                    </g>
                  </g>
                </FrameRichTextPreviewContext.Provider>
              );
            })()}
          {!drawingPreview &&
            connectionScene &&
            connectionPreview?.frameId === id && (
              <FrameRichTextPreviewContext.Provider value={true}>
                <g
                  data-drawing-preview="connection"
                  data-frame-export-exclude
                  aria-hidden="true"
                  pointerEvents="none"
                >
                  {renderFrame(
                    id,
                    focus,
                    false,
                    parentScale * placement.scale,
                    connectionScene,
                  )}
                </g>
              </FrameRichTextPreviewContext.Provider>
            )}
        </FrameThemeGroup>
      );
    },
    // Selection and erased candidates change behind refs; their revisions repaint the scene.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      runtime,
      revision,
      frameId,
      frameLayouts,
      themeForFrame,
      props.appearance,
      props.extensions,
      presenting,
      editable,
      pending,
      cameraStore,
      preview,
      moveGhost,
      moveGhostScene,
      alignmentGuides,
      edgePreview,
      editing,
      labelEditing,
      documentEditing,
      activeReferenceId,
      props.referenceInteraction,
      props.suspended,
      props.exporting,
      activeToolKey,
      shapeGeometry,
      connectionScene,
      connectionPreview,
      snapTerminals,
      gesturePreview,
      sceneActions,
      plainTextDocument,
      nativeContent,
      nativeEvents,
      lockedByAncestor,
    ],
  );
  const sceneContent = useMemo(() => {
    displayedLayoutsRef.current.clear();
    const shell = propsRef.current.embedShell;
    return renderFrame(
      frameId,
      [frameId],
      Boolean(shell),
      1,
      undefined,
      shell?.geometry,
      shell
        ? {
            refId: shell.refId,
            offsets: shell.offsets,
            scope: propsRef.current.instanceId ?? frameId,
          }
        : undefined,
    );
  }, [
    renderFrame,
    frameId,
    props.documentReferences,
    props.documentReferences?.revision,
    props.exporting,
    props.embedShell,
    props.referenceSeen,
  ]);
  useLayoutEffect(() => {
    // Preview commits move authored content, not the viewport. Measuring after
    // each drag write would synchronously lay out the entire SVG again. Hand
    // and pinch input already refreshed its viewport before moving the camera.
    if (
      (!dragRef.current &&
        gestureRef.current?.mode !== 'hand' &&
        !pinchRef.current) ||
      viewportRectDirty.current ||
      props.surface === 'nested'
    )
      captureViewportRect();
    refreshSelectionWorldBoundsRef.current = refreshSelectionWorldBounds;
  });
  useLayoutEffect(() => {
    // World selection geometry changes with the committed scene, never its camera.
    refreshSelectionWorldBounds();
    publishViewStateRef.current();
    layoutReadyRef.current = viewProjection;
    layoutWaiters.current.forEach((resolve) => resolve());
  }, [sceneContent, refreshSelectionWorldBounds, viewProjection]);
  return (
    <FrameCanvasProviders
      theme={resolvedTheme}
      runtime={runtime}
      wheelOwner={wheelOwner}
    >
      <FrameRichTextLinkPolicyContext.Provider value={richTextLinkPolicy}>
        <FrameRichTextLinkContext.Provider value={props.linkHost}>
          <ActionScope
            registry={actionRuntime}
            language={props.actionHost?.language}
            enabled={!props.suspended && !props.exporting}
          >
            <div
              className={props.className}
              style={{
                position: 'relative',
                width: '100%',
                height: '100%',
                minHeight: 320,
                ...props.style,
              }}
            >
              <svg
                ref={svgRef}
                role="application"
                aria-label="Frame canvas"
                data-reveal-cell-id={revealHighlight ?? undefined}
                data-instance-id={propsRef.current.instanceId ?? frameId}
                data-board-appearance={props.appearance}
                data-theme-id={resolvedTheme.id}
                data-surface={props.surface ?? 'root'}
                tabIndex={
                  props.suspended || props.surface === 'nested' ? -1 : 0
                }
                onClickCapture={(event) => {
                  if (
                    (event.target as Element).closest?.(
                      '[data-document-preview-body]',
                    )
                  )
                    return;
                  if (
                    (event.target as Element).closest('a[href]') &&
                    shouldActivateRichTextLink(event, {
                      activation:
                        propsRef.current.interactionSettings?.linkActivation,
                      readonly: propsRef.current.readonly || presenting,
                    })
                  )
                    return;
                  if (propsRef.current.inputMode === 'present') {
                    event.preventDefault();
                    event.stopPropagation();
                  }
                }}
                onPointerDownCapture={(event) => {
                  viewportAnimation.current = viewportIsAnimated();
                  captureViewportRect();
                  if (
                    (event.target as Element).closest?.(
                      'button, [data-document-header-actions]',
                    )
                  )
                    return;
                  if (
                    shouldActivateRichTextLink(event, {
                      activation:
                        propsRef.current.interactionSettings?.linkActivation,
                      readonly: propsRef.current.readonly || presenting,
                    }) &&
                    (event.target as Element).closest('a[href]')
                  ) {
                    return;
                  }

                  if (
                    (event.target as Element).closest?.(
                      '[data-document-preview-body]',
                    )
                  )
                    return;
                  if (propsRef.current.suspended) return;
                  if (
                    propsRef.current.placing &&
                    event.button === 0 &&
                    !(event.target as Element).closest(
                      '[data-reference-instance]',
                    )
                  ) {
                    event.preventDefault();
                    event.stopPropagation();
                    propsRef.current.onPlace?.(
                      pointFromEventRef.current(event),
                    );
                    return;
                  }
                  if (
                    propsRef.current.inputMode !== 'present' &&
                    !(event.target as Element).closest?.(
                      '[data-reference-instance]',
                    )
                  ) {
                    activeControllerRef.current = null;
                    propsRef.current.onActiveInstance?.(null);
                  }
                  const zoom = cameraRef.current.zoom ?? 1;
                  // Portal controls bubble through the React canvas tree, but their
                  // pointer events belong to the editor, not canvas focus/gestures.
                  if (
                    (event.target as Element).closest(
                      '[data-frame-text-toolbar]',
                    )
                  )
                    return;
                  if (event.button === 0 && pointersRef.current.size === 0) {
                    keyboardSelectionRef.current = null;
                    keyboardEditRef.current = null;
                    actionAfterToken.current = null;
                  }
                  if (
                    !(event.target as Element).closest?.(
                      '[contenteditable="true"], input, textarea, select, [data-frame-text-editor]',
                    )
                  )
                    svgRef.current?.focus();
                  pointersRef.current.set(event.pointerId, [
                    event.clientX,
                    event.clientY,
                  ]);
                  if (pointersRef.current.size >= 2) {
                    presentTapRef.current = null;
                    event.preventDefault();
                    event.stopPropagation();
                    blockSinglePointerRef.current = true;
                    cancelInteraction();
                    const points = [...pointersRef.current.values()];
                    const rect = captureViewportRect()!;
                    pinchRef.current = {
                      distance:
                        Math.hypot(
                          points[0][0] - points[1][0],
                          points[0][1] - points[1][1],
                        ) || 1,
                      zoom: cameraRef.current.zoom ?? 1,
                      origin: [
                        ...(cameraRef.current.origination ?? zeroOrigin),
                      ],
                      center: [
                        (points[0][0] + points[1][0]) / 2 - rect.left,
                        (points[0][1] + points[1][1]) / 2 - rect.top,
                      ],
                    };
                    setDragging(true);
                    return;
                  }
                  if (
                    propsRef.current.referenceInteraction === 'activate' &&
                    activeReferenceRef.current !== null &&
                    propsRef.current.surface !== 'nested' &&
                    (event.target as Element).closest?.(
                      'svg[data-surface="nested"]',
                    )
                  )
                    return;
                  if (propsRef.current.inputMode === 'present') {
                    presentTapRef.current = null;
                    event.preventDefault();
                    event.stopPropagation();
                    if (event.button === 0 || event.button === 1) {
                      cancelInteraction();
                      if (event.button === 0 && !spaceHandRef.current) {
                        let target = event.target as Element | null;
                        let cellId: string | null = null;
                        while (target && target !== svgRef.current) {
                          const id = target.getAttribute('data-cell-id');
                          if (
                            id &&
                            runtime.index.parentOf.get(id) === frameId
                          ) {
                            cellId = id;
                            break;
                          }
                          target = target.parentElement;
                        }
                        presentTapRef.current = {
                          pointerId: event.pointerId,
                          x: event.clientX,
                          y: event.clientY,
                          cellId,
                        };
                      }
                      gestureRef.current = {
                        mode: 'hand',
                        dragPanSpeed: normalizeInteractionMultiplier(
                          propsRef.current.interactionSettings?.dragPanSpeed,
                        ),
                        points: [pointFromEvent(event)],
                        erased: new Set(),
                        origin: [
                          ...(cameraRef.current.origination ?? zeroOrigin),
                        ],
                        zoom: cameraRef.current.zoom ?? 1,
                        additive: false,
                      };
                      setDragging(true);
                      svgRef.current?.setPointerCapture(event.pointerId);
                      return;
                    }
                  }
                  if (event.button === 1 || spaceHandRef.current) {
                    event.preventDefault();
                    event.stopPropagation();
                    cancelInteraction();
                    const point = pointFromEvent(event);
                    gestureRef.current = {
                      mode: 'hand',
                      dragPanSpeed: normalizeInteractionMultiplier(
                        propsRef.current.interactionSettings?.dragPanSpeed,
                      ),
                      points: [point],
                      erased: new Set(),
                      origin: [
                        ...(cameraRef.current.origination ?? zeroOrigin),
                      ],
                      zoom: cameraRef.current.zoom ?? 1,
                      additive: false,
                    };
                    setDragging(true);
                    svgRef.current?.setPointerCapture(event.pointerId);
                    return;
                  }
                  if (event.button === 2) {
                    rightDragRef.current = {
                      pointerId: event.pointerId,
                      x: event.clientX,
                      y: event.clientY,
                      moved: false,
                    };
                    return;
                  }
                  if (event.button !== 0) return;
                  const tool = props.tool;
                  if (
                    connectingRef.current &&
                    !(event.target as Element).closest('[data-port-id]')
                  ) {
                    updateConnection(event);
                    const chosen = (event.target as Element)
                      .closest('[data-cell-id]')
                      ?.getAttribute('data-cell-id');
                    if (chosen && runtime.store.cells[chosen]) {
                      const focus: string[] = [];
                      let owner = runtime.index.parentOf.get(chosen);
                      while (owner) {
                        focus.unshift(owner);
                        if (owner === frameId) break;
                        owner = runtime.index.parentOf.get(owner);
                      }
                      if (focus[0] === frameId)
                        selectContextCell(chosen, focus);
                    }
                    event.stopPropagation();
                    event.preventDefault();
                    return;
                  }
                  if (tool?.mode === 'polyline') {
                    if (!editable || pendingRef.current || event.button !== 0)
                      return;
                    event.stopPropagation();
                    event.preventDefault();
                    svgRef.current?.focus();
                    const rawPoint = pointFromEvent(event);
                    const point = vectorDraftRef.current?.hover ?? rawPoint;
                    const draft = vectorDraftRef.current ?? {
                      points: [],
                      frameId,
                      tool,
                      key: activeToolKey,
                      context: drawingContext(cameraRef.current.zoom ?? 1),
                    };
                    if (
                      draft.points.length > 1 &&
                      Math.hypot(
                        point[0] - draft.points[0][0],
                        point[1] - draft.points[0][1],
                      ) *
                        zoom <=
                        8
                    ) {
                      draft.points.push([...draft.points[0]]);
                      vectorDraftRef.current = draft;
                      finishVectorDraft();
                      return;
                    }
                    if (
                      !draft.points.length ||
                      Math.hypot(
                        point[0] - draft.points.at(-1)![0],
                        point[1] - draft.points.at(-1)![1],
                      ) *
                        zoom >
                        0.5
                    )
                      draft.points.push(point);
                    draft.hover = undefined;
                    vectorDraftRef.current = draft;
                    scheduleDraftPaint();
                    return;
                  }
                  const background = event.target === event.currentTarget;
                  if (!tool || (tool.mode === 'select' && !background)) return;
                  if (
                    tool.mode !== 'hand' &&
                    tool.mode !== 'select' &&
                    (!editable || pendingRef.current)
                  )
                    return;
                  event.stopPropagation();
                  event.preventDefault();
                  const point = pointFromEvent(event);
                  gestureRef.current = {
                    mode: tool.mode,
                    dragPanSpeed: normalizeInteractionMultiplier(
                      propsRef.current.interactionSettings?.dragPanSpeed,
                    ),
                    key: activeToolKey,
                    frameId,
                    tool: 'complete' in tool ? tool : undefined,
                    context: drawingContext(cameraRef.current.zoom ?? 1),
                    points: [point],
                    erased: new Set(),
                    origin: [...(cameraRef.current.origination ?? zeroOrigin)],
                    zoom: cameraRef.current.zoom ?? 1,
                    additive: event.shiftKey,
                    focus:
                      runtime.selection.focus
                        .filter(
                          (id) => runtime.store.cells[id]?.cellType === 'frame',
                        )
                        .at(-1) === frameId
                        ? runtime.selection.focus
                        : [frameId],
                  };
                  scheduleDraftPaint();
                  svgRef.current?.setPointerCapture(event.pointerId);
                  if (tool.mode === 'hand') setDragging(true);
                  if (tool.mode === 'erase') eraseAt(point);
                  if (tool.mode === 'select' && !event.shiftKey)
                    runtime.select({
                      focus: gestureRef.current.focus ?? [frameId],
                      ids: [],
                    });
                }}
                style={{
                  ...frameThemeStyle(resolvedTheme),
                  width: '100%',
                  height: '100%',
                  outline: 'none',
                  overflow: 'hidden',
                  touchAction: 'none',
                  backgroundColor: resolvedTheme.background,
                  backgroundImage: view?.theme?.gridEnabled
                    ? `radial-gradient(circle, ${resolvedTheme.grid} 1px, transparent 1px)`
                    : undefined,
                  backgroundSize: view?.theme?.gridEnabled
                    ? `${Math.max(4, view.theme.gridSize ?? 20) * zoom}px ${Math.max(4, view.theme.gridSize ?? 20) * zoom}px`
                    : undefined,
                  backgroundPosition: `${-origin[0] * zoom}px ${-origin[1] * zoom}px`,
                  cursor:
                    props.tool?.mode === 'hand' || spaceHandRef.current
                      ? 'grab'
                      : props.tool?.mode === 'erase'
                        ? 'crosshair'
                        : undefined,
                }}
                onDragStart={(event) => event.preventDefault()}
                onPointerDown={(event) => {
                  if (propsRef.current.inputMode === 'present') return;
                  if (
                    (event.target as Element).closest?.(
                      '[data-frame-text-editor], [contenteditable="true"]',
                    )
                  )
                    return;
                  if (
                    dragRef.current ||
                    gestureRef.current ||
                    connectingRef.current
                  )
                    return;
                  keyboardSelectionRef.current = null;
                  keyboardEditRef.current = null;
                  runtime.select({ focus: [frameId], ids: [] });
                  props.onSelectionChange?.(runtime.selection);
                  setEditing(null);
                  setLabelEditing(null);
                }}
                onDoubleClickCapture={(event) => {
                  if (propsRef.current.inputMode === 'present') {
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                  }
                  if (
                    props.tool?.mode === 'polyline' &&
                    vectorDraftRef.current
                  ) {
                    event.stopPropagation();
                    event.preventDefault();
                    finishVectorDraft();
                  }
                }}
                onPointerLeave={() => {
                  cameraStore.setHovered(null);
                  if (props.tool?.mode === 'erase' && !gestureRef.current) {
                    eraserHoverRef.current = null;
                    clearDraftPaint();
                  }
                }}
                onPointerMove={(event) => {
                  const tap = presentTapRef.current;
                  if (
                    tap &&
                    tap.pointerId === event.pointerId &&
                    Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 4
                  )
                    presentTapRef.current = null;
                  const zoom = cameraRef.current.zoom ?? 1;
                  if (props.tool?.mode === 'erase' && !gestureRef.current) {
                    eraserHoverRef.current = pointFromEvent(event);
                    scheduleDraftPaint();
                  }
                  if (pointersRef.current.has(event.pointerId))
                    pointersRef.current.set(event.pointerId, [
                      event.clientX,
                      event.clientY,
                    ]);
                  if (pinchRef.current && pointersRef.current.size >= 2) {
                    const points = [...pointersRef.current.values()];
                    const distance =
                      Math.hypot(
                        points[0][0] - points[1][0],
                        points[0][1] - points[1][1],
                      ) || 1;
                    const rect = readViewportRect()!;
                    const center: Point = [
                      (points[0][0] + points[1][0]) / 2 - rect.left,
                      (points[0][1] + points[1][1]) / 2 - rect.top,
                    ];
                    const nextZoom = Math.max(
                      propsRef.current.inputMode === 'present' ? 0.01 : 0.1,
                      Math.min(
                        8,
                        pinchRef.current.zoom *
                          (distance / pinchRef.current.distance),
                      ),
                    );
                    const pinch = pinchRef.current;
                    rememberGesture({
                      zoom: nextZoom,
                      origination: [
                        pinch.origin[0] +
                          pinch.center[0] / pinch.zoom -
                          center[0] / nextZoom,
                        pinch.origin[1] +
                          pinch.center[1] / pinch.zoom -
                          center[1] / nextZoom,
                      ],
                    });
                    return;
                  }
                  const rightDrag = rightDragRef.current;
                  if (
                    rightDrag &&
                    rightDrag.pointerId === event.pointerId &&
                    !rightDrag.moved
                  ) {
                    if ((event.buttons & 2) === 0) rightDragRef.current = null;
                    else if (
                      Math.hypot(
                        event.clientX - rightDrag.x,
                        event.clientY - rightDrag.y,
                      ) > 6
                    ) {
                      cancelInteraction();
                      rightDrag.moved = true;
                      propsRef.current.onCanvasContextMenu?.(null);
                      const point = pointFromEvent(event);
                      gestureRef.current = {
                        mode: 'hand',
                        dragPanSpeed: normalizeInteractionMultiplier(
                          propsRef.current.interactionSettings?.dragPanSpeed,
                        ),
                        points: [point],
                        erased: new Set(),
                        origin: [
                          ...(cameraRef.current.origination ?? zeroOrigin),
                        ],
                        zoom: cameraRef.current.zoom ?? 1,
                        additive: false,
                      };
                      setDragging(true);
                      svgRef.current?.setPointerCapture(event.pointerId);
                    }
                  }
                  if (connectingRef.current) {
                    updateConnection(event);
                    return;
                  }
                  const draft = vectorDraftRef.current;
                  if (draft) {
                    let point = pointFromEvent(event);
                    const first = draft.points[0],
                      last = draft.points.at(-1)!;
                    if (
                      draft.points.length > 1 &&
                      Math.hypot(point[0] - first[0], point[1] - first[1]) *
                        zoom <=
                        8
                    )
                      point = [...first];
                    else if (event.shiftKey) {
                      const angle =
                          Math.round(
                            Math.atan2(point[1] - last[1], point[0] - last[0]) /
                              (Math.PI / 4),
                          ) *
                          (Math.PI / 4),
                        distance = Math.hypot(
                          point[0] - last[0],
                          point[1] - last[1],
                        );
                      point = [
                        last[0] + distance * Math.cos(angle),
                        last[1] + distance * Math.sin(angle),
                      ];
                    } else if (Math.abs(point[0] - last[0]) * zoom <= 5)
                      point = [last[0], point[1]];
                    else if (Math.abs(point[1] - last[1]) * zoom <= 5)
                      point = [point[0], last[1]];
                    draft.hover = point;
                    scheduleDraftPaint();
                    return;
                  }
                  if (edgeDragRef.current) {
                    updateEdgeDrag(event);
                    scheduleDraftPaint();
                    return;
                  }
                  const gesture = gestureRef.current;
                  if (gesture) {
                    if (gesture.mode === 'hand') {
                      const rect = readViewportRect()!;
                      const originalClient: Point = [
                        (gesture.points[0][0] - gesture.origin[0]) *
                          gesture.zoom,
                        (gesture.points[0][1] - gesture.origin[1]) *
                          gesture.zoom,
                      ];
                      setViewport({
                        zoom: gesture.zoom,
                        origination: [
                          gesture.origin[0] -
                            ((event.clientX - rect.left - originalClient[0]) *
                              (gesture.dragPanSpeed ?? 1)) /
                              gesture.zoom,
                          gesture.origin[1] -
                            ((event.clientY - rect.top - originalClient[1]) *
                              (gesture.dragPanSpeed ?? 1)) /
                              gesture.zoom,
                        ],
                      });
                    } else {
                      const point = pointFromEvent(event);
                      if (
                        ['select', 'box', 'line', 'erase'].includes(
                          gesture.mode,
                        )
                      )
                        gesture.points = [gesture.points[0], point];
                      else gesture.points.push(point);
                      if (gesture.mode === 'erase') eraseAt(point);
                      scheduleDraftPaint();
                    }
                    return;
                  }
                  const drag = dragRef.current;
                  if (drag) {
                    if (drag.pointerId !== event.pointerId) return;
                    if ((event.buttons & 1) === 0) {
                      clearNodeDrag();
                      return;
                    }
                    const point = pointFromEvent(event);
                    if (
                      (!drag.mode || drag.mode === 'content-pan') &&
                      !preview &&
                      Math.hypot(
                        point[0] - drag.start[0],
                        point[1] - drag.start[1],
                      ) *
                        zoom <
                        3
                    )
                      return;
                    // Capturing on pointerdown retargets clicks to the SVG and loses double clicks.
                    if (!svgRef.current?.hasPointerCapture(event.pointerId))
                      svgRef.current?.setPointerCapture(event.pointerId);
                    let dx = (point[0] - drag.start[0]) / drag.scale;
                    let dy = (point[1] - drag.start[1]) / drag.scale;
                    const ownerFrame = runtime.index.parentOf.get(drag.id);
                    if (
                      (!drag.mode || drag.mode === 'move') &&
                      ownerFrame &&
                      !props.extensions?.some((extension) =>
                        extension.plugin?.fitLayoutBounds?.(
                          runtime.store,
                          ownerFrame,
                        ),
                      ) &&
                      propsRef.current.interactionSettings?.smartGuides !==
                        false &&
                      !event.altKey
                    ) {
                      if (!drag.snapBounds) {
                        const cells = { ...runtime.store.cells };
                        drag.geometry.forEach((geometry, id) => {
                          const cell = cells[id];
                          if (isNodeCell(cell))
                            cells[id] = { ...cell, geometry };
                        });
                        const displayed = { ...runtime.store, cells };
                        const moving = drag.ids ?? [drag.id];
                        const selected = new Set(moving);
                        drag.snapBounds = unionCellBounds(
                          moving.flatMap((id) => {
                            const b = cellArrangementBounds(displayed, id);
                            return b ? [b] : [];
                          }),
                        );
                        const focusId = runtime.selection.focus.at(-1)!;
                        const targets = focusedCellIds(displayed, focusId);
                        drag.snapTargets = collectArrangementBlocks(
                          displayed,
                          ownerFrame,
                          targets,
                          runtime.registry,
                        )
                          .filter(
                            (block) =>
                              !selected.has(block.id) &&
                              !block.members.some((id) => selected.has(id)),
                          )
                          .map((block) => block.bounds);
                        drag.frameId = ownerFrame;
                      }
                      if (drag.snapBounds) {
                        const snap = snapArrangementDelta(
                          drag.snapBounds,
                          [dx, dy],
                          drag.snapTargets ?? [],
                          6 / (zoom * drag.scale),
                        );
                        [dx, dy] = snap.delta;
                        setAlignmentGuides(snap.guides);
                      }
                    } else setAlignmentGuides([]);
                    const nextPreview = (
                      drag.mode === 'resize'
                        ? roundNodeGeometry
                        : drag.mode === 'content-pan'
                          ? (geometry: NodeGeometry) => geometry
                          : roundNodePosition
                    )(
                      drag.mode === 'resize'
                        ? resizeNodeGeometry(
                            drag.original,
                            drag.handle ?? 'se',
                            [dx, dy],
                            {
                              preserveRatio:
                                event.shiftKey ||
                                (() => {
                                  const c = runtime.store.cells[drag.id];
                                  return (
                                    (isFrameCell(c) ||
                                      isFrameReferenceCell(c)) &&
                                    c.aspectRatio !== undefined &&
                                    c.aspectRatio !== 'custom'
                                  );
                                })(),
                              fromCenter: event.altKey,
                              minSize:
                                isFrameCell(runtime.store.cells[drag.id]) ||
                                isFrameReferenceCell(
                                  runtime.store.cells[drag.id],
                                )
                                  ? frameMinimumSize
                                  : 8,
                            },
                          )
                        : drag.mode === 'rotate'
                          ? rotateNodeGeometry(
                              drag.original,
                              drag.localStart!,
                              [
                                drag.localStart![0] + dx,
                                drag.localStart![1] + dy,
                              ],
                              event.shiftKey,
                            )
                          : {
                              ...drag.original,
                              x: drag.original.x + dx,
                              y: drag.original.y + dy,
                              derived: false,
                            },
                    );
                    setPreview(nextPreview);
                    const local = drag.pointerMatrix
                      ? new DOMPoint(
                          event.clientX,
                          event.clientY,
                        ).matrixTransform(drag.pointerMatrix)
                      : undefined;
                    updateMoveGhost(
                      drag,
                      nextPreview,
                      local
                        ? [local.x, local.y]
                        : [
                            nextPreview.x + nextPreview.width / 2,
                            nextPreview.y + nextPreview.height / 2,
                          ],
                    );
                  }
                }}
                onContextMenu={(event) => {
                  if (
                    (event.target as Element).closest(
                      '[contenteditable="true"], input, textarea',
                    )
                  )
                    return;
                  event.preventDefault();
                  // Native right-click menus can fire on press or release. Pointerup
                  // handles mouse menus; keep this path for keyboard invocation.
                  if (event.button === 2 || rightDragRef.current) return;
                  propsRef.current.onCanvasContextMenu?.([
                    event.clientX,
                    event.clientY,
                  ]);
                }}
                onDragOver={(event) => {
                  if ([...event.dataTransfer.types].includes('Files'))
                    event.preventDefault();
                }}
                onDrop={(event) => {
                  if (
                    (event.target as Element).closest(
                      '[contenteditable="true"], input, textarea',
                    ) ||
                    !editable ||
                    pendingRef.current
                  )
                    return;
                  const file = [...event.dataTransfer.files].find((item) =>
                    item.type.startsWith('image/'),
                  );
                  if (!file) return;
                  event.preventDefault();
                  void insertExternal(
                    { image: file },
                    pointFromEvent(event as unknown as React.PointerEvent),
                    event.clientX,
                    event.clientY,
                  );
                }}
                onPointerUp={(event) => {
                  const tap = presentTapRef.current;
                  if (tap?.pointerId === event.pointerId)
                    presentTapRef.current = null;
                  const rightDrag = rightDragRef.current;
                  if (rightDrag?.pointerId === event.pointerId) {
                    rightDragRef.current = null;
                    if (
                      event.button === 2 &&
                      !rightDrag.moved &&
                      Math.hypot(
                        event.clientX - rightDrag.x,
                        event.clientY - rightDrag.y,
                      ) <= 6 &&
                      !(event.target as Element).closest(
                        '[contenteditable="true"], input, textarea',
                      )
                    )
                      propsRef.current.onCanvasContextMenu?.([
                        event.clientX,
                        event.clientY,
                      ]);
                  }
                  pointersRef.current.delete(event.pointerId);
                  if (blockSinglePointerRef.current) {
                    if (pointersRef.current.size < 2 && pinchRef.current) {
                      commitGesture();
                      pinchRef.current = null;
                      setDragging(false);
                    }
                    if (pointersRef.current.size === 0)
                      blockSinglePointerRef.current = false;
                    return;
                  }
                  if (propsRef.current.inputMode === 'present') {
                    if (pointersRef.current.size === 0) {
                      if (
                        gestureRef.current?.mode === 'hand' ||
                        pinchRef.current
                      )
                        commitGesture();
                      gestureRef.current = null;
                      pinchRef.current = null;
                      setDragging(false);
                    }
                    // Settle the pan before a tap starts a camera animation; a later
                    // gesture commit would otherwise cancel that animation.
                    if (
                      tap?.pointerId === event.pointerId &&
                      Math.hypot(
                        event.clientX - tap.x,
                        event.clientY - tap.y,
                      ) <= 4
                    )
                      propsRef.current.onPresentTap?.(tap.cellId);
                    return;
                  }
                  if (pointersRef.current.size < 2) {
                    if (pinchRef.current || gestureRef.current?.mode === 'hand')
                      commitGesture();
                    pinchRef.current = null;
                    setDragging(false);
                  }
                  if (vectorDraftRef.current) return;
                  if (edgeDragRef.current) {
                    const final = updateEdgeDrag(event, false);
                    if (final)
                      void dispatch({
                        id: transactionId(),
                        operations: [{ type: 'replace_cell', cell: final }],
                      });
                    edgeDragRef.current = null;
                    setDragging(false);
                    edgePendingPreviewRef.current = null;
                    setEdgePreview(null);
                    clearDraftPaint();
                    return;
                  }
                  const gesture = gestureRef.current;
                  if (gesture) {
                    const tool = gesture.tool;
                    if (gesture.mode !== 'hand') {
                      const end = pointFromEvent(event);
                      if (gesture.mode === 'path') {
                        const last = gesture.points.at(-1)!;
                        if (last[0] !== end[0] || last[1] !== end[1])
                          gesture.points.push(end);
                      } else gesture.points = [gesture.points[0], end];
                      if (gesture.mode === 'erase') eraseAt(end);
                    }
                    if (gesture.mode === 'hand') commitGesture();
                    else if (gesture.mode === 'erase' && gesture.erased.size)
                      void dispatch({
                        id: transactionId(),
                        operations: deleteCells(
                          runtime.store,
                          [...gesture.erased],
                          {
                            registry: runtime.registry,
                          },
                        ),
                      });
                    else if (gesture.mode === 'select') {
                      const first = gesture.points[0],
                        last = gesture.points.at(-1)!;
                      const focus = gesture.focus ?? [frameId];
                      const displayed = selectionDisplayStore();
                      const ids = focusedCellIds(
                        displayed,
                        focus.at(-1)!,
                      ).filter((id) => {
                        const bounds = cellArrangementBounds(displayed, id);
                        return (
                          bounds &&
                          bounds.x >= Math.min(first[0], last[0]) &&
                          bounds.y >= Math.min(first[1], last[1]) &&
                          bounds.x + bounds.width <=
                            Math.max(first[0], last[0]) &&
                          bounds.y + bounds.height <=
                            Math.max(first[1], last[1])
                        );
                      });
                      runtime.select({
                        focus,
                        ids: gesture.additive
                          ? [...new Set([...runtime.selection.ids, ...ids])]
                          : ids,
                      });
                      props.onSelectionChange?.(runtime.selection);
                    } else if (tool && 'complete' in tool) {
                      try {
                        const operations = tool.complete(
                          runtime.store,
                          gesture.frameId ?? frameId,
                          gesture.points,
                          gesture.context
                            ? {
                                ...gesture.context,
                                zoom: cameraRef.current.zoom ?? 1,
                              }
                            : undefined,
                        );
                        commitCreatedCells(
                          operations,
                          gesture.frameId ?? frameId,
                          tool,
                        );
                      } catch (error) {
                        setFailure(
                          error instanceof Error
                            ? error.message
                            : String(error),
                        );
                      }
                    }
                    gestureRef.current = null;
                    setDragging(false);
                    rightDragRef.current = null;
                    clearDraftPaint();
                    return;
                  }
                  const drag = dragRef.current;
                  if (drag && drag.pointerId !== event.pointerId) return;
                  const currentPreview = previewRef.current;
                  let preview =
                    drag &&
                    currentPreview?.sessionId === drag.sessionId &&
                    currentPreview.id === drag.id
                      ? currentPreview.geometry
                      : null;
                  if (
                    drag &&
                    preview &&
                    (!drag.mode || drag.mode === 'move') &&
                    propsRef.current.extensions?.some(
                      (extension) =>
                        (!extension.kind ||
                          extension.kind ===
                            runtime.store.cells[drag.id]?.kind) &&
                        extension.previewMove,
                    )
                  ) {
                    const finalPoint = pointFromEvent(event);
                    preview = roundNodePosition({
                      ...drag.original,
                      x:
                        drag.original.x +
                        (finalPoint[0] - drag.start[0]) / drag.scale,
                      y:
                        drag.original.y +
                        (finalPoint[1] - drag.start[1]) / drag.scale,
                      derived: false,
                    });
                  }
                  if (drag?.collapseId && !preview)
                    select(drag.collapseId, drag.focus);
                  if (drag && preview) {
                    const cell = runtime.store.cells[drag.id];
                    if (
                      drag.mode === 'content-pan' &&
                      drag.panFrameId &&
                      isNodeCell(cell) &&
                      propsRef.current.embedShell
                    ) {
                      const shell = propsRef.current.embedShell;
                      const layout = frameLayouts(drag.panFrameId);
                      const frame = runtime.store.cells[drag.panFrameId];
                      if (isFrameCell(frame)) {
                        const requested: Point = [
                          (drag.contentOffset?.[0] ?? 0) +
                            preview.x -
                            drag.original.x,
                          (drag.contentOffset?.[1] ?? 0) +
                            preview.y -
                            drag.original.y,
                        ];
                        const offset = projectEmbeddedContent(
                          props.extensions,
                          runtime.store,
                          { ...frame, geometry: shell.geometry },
                          layout.baseGeometry,
                          layout.fitBounds,
                          new Map([[cell.id, requested]]),
                        ).offsets.get(cell.id);
                        if (
                          offset &&
                          (offset[0] !== drag.contentOffset?.[0] ||
                            offset[1] !== drag.contentOffset?.[1])
                        )
                          shell.onContentOffset(cell.id, offset);
                      }
                    } else if (
                      drag.mode === 'content-pan' &&
                      drag.panFrameId &&
                      isNodeCell(cell)
                    ) {
                      const layout = frameLayouts(drag.panFrameId);
                      const frame = runtime.store.cells[drag.panFrameId];
                      const refCell = drag.panRefId
                        ? runtime.store.cells[drag.panRefId]
                        : undefined;
                      const ref =
                        refCell && isFrameReferenceCell(refCell)
                          ? refCell
                          : undefined;
                      if (isFrameCell(frame) && (!drag.panRefId || ref)) {
                        // Occurrence pans clamp against the ref shell geometry and
                        // persist on the reference, never on shared target content.
                        const displayed = ref
                          ? { ...frame, geometry: ref.geometry }
                          : frame;
                        const requested: Point = [
                          (drag.contentOffset?.[0] ?? 0) +
                            preview.x -
                            drag.original.x,
                          (drag.contentOffset?.[1] ?? 0) +
                            preview.y -
                            drag.original.y,
                        ];
                        const offset = projectEmbeddedContent(
                          props.extensions,
                          runtime.store,
                          displayed,
                          layout.baseGeometry,
                          layout.fitBounds,
                          new Map([[cell.id, requested]]),
                        ).offsets.get(cell.id);
                        if (
                          offset &&
                          (offset[0] !== drag.contentOffset?.[0] ||
                            offset[1] !== drag.contentOffset?.[1])
                        )
                          void dispatch({
                            id: transactionId(),
                            operations: ref
                              ? [
                                  {
                                    type: 'replace_cell',
                                    cell: updateContentOffset(
                                      props.extensions,
                                      ref,
                                      cell.id,
                                      offset,
                                    ),
                                  },
                                ]
                              : [
                                  {
                                    type: 'replace_cell',
                                    cell: updateContentOffset(
                                      props.extensions,
                                      cell,
                                      cell.id,
                                      offset,
                                    ),
                                  },
                                ],
                          });
                      }
                    } else if (drag.ids) {
                      void dispatch({
                        id: transactionId(),
                        operations: translateCellSelection(
                          runtime.store,
                          drag.ids,
                          [
                            preview.x - drag.original.x,
                            preview.y - drag.original.y,
                          ],
                          runtime.registry,
                        ),
                      });
                    } else if (isGroupCell(cell)) {
                      void dispatch({
                        id: transactionId(),
                        operations: moveGroup(
                          runtime.store,
                          cell.id,
                          [
                            preview.x - drag.original.x,
                            preview.y - drag.original.y,
                          ],
                          runtime.registry,
                        ),
                      });
                    } else if (isNodeCell(cell)) {
                      const util = runtime.registry.get(cell.kind);
                      try {
                        const position = drag.pointerMatrix
                          ? new DOMPoint(
                              event.clientX,
                              event.clientY,
                            ).matrixTransform(drag.pointerMatrix)
                          : undefined;
                        const point: Point = position
                          ? [position.x, position.y]
                          : [
                              preview.x + preview.width / 2,
                              preview.y + preview.height / 2,
                            ];
                        const base =
                          util as import('@sue/board-core').BaseCellUtil;
                        const authoredPreview =
                          drag.mode === 'rotate'
                            ? { ...cell.geometry, rotation: preview.rotation }
                            : drag.mode === 'resize' && drag.canonicalOriginal
                              ? {
                                  ...preview,
                                  x:
                                    preview.x -
                                    drag.original.x +
                                    drag.canonicalOriginal.x,
                                  y:
                                    preview.y -
                                    drag.original.y +
                                    drag.canonicalOriginal.y,
                                }
                              : preview;
                        const movePlan = resolveMovePreview(
                          drag,
                          preview,
                          point,
                        );
                        const operations = movePlan
                          ? movePlan.operations
                          : util && 'move' in util
                            ? drag.mode === 'resize'
                              ? base.resize(
                                  runtime.store,
                                  cell,
                                  authoredPreview,
                                )
                              : drag.mode === 'rotate'
                                ? base.rotate(
                                    runtime.store,
                                    cell,
                                    authoredPreview,
                                  )
                                : base.move(
                                    runtime.store,
                                    cell,
                                    {
                                      ...cell.geometry,
                                      x: preview.x,
                                      y: preview.y,
                                      derived: false,
                                    },
                                    undefined,
                                    {
                                      point,
                                      geometry: drag.geometry,
                                      scale: cameraStore.getZoom() * drag.scale,
                                    },
                                  )
                            : [
                                {
                                  type: 'replace_cell' as const,
                                  cell: {
                                    ...cell,
                                    geometry:
                                      drag.mode === 'resize' ||
                                      drag.mode === 'rotate'
                                        ? authoredPreview
                                        : {
                                            ...cell.geometry,
                                            x: preview.x,
                                            y: preview.y,
                                            derived: false,
                                          },
                                  },
                                },
                              ];
                        if (operations.length)
                          void dispatch({ id: transactionId(), operations });
                      } catch (error) {
                        const result = {
                          status: 'rejected' as const,
                          message:
                            error instanceof Error
                              ? error.message
                              : String(error),
                        };
                        props.onReject?.(result);
                        setFailure(result.message);
                      }
                    }
                  }
                  clearNodeDrag();
                }}
                onLostPointerCapture={() => {
                  presentTapRef.current = null;
                  pointersRef.current.clear();
                  if (pinchRef.current || gestureRef.current?.mode === 'hand')
                    commitGesture();
                  pinchRef.current = null;
                  blockSinglePointerRef.current = false;
                  cancelInteraction();
                }}
                onPointerCancel={() => {
                  presentTapRef.current = null;
                  pointersRef.current.clear();
                  if (pinchRef.current || gestureRef.current?.mode === 'hand')
                    commitGesture();
                  pinchRef.current = null;
                  blockSinglePointerRef.current = false;
                  cancelInteraction();
                }}
                onKeyDown={(event) => {
                  if (
                    event.defaultPrevented ||
                    propsRef.current.suspended ||
                    event.nativeEvent.isComposing ||
                    event.nativeEvent.keyCode === 229 ||
                    ['Process', 'Dead', 'AltGraph'].includes(event.key) ||
                    event.getModifierState('AltGraph')
                  )
                    return;

                  if (
                    propsRef.current.suspended ||
                    propsRef.current.surface === 'nested'
                  ) {
                    if (
                      propsRef.current.surface === 'nested' &&
                      event.key === 'Escape'
                    )
                      event.stopPropagation();
                    if (propsRef.current.suspended) return;
                  }
                  if (
                    propsRef.current.surface === 'nested' &&
                    event.code === 'Space'
                  )
                    return;
                  if (vectorDraftRef.current && event.key === 'Enter') {
                    event.preventDefault();
                    finishVectorDraft(true);
                    return;
                  }
                  if (
                    editing &&
                    event.key === 'Tab' &&
                    !event.ctrlKey &&
                    !event.metaKey &&
                    !event.altKey
                  ) {
                    event.preventDefault();
                    event.stopPropagation();
                    commitEditingTab();
                    return;
                  }
                  if (editing || labelEditing) {
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      setEditing(null);
                      setLabelEditing(null);
                      svgRef.current?.focus();
                      return;
                    }
                    if (event.key !== 'Tab') return;
                    setEditing(null);
                    setLabelEditing(null);
                  }
                  if (
                    (event.target as Element).closest(
                      '[contenteditable="true"], input, textarea',
                    )
                  )
                    return;
                  if (
                    event.code === 'Space' &&
                    !event.ctrlKey &&
                    !event.metaKey &&
                    !event.altKey
                  ) {
                    event.preventDefault();
                    spaceHandRef.current = true;
                    return;
                  }
                  if (propsRef.current.inputMode === 'present') return;
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    clearRevealOverrides();
                    setRevealHighlight(null);
                    if (propsRef.current.placing) {
                      propsRef.current.onCancelPlace?.();
                      return;
                    }
                    if (
                      gestureRef.current ||
                      vectorDraftRef.current ||
                      connectingRef.current ||
                      edgeDragRef.current ||
                      dragRef.current
                    ) {
                      event.stopPropagation();
                      cancelInteraction();
                      return;
                    }
                    if (
                      propsRef.current.surface === 'nested' &&
                      propsRef.current.onExitInstance
                    ) {
                      event.stopPropagation();
                      propsRef.current.onExitInstance();
                      return;
                    }
                    const focus = runtime.selection.focus;
                    const group = runtime.store.cells[focus.at(-1)!];
                    runtime.select(
                      isGroupCell(group)
                        ? { focus: focus.slice(0, -1), ids: [group.id] }
                        : {
                            focus:
                              runtime.selection.ids.length || focus.length === 1
                                ? focus
                                : focus.slice(0, -1),
                            ids: [],
                          },
                    );
                    props.onSelectionChange?.(runtime.selection);
                    return;
                  }
                  if (
                    dragRef.current ||
                    gestureRef.current ||
                    edgeDragRef.current ||
                    connectingRef.current ||
                    vectorDraftRef.current
                  ) {
                    const owner = resolveActionShortcut(
                      actionRuntime.actions(),
                      event,
                    );
                    if (
                      owner.status === 'matched' &&
                      (owner.action.id.startsWith('draw.') ||
                        owner.action.id.startsWith('canvas.tool.') ||
                        owner.action.id.startsWith('product.diagram.'))
                    ) {
                      cancelInteraction();
                      event.preventDefault();
                      event.stopPropagation();
                      void owner.action.execute(undefined, {
                        source: 'shortcut',
                      });
                      return;
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                  }
                  const selected =
                    runtime.selection.ids.length === 1
                      ? runtime.store.cells[runtime.selection.ids[0]]
                      : undefined;
                  const resolved = resolveActionShortcut(
                    actionRuntime.actions(),
                    event,
                  );
                  if (resolved.status === 'matched') {
                    event.preventDefault();
                    event.stopPropagation();
                    void resolved.action.execute(undefined, {
                      source: 'shortcut',
                    });
                    return;
                  }
                  if (resolved.status === 'conflict') {
                    event.preventDefault();
                    event.stopPropagation();
                    setFailure('Conflicting shortcuts');
                    return;
                  }
                  if (
                    editable &&
                    !pendingRef.current &&
                    isNodeCell(selected) &&
                    !selected.locked &&
                    frameCellUI(props.extensions, selected.kind).topic &&
                    !event.ctrlKey &&
                    !event.metaKey &&
                    !event.altKey &&
                    event.key.length === 1 &&
                    event.code !== 'Space' &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    const text = createInlineText(event.key);
                    const previous = selected.content?.text;
                    if (isBoardTextDocument(previous)) {
                      text.id = previous.id;
                      text.align = previous.align;
                      const findText = (
                        node: import('@sue/board-common').BoardTextNode,
                      ):
                        | import('@sue/board-common').BoardTextNode
                        | undefined =>
                        node.type === 'text'
                          ? node
                          : node.content?.map(findText).find(Boolean);
                      const leaf = findText(text.content),
                        prior = findText(previous.content);
                      if (leaf && prior?.marks) leaf.marks = prior.marks;
                    }
                    const request = {
                      id: selected.id,
                      label: event.key,
                      accepted: false,
                    };
                    nameSession.current =
                      selected.name === undefined
                        ? {
                            id: selected.id,
                            initial: nodeContentName(selected),
                          }
                        : null;
                    keyboardEditRef.current = request;
                    void dispatch({
                      id: transactionId(),
                      operations: [
                        {
                          type: 'replace_cell',
                          deferName: true,
                          cell: {
                            ...selected,
                            name:
                              selected.name ??
                              (nameSession.current?.initial || undefined),
                            content: {
                              ...selected.content,
                              label: event.key,
                              text,
                            },
                          },
                        },
                      ],
                    }).then((result) => {
                      if (keyboardEditRef.current !== request) return;
                      if (result.status === 'rejected')
                        keyboardEditRef.current = null;
                      else {
                        request.accepted = true;
                        applyKeyboardSelection();
                      }
                    });
                    return;
                  }
                }}
                onCompositionStart={() => {
                  composingRef.current = true;
                }}
                onCompositionEnd={() => {
                  composingRef.current = false;
                }}
                onCopy={(event) => {
                  if (
                    (event.target as Element).closest(
                      '[contenteditable="true"], input, textarea',
                    ) ||
                    !runtime.selection.ids.length
                  )
                    return;
                  if (
                    !actionRuntime.getActionState('canvas.clipboard.copy')
                      .enabled
                  )
                    return;
                  event.preventDefault();
                  const fragment = copyCellFragment(
                    runtime.store,
                    runtime.selection.ids,
                    runtime.registry,
                    { fileId: frameId },
                  );
                  event.clipboardData.setData(
                    'application/x-verd-cells',
                    JSON.stringify(fragment),
                  );
                  event.clipboardData.setData(
                    'text/plain',
                    clipboardText(fragment),
                  );
                  void actionRuntime.executeAction(
                    'canvas.clipboard.copy',
                    { performNative: async () => ({ status: 'accepted' }) },
                    { source: 'native' },
                  );
                }}
                onCut={(event) => {
                  if (
                    (event.target as Element).closest(
                      '[contenteditable="true"], input, textarea',
                    ) ||
                    !actionRuntime.getActionState('canvas.clipboard.cut')
                      .enabled
                  )
                    return;
                  event.preventDefault();
                  try {
                    const cut = cutSelection();
                    if (!cut.ids.length) return;
                    event.clipboardData.setData(
                      'application/x-verd-cells',
                      JSON.stringify(cut.fragment),
                    );
                    event.clipboardData.setData(
                      'text/plain',
                      clipboardText(cut.fragment),
                    );
                    const source = runtime.store;
                    void actionRuntime.executeAction(
                      'canvas.clipboard.cut',
                      {
                        performNative: async () => {
                          if (runtime.store !== source)
                            return {
                              status: 'rejected',
                              message: 'Clipboard target changed',
                            };
                          return dispatch({
                            id: transactionId(),
                            operations: cut.operations,
                          });
                        },
                      },
                      { source: 'native' },
                    );
                  } catch (error) {
                    clipboardFailure(error);
                  }
                }}
                onPaste={(event) => {
                  if (
                    (event.target as Element).closest(
                      '[contenteditable="true"], input, textarea',
                    ) ||
                    !actionRuntime.getActionState('canvas.clipboard.paste')
                      .enabled
                  )
                    return;
                  const custom = event.clipboardData.getData(
                    'application/x-verd-cells',
                  );
                  const plain = event.clipboardData.getData('text/plain');
                  const items = event.clipboardData.items;
                  const image =
                    items && typeof items[Symbol.iterator] === 'function'
                      ? [...items]
                          .find((item) => item.type.startsWith('image/'))
                          ?.getAsFile()
                      : null;
                  if (!custom && !plain && !image) return;
                  event.preventDefault();
                  const source = runtime.store;
                  void actionRuntime.executeAction(
                    'canvas.clipboard.paste',
                    {
                      performNative: async () => {
                        if (runtime.store !== source)
                          return {
                            status: 'rejected',
                            message: 'Clipboard target changed',
                          };
                        try {
                          if (custom)
                            return await pasteFragment(JSON.parse(custom));
                          if (image)
                            return await insertExternal(
                              { image },
                              viewportCenter(),
                            );
                          let fragment: CellFragment;
                          try {
                            fragment = readClipboardText(plain);
                          } catch {
                            return await insertExternal(
                              { text: plain },
                              viewportCenter(),
                            );
                          }
                          return await pasteFragment(fragment);
                        } catch (error) {
                          return clipboardFailure(error);
                        }
                      },
                    },
                    { source: 'native' },
                  );
                }}
                onKeyUp={(event) => {
                  if (event.code === 'Space') spaceHandRef.current = false;
                }}
              >
                <style>{`[data-drawing-preview], [data-drawing-preview] * { pointer-events: none !important; }`}</style>
                <style>{frameTitleCss}</style>
                <g
                  ref={worldRef}
                  data-frame-world="true"
                  transform={`scale(${zoom}) translate(${-origin[0]} ${-origin[1]})`}
                >
                  {sceneContent}
                  {revealHighlight && revealBounds && (
                    <rect
                      data-frame-export-exclude
                      data-reveal-highlight={revealHighlight}
                      x={revealBounds.x - 6}
                      y={revealBounds.y - 6}
                      width={revealBounds.width + 12}
                      height={revealBounds.height + 12}
                      fill="none"
                      stroke="var(--vm-primary,#6366f1)"
                      strokeWidth={3 / zoom}
                      strokeDasharray="6 3"
                      pointerEvents="none"
                    />
                  )}
                  {vectorDraftRef.current && (
                    <circle
                      data-vector-close="true"
                      cx={vectorDraftRef.current.points[0][0]}
                      cy={vectorDraftRef.current.points[0][1]}
                      r={5 / zoom}
                      fill={
                        gesturePreview.length > 2 &&
                        gesturePreview.at(-1)![0] ===
                          vectorDraftRef.current.points[0][0] &&
                        gesturePreview.at(-1)![1] ===
                          vectorDraftRef.current.points[0][1]
                          ? '#6366f1'
                          : '#fff'
                      }
                      stroke="#6366f1"
                      strokeWidth={1 / zoom}
                      pointerEvents="none"
                    />
                  )}
                  {draftScene && (
                    <FrameRichTextPreviewContext.Provider value={true}>
                      <g
                        data-drawing-preview="true"
                        data-frame-export-exclude
                        aria-hidden="true"
                        pointerEvents="none"
                      >
                        {renderFrame(frameId, [frameId], false, 1, draftScene)}
                      </g>
                    </FrameRichTextPreviewContext.Provider>
                  )}
                  {gesturePreview.length > 0 &&
                    gestureRef.current?.mode !== 'hand' &&
                    !draftScene &&
                    (gestureRef.current?.mode === 'select' ? (
                      <rect
                        data-selection-marquee="true"
                        x={Math.min(
                          gesturePreview[0][0],
                          gesturePreview.at(-1)![0],
                        )}
                        y={Math.min(
                          gesturePreview[0][1],
                          gesturePreview.at(-1)![1],
                        )}
                        width={Math.abs(
                          gesturePreview.at(-1)![0] - gesturePreview[0][0],
                        )}
                        height={Math.abs(
                          gesturePreview.at(-1)![1] - gesturePreview[0][1],
                        )}
                        fill="#6366f1"
                        fillOpacity={0.1}
                        stroke="#6366f1"
                        strokeWidth={1 / zoom}
                        pointerEvents="none"
                      />
                    ) : props.tool?.mode === 'erase' ? (
                      <circle
                        data-eraser-preview="true"
                        data-frame-export-exclude
                        cx={gesturePreview.at(-1)![0]}
                        cy={gesturePreview.at(-1)![1]}
                        r={10 / zoom}
                        fill="#ef4444"
                        fillOpacity={0.08}
                        stroke="#ef4444"
                        strokeWidth={1 / zoom}
                        pointerEvents="none"
                      />
                    ) : (
                        vectorDraftRef.current?.tool ?? gestureRef.current?.tool
                      )?.preview ? null : gestureRef.current?.mode === 'box' ? (
                      <rect
                        data-drawing-preview="true"
                        data-frame-export-exclude
                        x={Math.min(
                          gesturePreview[0][0],
                          gesturePreview.at(-1)![0],
                        )}
                        y={Math.min(
                          gesturePreview[0][1],
                          gesturePreview.at(-1)![1],
                        )}
                        width={Math.abs(
                          gesturePreview.at(-1)![0] - gesturePreview[0][0],
                        )}
                        height={Math.abs(
                          gesturePreview.at(-1)![1] - gesturePreview[0][1],
                        )}
                        fill="none"
                        stroke="#6366f1"
                        strokeWidth={2 / zoom}
                        pointerEvents="none"
                      />
                    ) : (
                      <path
                        data-drawing-preview="true"
                        data-frame-export-exclude
                        d={polylinePath(
                          ['path', 'polyline'].includes(
                            (
                              vectorDraftRef.current?.tool ??
                              gestureRef.current?.tool
                            )?.mode ?? '',
                          )
                            ? gesturePreview
                            : [gesturePreview[0], gesturePreview.at(-1)!],
                        )}
                        fill="none"
                        stroke="#6366f1"
                        strokeWidth={2 / zoom}
                        pointerEvents="none"
                      />
                    ))}
                </g>
              </svg>
              {editing &&
                (isFrameCell(runtime.store.cells[editing]) ||
                  isFrameReferenceCell(runtime.store.cells[editing])) &&
                !runtime.store.cells[editing].hidden &&
                editable &&
                selectionAllows(
                  runtime.store,
                  [editing],
                  runtime.registry,
                  'edit',
                  runtime.mountedRootId,
                ) && (
                  <FrameTitleEditor
                    cellId={editing}
                    svg={svgRef.current}
                    style={frameTitleStyle(
                      runtime.selection.ids.includes(editing),
                    )}
                    text={
                      isBoardTextDocument(
                        (runtime.store.cells[editing] as NodeCell).content
                          ?.text,
                      )
                        ? ((runtime.store.cells[editing] as NodeCell).content!
                            .text as BoardTextDocument)
                        : plainTextDocument(
                            runtime.store.cells[editing],
                            (runtime.store.cells[editing] as NodeCell).content
                              ?.label ??
                              (runtime.store.cells[editing] as NodeCell).name ??
                              '',
                          )
                    }
                    readonly={!editable || pending}
                    onClose={() => setEditing(null)}
                    onExitKey={() => svgRef.current?.focus()}
                    onHistory={publishHistory}
                    onChange={({ newText }) => {
                      const cell = runtime.store.cells[editing];
                      if (
                        !(isFrameCell(cell) || isFrameReferenceCell(cell)) ||
                        !selectionAllows(
                          runtime.store,
                          [editing],
                          runtime.registry,
                          'edit',
                          runtime.mountedRootId,
                        )
                      )
                        return Promise.resolve({ status: 'rejected' as const });
                      const previous = isBoardTextDocument(cell.content?.text)
                        ? cell.content.text
                        : createInlineText(cell.content?.label ?? '');
                      if (sameBoardText(previous, newText)) return;
                      const request = dispatch({
                        id: transactionId(),
                        operations: [
                          {
                            type: 'replace_cell',
                            deferName: true,
                            cell: {
                              ...cell,
                              name:
                                cell.name ??
                                (nameSession.current?.initial || undefined),
                              content: {
                                ...cell.content,
                                label: newText.plainText,
                                text: newText,
                              },
                            },
                          },
                        ],
                      });
                      textCommitRef.current = request;
                      return request;
                    }}
                  />
                )}
              {props.overlays}
              {failure && (
                <div
                  role="alert"
                  style={{ position: 'absolute', bottom: 8, left: 8 }}
                >
                  {failure}
                </div>
              )}
            </div>
          </ActionScope>
        </FrameRichTextLinkContext.Provider>
      </FrameRichTextLinkPolicyContext.Provider>
    </FrameCanvasProviders>
  );
}) as <T = FrameSnapshot>(
  props: FrameCanvasProps<T> & { ref?: React.Ref<FrameCanvasController> },
) => React.ReactElement;

function FrameReferenceSurface({
  edit = false,
  tool,
  actionHost,
  history,
  interactionSettings,
  linkHost,
  documentReferences,
  exporting,
  host,
  ownerFileId,
  refId,
  targetFrameId,
  parentOccurrenceId,
  appearance,
  seen,
  bounds,
  shellGeometry,
  offsets,
  suspended,
  readonly,
  inputMode,
  registry,
  extensions,
  onOpen,
  onOpenFrame,
  onActivate,
  onBackgroundTap,
  onSelection,
  onExit,
}: {
  edit?: boolean;
  tool?: FrameCanvasTool;
  actionHost?: FrameActionHost;
  history?: FrameHistoryAdapter;
  interactionSettings?: FrameCanvasInteractionSettings;
  linkHost?: FrameLinkHost;
  documentReferences?: FrameDocumentReferences;
  exporting?: boolean;
  host: FrameInstanceHost;
  ownerFileId: string;
  refId: string;
  targetFrameId: string;
  parentOccurrenceId?: string;
  appearance: string[];
  seen: string[];
  bounds: { x: number; y: number; width: number; height: number };
  shellGeometry: { x: number; y: number; width: number; height: number };
  offsets?: Record<string, Point>;
  suspended?: boolean;
  readonly?: boolean;
  inputMode?: FrameCanvasCommon['inputMode'];
  registry?: CellRegistry;
  extensions?: readonly FrameRenderExtension[];
  onOpen(): void;
  onOpenFrame?: FrameCanvasCommon['onOpenFrame'];
  onActivate(
    occurrenceId: string,
    controller?: FrameCanvasController | null,
  ): void;
  onBackgroundTap(): void;
  onSelection(selection: CellSelection): void;
  onExit(): void;
}) {
  const { language } = useFrameI18n();
  const nestedController = useRef<FrameCanvasController>(null);
  const appearanceKey = appearance.join('/');
  const appearanceIdentity = JSON.stringify(appearance);
  const seenKey = JSON.stringify(seen);
  const query = useMemo<FrameInstanceQuery>(
    () => ({
      ownerFileId,
      refId,
      targetFrameId,
      appearance: JSON.parse(appearanceIdentity) as string[],
      parentOccurrenceId,
    }),
    [ownerFileId, refId, targetFrameId, appearanceIdentity, parentOccurrenceId],
  );
  const bodyRef = useRef<HTMLDivElement>(null);
  const admitted = usePreviewMount({
    force: exporting || edit,
    viewport: bodyRef,
    retain: true,
  });
  const [mounted, setMounted] = useState(false);
  useLayoutEffect(() => {
    if (!admitted) return undefined;
    const release = host.acquire(query, edit ? { edit: true } : undefined);
    setMounted(true);
    return typeof release === 'function' ? release : () => host.release(query);
  }, [host, query, admitted, edit]);
  const binding = admitted && mounted ? host.get(query) : null;
  useLayoutEffect(() => {
    if (edit && binding && nestedController.current) {
      onActivate(binding.occurrenceId, nestedController.current);
      onSelection(binding.runtime.selection);
      nestedController.current.runtime.select(binding.runtime.selection);
      bodyRef.current
        ?.querySelector<SVGSVGElement>('svg')
        ?.focus({ preventScroll: true });
    }
  }, [edit, binding?.runtime, binding?.occurrenceId, mounted]);
  const backgroundTap = useRef<{
    pointerId: number;
    x: number;
    y: number;
    target: Element;
    dispose(): void;
  } | null>(null);
  const cancelBackgroundTap = useCallback(() => {
    backgroundTap.current?.dispose();
    backgroundTap.current = null;
  }, []);
  useEffect(
    () => cancelBackgroundTap,
    [
      cancelBackgroundTap,
      binding?.occurrenceId,
      suspended,
      exporting,
      inputMode,
    ],
  );
  const offsetMap = useMemo(
    () => new Map(Object.entries(offsets ?? {})),
    [offsets],
  );
  const empty =
    binding &&
    binding.preview &&
    Object.keys(binding.runtime.store.cells).length <= 1;
  const callbacks = useRef({
    onOpen,
    onOpenFrame,
    onActivate,
    onSelection,
    onExit,
  });
  callbacks.current = { onOpen, onOpenFrame, onActivate, onSelection, onExit };
  const nestedRuntime = binding?.runtime;
  const occurrenceId = binding?.occurrenceId;
  const contentReadonly = binding?.readonly;
  const {
    x: shellX,
    y: shellY,
    width: shellWidth,
    height: shellHeight,
  } = shellGeometry;
  // Parent shell translation must not rebuild this occurrence's scene. Callback
  // forwarding stays live without changing the nested canvas's render inputs.
  const nestedContent = useMemo(
    () =>
      nestedRuntime && occurrenceId ? (
        <FrameReferenceBoundary
          revision={nestedRuntime.store}
          language={language}
          onOpen={() => callbacks.current.onOpen()}
        >
          <FrameCanvas
            ref={nestedController}
            referenceInteraction={edit ? 'details' : undefined}
            tool={tool}
            actionHost={actionHost}
            history={history}
            interactionSettings={interactionSettings}
            linkHost={linkHost}
            documentReferences={documentReferences}
            exporting={exporting}
            runtime={nestedRuntime}
            value={{ store: nestedRuntime.store }}
            adapter={{ toFrameSnapshot: (value) => value }}
            onIntent={(transaction) => host.commit(occurrenceId, transaction)}
            surface="nested"
            instanceId={occurrenceId}
            frameId={targetFrameId}
            readonly={readonly || contentReadonly || suspended}
            inputMode={inputMode}
            suspended={suspended}
            registry={registry}
            extensions={extensions}
            autoFit={false}
            viewportOrigin={[bounds.x, bounds.y]}
            referenceSeen={JSON.parse(seenKey) as string[]}
            referenceAppearance={query.appearance}
            instanceHost={host}
            onActiveInstance={(occurrenceId) => {
              if (occurrenceId)
                callbacks.current.onActivate(
                  occurrenceId,
                  nestedController.current,
                );
            }}
            onInstanceSelection={(selection) =>
              callbacks.current.onSelection(selection)
            }
            onExitInstance={() => callbacks.current.onExit()}
            onOpenFrame={(...args) => callbacks.current.onOpenFrame?.(...args)}
            embedShell={{
              refId,
              geometry: {
                x: shellX,
                y: shellY,
                width: shellWidth,
                height: shellHeight,
              },
              offsets: offsetMap,
              onContentOffset: (rootId, offset) =>
                host.updateContentOffset?.(occurrenceId, rootId, offset),
            }}
            onSelectionChange={(selection) =>
              callbacks.current.onSelection(selection)
            }
            style={{ width: '100%', height: '100%', minHeight: 0 }}
          />
        </FrameReferenceBoundary>
      ) : mounted ? (
        <div data-frame-missing>引用缺失</div>
      ) : null,
    [
      nestedRuntime,
      nestedRuntime?.store,
      occurrenceId,
      contentReadonly,
      mounted,
      documentReferences,
      documentReferences?.revision,
      exporting,
      language,
      linkHost,
      host,
      targetFrameId,
      readonly,
      edit,
      tool,
      actionHost,
      history,
      interactionSettings,
      suspended,
      inputMode,
      registry,
      extensions,
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
      shellX,
      shellY,
      shellWidth,
      shellHeight,
      seenKey,
      query.appearance,
      refId,
      offsetMap,
    ],
  );
  return (
    <foreignObject
      x={bounds.x}
      y={bounds.y}
      width={bounds.width}
      height={bounds.height}
      data-instance-host={appearanceKey}
      data-reference-pending={exporting && !mounted ? 'true' : undefined}
      style={{ overflow: 'hidden' }}
    >
      <div
        ref={bodyRef}
        data-reference-instance={binding?.occurrenceId ?? appearanceKey}
        onPointerDownCapture={(event) => {
          cancelBackgroundTap();
          if (
            suspended ||
            exporting ||
            (event.target as Element).closest?.('[data-document-preview-body]')
          )
            return;
          if (binding && inputMode !== 'present')
            onActivate(binding.occurrenceId, nestedController.current);
          const target = event.target as Element;
          if (
            !binding ||
            inputMode === 'present' ||
            event.button !== 0 ||
            event.isPrimary === false ||
            !target.matches('svg[data-surface="nested"]') ||
            target.getAttribute('data-instance-id') !== binding.occurrenceId ||
            target.closest('[data-reference-instance]') !== event.currentTarget
          )
            return;
          const moved = (next: PointerEvent) =>
            Math.hypot(next.clientX - tap.x, next.clientY - tap.y) > 4;
          const move = (next: PointerEvent) => {
            if (next.pointerId === tap.pointerId && moved(next))
              cancelBackgroundTap();
          };
          const release = (next: PointerEvent) => {
            if (next.pointerId !== tap.pointerId) return;
            if (moved(next) || next.target !== target) cancelBackgroundTap();
            // Let the nested canvas settle its gesture before selecting the
            // owner shell. Clean up even when another surface consumes up.
            window.setTimeout(() => {
              if (backgroundTap.current === tap) cancelBackgroundTap();
            }, 0);
          };
          const tap = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            target,
            dispose() {
              window.removeEventListener(
                'pointerdown',
                cancelBackgroundTap,
                true,
              );
              window.removeEventListener('pointermove', move, true);
              window.removeEventListener('pointerup', release, true);
              window.removeEventListener(
                'pointercancel',
                cancelBackgroundTap,
                true,
              );
              window.removeEventListener('blur', cancelBackgroundTap);
            },
          };
          backgroundTap.current = tap;
          // Window capture also observes movement outside the reference and
          // extra fingers intercepted by the parent canvas's pinch handler.
          window.addEventListener('pointerdown', cancelBackgroundTap, true);
          window.addEventListener('pointermove', move, true);
          window.addEventListener('pointerup', release, true);
          window.addEventListener('pointercancel', cancelBackgroundTap, true);
          window.addEventListener('blur', cancelBackgroundTap);
        }}
        onPointerUp={(event) => {
          const tap = backgroundTap.current;
          cancelBackgroundTap();
          if (
            tap?.pointerId === event.pointerId &&
            tap.target === event.target &&
            event.button === 0
          )
            onBackgroundTap();
        }}
        style={{ width: '100%', height: '100%', position: 'relative' }}
      >
        <FrameContentVisibility exporting={exporting} editing={edit}>
          {nestedContent}
        </FrameContentVisibility>
        {!edit && empty && inputMode !== 'present' ? (
          <button
            type="button"
            data-preview-open
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
            }}
            onClick={(event) => {
              event.stopPropagation();
              onOpen();
            }}
          >
            打开编辑
          </button>
        ) : null}
        {!edit && binding?.preview ? (
          <button
            type="button"
            data-open-source
            style={{ position: 'absolute', right: 8, bottom: 8 }}
            onDoubleClick={(event) => {
              event.stopPropagation();
              onOpen();
            }}
            onClick={(event) => {
              event.stopPropagation();
              onOpen();
            }}
          >
            打开原画布
          </button>
        ) : null}
      </div>
    </foreignObject>
  );
}
