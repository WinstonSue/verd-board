import { memoizeCellValidationRead } from './validation-read-context';
import type { NodeOutline } from '../geometry/shape';
import type { Point } from '../interfaces/point';
import type { RectangleClient } from '../interfaces/rectangle-client';
import { cellDeletionLocked, groupLeafMembers } from './group';
import { initializeNodeName } from './name';
import {
  assertRegisteredCellKinds,
  createCellRegistry,
  type CellRegistry,
} from './registry';
import type {
  Cell,
  CellId,
  CellStore,
  EdgeCell,
  FrameCell,
  GroupCell,
  NodeGeometry,
} from './types';
import {
  isEdgeCell,
  isFrameCell,
  isGroupCell,
  stripFrameViewports,
} from './types';
import { normalizeCellRoutes } from './edge-route-policy';
import { validateCellStore } from './validation';
export { memoizeCellValidationRead } from './validation-read-context';
export * from './arrangement';
export * from './layout-plan';
export * from './geometry-policy';
export * from './domain-layout';
export * from './arrangement-graph';
export * from './relationship-layout';
export * from './clipboard';
export * from './commands';
export * from './edge-edit';
export * from './edge-route-policy';
export * from './lanes';
export * from './frame';
export * from './group';
export * from './name';
export * from './search';
export * from './position';
export * from './registry';
export * from './runtime';
export * from './transfer';
export * from './util';
export * from './validation';

export interface CellIndex {
  parentOf: Map<CellId, CellId>;
  orderOf: Map<CellId, CellId[]>;
  groupOf: Map<CellId, CellId>;
  domainOwnerOf: Map<CellId, CellId>;
  incoming: Map<CellId, CellId[]>;
  outgoing: Map<CellId, CellId[]>;
}

const defaultIndexRead = Symbol('cell-index');
export const indexCells = (
  store: CellStore,
  registry?: CellRegistry,
): CellIndex =>
  memoizeCellValidationRead(store, registry ?? defaultIndexRead, () =>
    buildCellIndex(store, registry),
  );

const buildCellIndex = (
  store: CellStore,
  registry?: CellRegistry,
): CellIndex => {
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
  const groupOf = new Map<CellId, CellId>();
  const domainOwnerOf = new Map<CellId, CellId>();
  const incoming = new Map<CellId, CellId[]>();
  const outgoing = new Map<CellId, CellId[]>();
  Object.values(store.cells).forEach((cell) => {
    listedMembers(cell, registry).forEach((id) =>
      (isGroupCell(cell) ? groupOf : domainOwnerOf).set(id, cell.id),
    );
    if (isEdgeCell(cell)) {
      if ('cellId' in cell.source) {
        const list = outgoing.get(cell.source.cellId) ?? [];
        list.push(cell.id);
        outgoing.set(cell.source.cellId, list);
      }
      if ('cellId' in cell.target) {
        const list = incoming.get(cell.target.cellId) ?? [];
        list.push(cell.id);
        incoming.set(cell.target.cellId, list);
      }
    }
  });
  return {
    parentOf,
    orderOf,
    groupOf,
    domainOwnerOf,
    incoming,
    outgoing,
  };
};

/** Update topology from actual changes; content and geometry edits retain identity. */
export const updateCellIndex = (
  before: CellStore,
  after: CellStore,
  previous: CellIndex,
  registry?: CellRegistry,
): CellIndex => {
  const topology = (cell: Cell | undefined) =>
    !cell
      ? null
      : [
          cell.cellType,
          isFrameCell(cell) ? [cell.children, cell.groups] : null,
          listedMembers(cell, registry),
          isEdgeCell(cell)
            ? [
                'cellId' in cell.source ? cell.source.cellId : null,
                'cellId' in cell.target ? cell.target.cellId : null,
              ]
            : null,
        ];
  const changed = changedCellIds(before, after).filter(
    (id) =>
      JSON.stringify(topology(before.cells[id])) !==
      JSON.stringify(topology(after.cells[id])),
  );
  if (!changed.length) return previous;
  const next: CellIndex = {
    parentOf: new Map(previous.parentOf),
    orderOf: new Map(previous.orderOf),
    groupOf: new Map(previous.groupOf),
    domainOwnerOf: new Map(previous.domainOwnerOf),
    incoming: new Map(previous.incoming),
    outgoing: new Map(previous.outgoing),
  };
  const neighborKeys = new Map<Map<CellId, CellId[]>, Set<CellId>>([
    [next.incoming, new Set()],
    [next.outgoing, new Set()],
  ]);
  const apply = (cell: Cell | undefined, adding: boolean) => {
    if (!cell) return;
    if (isFrameCell(cell)) {
      if (adding) next.orderOf.set(cell.id, [...cell.children]);
      else next.orderOf.delete(cell.id);
      for (const id of [...cell.children, ...cell.groups])
        if (adding) next.parentOf.set(id, cell.id);
        else if (next.parentOf.get(id) === cell.id) next.parentOf.delete(id);
    }
    for (const id of listedMembers(cell, registry)) {
      const map = isGroupCell(cell) ? next.groupOf : next.domainOwnerOf;
      if (adding) map.set(id, cell.id);
      else if (map.get(id) === cell.id) map.delete(id);
    }
    if (isEdgeCell(cell))
      for (const [terminal, map] of [
        [cell.source, next.outgoing],
        [cell.target, next.incoming],
      ] as const) {
        if (!('cellId' in terminal)) continue;
        neighborKeys.get(map)!.add(terminal.cellId);
        const list = (map.get(terminal.cellId) ?? []).filter(
          (id) => id !== cell.id,
        );
        if (adding) list.push(cell.id);
        if (list.length) map.set(terminal.cellId, list);
        else map.delete(terminal.cellId);
      }
  };
  changed.forEach((id) => apply(before.cells[id], false));
  changed.forEach((id) => apply(after.cells[id], true));
  const rank = new Map(
    Object.keys(after.cells).map((id, order) => [id, order]),
  );
  for (const [map, keys] of neighborKeys)
    for (const id of keys) {
      const list = map.get(id);
      if (list)
        map.set(
          id,
          [...list].sort((a, b) => rank.get(a)! - rank.get(b)!),
        );
    }
  return next;
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
  registry?: CellRegistry,
  mutable = false,
): CellStore => {
  const cells = mutable ? store.cells : { ...store.cells };
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
    for (const plugin of registry?.plugins ?? [])
      for (const id of plugin.deletionClosure?.(store, removed) ?? [])
        if (!removing.includes(id)) removing.push(id);
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
        registry?.get(cell.kind)?.retainOnSourceDeletion !== true) ||
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
  options?: { ignoreLock?: boolean; registry?: CellRegistry },
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
    selected.some((id) => cellDeletionLocked(store, id, options?.registry))
  )
    throw new Error('Cannot delete locked content');
  let candidate = store;
  const operations: CellOperation[] = [];
  for (const cellId of new Set(selected)) {
    if (!candidate.cells[cellId]) continue;
    const operation: CellOperation = { type: 'remove_cell', cellId };
    candidate = applyUnchecked(candidate, operation, options?.registry);
    operations.push(operation);
  }
  return operations;
};

const memberIdsOf = (
  cell: Cell,
  registry?: CellRegistry,
): readonly CellId[] | undefined => {
  if (isGroupCell(cell)) {
    return cell.members;
  }
  return registry?.get(cell.kind)?.members?.(cell);
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
const normalizeRelations = (
  before: CellStore,
  store: CellStore,
  registry: CellRegistry,
): CellStore => {
  const cells = { ...store.cells };
  const index = indexCells(store);
  Object.values(cells).forEach((cell) => {
    if (isFrameCell(cell))
      cells[cell.id] = pruneFrameRelations(cell, before, store, cells);
    const members = memberIdsOf(cell, registry);
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
        cells[cell.id] =
          registry.get(cell.kind)?.withMembers?.(cell, next) ?? cell;
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
  const context = registry ?? createCellRegistry();
  assertRegisteredCellKinds(store, context);
  let candidate = operations.reduce(
    (next, operation) => applyUnchecked(next, operation, context, true),
    { ...store, cells: { ...store.cells } },
  );
  assertRegisteredCellKinds(candidate, context);
  candidate = normalizeRelations(store, candidate, context);
  for (const plugin of context.plugins)
    candidate = plugin.normalize?.(store, candidate) ?? candidate;
  candidate = normalizeRelations(store, candidate, context);
  for (const plugin of context.plugins) {
    const error = plugin.validateTransaction?.(store, candidate);
    if (error) throw new Error(error);
  }
  for (const scene of context.scenes) {
    if (!scene.preserveAnchor) continue;
    for (const cell of Object.values(store.cells)) {
      if (!isFrameCell(cell) || !candidate.cells[cell.id]) continue;
      const hadAnchor = cell.children.some((id) =>
        scene.anchorKinds.includes(store.cells[id]?.kind),
      );
      const next = candidate.cells[cell.id];
      if (
        hadAnchor &&
        isFrameCell(next) &&
        !next.children.some((id) =>
          scene.anchorKinds.includes(candidate.cells[id]?.kind),
        )
      )
        throw new Error('Cannot delete the last scene anchor');
    }
  }
  candidate = normalizeCellRoutes(stripFrameViewports(candidate), context);
  const issues = validateCellStore(candidate, context);
  if (issues.length)
    throw new Error(issues.map((issue) => issue.message).join('; '));
  preparedCandidates.set(candidate, {
    before: new WeakRef(store),
    registry: context,
    operations: [...operations],
    fingerprint: JSON.stringify(operations),
  });
  return candidate;
};

const preparedCandidates = new WeakMap<
  CellStore,
  {
    before: WeakRef<CellStore>;
    registry: CellRegistry;
    operations: readonly CellOperation[];
    fingerprint: string;
  }
>();
/** Only candidates produced by the validated pipeline can bypass preparation. */
export const resolvePreparedCellOperations = (
  before: CellStore,
  operations: readonly CellOperation[],
  registry: CellRegistry,
  prepared?: CellStore,
): CellStore => {
  let cursor = prepared;
  const batches: (readonly CellOperation[])[] = [];
  while (cursor && cursor !== before) {
    const record = preparedCandidates.get(cursor);
    if (
      !record ||
      record.registry !== registry ||
      record.fingerprint !== JSON.stringify(record.operations)
    )
      break;
    batches.unshift(record.operations);
    cursor = record.before.deref();
  }
  const reusable =
    prepared &&
    cursor === before &&
    JSON.stringify(batches.flat()) === JSON.stringify(operations);
  if (reusable) {
    preparedCandidates.delete(prepared);
    return prepared;
  }
  const result = applyCellOperations(before, operations, registry);
  preparedCandidates.delete(result);
  return result;
};

export const applyCellOperation = (
  store: CellStore,
  operation: CellOperation,
  registry?: CellRegistry,
): CellStore => applyCellOperations(store, [operation], registry);

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

const cellDiffs = new WeakMap<
  CellStore,
  {
    before: WeakRef<CellStore>;
    diff: {
      forward: { type: 'patch_cells'; cells: Record<CellId, Cell | null> };
      inverse: { type: 'patch_cells'; cells: Record<CellId, Cell | null> };
    };
  }
>();
export const changedCellIds = (
  before: CellStore,
  after: CellStore,
): readonly CellId[] => Object.keys(diffCells(before, after).forward.cells);
const diffCells = (before: CellStore, after: CellStore) => {
  const cached = cellDiffs.get(after);
  if (cached?.before.deref() === before) return cached.diff;
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
  const diff = {
    forward: { type: 'patch_cells' as const, cells: forward },
    inverse: { type: 'patch_cells' as const, cells: inverse },
  };
  cellDiffs.set(after, { before: new WeakRef(before), diff });
  return diff;
};

export const commitCellOperations = (
  store: CellStore,
  history: CellHistory,
  operations: readonly CellOperation[],
  registry?: CellRegistry,
  options?: { restoreView?: boolean; prepared?: CellStore },
) => {
  const next = registry
    ? resolvePreparedCellOperations(
        store,
        operations,
        registry,
        options?.prepared,
      )
    : applyCellOperations(store, operations, registry);
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
    store: entry.inverse.reduce(
      (next, operation) => applyUnchecked(next, operation),
      store,
    ),
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
    store: entry.forward.reduce(
      (next, operation) => applyUnchecked(next, operation),
      store,
    ),
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
  labelLayout?: (
    edge: EdgeCell,
    index: number,
    points: readonly Point[],
  ) => import('../geometry/edge-label').EdgeLabelLayout | undefined;
  members?: (cell: Cell) => readonly CellId[];
  /** Spatial containers opt in; domain owners such as workflow starts do not. */
  moveMembers?: boolean;
  planDrop?: (
    store: CellStore,
    ids: readonly CellId[],
    operations: readonly CellOperation[],
    registry: CellRegistry,
  ) => CellOperation[];
  withMembers?: (cell: Cell, ids: readonly CellId[]) => Cell;
  fitText?: boolean;
  copyWithEndpoints?: boolean;
  translateable?: boolean;
  routingObstacle?: boolean;
  routingObstacles?: (
    cell: Cell,
    geometry?: NodeGeometry,
  ) => readonly import('../geometry/obstacle-route').RoutingObstacle[];
  translate?: (cell: Cell, delta: Point) => Cell;
  retainOnSourceDeletion?: boolean;
  groupable?: boolean;
  arrangeable?: boolean;
  routable?: boolean;
  orthogonalRoute?: boolean;
  lanes?: (cell: Cell) => readonly import('./lanes').CellLane[];
  withLaneMembers?: (cell: Cell, tracks: ReadonlyMap<string, string[]>) => Cell;
  growLanes?: (
    cell: Cell,
    bounds: ReadonlyMap<string, RectangleClient>,
  ) => Cell;
  preferredPortSide?: (
    node: NodeGeometry,
    other: NodeGeometry,
    end: 'source' | 'target',
  ) => import('../port').PortSide;
  freeTerminals?: boolean;
  ownerKind?: string;
  canConnect?: (node: Cell) => boolean;
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
  /** Domain-owned cells such as a lone task or module need a valid owner. */
  requiresPasteOwner?: (
    cell: Cell,
    fragment: { cells: Record<string, Cell> },
  ) => boolean;
  /** Spatial members can preserve a captured owner or accept a selected one. */
  optionalPasteOwner?: (
    cell: Cell,
    fragment: { cells: Record<string, Cell> },
  ) => boolean;
  preferSelectedPasteOwner?: boolean;
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

export const listedMembers = (cell: Cell, registry?: CellRegistry) =>
  memberIdsOf(cell, registry) ?? [];
