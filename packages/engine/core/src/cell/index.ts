import { initializeNodeName } from './name';
export * from './name';
import type { NodeOutline } from '../geometry/shape';
import type {
  Cell,
  CellId,
  CellStore,
  EdgeCell,
  FrameCell,
  GroupCell,
  NodeGeometry,
} from './types';
import type { Point } from '../interfaces/point';
import {
  cellDeletionLocked,
  groupLeafMembers,
  lockedByAncestor,
} from './group';
import {
  isEdgeCell,
  isFrameCell,
  isGroupCell,
  stripFrameViewports,
} from './types';
import { validateCellStore } from './validation';
export * from './validation';
export * from './frame';
export * from './util';
export * from './runtime';
export * from './clipboard';
export * from './transfer';

export interface CellIndex {
  parentOf: Map<CellId, CellId>;
  orderOf: Map<CellId, CellId[]>;
  groupOf: Map<CellId, CellId>;
  domainOwnerOf: Map<CellId, CellId>;
  /** @deprecated Use groupOf or domainOwnerOf to distinguish ownership. */
  membersOf: Map<CellId, CellId>;
  incoming: Map<CellId, CellId[]>;
  outgoing: Map<CellId, CellId[]>;
}

export const indexCells = (store: CellStore): CellIndex => {
  const parentOf = new Map<CellId, CellId>();
  const orderOf = new Map<CellId, CellId[]>();
  Object.values(store.cells).forEach((cell) => {
    if (!isFrameCell(cell)) {
      return;
    }
    orderOf.set(cell.id, [...cell.children]);
    cell.children.forEach((childId) => parentOf.set(childId, cell.id));
    cell.groups.forEach((groupId) => parentOf.set(groupId, cell.id));
  });
  const membersOf = new Map<CellId, CellId>();
  const groupOf = new Map<CellId, CellId>();
  const domainOwnerOf = new Map<CellId, CellId>();
  const incoming = new Map<CellId, CellId[]>();
  const outgoing = new Map<CellId, CellId[]>();
  Object.values(store.cells).forEach((cell) => {
    listedMembers(cell).forEach((id) =>
      (isGroupCell(cell) ? groupOf : domainOwnerOf).set(id, cell.id),
    );
    if (isEdgeCell(cell)) {
      if ('cellId' in cell.source)
        outgoing.set(cell.source.cellId, [
          ...(outgoing.get(cell.source.cellId) ?? []),
          cell.id,
        ]);
      if ('cellId' in cell.target)
        incoming.set(cell.target.cellId, [
          ...(incoming.get(cell.target.cellId) ?? []),
          cell.id,
        ]);
    }
  });
  groupOf.forEach((owner, id) => membersOf.set(id, owner));
  domainOwnerOf.forEach((owner, id) => membersOf.set(id, owner));
  return {
    parentOf,
    orderOf,
    groupOf,
    domainOwnerOf,
    membersOf,
    incoming,
    outgoing,
  };
};

export const parentOf = (store: CellStore, cellId: CellId) =>
  indexCells(store).parentOf.get(cellId);

export const frameOf = (
  store: CellStore,
  cellId: CellId,
): FrameCell | undefined => {
  let current = parentOf(store, cellId);
  while (current) {
    const cell = store.cells[current];
    if (cell && isFrameCell(cell)) {
      return cell;
    }
    current = parentOf(store, current);
  }
  const root = store.cells[store.rootId];
  return root && isFrameCell(root) ? root : undefined;
};

const clone = <T>(value: T): T => {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
};

export type CellOperation =
  | {
      type: 'insert_cell';
      cell: Cell;
      parentId: CellId;
      index?: number;
    }
  | { type: 'remove_cell'; cellId: CellId }
  | { type: 'replace_cell'; cell: Cell; deferName?: boolean }
  | { type: 'patch_cells'; cells: Record<CellId, Cell | null> }
  | {
      type: 'move_cell';
      cellId: CellId;
      parentId: CellId;
      index: number;
    };

const without = (ids: readonly CellId[], cellId: CellId) =>
  ids.filter((id) => id !== cellId);

const insertAt = (ids: readonly CellId[], cellId: CellId, index?: number) => {
  const next = without(ids, cellId);
  const at =
    index === undefined
      ? next.length
      : Math.max(0, Math.min(index, next.length));
  next.splice(at, 0, cellId);
  return next;
};

const detach = (frame: FrameCell, cellId: CellId): FrameCell => ({
  ...frame,
  children: without(frame.children, cellId),
  groups: without(frame.groups, cellId),
});

const attach = (frame: FrameCell, cell: Cell, index?: number): FrameCell => {
  if (isGroupCell(cell)) {
    return {
      ...frame,
      children: without(frame.children, cell.id),
      groups: insertAt(frame.groups, cell.id, index),
    };
  }
  return {
    ...frame,
    groups: without(frame.groups, cell.id),
    children: insertAt(frame.children, cell.id, index),
  };
};

const descendantIds = (store: CellStore, cellId: CellId): CellId[] => {
  const cell = store.cells[cellId];
  if (!cell || !isFrameCell(cell)) {
    return [cellId];
  }
  return [
    cellId,
    ...cell.children.flatMap((childId) => descendantIds(store, childId)),
    ...cell.groups,
  ];
};

const applyUnchecked = (
  store: CellStore,
  operation: CellOperation,
): CellStore => {
  const cells = { ...store.cells };
  if (operation.type === 'patch_cells') {
    Object.entries(operation.cells).forEach(([id, cell]) => {
      if (cell === null) delete cells[id];
      else cells[id] = clone(cell);
    });
    return { ...store, cells };
  }
  if (operation.type === 'replace_cell') {
    if (!cells[operation.cell.id])
      throw new Error('Cannot replace a missing cell');
    cells[operation.cell.id] = clone(
      initializeNodeName(
        operation.cell,
        cells[operation.cell.id],
        operation.deferName,
      ),
    );
    return { ...store, cells };
  }
  if (operation.type === 'insert_cell') {
    const parent = cells[operation.parentId];
    if (!parent || !isFrameCell(parent))
      throw new Error('Invalid insertion parent');
    if (cells[operation.cell.id])
      throw new Error(`Duplicate cell id: ${operation.cell.id}`);
    const cell = clone(initializeNodeName(operation.cell));
    cells[cell.id] = cell;
    cells[parent.id] = attach(parent, cell, operation.index);
    return { ...store, cells };
  }
  if (operation.type === 'move_cell') {
    const cell = cells[operation.cellId];
    const nextParent = cells[operation.parentId];
    const currentParentId = parentOf(store, operation.cellId);
    const currentParent = currentParentId ? cells[currentParentId] : undefined;
    if (
      !cell ||
      !nextParent ||
      !isFrameCell(nextParent) ||
      !currentParent ||
      !isFrameCell(currentParent)
    )
      throw new Error('Invalid move');
    if (descendantIds(store, operation.cellId).includes(operation.parentId))
      throw new Error('Frame hierarchy cycle');
    cells[currentParent.id] = detach(currentParent, cell.id);
    const parentAfterDetach = cells[operation.parentId] as FrameCell;
    cells[operation.parentId] = attach(
      parentAfterDetach,
      cell,
      operation.index,
    );
    return { ...store, cells };
  }
  if (!cells[operation.cellId]) throw new Error('Cannot remove a missing cell');
  if (operation.cellId === store.rootId)
    throw new Error('Cannot delete the root frame');
  const removing = descendantIds(store, operation.cellId);
  // Anchors own relationships, not ordinary node children.
  for (let at = 0; at < removing.length; at++) {
    const removed = cells[removing[at]];
    if (!removed) continue;
    if (removed.kind === 'architecture-layer') {
      listedMembers(removed).forEach((id) => {
        if (!removing.includes(id)) removing.push(id);
      });
    }
    if (removed.kind === 'mind-root' || removed.kind === 'mind-child') {
      Object.values(cells).forEach((edge) => {
        if (
          isEdgeCell(edge) &&
          edge.kind === 'mind-branch' &&
          'cellId' in edge.source &&
          edge.source.cellId === removed.id &&
          'cellId' in edge.target
        ) {
          if (!removing.includes(edge.target.cellId))
            removing.push(edge.target.cellId);
        }
      });
    }
  }
  const parentId = parentOf(store, operation.cellId);
  if (parentId && cells[parentId] && isFrameCell(cells[parentId])) {
    cells[parentId] = detach(cells[parentId], operation.cellId);
  }
  removing.forEach((id) => {
    delete cells[id];
  });
  Object.values(cells).forEach((cell) => {
    if (!isEdgeCell(cell)) {
      return;
    }
    const sourceId = 'cellId' in cell.source ? cell.source.cellId : undefined;
    const targetId = 'cellId' in cell.target ? cell.target.cellId : undefined;
    if (
      (sourceId &&
        removing.includes(sourceId) &&
        cell.kind !== 'mind-summary-edge') ||
      (targetId && removing.includes(targetId))
    ) {
      delete cells[cell.id];
      if (parentId && cells[parentId] && isFrameCell(cells[parentId])) {
        cells[parentId] = detach(cells[parentId] as FrameCell, cell.id);
      }
    }
  });
  return { ...store, cells };
};

/** Plan a selection deletion once; cascaded descendants and edges are not removed twice. */
export const deleteCells = (
  store: CellStore,
  ids: readonly CellId[],
  options?: { ignoreLock?: boolean },
): CellOperation[] => {
  for (const id of ids)
    if (!store.cells[id])
      throw new Error(`Cannot delete a missing cell: ${id}`);
  const selected: CellId[] = [];
  const expand = (id: CellId) => {
    if (selected.includes(id) || !store.cells[id]) return;
    selected.push(id);
    const cell = store.cells[id];
    if (isGroupCell(cell)) groupLeafMembers(store, id).forEach(expand);
  };
  ids.forEach(expand);
  if (
    !options?.ignoreLock &&
    selected.some((id) => cellDeletionLocked(store, id))
  )
    throw new Error('Cannot delete locked content');
  let candidate = store;
  const operations: CellOperation[] = [];
  for (const cellId of new Set(selected)) {
    if (!candidate.cells[cellId]) continue;
    const operation: CellOperation = { type: 'remove_cell', cellId };
    candidate = applyUnchecked(candidate, operation);
    operations.push(operation);
  }
  return operations;
};

const memberIdsOf = (cell: Cell): CellId[] | undefined => {
  if (isGroupCell(cell)) {
    return cell.members;
  }
  const data = (cell as { data?: { memberIds?: CellId[] } }).data;
  return data?.memberIds;
};

const sameIds = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, at) => id === b[at]);
const pruneFrameRelations = (
  cell: FrameCell,
  before: CellStore,
  store: CellStore,
  cells: CellStore['cells'],
) => {
  const keep = (id: string) =>
    !!cells[id] || (!before.cells[id] && !store.cells[id]);
  const children = cell.children.filter(keep),
    groups = cell.groups.filter(keep);
  return sameIds(children, cell.children) && sameIds(groups, cell.groups)
    ? cell
    : { ...cell, children, groups };
};

/** Prune memberships after the entire transaction, so intermediate states are allowed. */
const normalizeRelations = (before: CellStore, store: CellStore): CellStore => {
  const cells = { ...store.cells };
  const index = indexCells(store);
  Object.values(cells).forEach((cell) => {
    if (isFrameCell(cell))
      cells[cell.id] = pruneFrameRelations(cell, before, store, cells);
    const members = memberIdsOf(cell);
    if (members) {
      const parent = index.parentOf.get(cell.id);
      const next = members.filter(
        (id) => !!cells[id] && index.parentOf.get(id) === parent,
      );
      if (isGroupCell(cell)) {
        if (next.length < 2) {
          const owner = Object.values(cells).find(
            (candidate) =>
              isGroupCell(candidate) && candidate.members.includes(cell.id),
          );
          if (owner && isGroupCell(owner))
            cells[owner.id] = {
              ...owner,
              members: owner.members.flatMap((id) =>
                id === cell.id ? next : [id],
              ),
            };
          delete cells[cell.id];
          const frame = parent ? cells[parent] : undefined;
          if (frame && isFrameCell(frame))
            cells[parent!] = detach(frame, cell.id);
        } else if (!sameIds(members, next))
          cells[cell.id] = { ...cell, members: next };
      } else if (!sameIds(members, next)) {
        cells[cell.id] = {
          ...cell,
          data: { ...(cell as { data?: object }).data, memberIds: next },
        } as Cell;
      }
    }
  });
  let dissolving = true;
  while (dissolving) {
    dissolving = false;
    for (const cell of [...Object.values(cells)]) {
      if (!cells[cell.id] || !isGroupCell(cells[cell.id])) continue;
      const current = cells[cell.id];
      if (!isGroupCell(current)) continue;
      const parent = index.parentOf.get(current.id);
      const next = current.members.filter(
        (id) => !!cells[id] && index.parentOf.get(id) === parent,
      );
      if (
        next.length >= 2 &&
        (next.length !== current.members.length ||
          next.some((id, at) => id !== current.members[at]))
      ) {
        cells[current.id] = { ...current, members: next };
        dissolving = true;
        continue;
      }
      if (next.length >= 2) continue;
      dissolving = true;
      const owner = Object.values(cells).find(
        (candidate) =>
          candidate.id !== current.id &&
          isGroupCell(candidate) &&
          candidate.members.includes(current.id),
      );
      if (owner && isGroupCell(owner))
        cells[owner.id] = {
          ...owner,
          members: owner.members.flatMap((id) =>
            id === current.id ? next : [id],
          ),
        };
      delete cells[current.id];
      const frame = parent ? cells[parent] : undefined;
      if (frame && isFrameCell(frame))
        cells[parent!] = detach(frame, current.id);
    }
  }
  // Summary endpoints refer to a consecutive range in the previous sibling list.
  Object.values(cells).forEach((cell) => {
    if (!isEdgeCell(cell) || cell.kind !== 'mind-summary-edge') return;
    const range = cell.data as
      { startSiblingId: string; endSiblingId: string } | undefined;
    if (!range) return;
    const oldBranches = Object.values(before.cells).filter(
      (edge): edge is EdgeCell<{ order: string }> =>
        isEdgeCell(edge) && edge.kind === 'mind-branch',
    );
    const first = oldBranches.find(
      (edge) =>
        'cellId' in edge.target && edge.target.cellId === range.startSiblingId,
    );
    if (!first || !('cellId' in first.source)) return;
    const sourceId = first.source.cellId;
    const siblings = oldBranches
      .filter(
        (edge) => 'cellId' in edge.source && edge.source.cellId === sourceId,
      )
      .sort((a, b) => (a.data?.order ?? '').localeCompare(b.data?.order ?? ''))
      .flatMap((edge) => ('cellId' in edge.target ? [edge.target.cellId] : []));
    const start = siblings.indexOf(range.startSiblingId),
      end = siblings.indexOf(range.endSiblingId);
    const covered = new Set(
      siblings
        .slice(start, end + 1)
        .filter(
          (id) =>
            !!cells[id] &&
            Object.values(cells).some(
              (edge) =>
                isEdgeCell(edge) &&
                edge.kind === 'mind-branch' &&
                'cellId' in edge.source &&
                edge.source.cellId === sourceId &&
                'cellId' in edge.target &&
                edge.target.cellId === id,
            ),
        ),
    );
    const surviving = Object.values(cells)
      .filter(
        (edge): edge is EdgeCell<{ order: string }> =>
          isEdgeCell(edge) &&
          edge.kind === 'mind-branch' &&
          'cellId' in edge.source &&
          edge.source.cellId === sourceId &&
          'cellId' in edge.target &&
          covered.has(edge.target.cellId),
      )
      .sort((a, b) => (a.data?.order ?? '').localeCompare(b.data?.order ?? ''))
      .flatMap((edge) => ('cellId' in edge.target ? [edge.target.cellId] : []));
    if (!surviving.length) {
      delete cells[cell.id];
      if ('cellId' in cell.target) delete cells[cell.target.cellId];
    } else if (
      !('cellId' in cell.source) ||
      cell.source.cellId !== surviving[0] ||
      range.startSiblingId !== surviving[0] ||
      range.endSiblingId !== surviving[surviving.length - 1] ||
      Object.keys(cell.source).length !== 1 ||
      Object.keys(range).length !== 2
    )
      cells[cell.id] = {
        ...cell,
        source: { cellId: surviving[0] },
        data: {
          startSiblingId: surviving[0],
          endSiblingId: surviving[surviving.length - 1],
        },
      };
  });
  // Pruning may have removed summaries or groups after their parent was visited.
  Object.values(cells).forEach((cell) => {
    if (isFrameCell(cell))
      cells[cell.id] = pruneFrameRelations(cell, before, store, cells);
  });
  return { ...store, cells };
};

export const applyCellOperations = (
  store: CellStore,
  operations: readonly CellOperation[],
  registry?: CellRegistry,
): CellStore => {
  let candidate = normalizeRelations(
    store,
    operations.reduce(applyUnchecked, store),
  );
  // A domain frame cannot lose its last anchor, and starts cannot be deleted independently.
  Object.values(store.cells).forEach((cell) => {
    if (
      cell.kind === 'workflow-start' &&
      candidate.cells[cell.id]?.kind !== 'workflow-start'
    ) {
      const parentId = parentOf(store, cell.id);
      if (parentId && candidate.cells[parentId])
        throw new Error('Cannot delete a workflow start');
    }
    if (isFrameCell(cell) && candidate.cells[cell.id]) {
      const anchors = cell.children
        .map((id) => store.cells[id])
        .filter(
          (child) =>
            child && ['mind-root', 'architecture-layer'].includes(child.kind),
        );
      if (
        anchors.length &&
        !(candidate.cells[cell.id] as FrameCell).children.some((id) =>
          anchors.some((anchor) => candidate.cells[id]?.kind === anchor.kind),
        )
      )
        throw new Error('Cannot delete the last scene anchor');
    }
  });
  candidate = stripFrameViewports(candidate);
  const issues = validateCellStore(candidate, registry);
  if (issues.length)
    throw new Error(issues.map((issue) => issue.message).join('; '));
  return candidate;
};

export const applyCellOperation = (
  store: CellStore,
  operation: CellOperation,
): CellStore => applyCellOperations(store, [operation]);

export interface CellHistoryEntry {
  forward: CellOperation[];
  inverse: CellOperation[];
  /** Explicit theme edits and opening files restore their frame theme; ordinary edits keep it. */
  restoreView?: boolean;
}
export interface CellHistory {
  undos: CellHistoryEntry[];
  redos: CellHistoryEntry[];
}
export const emptyCellHistory = (): CellHistory => ({ undos: [], redos: [] });

const diffCells = (before: CellStore, after: CellStore) => {
  const forward: Record<CellId, Cell | null> = {},
    inverse: Record<CellId, Cell | null> = {};
  for (const id of new Set([
    ...Object.keys(before.cells),
    ...Object.keys(after.cells),
  ])) {
    const left = before.cells[id],
      right = after.cells[id];
    if (
      Object.is(left, right) ||
      JSON.stringify(left) === JSON.stringify(right)
    )
      continue;
    forward[id] = right ? clone(right) : null;
    inverse[id] = left ? clone(left) : null;
  }
  return {
    forward: { type: 'patch_cells' as const, cells: forward },
    inverse: { type: 'patch_cells' as const, cells: inverse },
  };
};

export const commitCellOperations = (
  store: CellStore,
  history: CellHistory,
  operations: readonly CellOperation[],
  registry?: CellRegistry,
  options?: { restoreView?: boolean },
) => {
  const next = applyCellOperations(store, operations, registry);
  const { forward, inverse } = diffCells(store, next);
  if (forward.type === 'patch_cells' && !Object.keys(forward.cells).length)
    return { store, history };
  return {
    store: next,
    history: {
      undos: [
        ...history.undos,
        {
          forward: [forward],
          inverse: [inverse],
          restoreView: options?.restoreView,
        },
      ],
      redos: [],
    },
  };
};

export const undoCells = (store: CellStore, history: CellHistory) => {
  const entry = history.undos.at(-1);
  if (!entry) return { store, history };
  return {
    store: entry.inverse.reduce(applyUnchecked, store),
    history: {
      undos: history.undos.slice(0, -1),
      redos: [...history.redos, entry],
    },
  };
};
export const redoCells = (store: CellStore, history: CellHistory) => {
  const entry = history.redos.at(-1);
  if (!entry) return { store, history };
  return {
    store: entry.forward.reduce(applyUnchecked, store),
    history: {
      undos: [...history.undos, entry],
      redos: history.redos.slice(0, -1),
    },
  };
};

export interface CellSelection {
  /** 从挂载根到当前 Frame 的路径，后面可接逐级进入的嵌套 Group 路径。 */
  focus: CellId[];
  ids: CellId[];
}

export const emptySelection = (rootId: CellId): CellSelection => ({
  focus: [rootId],
  ids: [],
});

export interface CellPasteAdjustContext {
  sourceId: string;
  nested: boolean;
  offset: Point;
  geometry?: ReadonlyMap<string, NodeGeometry>;
  ownerId?: string;
  fragmentIds: ReadonlySet<string>;
}
export interface CellUtil {
  kind: string;
  capabilities?: (
    store: CellStore,
    cell: Cell,
    mount: 'root' | 'embedded',
  ) => Partial<
    Record<
      'delete' | 'move' | 'edit' | 'resize' | 'rotate' | 'connect',
      boolean
    >
  >;
  validate?: (store: CellStore, cell: Cell) => string | undefined;
  validateEdge?: (store: CellStore, edge: EdgeCell) => string | undefined;
  /** Domain-owned cells such as a lone task or module need an explicit target. */
  requiresPasteOwner?: (
    cell: Cell,
    fragment: { cells: Record<string, Cell> },
  ) => boolean;
  pasteOwner?: (
    store: CellStore,
    frameId: string,
    selectionIds: readonly string[],
  ) => string | undefined;
  adjustPastedCell?: (
    cell: Cell,
    context: CellPasteAdjustContext,
  ) => Cell | null;
  rejectPaste?: (
    store: CellStore,
    frameId: string,
    cells: Record<string, Cell>,
    ownerId: string | undefined,
  ) => string | undefined;
  completePaste?: (
    store: CellStore,
    frameId: string,
    mapping: ReadonlyMap<string, string>,
    cells: Record<string, Cell>,
    ownerId: string | undefined,
  ) => CellOperation[];
}

export interface CellRegistry {
  register: (util: CellUtil) => void;
  get: (kind: string) => CellUtil | undefined;
  validate: (store: CellStore, cell: Cell) => string | undefined;
  validateEdge: (store: CellStore, edge: EdgeCell) => string | undefined;
}

export const createCellRegistry = (): CellRegistry => {
  const utils = new Map<string, CellUtil>();
  return {
    register(util) {
      utils.set(util.kind, util);
    },
    get(kind) {
      return utils.get(kind);
    },
    validate(store, cell) {
      return utils.get(cell.kind)?.validate?.(store, cell);
    },
    validateEdge(store, edge) {
      return utils.get(edge.kind)?.validateEdge?.(store, edge);
    },
  };
};

export interface PaintedCell {
  id: CellId;
  kind: string;
  cellType: Cell['cellType'];
  label?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  outline?: NodeOutline;
}

/** 渲染宿主只负责把一个 Frame 里的节点和边摊成绘制列表。形状细节由几何内核计算。 */
export const paintFrame = (
  store: CellStore,
  frameId: CellId,
): PaintedCell[] => {
  const frame = store.cells[frameId];
  if (!frame || !isFrameCell(frame)) {
    return [];
  }
  return frame.children.flatMap((childId): PaintedCell[] => {
    const cell = store.cells[childId];
    if (!cell || cell.hidden) {
      return [];
    }
    if (isFrameCell(cell) || cell.cellType === 'node') {
      const node = cell as FrameCell;
      return [
        {
          id: node.id,
          kind: node.kind,
          cellType: node.cellType,
          label: node.content?.label,
          x: node.geometry.x,
          y: node.geometry.y,
          width: node.geometry.width,
          height: node.geometry.height,
          outline: node.geometry.outline,
        },
      ];
    }
    if (isEdgeCell(cell)) {
      return [
        {
          id: cell.id,
          kind: cell.kind,
          cellType: cell.cellType,
          label: cell.labels?.[0]?.text,
        },
      ];
    }
    return [];
  });
};

export const terminalCellId = (terminal: EdgeCell['source']) =>
  'cellId' in terminal ? terminal.cellId : undefined;

export const groupMembers = (cell: GroupCell) => cell.members;

export const listedMembers = (cell: Cell) => memberIdsOf(cell) ?? [];
export * from './commands';
export * from './group';
export * from './arrangement';
export * from './edge-edit';
export * from './position';
