import {
  fitContentCandidates,
  fitContentOperations,
} from './frame-fit-content';
import { measureBoardText } from '@sue/board-react-text';
import { createFrameWheelOwner, FrameWheelContext } from './frame-wheel';
import { projectEmbeddedMindTrees } from './frame-mind-projection';
import { snapArrangementDelta, type AlignmentGuide } from './frame-alignment';
import {
  normalizeInteractionMultiplier,
  type FrameCanvasInteractionSettings,
} from './frame-interaction-settings';
export type { FrameCanvasInteractionSettings } from './frame-interaction-settings';
import { frameSnapshotToImage, type FrameImageOptions } from './frame-export';
import {
  createFrameCameraStore,
  FrameScaleContent,
  FrameNodeAppearance,
  type FrameNodeAppearanceValue,
} from './frame-camera-store';
import {
  interpolateViewport,
  prefersReducedMotion,
  PRESENTATION_CAMERA_MS,
  viewportForBounds,
  type ViewportInsets,
} from './frame-viewport';
import {
  memo,
  createContext,
  useContext,
  useId,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  forwardRef,
  useImperativeHandle,
  type ReactNode,
  type CSSProperties,
} from 'react';
import {
  alignCells,
  distributeCells,
  arrangeCells,
  arrangementAvailability,
  collectArrangementBlocks,
  cellArrangementBounds,
  unionCellBounds,
  geometryBounds,
  focusedCellIds,
  groupBounds,
  groupLeafMembers,
  groupHasLockedLeaf,
  groupAncestors,
  selectionObjectAtFocus,
  groupCells,
  ungroupCells,
  setCellsLocked,
  type ArrangementCommand,
  type RectangleClient,
  stripFrameViewports,
  nodeContentName,
  normalizeCellPositionOperations,
  roundNodePosition,
  roundNodeGeometry,
  frameTitleBounds,
  frameVisualBounds,
  frameContentViewport,
  frameMinimumSize,
  applyCellOperations,
  deleteCells,
  reorderCells,
  moveWhiteboardCells,
  translateCellSelection,
  frameScene,
  createCellRuntime,
  createCellRegistry,
  isGroupCell,
  moveGroup,
  isFrameCell,
  isFrameReferenceCell,
  isDocumentCell,
  isDocumentFrameCell,
  isNodeCell,
  isMindNodeKind,
  isEdgeCell,
  fitFrameContent,
  frameContentBounds,
  nodeShapeSpec,
  nodeShapeGeometry,
  hitNodeShape,
  createDefaultShapeGeometryRegistry,
  polylinePath,
  edgeRoutePoints,
  createEdgeRoutingContext,
  curvePath,
  arrowMarkerGeometry,
  edgeLabelLayout,
  portAnchor,
  relativeAnchor,
  distanceToPolyline,
  resizeNodeGeometry,
  rotateNodeGeometry,
  edgePolyline,
  edgeTerminalPosition,
  flattenCurve,
  snapEdgeTerminal,
  replaceEdgeTerminal,
  bindEdgeRouteTerminals,
  moveEdgeRoutePoint,
  moveEdgeSegment,
  polylineClosestPosition,
  copyCellFragment,
  planCellPaste,
  selectionAllows,
  type Cell,
  type CellRuntime,
  type CellRegistry,
  type CellTransaction,
  type CellChange,
  type CellSelection,
  type CellOperation,
  type CellStore,
  type CellMoveContext,
  type FrameSnapshot,
  type NodeCell,
  type NodeGeometry,
  type EdgeCell,
  type EdgeRoutingContext,
  type ResizeHandle,
  type Point,
  type CellFragment,
} from '@sue/board-core';
import { FrameRichText, FrameRichTextPreviewContext } from './frame-rich-text';
import { FrameSelectionHandles } from './frame-selection-handles';
import { frameSelectionWorldBounds } from './frame-selection-camera';
import { FrameTextEditor } from './frame-text-editor';
import {
  FrameTitleEditor,
  frameTitleStyle,
  frameTitleCss,
} from './frame-title-editor';
import { FrameInteractiveEdge } from './frame-edge-stroke';
import { createFrameNativeEvents } from './frame-native-events';
import { createFrameLockResolver } from './frame-locks';
import { FrameCellShadow, FrameStaticShadow } from './frame-shadow';
import {
  createInlineText,
  Alignment,
  isBoardTextDocument,
  sameBoardText,
  type BoardTextDocument,
} from '@sue/board-common';

export interface FrameRenderContext {
  store: CellStore;
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
  kind?: string;
  layout?: (store: CellStore, frameId: string) => Map<string, NodeGeometry>;
  render?: (context: FrameRenderContext) => ReactNode;
  /** Override only the outline, retaining native text, selection and editing. */
  renderShape?: (context: FrameRenderContext) => ReactNode;
  textBounds?: (
    context: FrameRenderContext,
  ) => import('@sue/board-core').RectangleClient;
  presentation?: (context: FrameRenderContext) => FramePresentation | undefined;
  /** Hover controls. Wrappers are excluded from image export. */
  renderControls?: (context: FrameRenderContext) => ReactNode;
  visible?: (context: FrameRenderContext) => boolean;
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
export interface FrameInstanceHost {
  /** Lookup only. Must not allocate or activate. */
  get(query: FrameInstanceQuery): FrameInstanceBinding | null;
  /** Mount lifecycle. Must not run during render. */
  acquire(query: FrameInstanceQuery): void | (() => void);
  release(query: FrameInstanceQuery): void;
  commit(
    occurrenceId: string,
    transaction: CellTransaction,
  ): Promise<FrameIntentResult>;
  updateMindOffset?(
    occurrenceId: string,
    mindRootId: string,
    offset: Point,
  ): void;
}
export type FrameIntentResult =
  { status: 'accepted' } | { status: 'rejected'; message?: string };
export interface FrameHistoryAdapter {
  undo(): void;
  redo(): void;
  /**
   * Real availability for toolbar state. Absent = legacy behavior where an
   * external adapter keeps the buttons enabled unconditionally.
   */
  canUndo?(): boolean;
  canRedo?(): boolean;
  /** True while a workspace commit is still in flight. */
  busy?(): boolean;
}
export type FrameSelectionCommand =
  | ArrangementCommand
  | { type: 'group' | 'ungroup' | 'lock' | 'unlock' | 'fit-content' };
export interface FrameCanvasController {
  runtime: CellRuntime;
  selectionCommandState(command: FrameSelectionCommand): {
    enabled: boolean;
    reason?: string;
  };
  executeSelectionCommand(
    command: FrameSelectionCommand,
  ): Promise<FrameIntentResult>;
  exportImage(options?: FrameImageOptions): Promise<Blob>;
  dispatch(transaction: CellTransaction): Promise<FrameIntentResult>;
  moveSelection(targetFrameId: string): Promise<FrameIntentResult>;
  clipboard(action: 'copy' | 'cut' | 'paste'): Promise<FrameIntentResult>;
  undo(): void;
  redo(): void;
  focus(frameId: string): void;
  fit(): void;
  /** Center the mounted node selection, preserving the current zoom. */
  centerSelection(): void;
  /**
   * Locate `cellId` again on an already mounted canvas: select it and
   * center it without changing zoom.
   */
  revealCell(cellId: string): void;
  /** Screen point to canvas world coordinates, including the current camera. */
  clientToWorld(clientX: number, clientY: number): [number, number];
  setZoom(zoom: number): void;
  editText(cellId: string): void;
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
  finishEditing(): void;
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
export interface FrameDocumentReferences {
  editRequest?: { instanceId: string; nonce: number };
  title(targetDocumentId: string): string | undefined;
  /** Product controls rendered in the shell title bar, outside its document body. */
  renderHeaderActions?(props: FrameDocumentReferenceProps): ReactNode;
  render(props: FrameDocumentReferenceProps): ReactNode;
}
interface FrameCanvasCommon {
  documentReferences?: FrameDocumentReferences;
  exporting?: boolean;
  /** Device interaction preferences; camera-only, never written to the document. */
  interactionSettings?: FrameCanvasInteractionSettings;
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
    onMindOffset(rootId: string, offset: Point): void;
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
  runtime,
  wheelOwner,
  children,
}: {
  runtime: CellRuntime;
  wheelOwner: ReturnType<typeof createFrameWheelOwner>;
  children: ReactNode;
}) {
  return (
    <RuntimeContext.Provider value={runtime}>
      <FrameWheelContext.Provider value={wheelOwner}>
        {children}
      </FrameWheelContext.Provider>
    </RuntimeContext.Provider>
  );
}
export const useFrameRuntime = (): CellRuntime => {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error('FrameCanvas context is missing');
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
type FrameLayoutEntry = {
  geometry: Map<string, NodeGeometry>;
  baseGeometry: Map<string, NodeGeometry>;
  fitBounds: RectangleClient;
  mindOffsets: Map<string, Point>;
  store: CellStore;
  routing: EdgeRoutingContext;
  outlines: Map<
    string,
    {
      geometry: NodeGeometry;
      registry: ReturnType<typeof createDefaultShapeGeometryRegistry>;
      spec: ReturnType<typeof nodeShapeSpec>;
      pathGeometry: ReturnType<typeof nodeShapeGeometry>;
      textBounds: NodeGeometry;
      parts: ReturnType<
        NonNullable<NonNullable<ReturnType<typeof nodeShapeGeometry>>['parts']>
      >;
    }
  >;
  routes: Map<
    string,
    {
      cell: EdgeCell;
      sourceGeometry?: NodeGeometry;
      targetGeometry?: NodeGeometry;
      routing: EdgeRoutingContext;
      points: Point[];
      labelPoints: Point[];
      path: string;
      markers?: ReturnType<typeof arrowMarkerGeometry>[];
    }
  >;
  getGeometry(id: string): NodeGeometry | undefined;
  baseRouting: EdgeRoutingContext;
};
type FrameLayoutMemory = Pick<
  FrameLayoutEntry,
  | 'baseGeometry'
  | 'geometry'
  | 'baseRouting'
  | 'routing'
  | 'outlines'
  | 'routes'
> & {
  baseNodes: Map<string, { original: NodeCell; derived: NodeCell }>;
  nodes: Map<string, { original: NodeCell; derived: NodeCell }>;
};
const sameGeometry = (a: NodeGeometry, b: NodeGeometry) =>
  a.x === b.x &&
  a.y === b.y &&
  a.width === b.width &&
  a.height === b.height &&
  a.rotation === b.rotation &&
  a.derived === b.derived &&
  (a.outline === b.outline ||
    JSON.stringify(a.outline) === JSON.stringify(b.outline));
function canonicalGeometry(
  store: CellStore,
  next: Map<string, NodeGeometry>,
  previous?: ReadonlyMap<string, NodeGeometry>,
) {
  for (const [id, value] of next) {
    const original = store.cells[id];
    const old = previous?.get(id);
    if (isNodeCell(original) && sameGeometry(original.geometry, value))
      next.set(id, original.geometry);
    else if (old && sameGeometry(old, value)) next.set(id, old);
  }
}
function applyLayoutGeometry(
  store: CellStore,
  geometry: ReadonlyMap<string, NodeGeometry>,
  previous?: FrameLayoutMemory['nodes'],
) {
  let laidOut = store;
  const nodes: FrameLayoutMemory['nodes'] = new Map();
  for (const [id, value] of geometry) {
    const original = store.cells[id];
    if (!isNodeCell(original) || original.geometry === value) continue;
    const old = previous?.get(id);
    const derived =
      old?.original === original && old.derived.geometry === value
        ? old.derived
        : { ...original, geometry: value };
    nodes.set(id, { original, derived });
    if (laidOut === store) laidOut = { ...store, cells: { ...store.cells } };
    laidOut.cells[id] = derived;
  }
  return { laidOut, nodes };
}
/** Each scene owns its caches; a draft reuses existing root layout geometry. */
function createFrameLayouts(
  store: CellStore,
  extensions: readonly FrameRenderExtension[] = [],
  seed?: { frameId: string; geometry: ReadonlyMap<string, NodeGeometry> },
  mountedRootId = store.rootId,
  memory = new Map<string, FrameLayoutMemory>(),
) {
  for (const id of memory.keys())
    if (!isFrameCell(store.cells[id])) memory.delete(id);
  const cache = new Map<string, FrameLayoutEntry>();
  return (id: string) => {
    const existing = cache.get(id);
    if (existing) return existing;
    const previous = memory.get(id);
    let geometry = new Map<string, NodeGeometry>();
    if (seed?.frameId === id)
      seed.geometry.forEach((value, key) =>
        geometry.set(key, roundNodeGeometry(value)),
      );
    else
      extensions.forEach((extension) =>
        extension
          .layout?.(store, id)
          .forEach((value, key) => geometry.set(key, roundNodeGeometry(value))),
      );
    canonicalGeometry(store, geometry, previous?.baseGeometry);
    const base = applyLayoutGeometry(store, geometry, previous?.baseNodes);
    let laidOut = base.laidOut;
    const baseGeometry = geometry;
    const baseRouting = createEdgeRoutingContext(
      laidOut,
      id,
      undefined,
      previous?.baseRouting,
    );
    const contentBounds = frameContentBounds(laidOut, id, baseRouting);
    const fitBounds =
      frameScene(store, id) === 'mind-root'
        ? unionCellBounds([
            contentBounds,
            ...[...baseGeometry].flatMap(([id, bounds]) =>
              !store.cells[id]?.hidden ? [geometryBounds(bounds)] : [],
            ),
          ])!
        : contentBounds;
    const frame = store.cells[id];
    const projection =
      id !== mountedRootId && isFrameCell(frame)
        ? projectEmbeddedMindTrees(store, frame, baseGeometry, fitBounds)
        : { geometry, offsets: new Map<string, Point>() };
    geometry = projection.geometry;
    if (geometry !== baseGeometry)
      canonicalGeometry(store, geometry, previous?.geometry);
    const projected =
      geometry === baseGeometry
        ? base
        : applyLayoutGeometry(store, geometry, previous?.nodes);
    laidOut = projected.laidOut;
    const outlines = previous?.outlines ?? new Map();
    const routes = previous?.routes ?? new Map();
    for (const map of [outlines, routes])
      for (const key of map.keys())
        if (
          !isFrameCell(frame) ||
          !frame.children.includes(key) ||
          !store.cells[key]
        )
          map.delete(key);
    const entry: NonNullable<ReturnType<typeof cache.get>> = {
      geometry,
      baseGeometry,
      baseRouting,
      fitBounds,
      mindOffsets: projection.offsets,
      store: laidOut,
      routing:
        geometry === baseGeometry
          ? baseRouting
          : createEdgeRoutingContext(laidOut, id, undefined, previous?.routing),
      outlines,
      routes,
      getGeometry: (cellId: string) => {
        const node = store.cells[cellId];
        return isNodeCell(node)
          ? (geometry.get(cellId) ?? node.geometry)
          : undefined;
      },
    };
    memory.set(id, {
      baseGeometry,
      geometry,
      baseRouting,
      routing: entry.routing,
      outlines,
      routes,
      baseNodes: base.nodes,
      nodes: projected.nodes,
    });
    cache.set(id, entry);
    return entry;
  };
}
export const FrameCanvas = forwardRef(function FrameCanvas<T>(
  props: FrameCanvasProps<T>,
  ref: React.ForwardedRef<FrameCanvasController>,
) {
  const renderScope = useId();
  const snapshot = useMemo(() => {
    const projected = props.adapter
      ? props.adapter.toFrameSnapshot(props.value as T)
      : (props.value as FrameSnapshot);
    return { store: stripFrameViewports(projected.store) };
  }, [props.value, props.adapter]);
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
  const [editing, setEditingState] = useState<string | null>(null);
  const editingCellRef = useRef<string | null>(null);
  const textCommitRef = useRef<Promise<FrameIntentResult> | null>(null);
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
  const captureViewportRect = useCallback((rect?: DOMRect) => {
    const measured = rect ?? svgRef.current?.getBoundingClientRect();
    if (measured)
      viewportRectRef.current = {
        left: measured.left,
        top: measured.top,
        width: measured.width,
        height: measured.height,
      };
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
  const presenting = props.inputMode === 'present';
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
  const dispatchTransaction = async (
    transaction: CellTransaction,
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
      if (current.adapter) {
        // Host mode never mutates its source or publishes a speculative state.
        applyCellOperations(
          runtime.store,
          transaction.operations,
          runtime.registry,
        );
        pendingRef.current = true;
        setPending(true);
        const result = (await current.onIntent?.(transaction)) ?? {
          status: 'accepted' as const,
        };
        if (result.status === 'rejected') {
          current.onReject?.(result);
          setFailure(result.message ?? 'Edit rejected');
        }
        return result;
      }
      const change = runtime.transact(transaction);
      current.onSelectionChange?.(runtime.selection);
      current.onChange?.(change);
      setFailure(null);
      return { status: 'accepted' };
    } catch (error) {
      const result = {
        status: 'rejected' as const,
        message: error instanceof Error ? error.message : String(error),
      };
      current.onReject?.(result);
      setFailure(result.message);
      return result;
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };
  const dispatch = (transaction: CellTransaction) =>
    dispatchTransaction({
      ...transaction,
      operations: normalizeCellPositionOperations(
        runtime.store,
        transaction.operations,
      ),
    });
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
    setEditing(cellId);
  };
  const publishHistory = (direction: 'undo' | 'redo') => {
    if (!editable || pending) return;
    if (props.history) {
      props.history[direction]();
      return;
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
      message: error instanceof Error ? error.message : String(error),
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
    const operations = deleteCells(runtime.store, ids);
    applyCellOperations(runtime.store, operations, runtime.registry);
    return { ids, operations, fragment: copyCellFragment(runtime.store, ids) };
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
        store: runtime.store,
        frameId: parentId,
        selectionIds: runtime.selection.ids,
        fragment,
        allocateId: transactionId,
        offset: [20, 20],
        registry: runtime.registry,
        intent: 'paste',
        targetMindNodeId:
          runtime.selection.ids.length === 1 &&
          ['mind-root', 'mind-child'].includes(
            runtime.store.cells[runtime.selection.ids[0]]?.kind,
          )
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
      if (
        hit &&
        isNodeCell(hit) &&
        ['mind-root', 'mind-child', 'mind-summary'].includes(hit.kind)
      ) {
        return dispatch({
          id: transactionId(),
          operations: [
            {
              type: 'replace_cell',
              cell: {
                ...hit,
                geometry: {
                  ...hit.geometry,
                  width: Math.max(hit.geometry.width, width + 16),
                },
                data: {
                  ...(hit.data as object),
                  image: { url, width, height },
                },
              },
            },
          ],
        });
      }
      const id = transactionId();
      const operations = [
        {
          type: 'insert_cell' as const,
          parentId: focusFrameId(),
          cell: {
            id,
            kind: 'image',
            cellType: 'node' as const,
            geometry: {
              x: at[0] - width / 2,
              y: at[1] - height / 2,
              width,
              height,
            },
            data: { url },
          },
        },
      ];
      return dispatch({ id: transactionId(), operations }).then((result) =>
        selectInserted(operations, result),
      );
    }
    if (!source.text?.trim()) return { status: 'rejected' as const };
    const id = transactionId();
    const operations = [
      {
        type: 'insert_cell' as const,
        parentId: focusFrameId(),
        cell: {
          id,
          kind: 'geometry',
          cellType: 'node' as const,
          geometry: {
            x: at[0],
            y: at[1],
            width: 160,
            height: 48,
            outline: 'text',
          },
          content: {
            label: source.text,
            text: createInlineText(source.text),
          },
        },
      },
    ];
    return dispatch({ id: transactionId(), operations }).then((result) =>
      selectInserted(operations, result),
    );
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
  const clipboard = async (
    action: 'copy' | 'cut' | 'paste',
  ): Promise<FrameIntentResult> => {
    if (action !== 'copy' && (!editable || pendingRef.current))
      return {
        status: 'rejected',
        message: pendingRef.current
          ? 'A transaction is pending'
          : 'Canvas is readonly',
      };
    try {
      if (action === 'paste')
        return await pasteFragment(
          readClipboardText(await navigator.clipboard.readText()),
        );
      if (action === 'copy') {
        await navigator.clipboard.writeText(
          clipboardText(copyCellFragment(runtime.store, runtime.selection.ids)),
        );
        return { status: 'accepted' };
      }
      const source = runtime.store;
      const cut = cutSelection();
      if (!cut.ids.length)
        return { status: 'rejected', message: 'No unlocked cells selected' };
      pendingRef.current = true;
      setPending(true);
      try {
        await navigator.clipboard.writeText(clipboardText(cut.fragment));
      } finally {
        pendingRef.current = false;
        setPending(false);
      }
      if (runtime.store !== source)
        throw new Error('Canvas changed while writing to the clipboard');
      return await dispatch({
        id: transactionId(),
        operations: cut.operations,
      });
    } catch (error) {
      return clipboardFailure(error);
    }
  };
  const selectionDisplayStore = () => {
    return frameLayouts(focusFrameId()).store;
  };
  const selectionCommandState = (
    command: FrameSelectionCommand,
  ): { enabled: boolean; reason?: string } => {
    if (!editable || pendingRef.current) return { enabled: false };
    const store =
        command.type === 'align' ||
        command.type === 'distribute' ||
        command.type === 'layout'
          ? selectionDisplayStore()
          : runtime.store,
      selection = runtime.selection;
    if (
      command.type === 'align' ||
      command.type === 'distribute' ||
      command.type === 'layout'
    )
      return arrangementAvailability(
        store,
        focusFrameId(),
        selection.ids,
        command,
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
      groupCells(store, focusFrameId(), selection.ids, '__new_group__');
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
        operations = alignCells(store, selection.ids, command.axis);
      else if (command.type === 'distribute')
        operations = distributeCells(store, selection.ids, command.axis);
      else if (command.type === 'layout')
        operations = arrangeCells(
          store,
          focusFrameId(),
          selection.ids,
          command.style,
        );
      else if (command.type === 'group') {
        const groupId = transactionId();
        operations = groupCells(store, focusFrameId(), selection.ids, groupId);
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
      const request = { ids: nextIds, focus: selection.focus, accepted: false };
      keyboardSelectionRef.current = request;
      const result = await dispatch({ id: transactionId(), operations });
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
  useImperativeHandle(ref, () => ({
    runtime,
    selectionCommandState,
    executeSelectionCommand,
    exportImage: (options) =>
      frameSnapshotToImage(
        { store: runtime.store },
        {
          ...options,
          frameId,
          registry: runtime.registry,
          extensions: propsRef.current.extensions,
          documentReferences: propsRef.current.documentReferences,
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
    clipboard,
    moveSelection: async (targetFrameId) => {
      try {
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
        return await dispatch({
          id: transactionId(),
          operations: moveWhiteboardCells(
            runtime.store,
            runtime.selection.ids,
            targetFrameId,
            laidOut,
          ),
        });
      } catch (error) {
        return {
          status: 'rejected',
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
    undo: () => publishHistory('undo'),
    redo: () => publishHistory('redo'),
    focus: (id) => {
      const index = runtime.index;
      const path = [id];
      let parent = index.parentOf.get(id);
      while (parent && path[0] !== frameId) {
        path.unshift(parent);
        parent = index.parentOf.get(parent);
      }
      runtime.select({ focus: path, ids: [] });
    },
    fit: fitCanvas,
    centerSelection,
    revealCell(cellId: string) {
      const index = runtime.index;
      const path = [cellId];
      const seen = new Set<string>();
      let parent = index.parentOf.get(cellId) ?? index.groupOf.get(cellId);
      while (parent && path[0] !== frameId && !seen.has(parent)) {
        seen.add(parent);
        path.unshift(parent);
        parent = index.parentOf.get(parent) ?? index.groupOf.get(parent);
      }
      if (path[0] !== frameId) path.unshift(frameId);
      const focus = path.slice(0, -1);
      const mounted = focus.length ? focus : [frameId];
      try {
        runtime.select({ focus: mounted, ids: [cellId] });
      } catch {
        runtime.select({ focus: [frameId], ids: [] });
      }
      centerSelection();
    },
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
    editText,
    selectionScreenBounds: () => boundsRef.current(),
    fitBounds: (bounds, options) => fitWorldBounds(bounds, options),
    fitCells: (ids, options) => {
      const svg = svgRef.current;
      if (!svg) return false;
      const bounds = frameSelectionWorldBounds({
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
    finishEditing: () => {
      const active = svgRef.current?.querySelector(
        '[contenteditable="true"]',
      ) as HTMLElement | null;
      active?.blur();
      setEditing(null);
      setLabelEditing(null);
    },
  }));
  const view = (
    runtime.store.cells[frameId] as import('@sue/board-core').FrameCell
  )?.view;
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
    worldRef.current?.setAttribute(
      'transform',
      `scale(${scale}) translate(${-offset[0]} ${-offset[1]})`,
    );
    if (svgRef.current) {
      svgRef.current.style.backgroundPosition = `${-offset[0] * scale}px ${-offset[1] * scale}px`;
      if (view?.theme?.gridEnabled) {
        const size = Math.max(4, view.theme.gridSize ?? 20) * scale;
        svgRef.current.style.backgroundSize = `${size}px ${size}px`;
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
    [frameId, props.extensions],
  );
  const frameLayouts = useMemo(
    () =>
      createFrameLayouts(
        runtime.store,
        props.extensions,
        undefined,
        frameId,
        layoutMemory,
      ),
    [runtime.store, props.extensions, frameId, layoutMemory],
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
      const rect = captureViewportRect();
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
    if (svg) return wheelOwner.register(svg);
    return undefined;
  }, [wheelOwner, props.surface, props.suspended, props.exporting]);
  useEffect(() => {
    const refreshViewport = () => {
      captureViewportRect();
      publishViewStateRef.current();
    };
    window.addEventListener('scroll', refreshViewport, true);
    window.addEventListener('resize', refreshViewport);
    return () => {
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
    const rect = captureViewportRect()!;
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
    mode?: 'move' | 'resize' | 'rotate' | 'mind-pan';
    mindFrameId?: string;
    /** Reference occurrence the pan belongs to; offsets write to its shell. */
    mindRefId?: string;
    mindOffset?: Point;
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
  const setPreview = (geometry: NodeGeometry | null) => {
    const drag = dragRef.current;
    const next =
      drag && geometry
        ? { sessionId: drag.sessionId, id: drag.id, geometry }
        : null;
    previewRef.current = next;
    setPreviewState(next);
    if (!next) setMoveGhost(null);
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
  const updateMoveGhost = (
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
        ),
      };
    } catch {
      return null;
    }
  }, [moveGhost, runtime.store, runtime.registry, props.extensions, frameId]);
  const [alignmentGuides, setAlignmentGuides] = useState<AlignmentGuide[]>([]);
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
  const activeToolKey = props.tool?.key ?? props.tool?.mode ?? 'select';
  useEffect(() => {
    setDocumentEditing(null);
  }, [activeToolKey, props.readonly, props.suspended]);
  const documentEditRequest = props.documentReferences?.editRequest;
  useEffect(() => {
    if (documentEditRequest) setDocumentEditing(documentEditRequest.instanceId);
  }, [documentEditRequest?.nonce, documentEditRequest?.instanceId]);
  useEffect(() => {
    if (!documentEditing) return;
    const leave = (event: PointerEvent) => {
      const target = event.target as Element;
      if (
        target
          .closest?.('[data-document-frame-instance]')
          ?.getAttribute('data-document-frame-instance') !== documentEditing
      )
        setDocumentEditing(null);
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
    frame.children.forEach((id) => {
      const cell = runtime.store.cells[id];
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
      if (!isNodeCell(cell) || cell.locked || cell.hidden || isFrameCell(cell))
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
    if (!editing) return;
    const id = editing;
    const commit = textCommitRef.current;
    setEditing(null);
    void (async () => {
      const committed = await commit;
      if (committed && committed.status === 'rejected') return;
      const cell = runtime.store.cells[id];
      const util = cell ? runtime.registry.get(cell.kind) : undefined;
      if (!cell || !util || !('keyboard' in util) || pendingRef.current) return;
      const operations = (
        util as import('@sue/board-core').BaseCellUtil
      ).keyboard(runtime.store, cell, 'Tab', transactionId);
      if (!operations) return;
      const inserted = operations.find(
        (operation) => operation.type === 'insert_cell',
      );
      const request =
        inserted?.type === 'insert_cell'
          ? {
              ids: [inserted.cell.id],
              focus: [...runtime.selection.focus],
              accepted: false,
            }
          : null;
      keyboardSelectionRef.current = request;
      const edit =
        inserted?.type === 'insert_cell' && isNodeCell(inserted.cell)
          ? {
              id: inserted.cell.id,
              label: inserted.cell.content?.label ?? '',
              accepted: false,
            }
          : null;
      keyboardEditRef.current = edit;
      const result = await dispatch({
        id: transactionId(),
        operations,
      });
      if (keyboardSelectionRef.current !== request) return;
      if (result.status === 'rejected') {
        keyboardSelectionRef.current = null;
        keyboardEditRef.current = null;
        return;
      }
      if (request) {
        request.accepted = true;
        if (edit) edit.accepted = true;
        applyKeyboardSelection();
      }
    })();
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
    [nativeContentCache],
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
        store: CellStore;
        layouts: ReturnType<typeof createFrameLayouts>;
        preview: boolean;
        children?: readonly string[];
        overrides?: ReadonlyMap<string, NodeGeometry>;
      },
      shellGeometry?: NodeGeometry,
      /**
       * Set when this frame renders inside a frame-reference occurrence:
       * `refId` receives per-occurrence mind-pan writes, `offsets` carries
       * that occurrence's saved mind-tree pan offsets, and `seen` guards
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
      const renderEditable = !drawingPreview && editable;
      const nodePreview = drawingPreview ? null : preview;
      const store = scene?.store ?? runtime.store,
        frame = store.cells[id];
      if (!isFrameCell(frame)) return null;
      const base = (scene?.layouts ?? frameLayouts)(id);
      const displayedFrame = shellGeometry
        ? { ...frame, geometry: shellGeometry }
        : dragRef.current?.id === id && nodePreview
          ? { ...frame, geometry: nodePreview }
          : frame;
      const mindPan = dragRef.current?.mode === 'mind-pan';
      const projection =
        embedded && (shellGeometry || (mindPan && nodePreview))
          ? projectEmbeddedMindTrees(
              store,
              displayedFrame,
              base.baseGeometry,
              base.fitBounds,
              mindPan && nodePreview && dragRef.current?.mindFrameId === id
                ? new Map([
                    [
                      dragRef.current.id,
                      [
                        (dragRef.current.mindOffset?.[0] ?? 0) +
                          nodePreview.x -
                          dragRef.current.original.x,
                        (dragRef.current.mindOffset?.[1] ?? 0) +
                          nodePreview.y -
                          dragRef.current.original.y,
                      ] as Point,
                    ],
                  ])
                : (occurrence?.offsets ?? undefined),
            )
          : { geometry: base.geometry, offsets: base.mindOffsets };
      const mindOffsets = projection.offsets;
      const geometry =
        scene?.overrides || (dragRef.current && nodePreview && !mindPan)
          ? new Map(projection.geometry)
          : projection.geometry;
      scene?.overrides?.forEach((bounds, id) => geometry.set(id, bounds));
      if (dragRef.current && nodePreview && !mindPan) {
        const dragged = store.cells[dragRef.current.id];
        if (isGroupCell(dragged)) {
          for (const operation of translateCellSelection(
            base.store,
            [dragged.id],
            [
              nodePreview.x - dragRef.current.original.x,
              nodePreview.y - dragRef.current.original.y,
            ],
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
        )) {
          if (operation.type !== 'replace_cell') continue;
          laidOut.cells[operation.cell.id] = operation.cell;
          if (isNodeCell(operation.cell))
            geometry.set(operation.cell.id, operation.cell.geometry);
        }
      }
      const routing = geometryChanged
        ? createEdgeRoutingContext(laidOut, id, undefined, base.routing)
        : base.routing;
      if (!drawingPreview)
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
            frameScene(store, id) === 'mind-root'
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
      const contextForCell = (
        cell: Cell,
        bounds?: NodeGeometry,
      ): FrameRenderContext => ({
        store,
        cell: store.cells[cell.id] ?? cell,
        geometry: bounds,
        selected:
          !drawingPreview &&
          !presenting &&
          runtime.selection.ids.includes(cell.id),
        pending,
        readonly:
          !renderEditable || !!cell.locked || lockedByAncestor(store, cell.id),
        preview: drawingPreview,
        frameId: id,
        scale: cameraStore.getZoom() * parentScale * placement.scale,
        hovered:
          !drawingPreview && !presenting && cameraStore.isHovered(cell.id),
        getGeometry: geometryChanged
          ? (cellId: string) => {
              const node = store.cells[cellId];
              return isNodeCell(node)
                ? (geometry.get(cellId) ?? node.geometry)
                : undefined;
            }
          : base.getGeometry,
        select: () => {
          if (!drawingPreview) sceneActions.select(cell.id, focus);
        },
        edit: (id: string) => {
          if (!drawingPreview) sceneActions.editText(id);
        },
        history: (action: 'undo' | 'redo') => {
          if (!drawingPreview) sceneActions.publishHistory(action);
        },
        dispatch: drawingPreview ? rejectPreviewIntent : sceneActions.dispatch,
      });
      const contextAtZoom = (
        context: FrameRenderContext,
        scale: number,
      ): FrameRenderContext => ({
        ...context,
        scale: scale * parentScale * placement.scale,
        hovered: !drawingPreview && cameraStore.isHovered(context.cell.id),
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
        if (layer === 'controls') {
          if (drawingPreview) return null;
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
          event.stopPropagation();
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
                frameScene(store, id) !== 'mind-root'
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
        if (isDocumentCell(cell)) {
          const shell = bounds ?? cell.geometry;
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
            setDocumentEditing(null);
            sceneActions.select(cellId, focus, false);
            svgRef.current?.focus({ preventScroll: true });
          };
          const title =
            cell.name ??
            propsRef.current.documentReferences?.title(
              cell.data.targetDocumentId,
            ) ??
            '文档引用';
          const referenceProps: FrameDocumentReferenceProps = {
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
          return (
            <g
              key={cellId}
              data-cell-id={cellId}
              data-cell-kind={cell.kind}
              data-document-frame-instance={instanceId}
              opacity={cell.appearance?.opacity}
            >
              <FrameCellShadow shadow={cell.appearance?.shadow} bounds={shell}>
                {(filter) => (
                  <rect
                    {...shell}
                    filter={filter}
                    rx={8}
                    fill={cell.appearance?.fill ?? '#fff'}
                    stroke={
                      selected
                        ? '#6366f1'
                        : (cell.appearance?.strokeColor ?? '#cbd5e1')
                    }
                    strokeWidth={cell.appearance?.strokeWidth ?? 1}
                    strokeDasharray={
                      cell.appearance?.strokeStyle === 'dashed'
                        ? '8 4'
                        : cell.appearance?.strokeStyle === 'dotted'
                          ? '2 4'
                          : undefined
                    }
                    onPointerDown={beginFrameMove}
                  />
                )}
              </FrameCellShadow>
              <rect
                x={shell.x}
                y={shell.y}
                width={shell.width}
                height={32}
                rx={8}
                fill="#f1f5f9"
                onPointerDown={beginFrameMove}
              />
              <foreignObject
                x={shell.x + 12}
                y={shell.y}
                width={Math.max(0, shell.width - (headerActions ? 84 : 24))}
                height={32}
                onPointerDown={beginFrameMove}
              >
                <div
                  title={title}
                  style={{
                    cursor: 'move',
                    font: '14px/32px system-ui, sans-serif',
                    color: '#334155',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {title}
                </div>
              </foreignObject>
              {headerActions && (
                <foreignObject
                  x={shell.x + Math.max(0, shell.width - 68)}
                  y={shell.y + 2}
                  width={Math.min(64, shell.width)}
                  height={28}
                  data-frame-export-exclude
                  data-document-header-actions
                >
                  <div
                    style={{
                      height: '100%',
                      display: 'flex',
                      justifyContent: 'flex-end',
                      alignItems: 'center',
                      gap: 4,
                      pointerEvents: 'auto',
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                    onPointerUp={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                    onDoubleClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                    onKeyUp={(event) => event.stopPropagation()}
                  >
                    {headerActions}
                  </div>
                </foreignObject>
              )}
              <foreignObject
                x={shell.x + 4}
                y={shell.y + 34}
                width={Math.max(0, shell.width - 8)}
                height={Math.max(0, shell.height - 38)}
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
                      (event.target as Element).closest('button')
                    )
                      return;
                    event.preventDefault();
                    event.stopPropagation();
                    sceneActions.select(cellId, focus, false);
                    setDocumentEditing(instanceId);
                  }}
                  onClickCapture={(event) => {
                    if (
                      documentIsEditing ||
                      documentReadonly ||
                      (event.target as Element).closest('button') ||
                      event.metaKey ||
                      event.ctrlKey
                    )
                      return;
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                >
                  {propsRef.current.documentReferences?.render(
                    referenceProps,
                  ) ?? (
                    <div style={{ padding: 12 }}>
                      文档未解析 · {cell.data.targetDocumentId}
                    </div>
                  )}
                </div>
              </foreignObject>
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
              <rect
                x={shellBounds.x}
                y={shellBounds.y}
                width={shellBounds.width}
                height={shellBounds.height}
                rx={12}
                data-frame-shell
                data-frame-active={active ? 'true' : 'false'}
                fill={active ? '#f1f5f9' : 'transparent'}
                stroke={active ? '#cbd5e1' : 'none'}
                vectorEffect="non-scaling-stroke"
                onPointerDown={beginFrameMove}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  if (!sceneActions.enterSelectedGroup(cellId))
                    propsRef.current.onOpenFrame?.(cellId);
                }}
              />
              <g>
                <FrameCellShadow
                  shadow={cell.appearance?.shadow}
                  bounds={contentBounds}
                >
                  {(filter) => (
                    <rect
                      {...contentBounds}
                      data-frame-content-plate
                      filter={filter}
                      opacity={cell.appearance?.opacity}
                      strokeWidth={cell.appearance?.strokeWidth ?? 1}
                      strokeDasharray={
                        cell.appearance?.strokeStyle === 'dashed'
                          ? '8 4'
                          : cell.appearance?.strokeStyle === 'dotted'
                            ? '2 4'
                            : undefined
                      }
                      fill={cell.appearance?.fill ?? '#fff'}
                      stroke={
                        active
                          ? '#6366f1'
                          : (cell.appearance?.strokeColor ?? '#cbd5e1')
                      }
                      onPointerDown={beginFrameMove}
                      onDoubleClick={(event) => {
                        event.stopPropagation();
                        if (!sceneActions.enterSelectedGroup(cellId))
                          propsRef.current.onOpenFrame?.(cellId);
                      }}
                    />
                  )}
                </FrameCellShadow>
              </g>
              <g
                data-frame-title-id={drawingPreview ? undefined : cellId}
                style={{ cursor: 'move' }}
                onPointerDown={beginFrameMove}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  if (
                    !drawingPreview &&
                    !sceneActions.enterSelectedGroup(cellId)
                  )
                    sceneActions.editText(cellId);
                }}
              >
                <rect
                  {...frameTitleBounds(bounds ?? cell.geometry)}
                  fill="transparent"
                  stroke="none"
                  pointerEvents="all"
                />
                <foreignObject
                  {...frameTitleBounds(bounds ?? cell.geometry)}
                  stroke="none"
                  data-frame-title-text
                  style={{
                    visibility:
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
                        ? 'hidden'
                        : undefined,
                    overflow: 'hidden',
                    pointerEvents: 'none',
                  }}
                >
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
                </foreignObject>
              </g>
              <g
                clipPath={`url(#frame-content-${renderScope}-${occurrence?.scope ?? propsRef.current.instanceId ?? frameId}-${cellId})`}
              >
                <clipPath
                  id={`frame-content-${renderScope}-${occurrence?.scope ?? propsRef.current.instanceId ?? frameId}-${cellId}`}
                >
                  <rect {...contentBounds} />
                </clipPath>
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
              </g>
              {selected && renderEditable && !cell.locked && bounds && (
                <FrameScaleContent
                  camera={cameraStore}
                  cellId={drawingPreview ? undefined : cellId}
                  render={(zoom) => (
                    <FrameSelectionHandles
                      id={cellId}
                      geometry={bounds}
                      scale={zoom * parentScale * placement.scale}
                      resize={allowed.resize && cell.kind !== 'vector-line'}
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
          const seen = new Set(occurrence?.seen ?? [id]);
          const resolved = isFrameCell(target) && !seen.has(targetId);
          const title =
            cell.name ?? (isFrameCell(target) ? target.name : undefined);
          const label =
            title ??
            (isFrameCell(target) || propsRef.current.instanceHost
              ? 'Frame'
              : '引用缺失');
          return (
            <g
              key={cellId}
              data-cell-id={drawingPreview ? undefined : cellId}
              data-draft-cell-id={drawingPreview ? cellId : undefined}
              data-cell-kind={drawingPreview ? undefined : 'frame-reference'}
              data-draft-cell-kind={drawingPreview ? 'frame' : undefined}
            >
              <rect
                x={shellBounds.x}
                y={shellBounds.y}
                width={shellBounds.width}
                height={shellBounds.height}
                rx={12}
                data-frame-shell
                data-frame-active={active ? 'true' : 'false'}
                fill={active ? '#f1f5f9' : 'transparent'}
                stroke={active ? '#cbd5e1' : 'none'}
                vectorEffect="non-scaling-stroke"
                onPointerDown={beginFrameMove}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  if (!sceneActions.enterSelectedGroup(cellId))
                    propsRef.current.onOpenFrame?.(targetId, {
                      sourceFileId: id,
                      refId: cellId,
                      occurrenceId: `${occurrence?.scope ?? propsRef.current.instanceId ?? id}/${cellId}`,
                    });
                }}
              />
              <g>
                <FrameCellShadow
                  shadow={cell.appearance?.shadow}
                  bounds={contentBounds}
                >
                  {(filter) => (
                    <rect
                      {...contentBounds}
                      data-frame-content-plate
                      filter={filter}
                      opacity={cell.appearance?.opacity}
                      strokeWidth={cell.appearance?.strokeWidth ?? 1}
                      strokeDasharray={
                        !resolved || cell.appearance?.strokeStyle === 'dashed'
                          ? '8 4'
                          : cell.appearance?.strokeStyle === 'dotted'
                            ? '2 4'
                            : undefined
                      }
                      fill={cell.appearance?.fill ?? '#fff'}
                      stroke={
                        active
                          ? '#6366f1'
                          : (cell.appearance?.strokeColor ?? '#cbd5e1')
                      }
                      onPointerDown={beginFrameMove}
                      onDoubleClick={(event) => {
                        event.stopPropagation();
                        if (!sceneActions.enterSelectedGroup(cellId))
                          propsRef.current.onOpenFrame?.(targetId, {
                            sourceFileId: id,
                            refId: cellId,
                            occurrenceId: `${occurrence?.scope ?? propsRef.current.instanceId ?? id}/${cellId}`,
                          });
                      }}
                    />
                  )}
                </FrameCellShadow>
              </g>
              <g
                data-frame-title-id={drawingPreview ? undefined : cellId}
                style={{ cursor: 'move' }}
                onPointerDown={beginFrameMove}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  if (
                    !drawingPreview &&
                    !sceneActions.enterSelectedGroup(cellId)
                  )
                    sceneActions.editText(cellId);
                }}
              >
                <rect
                  {...frameTitleBounds(bounds ?? cell.geometry)}
                  fill="transparent"
                  stroke="none"
                  pointerEvents="all"
                />
                <foreignObject
                  {...frameTitleBounds(bounds ?? cell.geometry)}
                  stroke="none"
                  data-frame-title-text
                  style={{
                    visibility:
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
                        ? 'hidden'
                        : undefined,
                    overflow: 'hidden',
                    pointerEvents: 'none',
                  }}
                >
                  <FrameRichText
                    text={
                      isBoardTextDocument(cell.content?.text) &&
                      cell.content.text.plainText
                        ? cell.content.text
                        : plainTextDocument(cell, label)
                    }
                    style={frameTitleStyle(active)}
                  />
                </foreignObject>
              </g>
              <g
                clipPath={`url(#frame-content-${renderScope}-${occurrence?.scope ?? propsRef.current.instanceId ?? frameId}-${cellId})`}
              >
                <clipPath
                  id={`frame-content-${renderScope}-${occurrence?.scope ?? propsRef.current.instanceId ?? frameId}-${cellId}`}
                >
                  <rect {...contentBounds} />
                </clipPath>
                {propsRef.current.instanceHost &&
                !drawingPreview &&
                !seen.has(targetId) &&
                contentBounds.width > 0 &&
                contentBounds.height > 0 ? (
                  <FrameReferenceSurface
                    documentReferences={propsRef.current.documentReferences}
                    exporting={propsRef.current.exporting}
                    host={propsRef.current.instanceHost}
                    ownerFileId={id}
                    refId={cellId}
                    targetFrameId={targetId}
                    parentOccurrenceId={propsRef.current.instanceId}
                    appearance={[
                      ...(propsRef.current.referenceAppearance ?? [id]),
                      cellId,
                    ]}
                    seen={[...(propsRef.current.referenceSeen ?? []), targetId]}
                    bounds={contentBounds}
                    shellGeometry={shellBounds}
                    offsets={cell.data.mindOffsets}
                    suspended={propsRef.current.suspended}
                    readonly={propsRef.current.readonly}
                    inputMode={propsRef.current.inputMode}
                    registry={runtime.registry}
                    extensions={propsRef.current.extensions}
                    onOpen={() =>
                      propsRef.current.onOpenFrame?.(targetId, {
                        sourceFileId: id,
                        refId: cellId,
                        occurrenceId: `${id}/${cellId}`,
                      })
                    }
                    onOpenFrame={propsRef.current.onOpenFrame}
                    onActivate={(occurrenceId) =>
                      propsRef.current.onActiveInstance?.(occurrenceId)
                    }
                    onBackgroundTap={() => {
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
                      propsRef.current.onActiveInstance?.(null);
                      sceneActions.selectContextCell(cellId, focus);
                      svgRef.current?.focus();
                    }}
                  />
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
                        Object.entries(cell.data.mindOffsets ?? {}),
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
                        {isFrameCell(target) && seen.has(targetId)
                          ? '已在当前预览路径中展示，可打开原图'
                          : '引用缺失'}
                      </text>
                    </g>
                  )}
              </g>
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
          let route = base.routes.get(cellId);
          if (
            !route ||
            route.cell !== cell ||
            route.routing !== routing ||
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
            const points = edgeRoutePoints(cell, source, target, routing);
            const reusable =
              route?.cell === cell && route.points === points
                ? route
                : undefined;
            route = {
              cell,
              sourceGeometry,
              targetGeometry,
              routing,
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
            cell.kind === 'mind-branch' || cell.kind === 'mind-summary-edge';
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
          const stroke = selected
            ? '#6366f1'
            : (cell.appearance?.strokeColor ?? '#64748b');
          return (
            <g
              key={cellId}
              data-cell-id={drawingPreview ? undefined : cellId}
              data-draft-cell-id={drawingPreview ? cellId : undefined}
              data-cell-kind={drawingPreview ? undefined : cell.kind}
              data-draft-cell-kind={drawingPreview ? cell.kind : undefined}
              opacity={cell.appearance?.opacity}
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
                          ...cell,
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
                  <g filter={filter}>
                    {(() => {
                      const fallback = (
                        <>
                          <FrameInteractiveEdge
                            id={cellId}
                            camera={cameraStore}
                            points={points}
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
                          />
                          {cell.labels?.map((label, at) => {
                            const { point, bounds: labelBounds } =
                              edgeLabelLayout(cell, at, labelPoints, routing);
                            if (
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
                                    style={{ color: stroke }}
                                    readonly={!renderEditable}
                                    onClose={() => setLabelEditing(null)}
                                    onExitKey={() => svgRef.current?.focus()}
                                    onHistory={sceneActions.publishHistory}
                                    onChange={({ newText }) =>
                                      sceneActions.dispatch({
                                        id: transactionId(),
                                        operations: [
                                          {
                                            type: 'replace_cell',
                                            cell: {
                                              ...cell,
                                              labels: cell.labels!.map(
                                                (previous, index) =>
                                                  index === at
                                                    ? {
                                                        ...previous,
                                                        text: newText.plainText,
                                                        richText: newText,
                                                      }
                                                    : previous,
                                              ),
                                            },
                                          },
                                        ],
                                      })
                                    }
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
                                    style={{ color: stroke }}
                                  />
                                </foreignObject>
                              </g>
                            );
                          })}
                        </>
                      );
                      return extension?.render ? (
                        <FrameScaleContent
                          camera={cameraStore}
                          cellId={drawingPreview ? undefined : cellId}
                          render={(scale) =>
                            extension.render!(contextAtZoom(context, scale)) ??
                            fallback
                          }
                        />
                      ) : (
                        fallback
                      );
                    })()}
                  </g>
                )}
              </FrameCellShadow>
              {selected &&
                renderEditable &&
                !cell.locked &&
                labelEditing?.id !== cellId &&
                ['arrow', 'workflow-edge', 'architecture-edge'].includes(
                  cell.kind,
                ) && (
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
              (cell.kind === 'mind-root' ? 20 : 16),
            color: color ?? '#0f172a',
          };
          const createFallback = () =>
            cell.kind === 'image' ? (
              <image
                href={(cell.data as { url: string })?.url}
                x={bounds.x}
                y={bounds.y}
                width={bounds.width}
                height={bounds.height}
              />
            ) : (
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
                  return shapeExtension?.renderShape ? (
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
                  );
                })()}
                {(drawingPreview || editing !== cellId) && (
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
                        isMindNodeKind(cell.kind) ? Alignment.left : undefined
                      }
                    />
                  </foreignObject>
                )}
              </>
            );
          const fallback =
            drawingPreview || shapeExtension
              ? createFallback()
              : nativeContent(
                  cellId,
                  [
                    cell,
                    bounds,
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
            />
          );
          const shadowedContent =
            drawingPreview || extension?.render
              ? createShadow()
              : nativeContent(
                  cellId,
                  [content, bounds, cell.appearance?.shadow],
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
              fill={fill ?? cell.appearance?.fill ?? '#fff'}
              data-node-shape={bounds.outline}
              stroke={
                selected
                  ? '#6366f1'
                  : (cell.appearance?.strokeColor ?? stroke ?? '#64748b')
              }
              strokeWidth={cell.appearance?.strokeWidth ?? 1.5}
              strokeDasharray={
                cell.appearance?.strokeStyle === 'dashed'
                  ? '8 4'
                  : cell.appearance?.strokeStyle === 'dotted'
                    ? '2 4'
                    : undefined
              }
              opacity={cell.appearance?.opacity}
              onPointerEnter={() => {
                if (!drawingPreview) cameraStore.setHovered(cellId);
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
                  cell.kind === 'mind-child' ||
                  (util && 'capabilities' in util
                    ? (
                        util as import('@sue/board-core').BaseCellUtil
                      ).capabilities(
                        store,
                        cell,
                        embedded ? 'embedded' : 'root',
                      ).move
                    : ![
                        'mind-child',
                        'mind-summary',
                        'architecture-layer',
                      ].includes(cell.kind));
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
                    cell.kind === 'mind-child' ||
                    (embedded && cell.kind === 'mind-root')) &&
                  parentScale * placement.scale > 0
                ) {
                  setDragging(true);
                  setPreview(null);
                  dragRef.current = {
                    sessionId: ++dragSequence.current,
                    pointerId: event.pointerId,
                    mode:
                      embedded && cell.kind === 'mind-root'
                        ? 'mind-pan'
                        : undefined,
                    mindFrameId:
                      embedded && cell.kind === 'mind-root' ? id : undefined,
                    mindRefId:
                      embedded && cell.kind === 'mind-root'
                        ? occurrence?.refId
                        : undefined,
                    mindOffset: mindOffsets.get(cellId),
                    collapseId:
                      !event.shiftKey && runtime.selection.ids.length > 1
                        ? cellId
                        : undefined,
                    ids:
                      selectionCanMove &&
                      runtime.selection.ids.length > 1 &&
                      frameScene(store, id) !== 'mind-root'
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
                        resize={allowed.resize && cell.kind !== 'vector-line'}
                        rotate={allowed.rotate}
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
                                      kind: cell.kind.startsWith('workflow-')
                                        ? 'workflow-edge'
                                        : cell.kind.startsWith('architecture-')
                                          ? 'architecture-edge'
                                          : 'arrow',
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
              {!drawingPreview && editing === cellId && (
                <foreignObject
                  x={textBounds.x + 8}
                  y={textBounds.y + 4}
                  width={Math.max(1, textBounds.width - 16)}
                  height={Math.max(1, textBounds.height - 8)}
                  stroke="none"
                  style={{ overflow: 'visible' }}
                >
                  <FrameTextEditor
                    text={text}
                    defaultAlign={
                      isMindNodeKind(cell.kind) ? Alignment.left : undefined
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
          !shapeExtension &&
          !extension?.render
        ) {
          const render = () =>
            renderAppearance(computeAppearance(cameraStore.getZoom()));
          nativeEvents.setRender(cellId, render);
          return nativeContent(
            cellId,
            [
              cell,
              bounds,
              renderEditable,
              pending,
              snapTerminals,
              connectionPreview,
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
        const node = renderCellBody(cellId, layer);
        const cell =
          !drawingPreview && edgePreview?.id === cellId
            ? edgePreview
            : laidOut.cells[cellId];
        if (!node || !cell) return node;
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
        <g
          data-frame-content-id={drawingPreview ? undefined : id}
          data-draft-frame-content-id={drawingPreview ? id : undefined}
          transform={`translate(${placement.offset[0]} ${placement.offset[1]}) scale(${placement.scale})`}
        >
          {!drawingPreview &&
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
          {(scene?.children ?? frame.children).map((cellId) => {
            const body = renderCell(cellId);
            if (
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
          })}
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
          {!drawingPreview &&
            frame.children.map((cellId) => renderCell(cellId, 'controls'))}
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
                    data-mind-drop-preview
                    data-drawing-preview="mind-drop"
                    data-frame-export-exclude
                    aria-hidden="true"
                    pointerEvents="none"
                  >
                    <rect
                      data-mind-drop-target={parentId}
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
                    <g data-mind-ghost={moveGhost.id} opacity={0.35}>
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
        </g>
      );
    },
    // Selection and erased candidates change behind refs; their revisions repaint the scene.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      runtime,
      revision,
      frameId,
      frameLayouts,
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
  }, [renderFrame, frameId, props.documentReferences, props.exporting]);
  useLayoutEffect(() => {
    captureViewportRect();
    refreshSelectionWorldBoundsRef.current = refreshSelectionWorldBounds;
  });
  useLayoutEffect(() => {
    // World selection geometry changes with the committed scene, never its camera.
    refreshSelectionWorldBounds();
    publishViewStateRef.current();
  }, [sceneContent, refreshSelectionWorldBounds]);
  return (
    <FrameCanvasProviders runtime={runtime} wheelOwner={wheelOwner}>
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
          data-instance-id={propsRef.current.instanceId ?? frameId}
          data-surface={props.surface ?? 'root'}
          tabIndex={props.suspended || props.surface === 'nested' ? -1 : 0}
          onClickCapture={(event) => {
            if (
              (event.target as Element).closest?.(
                '[data-document-preview-body]',
              )
            )
              return;
            if (propsRef.current.inputMode === 'present') {
              event.preventDefault();
              event.stopPropagation();
            }
          }}
          onPointerDownCapture={(event) => {
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
              !(event.target as Element).closest('[data-reference-instance]')
            ) {
              event.preventDefault();
              event.stopPropagation();
              propsRef.current.onPlace?.(pointFromEventRef.current(event));
              return;
            }
            if (
              propsRef.current.inputMode !== 'present' &&
              !(event.target as Element).closest?.('[data-reference-instance]')
            )
              propsRef.current.onActiveInstance?.(null);
            const zoom = cameraRef.current.zoom ?? 1;
            // Portal controls bubble through the React canvas tree, but their
            // pointer events belong to the editor, not canvas focus/gestures.
            if ((event.target as Element).closest('[data-frame-text-toolbar]'))
              return;
            if (event.button === 0 && pointersRef.current.size === 0) {
              keyboardSelectionRef.current = null;
              keyboardEditRef.current = null;
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
                origin: [...(cameraRef.current.origination ?? zeroOrigin)],
                center: [
                  (points[0][0] + points[1][0]) / 2 - rect.left,
                  (points[0][1] + points[1][1]) / 2 - rect.top,
                ],
              };
              setDragging(true);
              return;
            }
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
                    if (id && runtime.index.parentOf.get(id) === frameId) {
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
                  origin: [...(cameraRef.current.origination ?? zeroOrigin)],
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
                origin: [...(cameraRef.current.origination ?? zeroOrigin)],
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
                if (focus[0] === frameId) selectContextCell(chosen, focus);
              }
              event.stopPropagation();
              event.preventDefault();
              return;
            }
            if (tool?.mode === 'polyline') {
              if (!editable || pendingRef.current || event.button !== 0) return;
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
                  .filter((id) => runtime.store.cells[id]?.cellType === 'frame')
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
            width: '100%',
            height: '100%',
            outline: 'none',
            overflow: 'hidden',
            touchAction: 'none',
            backgroundColor: view?.theme?.boardBackground ?? '#f8fafc',
            backgroundImage: view?.theme?.gridEnabled
              ? 'radial-gradient(circle, #94a3b8 1px, transparent 1px)'
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
            if (dragRef.current || gestureRef.current || connectingRef.current)
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
            if (props.tool?.mode === 'polyline' && vectorDraftRef.current) {
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
              const rect = captureViewportRect()!;
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
                  origin: [...(cameraRef.current.origination ?? zeroOrigin)],
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
                Math.hypot(point[0] - first[0], point[1] - first[1]) * zoom <= 8
              )
                point = [...first];
              else if (event.shiftKey) {
                const angle =
                    Math.round(
                      Math.atan2(point[1] - last[1], point[0] - last[0]) /
                        (Math.PI / 4),
                    ) *
                    (Math.PI / 4),
                  distance = Math.hypot(point[0] - last[0], point[1] - last[1]);
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
              const point = pointFromEvent(event);
              if (gesture.mode === 'hand') {
                const rect = captureViewportRect()!;
                const originalClient: Point = [
                  (gesture.points[0][0] - gesture.origin[0]) * gesture.zoom,
                  (gesture.points[0][1] - gesture.origin[1]) * gesture.zoom,
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
                if (['select', 'box', 'line', 'erase'].includes(gesture.mode))
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
                (!drag.mode || drag.mode === 'mind-pan') &&
                !preview &&
                Math.hypot(point[0] - drag.start[0], point[1] - drag.start[1]) *
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
                frameScene(runtime.store, ownerFrame) !== 'mind-root' &&
                propsRef.current.interactionSettings?.smartGuides !== false &&
                !event.altKey
              ) {
                if (!drag.snapBounds) {
                  const cells = { ...runtime.store.cells };
                  drag.geometry.forEach((geometry, id) => {
                    const cell = cells[id];
                    if (isNodeCell(cell)) cells[id] = { ...cell, geometry };
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
                  : drag.mode === 'mind-pan'
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
                              (isFrameCell(c) || isFrameReferenceCell(c)) &&
                              c.aspectRatio !== undefined &&
                              c.aspectRatio !== 'custom'
                            );
                          })(),
                        fromCenter: event.altKey,
                        minSize:
                          isFrameCell(runtime.store.cells[drag.id]) ||
                          isFrameReferenceCell(runtime.store.cells[drag.id])
                            ? frameMinimumSize
                            : 8,
                      },
                    )
                  : drag.mode === 'rotate'
                    ? rotateNodeGeometry(
                        drag.original,
                        drag.localStart!,
                        [drag.localStart![0] + dx, drag.localStart![1] + dy],
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
                ? new DOMPoint(event.clientX, event.clientY).matrixTransform(
                    drag.pointerMatrix,
                  )
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
                if (gestureRef.current?.mode === 'hand' || pinchRef.current)
                  commitGesture();
                gestureRef.current = null;
                pinchRef.current = null;
                setDragging(false);
              }
              // Settle the pan before a tap starts a camera animation; a later
              // gesture commit would otherwise cancel that animation.
              if (
                tap?.pointerId === event.pointerId &&
                Math.hypot(event.clientX - tap.x, event.clientY - tap.y) <= 4
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
                  operations: deleteCells(runtime.store, [...gesture.erased]),
                });
              else if (gesture.mode === 'select') {
                const first = gesture.points[0],
                  last = gesture.points.at(-1)!;
                const focus = gesture.focus ?? [frameId];
                const displayed = selectionDisplayStore();
                const ids = focusedCellIds(displayed, focus.at(-1)!).filter(
                  (id) => {
                    const bounds = cellArrangementBounds(displayed, id);
                    return (
                      bounds &&
                      bounds.x >= Math.min(first[0], last[0]) &&
                      bounds.y >= Math.min(first[1], last[1]) &&
                      bounds.x + bounds.width <= Math.max(first[0], last[0]) &&
                      bounds.y + bounds.height <= Math.max(first[1], last[1])
                    );
                  },
                );
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
                    error instanceof Error ? error.message : String(error),
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
                    extension.kind === runtime.store.cells[drag.id]?.kind) &&
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
                drag.mode === 'mind-pan' &&
                drag.mindFrameId &&
                isNodeCell(cell) &&
                propsRef.current.embedShell
              ) {
                const shell = propsRef.current.embedShell;
                const layout = frameLayouts(drag.mindFrameId);
                const frame = runtime.store.cells[drag.mindFrameId];
                if (isFrameCell(frame)) {
                  const requested: Point = [
                    (drag.mindOffset?.[0] ?? 0) + preview.x - drag.original.x,
                    (drag.mindOffset?.[1] ?? 0) + preview.y - drag.original.y,
                  ];
                  const offset = projectEmbeddedMindTrees(
                    runtime.store,
                    { ...frame, geometry: shell.geometry },
                    layout.baseGeometry,
                    layout.fitBounds,
                    new Map([[cell.id, requested]]),
                  ).offsets.get(cell.id);
                  if (
                    offset &&
                    (offset[0] !== drag.mindOffset?.[0] ||
                      offset[1] !== drag.mindOffset?.[1])
                  )
                    shell.onMindOffset(cell.id, offset);
                }
              } else if (
                drag.mode === 'mind-pan' &&
                drag.mindFrameId &&
                isNodeCell(cell)
              ) {
                const layout = frameLayouts(drag.mindFrameId);
                const frame = runtime.store.cells[drag.mindFrameId];
                const refCell = drag.mindRefId
                  ? runtime.store.cells[drag.mindRefId]
                  : undefined;
                const ref =
                  refCell && isFrameReferenceCell(refCell)
                    ? refCell
                    : undefined;
                if (isFrameCell(frame) && (!drag.mindRefId || ref)) {
                  // Occurrence pans clamp against the ref shell geometry and
                  // persist on the reference, never on shared target content.
                  const displayed = ref
                    ? { ...frame, geometry: ref.geometry }
                    : frame;
                  const requested: Point = [
                    (drag.mindOffset?.[0] ?? 0) + preview.x - drag.original.x,
                    (drag.mindOffset?.[1] ?? 0) + preview.y - drag.original.y,
                  ];
                  const offset = projectEmbeddedMindTrees(
                    runtime.store,
                    displayed,
                    layout.baseGeometry,
                    layout.fitBounds,
                    new Map([[cell.id, requested]]),
                  ).offsets.get(cell.id);
                  if (
                    offset &&
                    (offset[0] !== drag.mindOffset?.[0] ||
                      offset[1] !== drag.mindOffset?.[1])
                  )
                    void dispatch({
                      id: transactionId(),
                      operations: ref
                        ? [
                            {
                              type: 'replace_cell',
                              cell: {
                                ...ref,
                                data: {
                                  ...ref.data,
                                  mindOffsets: {
                                    ...(ref.data.mindOffsets ?? {}),
                                    [cell.id]: offset,
                                  },
                                },
                              },
                            },
                          ]
                        : [
                            {
                              type: 'replace_cell',
                              cell: {
                                ...cell,
                                data: {
                                  ...(cell.data as object),
                                  embeddedOffset: offset,
                                },
                              },
                            },
                          ],
                    });
                }
              } else if (drag.ids) {
                void dispatch({
                  id: transactionId(),
                  operations: translateCellSelection(runtime.store, drag.ids, [
                    preview.x - drag.original.x,
                    preview.y - drag.original.y,
                  ]),
                });
              } else if (isGroupCell(cell)) {
                void dispatch({
                  id: transactionId(),
                  operations: moveGroup(runtime.store, cell.id, [
                    preview.x - drag.original.x,
                    preview.y - drag.original.y,
                  ]),
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
                  const base = util as import('@sue/board-core').BaseCellUtil;
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
                  const movePlan = resolveMovePreview(drag, preview, point);
                  const operations = movePlan
                    ? movePlan.operations
                    : util && 'move' in util
                      ? drag.mode === 'resize'
                        ? base.resize(runtime.store, cell, authoredPreview)
                        : drag.mode === 'rotate'
                          ? base.rotate(runtime.store, cell, authoredPreview)
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
                                drag.mode === 'resize' || drag.mode === 'rotate'
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
                      error instanceof Error ? error.message : String(error),
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
            if (propsRef.current.surface === 'nested' && event.code === 'Space')
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
            const modified = event.ctrlKey || event.metaKey;
            if (modified && event.key.toLowerCase() === 'g') {
              event.preventDefault();
              const command: FrameSelectionCommand = {
                type: event.shiftKey ? 'ungroup' : 'group',
              };
              if (selectionCommandState(command).enabled)
                void executeSelectionCommand(command);
              return;
            }
            if (modified && event.key.toLowerCase() === 'a') {
              event.preventDefault();
              const focus = runtime.selection.focus;
              const ids = focusedCellIds(runtime.store, focus.at(-1)!);
              runtime.select({
                focus,
                ids: ids.filter((id) => !runtime.store.cells[id].hidden),
              });
              props.onSelectionChange?.(runtime.selection);
              return;
            }
            if (
              editable &&
              !pendingRef.current &&
              modified &&
              event.key.toLowerCase() === 'd' &&
              runtime.selection.ids.length
            ) {
              event.preventDefault();
              const fragment = copyCellFragment(
                runtime.store,
                runtime.selection.ids,
              );
              const parentId =
                [...runtime.selection.focus]
                  .reverse()
                  .find((id) => isFrameCell(runtime.store.cells[id])) ??
                frameId;
              try {
                const plan = planCellPaste({
                  store: runtime.store,
                  frameId: parentId,
                  selectionIds: runtime.selection.ids,
                  fragment,
                  allocateId: transactionId,
                  offset: [20, 20],
                  registry: runtime.registry,
                  intent: 'duplicate',
                  targetMindNodeId:
                    runtime.selection.ids.length === 1 &&
                    ['mind-root', 'mind-child'].includes(
                      runtime.store.cells[runtime.selection.ids[0]].kind,
                    )
                      ? runtime.selection.ids[0]
                      : undefined,
                });
                const request = {
                  ids: plan.selection.ids,
                  focus: plan.selection.focus,
                  accepted: false,
                };
                keyboardSelectionRef.current = request;
                void dispatch({
                  id: transactionId(),
                  operations: plan.operations,
                }).then((result) => {
                  if (keyboardSelectionRef.current !== request) return;
                  if (result.status === 'rejected')
                    keyboardSelectionRef.current = null;
                  else {
                    request.accepted = true;
                    applyKeyboardSelection();
                  }
                });
              } catch (error) {
                setFailure(
                  error instanceof Error ? error.message : String(error),
                );
              }
              return;
            }
            if (modified && ['=', '+', '-', '0'].includes(event.key)) {
              event.preventDefault();
              if (event.shiftKey && ['=', '+'].includes(event.key)) {
                fitCanvas();
                return;
              }
              setViewport({
                zoom:
                  event.key === '0'
                    ? 1
                    : Math.max(
                        0.1,
                        Math.min(
                          8,
                          (cameraRef.current.zoom ?? 1) +
                            (event.key === '-' ? -0.1 : 0.1),
                        ),
                      ),
                origination: cameraRef.current.origination ?? zeroOrigin,
              });
              return;
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              if (propsRef.current.placing) {
                propsRef.current.onCancelPlace?.();
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
              editable &&
              (event.ctrlKey || event.metaKey) &&
              (['[', ']', '{', '}'].includes(event.key) ||
                ['BracketLeft', 'BracketRight'].includes(event.code))
            ) {
              event.preventDefault();
              const direction =
                event.code === 'BracketRight' || [']', '}'].includes(event.key)
                  ? event.shiftKey || event.altKey
                    ? 'front'
                    : 'forward'
                  : event.shiftKey || event.altKey
                    ? 'back'
                    : 'backward';
              const ownerId =
                [...runtime.selection.focus]
                  .reverse()
                  .find((id) => isFrameCell(runtime.store.cells[id])) ??
                frameId;
              if (!frameScene(runtime.store, ownerId))
                void dispatch({
                  id: transactionId(),
                  operations: reorderCells(
                    runtime.store,
                    ownerId,
                    runtime.selection.ids,
                    direction,
                  ),
                });
              return;
            }
            const selected =
              runtime.selection.ids.length === 1
                ? runtime.store.cells[runtime.selection.ids[0]]
                : undefined;
            const util = selected
              ? runtime.registry.get(selected.kind)
              : undefined;
            const expandMind =
              (event.ctrlKey || event.metaKey) &&
              event.key === '/' &&
              selected?.kind === 'mind-child';
            if (
              editable &&
              selected &&
              util &&
              'keyboard' in util &&
              ((!event.ctrlKey && !event.metaKey && !event.altKey) ||
                expandMind)
            ) {
              if (pendingRef.current) {
                event.preventDefault();
                return;
              }
              const operations = (
                util as import('@sue/board-core').BaseCellUtil
              ).keyboard(runtime.store, selected, event.key, transactionId);
              if (operations) {
                event.preventDefault();
                const inserted = operations.find(
                  (operation) =>
                    operation.type === 'insert_cell' &&
                    isNodeCell(operation.cell),
                );
                const selection =
                  inserted?.type === 'insert_cell'
                    ? {
                        ids: [inserted.cell.id],
                        focus: [...runtime.selection.focus],
                        accepted: false,
                      }
                    : null;
                keyboardSelectionRef.current = selection;
                const edit =
                  inserted?.type === 'insert_cell' &&
                  isNodeCell(inserted.cell) &&
                  ['mind-root', 'mind-child', 'mind-summary'].includes(
                    inserted.cell.kind,
                  )
                    ? {
                        id: inserted.cell.id,
                        label: inserted.cell.content?.label ?? '',
                        accepted: false,
                      }
                    : null;
                keyboardEditRef.current = edit;
                void dispatch({ id: transactionId(), operations }).then(
                  (result) => {
                    if (keyboardSelectionRef.current !== selection) return;
                    if (result.status === 'rejected') {
                      keyboardSelectionRef.current = null;
                      keyboardEditRef.current = null;
                    } else if (selection) {
                      selection.accepted = true;
                      if (edit) edit.accepted = true;
                      applyKeyboardSelection();
                    }
                  },
                );
                return;
              }
            }
            if (
              editable &&
              !pendingRef.current &&
              isNodeCell(selected) &&
              !selected.locked &&
              ['mind-root', 'mind-child', 'mind-summary'].includes(
                selected.kind,
              ) &&
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
                ): import('@sue/board-common').BoardTextNode | undefined =>
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
                  ? { id: selected.id, initial: nodeContentName(selected) }
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
            if (
              (event.ctrlKey || event.metaKey) &&
              event.key.toLowerCase() === 'z'
            ) {
              event.preventDefault();
              publishHistory(event.shiftKey ? 'redo' : 'undo');
            } else if (
              editable &&
              !event.ctrlKey &&
              !event.metaKey &&
              (event.key === 'Delete' || event.key === 'Backspace')
            ) {
              event.preventDefault();
              void dispatch({
                id: transactionId(),
                operations: deleteCells(runtime.store, runtime.selection.ids),
              });
            }
          }}
          onCopy={(event) => {
            if (
              (event.target as Element).closest(
                '[contenteditable="true"], input, textarea',
              ) ||
              !runtime.selection.ids.length
            )
              return;
            event.preventDefault();
            const fragment = copyCellFragment(
              runtime.store,
              runtime.selection.ids,
            );
            event.clipboardData.setData(
              'application/x-verd-cells',
              JSON.stringify(fragment),
            );
            event.clipboardData.setData('text/plain', clipboardText(fragment));
          }}
          onCut={(event) => {
            if (
              (event.target as Element).closest(
                '[contenteditable="true"], input, textarea',
              ) ||
              !editable ||
              pendingRef.current
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
              void dispatch({
                id: transactionId(),
                operations: cut.operations,
              });
            } catch (error) {
              clipboardFailure(error);
            }
          }}
          onPaste={(event) => {
            if (
              (event.target as Element).closest(
                '[contenteditable="true"], input, textarea',
              )
            )
              return;
            if (!editable || pendingRef.current) return;
            const custom = event.clipboardData.getData(
              'application/x-verd-cells',
            );
            const plain = event.clipboardData.getData('text/plain');
            const itemList = event.clipboardData.items;
            const image =
              itemList && typeof itemList[Symbol.iterator] === 'function'
                ? [...itemList].find((item) => item.type.startsWith('image/'))
                : undefined;
            if (custom) {
              try {
                event.preventDefault();
                void pasteFragment(JSON.parse(custom));
              } catch (error) {
                clipboardFailure(error);
              }
              return;
            }
            if (image) {
              const file = image.getAsFile();
              if (!file) return;
              event.preventDefault();
              void insertExternal({ image: file }, viewportCenter()).catch(
                (error) => clipboardFailure(error),
              );
              return;
            }
            if (!plain) return;
            try {
              event.preventDefault();
              void pasteFragment(readClipboardText(plain));
            } catch {
              event.preventDefault();
              void insertExternal({ text: plain }, viewportCenter());
            }
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
                  x={Math.min(gesturePreview[0][0], gesturePreview.at(-1)![0])}
                  y={Math.min(gesturePreview[0][1], gesturePreview.at(-1)![1])}
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
              ) : (vectorDraftRef.current?.tool ?? gestureRef.current?.tool)
                  ?.preview ? null : gestureRef.current?.mode === 'box' ? (
                <rect
                  data-drawing-preview="true"
                  data-frame-export-exclude
                  x={Math.min(gesturePreview[0][0], gesturePreview.at(-1)![0])}
                  y={Math.min(gesturePreview[0][1], gesturePreview.at(-1)![1])}
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
                      (vectorDraftRef.current?.tool ?? gestureRef.current?.tool)
                        ?.mode ?? '',
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
              style={frameTitleStyle(runtime.selection.ids.includes(editing))}
              text={
                isBoardTextDocument(
                  (runtime.store.cells[editing] as NodeCell).content?.text,
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
    </FrameCanvasProviders>
  );
}) as <T = FrameSnapshot>(
  props: FrameCanvasProps<T> & { ref?: React.Ref<FrameCanvasController> },
) => React.ReactElement;

function FrameReferenceSurface({
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
  onActivate(occurrenceId: string): void;
  onBackgroundTap(): void;
  onSelection(selection: CellSelection): void;
  onExit(): void;
}) {
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
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const release = host.acquire(query);
    setMounted(true);
    return typeof release === 'function' ? release : () => host.release(query);
  }, [host, query]);
  const binding = mounted ? host.get(query) : null;
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
  return (
    <foreignObject
      x={bounds.x}
      y={bounds.y}
      width={bounds.width}
      height={bounds.height}
      data-instance-host={appearanceKey}
      style={{ overflow: 'hidden' }}
    >
      <div
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
            onActivate(binding.occurrenceId);
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
        {binding ? (
          <FrameCanvas
            documentReferences={documentReferences}
            exporting={exporting}
            runtime={binding.runtime}
            value={{ store: binding.runtime.store }}
            adapter={{ toFrameSnapshot: (value) => value }}
            onIntent={(transaction) =>
              host.commit(binding.occurrenceId, transaction)
            }
            surface="nested"
            instanceId={binding.occurrenceId}
            frameId={targetFrameId}
            readonly={readonly || binding.readonly || suspended}
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
              if (occurrenceId) onActivate(occurrenceId);
            }}
            onInstanceSelection={onSelection}
            onExitInstance={onExit}
            onOpenFrame={onOpenFrame}
            embedShell={{
              refId,
              geometry: shellGeometry,
              offsets: offsetMap,
              onMindOffset: (rootId, offset) =>
                host.updateMindOffset?.(binding.occurrenceId, rootId, offset),
            }}
            onSelectionChange={onSelection}
            style={{ width: '100%', height: '100%', minHeight: 0 }}
          />
        ) : mounted ? (
          <div data-frame-missing>引用缺失</div>
        ) : null}
        {empty && inputMode !== 'present' ? (
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
        {binding?.preview ? (
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
