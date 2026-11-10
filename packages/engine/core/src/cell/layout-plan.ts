import { resolveTerminal } from '../terminal/resolve';
import {
  arrangeCells,
  collectArrangementBlocks,
  type CellLayoutStyle,
} from './arrangement';
import { translateCellSelection } from './commands';
import { createEdgeRoutingContext, edgePolyline } from '../geometry/edge';
import { anchorFromPoint } from '../anchor';
import { isClearOrthogonalRoute } from '../geometry/obstacle-route';
import {
  frameGeometryScene,
  geometryPolicyFor,
  geometrySpacingFor,
  type GeometryPlanResult,
} from './geometry-policy';
import { frameScene } from './frame';
import {
  focusedCellIds,
  createCellHierarchy,
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
import { frameLanes, laneContains } from './lanes';
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

/** Tentative geometry may exceed a container while that container is being grown.
 * This is never a transaction candidate: the complete result is validated below. */
function layoutPreview(
  store: CellStore,
  operations: readonly CellOperation[],
): CellStore {
  const cells = { ...store.cells };
  for (const op of operations) {
    if (op.type !== 'replace_cell' || !cells[op.cell.id])
      throw new Error('Layout can only replace existing cells');
    cells[op.cell.id] = op.cell;
  }
  return { ...store, cells };
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
  const hierarchy = createCellHierarchy(store);
  return [...new Set(edgeIds)].sort().filter((id) => {
    const edge = store.cells[id];
    return (
      isEdgeCell(edge) &&
      !edge.hidden &&
      !edge.locked &&
      !hierarchy.lockedByAncestor(id) &&
      !hierarchy
        .groupAncestors(id)
        .some((owner) => store.cells[owner]?.hidden) &&
      registry.get(edge.kind)?.routable !== false &&
      !registry.scenes.some(
        (scene) =>
          scene.kinds.includes(edge.kind) &&
          scene.geometry &&
          scene.geometry.edgeRouting !== 'orthogonal',
      ) &&
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
  return planOptimizeEdges(store, edgeIds, registry).operations;
}

/** Explicit commands can replace authored points; background work owns generated paths only. */
export function planOptimizeEdges(
  store: CellStore,
  edgeIds: readonly CellId[],
  registry: CellRegistry = createCellRegistry(),
  options: { automatic?: boolean } = {},
): GeometryPlanResult {
  const ids = optimizableEdgeIds(store, edgeIds, registry).filter((id) => {
    const route = (store.cells[id] as import('./types').EdgeCell).route;
    return (
      !options.automatic ||
      route.origin === 'generated' ||
      !('points' in route && route.points?.length)
    );
  });
  if (!ids.length)
    return { status: 'success', operations: [], diagnostics: [] };
  const diagnostics: GeometryPlanResult['diagnostics'] = [];
  const targets = new Set(ids);
  const candidate = { ...store, cells: { ...store.cells } };
  for (const frame of Object.values(store.cells).filter(isFrameCell)) {
    const members = frame.children.filter((id) => targets.has(id));
    if (!members.length) continue;
    const current = createEdgeRoutingContext(
      store,
      frame.id,
      undefined,
      undefined,
      registry,
    );
    for (const id of members) {
      const edge = store.cells[id] as import('./types').EdgeCell;
      const points = edgePolyline(store, edge, undefined, current);
      const freeze = (end: 'source' | 'target') => {
        const terminal = edge[end];
        if (!('cellId' in terminal) || terminal.portId || terminal.anchor)
          return terminal;
        const actual = end === 'source' ? points[0] : points.at(-1)!;
        const raw = resolveTerminal(
          store,
          terminal,
          end === 'source' ? edge.target : edge.source,
          { geometry: current.geometry },
        );
        if (!raw) throw new Error('Missing edge endpoint');
        if (
          Math.hypot(actual[0] - raw.point[0], actual[1] - raw.point[1]) < 1e-6
        )
          return terminal;
        const n = store.cells[terminal.cellId] as import('./types').NodeCell;
        const g = current.geometry?.get(n.id) ?? n.geometry;
        return {
          ...terminal,
          anchor: anchorFromPoint(g, actual),
        };
      };
      candidate.cells[id] = {
        ...edge,
        source: freeze('source'),
        target: freeze('target'),
        route: { mode: 'auto' },
      };
    }
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
      const entry = context.routes.get(id);
      if (
        entry?.result.status === 'blocked' ||
        !entry ||
        !isClearOrthogonalRoute(
          points,
          entry.source.side,
          entry.target.side,
          context.obstacles,
          {
            sourceId: 'cellId' in edge.source ? edge.source.cellId : undefined,
            targetId: 'cellId' in edge.target ? edge.target.cellId : undefined,
            visualGap: context.visualGap,
            terminalRun: context.terminalRun,
            allowFreeTerminalDirections: true,
            strokeWidth: edge.appearance?.strokeWidth,
          },
        )
      ) {
        const reason = entry?.result.reason;
        diagnostics.push({
          code:
            reason === 'search-budget'
              ? 'routing.budget'
              : reason === 'terminal-blocked'
                ? 'routing.terminal-blocked'
                : 'routing.clearance',
          frameId: frame.id,
          sceneId: frameGeometryScene(store, frame.id, registry)?.id,
          cellIds: [id],
          message:
            reason === 'search-budget'
              ? 'Routing search budget exhausted; the original path was retained.'
              : 'No route meeting the painted node clearance was found; the original path was retained.',
        });
        continue;
      }
      const route = {
        mode: 'orthogonal' as const,
        origin: 'generated' as const,
        points: points.map((p) => [...p] as [number, number]),
      };
      const cell = { ...edge, route };
      if (JSON.stringify(store.cells[id]) !== JSON.stringify(cell))
        operations.push({ type: 'replace_cell', cell });
    }
  }
  return {
    status: diagnostics.length
      ? diagnostics.length === ids.length
        ? 'blocked'
        : 'partial'
      : 'success',
    operations,
    diagnostics,
  };
}

/** Compute and validate the complete candidate before any transaction is sent. */
export function planCellLayout(
  store: CellStore,
  selection: CellSelection,
  style: CellLayoutStyle,
  registry: CellRegistry = createCellRegistry(),
): CellOperation[] {
  return planGeometryLayout(store, selection, style, registry).operations;
}

/** Joint placement/routing planner. A failed corridor is fed back into spacing;
 * only a complete candidate is returned, so callers commit a single undo step. */
export function planGeometryLayout(
  store: CellStore,
  selection: CellSelection,
  style: CellLayoutStyle,
  registry: CellRegistry = createCellRegistry(),
  options: { automatic?: boolean; maxAttempts?: number } = {},
): GeometryPlanResult {
  const scope = resolveCellArrangementScope(store, selection);
  const policy = geometryPolicyFor(store, scope.frameId, registry);
  if (style === 'domain') style = policy.defaultStyle ?? 'relationships';
  const sceneId = frameGeometryScene(store, scope.frameId, registry)?.id;
  if (policy.nodeLayout === 'none')
    return {
      status: 'blocked',
      operations: [],
      diagnostics: [
        {
          code: 'geometry.domain-managed',
          message:
            'This scene owns its geometry; generic layout is unavailable.',
          frameId: scope.frameId,
          sceneId,
          cellIds: scope.ids,
        },
      ],
    };
  const edgeIds = arrangementEdgeIds(store, selection);
  if (
    !scope.ids.length ||
    (policy.nodeLayout === 'core' &&
      collectArrangementBlocks(
        store,
        scope.frameId,
        scope.ids,
        registry,
      ).filter((b) => !b.locked).length < (edgeIds.length ? 1 : 2))
  )
    return { status: 'success', operations: [], diagnostics: [] };
  let diagnostics: GeometryPlanResult['diagnostics'] = [];
  // Demand grows with fan-in/out, before routing is attempted. Later passes
  // monotonically enlarge channels; they never relax the visual safety gap.
  const degree = new Map<string, number>();
  for (const id of edgeIds) {
    const e = store.cells[id];
    if (!isEdgeCell(e)) continue;
    for (const t of [e.source, e.target])
      if ('cellId' in t) degree.set(t.cellId, (degree.get(t.cellId) ?? 0) + 1);
  }
  const baseSpacing = geometrySpacingFor(policy);
  const demand = Math.max(
    1,
    (Math.max(0, ...degree.values()) * baseSpacing.laneGap) /
      baseSpacing.nodeGap,
  );
  const attempts = Math.max(1, Math.min(8, options.maxAttempts ?? 6));
  for (let attempt = 0; attempt < attempts; attempt++) {
    const expansion = demand * 2 ** attempt;
    const context = {
      store,
      frameId: scope.frameId,
      selection,
      style,
      registry,
      spacing: geometrySpacingFor(policy, expansion),
      expansion,
    };
    const invalid = policy.validate?.(context) ?? [];
    if (invalid.length)
      return { status: 'blocked', operations: [], diagnostics: [...invalid] };
    const fixedIds = new Set(policy.fixedNodeIds?.(context) ?? []);
    try {
      const placement =
        policy.planLayout?.(context) ??
        planNodeLayout(
          store,
          selection,
          style,
          registry,
          context.spacing.nodeGap,
          context.spacing.rankGap,
          true,
        );
      let candidate = layoutPreview(store, placement);
      const units = policy.resolveLayoutUnits?.(context) ?? [];
      const scopedBlocks = collectArrangementBlocks(
        store,
        scope.frameId,
        scope.ids,
        registry,
      ).map((block) => ({
        ...block,
        locked: block.locked || block.members.some((id) => fixedIds.has(id)),
      }));
      // Move only scoped, unlocked blocks to a roomy corridor when local retries fail.
      if (
        attempt === attempts - 1 &&
        !frameLanes(store, scope.frameId, registry).length
      ) {
        const movable = scopedBlocks.filter((b) => !b.locked);
        const members = new Set(movable.flatMap((b) => b.members));
        const fixed = createEdgeRoutingContext(
          store,
          scope.frameId,
          undefined,
          undefined,
          registry,
        ).obstacles.filter(
          (b) => isNodeCell(store.cells[b.id]) && !members.has(b.id),
        );
        const bounds = unionCellBounds(
          movable.flatMap((b) =>
            b.members.flatMap((id) => {
              const n = candidate.cells[id];
              return isNodeCell(n) ? [geometryBounds(n.geometry)] : [];
            }),
          ),
        );
        if (fixed.length && bounds) {
          const dx = Math.max(
            0,
            Math.max(...fixed.map((b) => b.x + b.width)) +
              context.spacing.rankGap -
              bounds.x,
          );
          if (dx)
            candidate = layoutPreview(
              candidate,
              movable.flatMap((b) =>
                translateCellSelection(candidate, [b.id], [dx, 0], registry),
              ),
            );
        }
      }
      const packed: import('../interfaces/rectangle-client').RectangleClient[] =
        [];
      for (const unit of units) {
        const blocks = scopedBlocks.filter((b) =>
          b.members.some((id) => unit.nodeIds.includes(id)),
        );
        if (!blocks.length) continue;
        const selected = new Set(blocks.flatMap((b) => b.members));
        const bounds = unionCellBounds(
          unit.nodeIds.flatMap((id) => {
            const n = candidate.cells[id];
            return isNodeCell(n) ? [geometryBounds(n.geometry)] : [];
          }),
        );
        if (!bounds) continue;
        if (
          unit.nodeIds.every((id) => selected.has(id)) &&
          blocks.every((b) => !b.locked)
        ) {
          let dy = 0;
          for (const previous of packed)
            if (
              Math.min(previous.x + previous.width, bounds.x + bounds.width) >
                Math.max(previous.x, bounds.x) &&
              Math.min(
                previous.y + previous.height,
                bounds.y + dy + bounds.height,
              ) > Math.max(previous.y, bounds.y + dy)
            )
              dy =
                previous.y +
                previous.height +
                context.spacing.nodeGap -
                bounds.y;
          if (dy)
            candidate = layoutPreview(
              candidate,
              blocks.flatMap((b) =>
                translateCellSelection(candidate, [b.id], [0, dy], registry),
              ),
            );
          packed.push({ ...bounds, y: bounds.y + dy });
        } else packed.push(bounds);
      }
      for (let pass = 0; pass < 3; pass++) {
        const growth: CellOperation[] = [];
        const demands = new Map<
          string,
          Map<string, import('../interfaces/rectangle-client').RectangleClient>
        >();
        for (const lane of frameLanes(candidate, scope.frameId, registry)) {
          const bounds = unionCellBounds(
            lane.members.flatMap((id) => {
              const n = candidate.cells[id];
              return isNodeCell(n) ? [geometryBounds(n.geometry)] : [];
            }),
          );
          if (!bounds || laneContains(lane.bounds, bounds)) continue;
          const owner = candidate.cells[lane.containerId];
          if (
            owner.locked ||
            lockedByAncestor(candidate, owner.id) ||
            (scope.kind !== 'frame' && !scope.ids.includes(owner.id))
          )
            throw new Error(
              'Fixed or out-of-scope swimlane prevents expansion',
            );
          let tracks = demands.get(owner.id);
          if (!tracks) demands.set(owner.id, (tracks = new Map()));
          tracks.set(lane.id, bounds);
        }
        for (const [id, tracks] of demands) {
          const c = candidate.cells[id],
            grow = registry.get(c.kind)?.growLanes;
          if (!grow)
            throw new Error('Container does not support track expansion');
          growth.push({ type: 'replace_cell', cell: grow(c, tracks) });
        }
        if (!growth.length) break;
        candidate = layoutPreview(candidate, growth);
      }
      candidate = applyCellOperations(
        store,
        Object.keys(candidate.cells)
          .filter(
            (id) =>
              JSON.stringify(candidate.cells[id]) !==
              JSON.stringify(store.cells[id]),
          )
          .map((id) => ({ type: 'replace_cell', cell: candidate.cells[id] })),
        registry,
      );
      for (const id of fixedIds)
        if (
          JSON.stringify(
            (store.cells[id] as import('./types').NodeCell)?.geometry,
          ) !==
          JSON.stringify(
            (candidate.cells[id] as import('./types').NodeCell)?.geometry,
          )
        )
          throw new Error('Locked domain container restricts member placement');
      // The spatial index bounds the final overlap check on large scenes.
      const checking = createEdgeRoutingContext(
        candidate,
        scope.frameId,
        undefined,
        undefined,
        registry,
      );
      const byId = new Map(checking.obstacles.map((box) => [box.id, box]));
      const hierarchy = createCellHierarchy(candidate);
      const movedIds = new Set(
        checking.obstacles
          .filter(
            (box) =>
              isNodeCell(candidate.cells[box.id]) &&
              JSON.stringify(
                (store.cells[box.id] as import('./types').NodeCell)?.geometry,
              ) !==
                JSON.stringify(
                  (candidate.cells[box.id] as import('./types').NodeCell)
                    ?.geometry,
                ),
          )
          .map((box) => box.id),
      );
      for (const a of checking.obstacles) {
        if (!movedIds.has(a.id)) continue;
        const ancestors = hierarchy.groupAncestors(a.id);
        for (const id of checking.queryObstacles?.(a) ?? [...byId.keys()]) {
          const b = byId.get(id)!;
          if (a.id === b.id || (movedIds.has(b.id) && a.id >= b.id)) continue;
          if (
            ancestors.some((owner) =>
              hierarchy.groupAncestors(b.id).includes(owner),
            )
          )
            continue;
          if (
            Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) &&
            Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y)
          )
            throw new Error('layout-overlap');
        }
      }
      const routes =
        policy.edgeRouting === 'orthogonal'
          ? planOptimizeEdges(candidate, edgeIds, registry, options)
          : { status: 'success' as const, operations: [], diagnostics: [] };
      if (routes.status === 'success') {
        const final = applyCellOperations(
          candidate,
          routes.operations,
          registry,
        );
        return {
          status: 'success',
          operations: Object.keys(final.cells)
            .filter(
              (id) =>
                JSON.stringify(final.cells[id]) !==
                JSON.stringify(store.cells[id]),
            )
            .map((id) => ({ type: 'replace_cell', cell: final.cells[id] })),
          diagnostics: [],
        };
      }
      diagnostics = routes.diagnostics;
    } catch (error) {
      diagnostics = [
        {
          code: 'layout.constraints',
          message: error instanceof Error ? error.message : String(error),
          frameId: scope.frameId,
          sceneId,
          cellIds: scope.ids,
        },
      ];
    }
  }
  return {
    status: 'blocked',
    operations: [],
    diagnostics: diagnostics.map((d) => ({
      ...d,
      message: `${d.message} Placement/routing retry budget exhausted; check fixed objects and scope constraints.`,
    })),
  };
}

/** Placement primitive for domain strategies. Does not route or commit. */
export function planNodeLayout(
  store: CellStore,
  selection: CellSelection,
  style: CellLayoutStyle,
  registry: CellRegistry = createCellRegistry(),
  gap = 32,
  rankGap?: number,
  transient = false,
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
    gap,
    registry,
    { rankGap, laneInset: Math.max(48, gap / 2) },
  );
  if (!operations.length) return [];
  let candidate = layoutPreview(store, operations);
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
  const laneMembers = new Set(
    frameLanes(store, scope.frameId, registry).flatMap((lane) => lane.members),
  );
  if (
    (delta[0] || delta[1]) &&
    !movable.some((block) => block.members.some((id) => laneMembers.has(id)))
  ) {
    const shifts = movable.flatMap((block) =>
      translateCellSelection(candidate, [block.id], delta, registry),
    );
    operations.push(...shifts);
    candidate = layoutPreview(candidate, shifts);
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
  if (transient)
    return changed.map((id) => ({
      type: 'replace_cell',
      cell: candidate.cells[id],
    }));
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
  if (!transient)
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
        if (!transient && x > 1e-6 && y > 1e-6)
          throw new Error('layout-overlap');
      }
    }
  return changed.map((id) => ({
    type: 'replace_cell',
    cell: candidate.cells[id],
  }));
}
