import { memoizeCellValidationRead } from './validation-read-context';
import {
  createEdgeRoutingContext,
  edgePolyline,
  flattenCurve,
  type EdgeRoutingContext,
} from '../geometry/edge';
import type { RectangleClient } from '../interfaces/rectangle-client';
import { createCellRegistry, type CellRegistry } from './registry';
import {
  isEdgeCell,
  isFrameCell,
  isFrameReferenceCell,
  isGroupCell,
  isNodeCell,
  type CellId,
  type CellStore,
  type NodeGeometry,
} from './types';

/** A calculation-scoped hierarchy. Recreate after changing the store; no global cache. */
export interface CellHierarchy {
  readonly groupOf: ReadonlyMap<CellId, CellId>;
  readonly parentOf: ReadonlyMap<CellId, CellId>;
  groupAncestors(id: CellId): CellId[];
  lockedByAncestor(id: CellId): boolean;
}

export function createCellHierarchy(
  store: CellStore,
  index?: Pick<CellHierarchy, 'groupOf' | 'parentOf'>,
): CellHierarchy {
  const groups = new Map<CellId, CellId>();
  const frames = new Map<CellId, CellId>();
  if (!index)
    for (const cell of Object.values(store.cells)) {
      if (isGroupCell(cell))
        for (const id of cell.members)
          if (!groups.has(id)) groups.set(id, cell.id);
      if (isFrameCell(cell))
        for (const id of [...cell.children, ...cell.groups])
          if (!frames.has(id)) frames.set(id, cell.id);
    }
  const groupOf = index?.groupOf ?? groups;
  const parentOf = index?.parentOf ?? frames;
  const locks = new Map<CellId, boolean>();
  const locked = (
    id: CellId,
    seen: Set<CellId>,
    state: { cyclic: boolean },
  ): boolean => {
    if (seen.has(id)) {
      state.cyclic = true;
      return false;
    }
    const cached = locks.get(id);
    if (cached !== undefined) return cached;
    seen.add(id);
    const result = [groupOf.get(id), parentOf.get(id)].some(
      (owner) =>
        !!owner && (!!store.cells[owner]?.locked || locked(owner, seen, state)),
    );
    seen.delete(id);
    // A cycle can make a negative result depend on the current traversal path.
    if (result || !state.cyclic) locks.set(id, result);
    return result;
  };
  return {
    groupOf,
    parentOf,
    groupAncestors(id) {
      const ancestors: CellId[] = [],
        seen = new Set<CellId>();
      let owner = groupOf.get(id);
      while (owner && !seen.has(owner)) {
        seen.add(owner);
        ancestors.push(owner);
        owner = groupOf.get(owner);
      }
      return ancestors;
    },
    lockedByAncestor: (id) => locked(id, new Set(), { cyclic: false }),
  };
}

const hierarchyRead = Symbol('validation-hierarchy');
const validationHierarchy = (store: CellStore) =>
  memoizeCellValidationRead<CellHierarchy | undefined>(
    store,
    hierarchyRead,
    () => createCellHierarchy(store),
    () => undefined,
  );

/** Direct membership only. Nested groups stay registered on the owning frame. */
export const groupLeafMembers = (
  store: CellStore,
  id: CellId,
  seen = new Set<string>(),
): CellId[] => {
  if (seen.has(id)) return [];
  seen.add(id);
  const cell = store.cells[id];
  if (!cell) return [];
  if (!isGroupCell(cell)) return [id];
  return cell.members.flatMap((member) =>
    groupLeafMembers(store, member, seen),
  );
};

export const directGroupOf = (
  store: CellStore,
  id: CellId,
): CellId | undefined =>
  Object.values(store.cells).find(
    (cell) => isGroupCell(cell) && cell.members.includes(id),
  )?.id;

export const groupAncestors = (store: CellStore, id: CellId): CellId[] => {
  const hierarchy = validationHierarchy(store);
  if (hierarchy) return hierarchy.groupAncestors(id);
  const ancestors: CellId[] = [];
  const seen = new Set<string>();
  let owner = directGroupOf(store, id);
  while (owner && !seen.has(owner)) {
    seen.add(owner);
    ancestors.push(owner);
    owner = directGroupOf(store, owner);
  }
  return ancestors;
};

export const groupHasLockedLeaf = (
  store: CellStore,
  id: CellId,
  seen = new Set<string>(),
): boolean => {
  if (seen.has(id)) return false;
  seen.add(id);
  const cell = store.cells[id];
  if (!cell) return false;
  if (cell.locked) return true;
  if (!isGroupCell(cell)) return false;
  return cell.members.some((member) => groupHasLockedLeaf(store, member, seen));
};

export const lockedByAncestor = (store: CellStore, id: CellId): boolean => {
  const hierarchy = validationHierarchy(store);
  if (hierarchy) return hierarchy.lockedByAncestor(id);
  const seen = new Set<string>();
  const visit = (childId: string): boolean => {
    if (seen.has(childId)) return false;
    seen.add(childId);
    const group = directGroupOf(store, childId);
    const frame = Object.values(store.cells).find(
      (cell) =>
        isFrameCell(cell) &&
        [...cell.children, ...cell.groups].includes(childId),
    );
    return [group, frame?.id].some(
      (owner) => !!owner && (!!store.cells[owner]?.locked || visit(owner)),
    );
  };
  return visit(id);
};

/** Deleting a structural owner must also respect locks on its cascaded contents. */
export const cellDeletionLocked = (
  store: CellStore,
  id: CellId,
  registry: CellRegistry = createCellRegistry(),
): boolean => {
  const seen = new Set<string>();
  const visit = (id: string): boolean => {
    if (seen.has(id)) return false;
    seen.add(id);
    const cell = store.cells[id];
    if (!cell) return false;
    if (cell.locked || lockedByAncestor(store, id)) return true;
    const members = isFrameCell(cell)
      ? [...cell.children, ...cell.groups]
      : isGroupCell(cell)
        ? cell.members
        : (registry.get(cell.kind)?.members?.(cell) ?? []);
    return [
      ...members,
      ...registry.plugins.flatMap((plugin) => [
        ...(plugin.references?.(cell) ?? []),
        ...(plugin.deletionClosure?.(store, cell) ?? []),
      ]),
    ].some(visit);
  };
  return visit(id);
};

export const geometryBounds = (g: NodeGeometry): RectangleClient => {
  const cos = Math.abs(Math.cos(g.rotation ?? 0));
  const sin = Math.abs(Math.sin(g.rotation ?? 0));
  const width = g.width * cos + g.height * sin;
  const height = g.width * sin + g.height * cos;
  return {
    x: g.x + (g.width - width) / 2,
    y: g.y + (g.height - height) / 2,
    width,
    height,
  };
};

export const unionCellBounds = (
  bounds: readonly RectangleClient[],
): RectangleClient | undefined => {
  if (!bounds.length) return undefined;
  const x = Math.min(...bounds.map((b) => b.x));
  const y = Math.min(...bounds.map((b) => b.y));
  return {
    x,
    y,
    width: Math.max(...bounds.map((b) => b.x + b.width)) - x,
    height: Math.max(...bounds.map((b) => b.y + b.height)) - y,
  };
};

/** Frames contribute their shells, groups their visible leaves and free connectors. */
export const cellArrangementBounds = (
  store: CellStore,
  id: CellId,
): RectangleClient | undefined => {
  const routing = new Map<CellId, EdgeRoutingContext>();
  let parents: Map<CellId, CellId> | undefined;
  const routeContext = (id: CellId) => {
    parents ??= new Map(
      Object.values(store.cells).flatMap((cell) =>
        isFrameCell(cell)
          ? cell.children.map((child) => [child, cell.id] as const)
          : [],
      ),
    );
    const frameId = parents.get(id);
    if (!frameId) return undefined;
    let context = routing.get(frameId);
    if (!context) {
      context = createEdgeRoutingContext(store, frameId);
      routing.set(frameId, context);
    }
    return context;
  };
  // Every arrow in this traversal shares its owning Frame's batch plan.
  // Keep the cache local so later edits cannot reuse stale obstacle geometry.
  const boundsOf = (id: CellId): RectangleClient | undefined => {
    const cell = store.cells[id];
    if (!cell || cell.hidden) return undefined;
    if (isGroupCell(cell))
      return unionCellBounds(
        groupLeafMembers(store, id).flatMap((leaf) => {
          const bounds = boundsOf(leaf);
          return bounds ? [bounds] : [];
        }),
      );
    if (isNodeCell(cell)) return geometryBounds(cell.geometry);
    if (isEdgeCell(cell)) {
      const automatic =
        (cell.route.mode === 'auto' || cell.route.mode === 'orthogonal') &&
        !('points' in cell.route && cell.route.points?.length);
      const route = edgePolyline(
        store,
        cell,
        undefined,
        automatic ? routeContext(cell.id) : undefined,
      );
      const points = cell.route.mode === 'curve' ? flattenCurve(route) : route;
      return unionCellBounds(
        points.map(([x, y]) => ({ x, y, width: 0, height: 0 })),
      );
    }
    return undefined;
  };
  return boundsOf(id);
};

export const groupBounds = (
  store: CellStore,
  id: CellId,
): RectangleClient | undefined => {
  return cellArrangementBounds(store, id);
};

export const isGroupableCell = (
  store: CellStore,
  id: CellId,
  registry: CellRegistry = createCellRegistry(),
): boolean => {
  const cell = store.cells[id];
  if (!cell) return false;
  if (isGroupCell(cell)) return true;
  if (isEdgeCell(cell)) return registry.get(cell.kind)?.groupable === true;
  return isNodeCell(cell) && registry.get(cell.kind)?.groupable !== false;
};

/** Resolve a leaf to the direct object in the current group/Frame focus. */
export const selectionObjectAtFocus = (
  store: CellStore,
  id: CellId,
  focusedId: CellId,
): CellId => {
  let current = id;
  for (const owner of groupAncestors(store, id)) {
    if (owner === focusedId) break;
    current = owner;
  }
  return current;
};

export const focusedCellIds = (
  store: CellStore,
  focusedId: CellId,
  hierarchy?: CellHierarchy,
): CellId[] => {
  let focused = store.cells[focusedId];
  if (isFrameReferenceCell(focused))
    focused = store.cells[focused.data.targetFrameId];
  if (isGroupCell(focused)) return focused.members;
  if (!isFrameCell(focused)) return [];
  const groups = (hierarchy ?? createCellHierarchy(store)).groupOf;
  return [...focused.children, ...focused.groups].filter(
    (id) => !groups.has(id),
  );
};
