import {
  arrangeCells,
  collectArrangementBlocks,
  type CellLayoutStyle,
} from './arrangement';
import { translateCellSelection } from './commands';
import { createEdgeRoutingContext, edgePolyline } from '../geometry/edge';
import { frameScene } from './frame';
import {
  focusedCellIds,
  geometryBounds,
  groupAncestors,
  lockedByAncestor,
  unionCellBounds,
} from './group';
import {
  applyCellOperations,
  type CellOperation,
  type CellSelection,
} from './index';
import { createCellRegistry, type CellRegistry } from './registry';
import {
  isDocumentCell,
  isEdgeCell,
  isFrameCell,
  isFrameReferenceCell,
  isGroupCell,
  isNodeCell,
  type CellId,
  type CellStore,
} from './types';

export interface CellArrangementScope {
  frameId: CellId;
  containerId: CellId;
  ids: CellId[];
  kind: 'frame' | 'group' | 'selection';
}

/** Layout and routing share the same visible container/selection boundary. */
export function resolveCellArrangementScope(
  store: CellStore,
  selection: CellSelection,
): CellArrangementScope {
  const ownerId = (id: CellId) => {
    const cell = store.cells[id];
    return isFrameReferenceCell(cell) ? cell.data.targetFrameId : id;
  };
  const frameId =
    [...selection.focus]
      .reverse()
      .map(ownerId)
      .find((id) => isFrameCell(store.cells[id])) ?? store.rootId;
  const focusId = ownerId(selection.focus.at(-1) ?? frameId);
  const focus = store.cells[focusId];
  if (!isFrameCell(focus) && !isGroupCell(focus))
    throw new Error('Invalid arrangement scope');
  const available = new Set(focusedCellIds(store, focusId));
  if (selection.ids.some((id) => !available.has(id)))
    throw new Error('Arrangement crosses scope');
  const single =
    selection.ids.length === 1 ? store.cells[selection.ids[0]] : undefined;
  const containerId = isGroupCell(single) ? single.id : focusId;
  return {
    frameId,
    containerId,
    ids: store.cells[containerId]?.hidden
      ? []
      : isGroupCell(single) || !selection.ids.length
        ? focusedCellIds(store, containerId)
        : [...selection.ids],
    kind:
      isGroupCell(single) || (!selection.ids.length && isGroupCell(focus))
        ? 'group'
        : selection.ids.length
          ? 'selection'
          : 'frame',
  };
}

/** Include explicit edges and incident edges; a nested Frame is only a shell. */
export function arrangementEdgeIds(
  store: CellStore,
  selection: CellSelection,
): CellId[] {
  const scope = resolveCellArrangementScope(store, selection);
  const selected = new Set<CellId>();
  const visit = (id: CellId) => {
    const cell = store.cells[id];
    if (!cell || cell.hidden || selected.has(id)) return;
    selected.add(id);
    if (isGroupCell(cell)) cell.members.forEach(visit);
  };
  scope.ids.forEach(visit);
  const frame = store.cells[scope.frameId];
  if (!isFrameCell(frame)) return [];
  return frame.children
    .filter((id) => {
      const edge = store.cells[id];
      return (
        isEdgeCell(edge) &&
        !edge.hidden &&
        (selected.has(id) ||
          ('cellId' in edge.source && selected.has(edge.source.cellId)) ||
          ('cellId' in edge.target && selected.has(edge.target.cellId)))
      );
    })
    .sort();
}

/** Reset only authored orthogonal paths, retaining all terminal constraints. */
export function rerouteEdges(
  store: CellStore,
  edgeIds: readonly CellId[],
  registry: CellRegistry = createCellRegistry(),
): CellOperation[] {
  return [...new Set(edgeIds)].sort().flatMap((id): CellOperation[] => {
    const edge = store.cells[id];
    if (
      !isEdgeCell(edge) ||
      edge.hidden ||
      groupAncestors(store, id).some((owner) => store.cells[owner]?.hidden) ||
      edge.locked ||
      lockedByAncestor(store, id) ||
      registry.get(edge.kind)?.routable === false
    )
      return [];
    if (edge.route.mode === 'straight' || edge.route.mode === 'curve')
      return [];
    if (
      edge.route.mode !== 'fixed' &&
      !('points' in edge.route && edge.route.points?.length)
    )
      return [];
    return [
      {
        type: 'replace_cell',
        cell: {
          ...edge,
          route: {
            mode: edge.route.mode === 'fixed' ? 'auto' : edge.route.mode,
            ...('strategy' in edge.route && edge.route.strategy
              ? { strategy: edge.route.strategy }
              : {}),
          },
        },
      },
    ];
  });
}

/** Cheap eligibility for Actions; querying a button never plans routes. */
export function optimizableEdgeIds(
  store: CellStore,
  edgeIds: readonly CellId[],
  registry: CellRegistry = createCellRegistry(),
): CellId[] {
  return [...new Set(edgeIds)].sort().filter((id) => {
    const edge = store.cells[id];
    return (
      isEdgeCell(edge) &&
      !edge.hidden &&
      !edge.locked &&
      !lockedByAncestor(store, id) &&
      !groupAncestors(store, id).some((owner) => store.cells[owner]?.hidden) &&
      registry.get(edge.kind)?.routable !== false &&
      edge.route.mode !== 'straight' &&
      edge.route.mode !== 'curve'
    );
  });
}

/** One-shot planning writes editable paths, never a continuously running policy. */
export function optimizeEdges(
  store: CellStore,
  edgeIds: readonly CellId[],
  registry: CellRegistry = createCellRegistry(),
): CellOperation[] {
  const ids = optimizableEdgeIds(store, edgeIds, registry);
  if (!ids.length) return [];
  const targets = new Set(ids);
  const candidate = { ...store, cells: { ...store.cells } };
  for (const id of ids) {
    const edge = store.cells[id] as import('./types').EdgeCell;
    candidate.cells[id] = { ...edge, route: { mode: 'auto' } };
  }
  const operations: CellOperation[] = [];
  for (const frame of Object.values(candidate.cells).filter(isFrameCell)) {
    const members = frame.children.filter((id) => targets.has(id));
    if (!members.length) continue;
    const context = createEdgeRoutingContext(
      candidate,
      frame.id,
      undefined,
      undefined,
      registry,
      { optimizeIds: new Set(members), fixedTerminalIds: new Set(members) },
    );
    for (const id of members) {
      const edge = candidate.cells[id] as import('./types').EdgeCell;
      const points = edgePolyline(candidate, edge, undefined, context);
      if (context.routes.get(id)?.result.status === 'blocked') continue;
      const route = {
        mode: 'orthogonal' as const,
        points: points.map((p) => [...p] as [number, number]),
      };
      if (
        JSON.stringify(
          (store.cells[id] as import('./types').EdgeCell).route,
        ) !== JSON.stringify(route)
      )
        operations.push({ type: 'replace_cell', cell: { ...edge, route } });
    }
  }
  return operations;
}

/** Compute and validate the complete candidate before any transaction is sent. */
export function planCellLayout(
  store: CellStore,
  selection: CellSelection,
  style: CellLayoutStyle,
  registry: CellRegistry = createCellRegistry(),
): CellOperation[] {
  const scope = resolveCellArrangementScope(store, selection);
  // Empty explicit containers must never fall back to all Frame children.
  if (!scope.ids.length) return [];
  const specialized = registry.scenes
    .find((scene) =>
      scene.anchorKinds.includes(
        frameScene(store, scope.frameId, registry) ?? '',
      ),
    )
    ?.layouts?.some((layout) => layout.id === style);
  const blocks = collectArrangementBlocks(
    store,
    scope.frameId,
    scope.ids,
    registry,
  ).filter(
    (block) =>
      !groupAncestors(store, block.id).some(
        (owner) => store.cells[owner]?.hidden,
      ) &&
      (!specialized ||
        !block.members.some(
          (id) =>
            isDocumentCell(store.cells[id]) ||
            (store.cells[id]?.kind === 'geometry' &&
              (store.cells[id] as import('./types').NodeCell).geometry
                .outline === 'text'),
        )),
  );
  const movable = blocks.filter((block) => !block.locked);
  if (movable.length < 2) return [];
  const operations = arrangeCells(
    store,
    scope.frameId,
    blocks.map((block) => block.id),
    style,
    32,
    registry,
  );
  if (!operations.length) return [];
  let candidate = applyCellOperations(store, operations, registry);
  const origin = unionCellBounds(blocks.map((block) => block.bounds))!;
  const placed = unionCellBounds(
    collectArrangementBlocks(
      candidate,
      scope.frameId,
      movable.map((block) => block.id),
      registry,
    ).map((block) => block.bounds),
  )!;
  const delta: [number, number] = [
    Math.round(origin.x) - placed.x,
    Math.round(origin.y) - placed.y,
  ];
  if (delta[0] || delta[1]) {
    const shifts = movable.flatMap((block) =>
      translateCellSelection(candidate, [block.id], delta, registry),
    );
    operations.push(...shifts);
    candidate = applyCellOperations(candidate, shifts, registry);
  }
  const changed = [
    ...new Set(
      operations.flatMap((op) =>
        op.type === 'replace_cell' ? [op.cell.id] : [],
      ),
    ),
  ].filter(
    (id) =>
      JSON.stringify(store.cells[id]) !== JSON.stringify(candidate.cells[id]),
  );
  const blockOf = new Map(
    movable.flatMap((block) =>
      block.members.map((id) => [id, block.id] as const),
    ),
  );
  const moved = new Set(
    changed.filter((id) => {
      const before = store.cells[id],
        after = candidate.cells[id];
      return (
        isNodeCell(before) &&
        isNodeCell(after) &&
        JSON.stringify(before.geometry) !== JSON.stringify(after.geometry)
      );
    }),
  );
  const frame = candidate.cells[scope.frameId];
  const obstacles = isFrameCell(frame)
    ? frame.children.flatMap((id) => {
        const cell = candidate.cells[id];
        if (
          !isNodeCell(cell) ||
          cell.hidden ||
          groupAncestors(candidate, id).some(
            (owner) => candidate.cells[owner]?.hidden,
          ) ||
          registry.get(cell.kind)?.routingObstacle === false
        )
          return [];
        return [{ id, bounds: geometryBounds(cell.geometry) }];
      })
    : [];
  for (const a of obstacles) {
    if (!moved.has(a.id)) continue;
    for (const b of obstacles) {
      if (a.id === b.id) continue;
      // Contents of a rigid block may already overlap; only compare distinct blocks.
      if (blockOf.has(a.id) && blockOf.get(a.id) === blockOf.get(b.id))
        continue;
      const x =
        Math.min(a.bounds.x + a.bounds.width, b.bounds.x + b.bounds.width) -
        Math.max(a.bounds.x, b.bounds.x);
      const y =
        Math.min(a.bounds.y + a.bounds.height, b.bounds.y + b.bounds.height) -
        Math.max(a.bounds.y, b.bounds.y);
      if (x > 1e-6 && y > 1e-6) throw new Error('layout-overlap');
    }
  }
  return changed.map((id) => ({
    type: 'replace_cell',
    cell: candidate.cells[id],
  }));
}
