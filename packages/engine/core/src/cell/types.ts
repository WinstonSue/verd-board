import type { NodeOutline } from '../geometry/shape';
import type { Point } from '../interfaces/point';
import type { RectangleClient } from '../interfaces/rectangle-client';
import type { BoardTheme } from '../interfaces/theme';

export type CellId = string;

export type CellType = 'node' | 'frame' | 'edge' | 'group';

export type PortDirection = 'input' | 'output' | 'both';

export type PortSide = 'top' | 'right' | 'bottom' | 'left';

export interface PortSpec {
  id: string;
  direction: PortDirection;
  side: PortSide;
  offset?: number;
  maxConnections?: number;
}

export interface NodeAppearance {
  fill?: string;
  strokeColor?: string;
  strokeWidth?: number;
  strokeStyle?: 'solid' | 'dashed' | 'dotted';
  shadow?: string;
  opacity?: number;
}

export interface NodeGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  /** 布局算出的节点没有自己的坐标，为 true 时 x/y 只是缓存。 */
  derived?: boolean;
  outline?: NodeOutline;
  rotation?: number;
}

export interface NodeContent {
  label?: string;
  text?: unknown;
}

export interface CellBase {
  id: CellId;
  kind: string;
  locked?: boolean;
  hidden?: boolean;
}

export interface NodeCell<T = unknown> extends CellBase {
  cellType: 'node' | 'frame';
  /** Independent plain-text name. An explicit empty name is valid. */
  name?: string;
  geometry: NodeGeometry;
  appearance?: NodeAppearance;
  ports?: PortSpec[];
  content?: NodeContent;
  data?: T;
}

export type FrameAspectRatio =
  | 'custom'
  | 'a4'
  | '1:1'
  | '4:3'
  | '16:10'
  | '16:9'
  | 'browser'
  | 'tablet'
  | 'phone';

export type MindColorScheme =
  'default' | 'colorful' | 'soft' | 'retro' | 'dark' | 'starry';

/**
 * Mind-specific view settings. Absent fields inherit the owning file's
 * canvas theme; an explicit value overrides it for every tree in the file.
 */
export interface MindViewSettings {
  colorScheme?: MindColorScheme;
}

export interface FrameView {
  theme?: BoardTheme;
  mind?: MindViewSettings;
}

/** 唯一带 children 的节点。不区分场景，场景由内部锚点节点决定。 */
export interface FrameCell extends NodeCell {
  cellType: 'frame';
  children: CellId[];
  groups: CellId[];
  aspectRatio?: FrameAspectRatio;
  view?: FrameView;
}

export interface FrameReferenceData {
  /** Stable identity of the target file's root Frame. Absent targets stay unresolved. */
  targetFrameId: CellId;
  /** Per-instance pan offsets for embedded mind trees, keyed by mind-root id. */
  mindOffsets?: Record<CellId, Point>;
}

/**
 * Occurrence shell: embeds another file's root Frame without owning it.
 * Position, size, appearance, hidden/locked, aspect ratio and mind offsets are
 * per instance; content, domain relations and theme live in the target file.
 */
export interface FrameReferenceCell extends NodeCell<FrameReferenceData> {
  cellType: 'node';
  kind: 'frame-reference';
  data: FrameReferenceData;
  aspectRatio?: FrameAspectRatio;
}

export type EdgeTerminal =
  { cellId: CellId; portId?: string; anchor?: Point } | { point: Point };

export interface EdgeAppearance {
  strokeColor?: string;
  strokeWidth?: number;
  strokeStyle?: 'solid' | 'dashed' | 'dotted';
  opacity?: number;
  shadow?: string;
}

export interface EdgeLabel {
  text: string;
  position?: number;
  richText?: unknown;
}

export type EdgeRoute =
  | { mode: 'auto' }
  | { mode: 'orthogonal'; points?: Point[] }
  | { mode: 'straight'; points?: Point[] }
  | { mode: 'curve'; points?: Point[] }
  | { mode: 'fixed'; points: Point[] };

export interface EdgeCell<T = unknown> extends CellBase {
  cellType: 'edge';
  source: EdgeTerminal;
  target: EdgeTerminal;
  route: EdgeRoute;
  labels?: EdgeLabel[];
  appearance?: EdgeAppearance;
  data?: T;
}

export interface GroupCell extends CellBase {
  cellType: 'group';
  kind: 'group';
  members: CellId[];
}

export type Cell =
  NodeCell | FrameCell | FrameReferenceCell | EdgeCell | GroupCell;

export interface CellStore {
  rootId: CellId;
  cells: Record<CellId, Cell>;
}

export const isFrameCell = (cell: Cell | undefined): cell is FrameCell =>
  cell?.cellType === 'frame';

export const isFrameReferenceCell = (
  cell: Cell | undefined,
): cell is FrameReferenceCell =>
  cell?.cellType === 'node' && cell.kind === 'frame-reference';

export const isEdgeCell = (cell: Cell | undefined): cell is EdgeCell =>
  cell?.cellType === 'edge';

export const isGroupCell = (cell: Cell | undefined): cell is GroupCell =>
  cell?.cellType === 'group';

export const isNodeCell = (cell: Cell | undefined): cell is NodeCell =>
  cell?.cellType === 'node' || cell?.cellType === 'frame';

export const nodeRectangle = (cell: NodeCell): RectangleClient => ({
  x: cell.geometry.x,
  y: cell.geometry.y,
  width: cell.geometry.width,
  height: cell.geometry.height,
});

export interface MindNodeData {
  layout?: string;
  rightNodeCount?: number;
  manualWidth?: number;
  note?: unknown;
  noteCollapsed?: boolean;
  image?: { url: string; width: number; height: number };
  emojis?: { name: string }[];
  branchAppearance?: NodeAppearance;
  branchShape?: 'bight' | 'polyline';
}
export interface MindRootData extends MindNodeData {
  collapsed?: boolean;
  /** Maximum outer topic width; absent inherits the application default. */
  maxNodeWidth?: number;
  /** Presentation offset inside an embedded Frame; detail layout stays canonical. */
  embeddedOffset?: Point;
}
export interface MindChildData extends MindNodeData {
  collapsed?: boolean;
}

export interface MindSummaryData {
  startSiblingId: CellId;
  endSiblingId: CellId;
}

export interface MindBranchData {
  order: string;
}

export interface WorkflowStartData {
  graphMode: 'dag' | 'process';
  origin: Point;
  memberIds: CellId[];
}

export interface ArchitectureLayerData {
  order: string;
  memberIds: CellId[];
}

export interface ArchitectureModuleData {
  shape: 'box' | 'decision' | 'store';
  /** 拖动过后记住的坐标。没有它时仍按层排成一行。 */
  placed?: boolean;
}

export const createFrameCell = (
  id: CellId,
  geometry: NodeGeometry = { x: 0, y: 0, width: 960, height: 640 },
): FrameCell => ({
  id,
  kind: 'frame',
  cellType: 'frame',
  geometry,
  children: [],
  groups: [],
});

export const createCellStore = (root: FrameCell): CellStore => ({
  rootId: root.id,
  cells: { [root.id]: root },
});

export const createFrameReferenceCell = (
  id: CellId,
  targetFrameId: CellId,
  geometry: NodeGeometry,
): FrameReferenceCell => ({
  id,
  kind: 'frame-reference',
  cellType: 'node',
  geometry,
  data: { targetFrameId },
});

/** Full assembled frame subtree. Persisted partitions are reconstructed before use. */
export interface FrameSnapshot {
  store: CellStore;
}

/** Older files may carry a camera in Frame.view; cameras now belong to the mounted canvas. */
export function stripFrameViewports(store: CellStore): CellStore {
  let cells = store.cells;
  for (const cell of Object.values(store.cells)) {
    if (
      !isFrameCell(cell) ||
      !cell.view ||
      !Object.hasOwn(cell.view, 'viewport')
    )
      continue;
    if (cells === store.cells) cells = { ...cells };
    const view = { ...cell.view } as FrameView & { viewport?: unknown };
    delete view.viewport;
    cells[cell.id] = {
      ...cell,
      view: Object.keys(view).length ? view : undefined,
    };
  }
  return cells === store.cells ? store : { ...store, cells };
}
