import { createSpatialIndex } from './spatial-index';
import type { RectangleClient } from '../interfaces/rectangle-client';
import {
  isOrthogonalPolyline,
  normalizeEdgeRoute,
} from '../cell/edge-route-policy';
import type { CellRegistry } from '../cell/registry';
import {
  isEdgeCell,
  isFrameCell,
  isNodeCell,
  type CellStore,
  type EdgeCell,
  type NodeGeometry,
  type PortSpec,
} from '../cell/types';
import type { Point } from '../interfaces/point';
import type { EdgeLabelLayout } from './edge-label';
import { nodeShapeGeometry } from './node';
import {
  routeOrthogonalAvoiding,
  routingSegmentPenalty,
  separateOrthogonalSegments,
  type OrthogonalRoutingResult,
  type RoutingObstacle,
  type RoutingSegment,
} from './obstacle-route';
import { polylinePath } from './polyline';
import { optimizeFrameRoutes } from './route-optimization';
import { routeOrthogonal, simplifyOrthogonal } from './route';
import {
  compactOrthogonalRoute,
  type CompactionRoute,
} from './route-compaction';
import {
  copyRoutingResult,
  routingBatches,
  sameRoutingResult,
} from './routing-cache';
import { facingSides, sideAnchor, type GeometrySide } from './side';

type TerminalPosition = { point: Point; side: GeometrySide };
export interface EdgeRoutingContext {
  /** Shared across equivalent contexts; entries contain pure derived geometry. */
  crossingsCache?: {
    signature?: string;
    value?: Map<string, import('./edge-intersections').EdgeJump[]>;
  };
  /** Explicit one-shot optimization; persisted route strategies never enable it. */
  readonly optimizeIds?: ReadonlySet<string>;
  readonly fixedTerminalIds?: ReadonlySet<string>;
  /** Interaction previews reuse settled paths and only adjust connected ends. */
  readonly preview?: EdgeRoutingContext;
  readonly registry?: CellRegistry;
  readonly obstacles: readonly RoutingObstacle[];
  readonly queryObstacles?: (bounds: RectangleClient) => readonly string[];
  readonly clearance?: number;
  /** Lazy frame-wide planning keeps all consumers independent of render order. */
  prepare?: () => void;
  labelLayouts?: Map<string, EdgeLabelLayout>;
  readonly terminals?: Map<
    string,
    {
      edge: EdgeCell;
      source: TerminalPosition;
      target: TerminalPosition;
      originalSource: TerminalPosition;
      originalTarget: TerminalPosition;
    }
  >;
  /** Derived only: never persisted in EdgeRoute or added to document history. */
  readonly routes: Map<
    string,
    {
      edge: EdgeCell;
      source: TerminalPosition;
      target: TerminalPosition;
      result: OrthogonalRoutingResult;
    }
  >;
}

/** Direct visible siblings share one coordinate system. Layer bands are
 * transparent containers; nested Frame shells remain obstacles in the parent. */
export const createEdgeRoutingContext = (
  store: CellStore,
  frameId: string,
  geometry?: ReadonlyMap<string, NodeGeometry>,
  previous?: EdgeRoutingContext,
  registry?: CellRegistry,
  options?: {
    optimizeIds?: ReadonlySet<string>;
    fixedTerminalIds?: ReadonlySet<string>;
    preview?: boolean;
  },
): EdgeRoutingContext => {
  const frame = store.cells[frameId];
  const obstacles: RoutingObstacle[] = [];
  if (isFrameCell(frame))
    for (const id of frame.children) {
      const node = store.cells[id];
      if (
        !isNodeCell(node) ||
        node.hidden ||
        registry?.get(node.kind)?.routingObstacle === false
      )
        continue;
      const g = geometry?.get(id) ?? node.geometry;
      if (
        ![g.x, g.y, g.width, g.height, g.rotation ?? 0].every(
          Number.isFinite,
        ) ||
        g.width <= 0 ||
        g.height <= 0
      )
        continue;
      const cos = Math.abs(Math.cos(g.rotation ?? 0)),
        sin = Math.abs(Math.sin(g.rotation ?? 0));
      const width = g.width * cos + g.height * sin,
        height = g.width * sin + g.height * cos;
      obstacles.push({
        id,
        x: g.x + (g.width - width) / 2,
        y: g.y + (g.height - height) / 2,
        width,
        height,
      });
    }
  obstacles.sort((a, b) => a.id.localeCompare(b.id));
  let obstacleIndex: ReturnType<typeof createSpatialIndex> | undefined;
  const context: EdgeRoutingContext = {
    obstacles,
    queryObstacles: (bounds) =>
      (obstacleIndex ??= createSpatialIndex(obstacles)).query(bounds),
    crossingsCache: previous?.crossingsCache ?? {},
    registry,
    routes: new Map(),
    clearance: previous?.clearance,
    terminals: new Map(),
    optimizeIds: options?.optimizeIds,
    fixedTerminalIds: options?.fixedTerminalIds,
    preview: options?.preview ? previous : undefined,
  };
  let prepared = false;
  context.prepare = () => {
    if (prepared) return;
    prepared = true;
    if (!options?.preview)
      planFrameRoutes(store, frameId, geometry, context, previous);
    // Retain only the current store and pure batch output after preparation.
    previous = undefined;
  };
  return context;
};

const automaticRoute = (edge: EdgeCell, registry?: CellRegistry) =>
  (edge.route.mode === 'auto' || edge.route.mode === 'orthogonal') &&
  !('points' in edge.route && edge.route.points?.length) &&
  registry?.get(edge.kind)?.routable !== false;

const sameTerminal = (a: TerminalPosition, b: TerminalPosition) =>
  a.side === b.side && a.point[0] === b.point[0] && a.point[1] === b.point[1];

function planFrameRoutes(
  store: CellStore,
  frameId: string,
  geometry: ReadonlyMap<string, NodeGeometry> | undefined,
  context: EdgeRoutingContext,
  previous?: EdgeRoutingContext,
) {
  const frame = store.cells[frameId];
  if (!isFrameCell(frame)) return;
  const edges = frame.children
    .map((id) => store.cells[id])
    .filter(
      (cell): cell is EdgeCell =>
        isEdgeCell(cell) &&
        !cell.hidden &&
        automaticRoute(cell, context.registry),
    );
  const crossingPenalty = context.registry?.scenes.some(
    (scene) =>
      !!scene.routing && edges.some((edge) => scene.kinds.includes(edge.kind)),
  )
    ? Math.max(
        160,
        Math.min(1600, 1600 * (48 / Math.max(1, edges.length)) ** 4),
      )
    : 160;
  const terminals = context.terminals!;
  type Exit = {
    edge: EdgeCell;
    end: 'source' | 'target';
    other: Point;
    side: GeometrySide;
  };
  const exits = new Map<string, Exit[]>();
  for (const edge of edges) {
    const source = edgeTerminalPosition(
      store,
      edge.source,
      edge.target,
      geometry,
    );
    const target = edgeTerminalPosition(
      store,
      edge.target,
      edge.source,
      geometry,
    );
    const preference = context.registry?.scenes
      .find((scene) => scene.kinds.includes(edge.kind))
      ?.routing?.(store, edge, geometry);
    const originalSource = source,
      originalTarget = target;
    const preferred = (
      end: 'source' | 'target',
      position: TerminalPosition,
    ): TerminalPosition => {
      const terminal = edge[end],
        side = preference?.[end];
      if (
        context.fixedTerminalIds?.has(edge.id) ||
        !side ||
        !('cellId' in terminal) ||
        terminal.portId ||
        terminal.anchor
      )
        return position;
      const node = store.cells[terminal.cellId];
      if (
        !isNodeCell(node) ||
        (geometry?.get(node.id) ?? node.geometry).rotation
      )
        return position;
      return portAnchor(geometry?.get(node.id) ?? node.geometry, { side });
    };
    const plannedSource = preferred('source', source),
      plannedTarget = preferred('target', target);
    terminals.set(edge.id, {
      edge,
      source: plannedSource,
      target: plannedTarget,
      originalSource,
      originalTarget,
    });
    for (const end of ['source', 'target'] as const) {
      const terminal = edge[end];
      if (
        context.fixedTerminalIds?.has(edge.id) ||
        !('cellId' in terminal) ||
        terminal.portId ||
        terminal.anchor
      )
        continue;
      const node = store.cells[terminal.cellId];
      if (
        !isNodeCell(node) ||
        (geometry?.get(node.id) ?? node.geometry).rotation
      )
        continue;
      const position = end === 'source' ? plannedSource : plannedTarget;
      const key = `${terminal.cellId}:${position.side}`;
      const list = exits.get(key) ?? [];
      list.push({
        edge,
        end,
        other: end === 'source' ? target.point : source.point,
        side: position.side,
      });
      exits.set(key, list);
    }
  }
  // A short node side cannot accommodate arbitrarily many arrowheads.
  for (const [, list] of [...exits].sort(([a], [b]) => a.localeCompare(b))) {
    const terminal = list[0].edge[list[0].end];
    if (!('cellId' in terminal)) continue;
    const node = store.cells[terminal.cellId];
    if (!isNodeCell(node)) continue;
    const bounds = geometry?.get(node.id) ?? node.geometry;
    const verticalSide = list[0].side === 'left' || list[0].side === 'right';
    const size = verticalSide ? bounds.height : bounds.width;
    const capacity = Math.max(1, Math.floor((size - 32) / 16) + 1);
    if (list.length <= capacity) continue;
    const axis = verticalSide ? 1 : 0;
    list.sort(
      (a, b) =>
        a.other[axis] - b.other[axis] || a.edge.id.localeCompare(b.edge.id),
    );
    for (const exit of list.splice(capacity)) {
      const candidates: GeometrySide[] = verticalSide
        ? ['top', 'bottom']
        : ['left', 'right'];
      candidates.sort(
        (a, b) =>
          (exits.get(`${terminal.cellId}:${a}`)?.length ?? 0) -
          (exits.get(`${terminal.cellId}:${b}`)?.length ?? 0),
      );
      const side = candidates[0],
        nextKey = `${terminal.cellId}:${side}`;
      const next = exits.get(nextKey) ?? [];
      next.push({ ...exit, side });
      exits.set(nextKey, next);
      terminals.get(exit.edge.id)![exit.end] = portAnchor(bounds, { side });
    }
  }
  for (const list of exits.values()) {
    if (list.length < 2) continue;
    const axis = list[0].side === 'top' || list[0].side === 'bottom' ? 0 : 1;
    list.sort(
      (a, b) =>
        a.other[axis] - b.other[axis] ||
        a.other[1 - axis] - b.other[1 - axis] ||
        a.edge.id.localeCompare(b.edge.id),
    );
    list.forEach(({ edge, end, side }, at) => {
      const terminal = edge[end];
      if (!('cellId' in terminal)) return;
      const node = store.cells[
        terminal.cellId
      ] as import('../cell/types').NodeCell;
      const bounds = geometry?.get(node.id) ?? node.geometry;
      terminals.get(edge.id)![end] = portAnchor(bounds, {
        side,
        offset: (() => {
          const size = axis === 0 ? bounds.width : bounds.height;
          const padding = Math.min(16, size / (list.length + 1));
          return (
            (padding + ((size - 2 * padding) * at) / (list.length - 1)) / size
          );
        })(),
      });
    });
  }
  const length = (edge: EdgeCell) => {
    const { source, target } = terminals.get(edge.id)!;
    return (
      Math.abs(source.point[0] - target.point[0]) +
      Math.abs(source.point[1] - target.point[1])
    );
  };
  edges.sort((a, b) => length(a) - length(b) || a.id.localeCompare(b.id));
  const occupied: RoutingSegment[] = [];
  const fixedRoutes: CompactionRoute[] = [];
  const addSegments = (points: readonly Point[]) =>
    points.slice(1).forEach((end, at) => {
      const start = points[at];
      if (start[0] === end[0] || start[1] === end[1])
        occupied.push({ start, end });
    });
  for (const id of [...frame.children].sort()) {
    const edge = store.cells[id];
    if (
      isEdgeCell(edge) &&
      !edge.hidden &&
      !automaticRoute(edge, context.registry) &&
      (edge.route.mode === 'straight' ||
        ('points' in edge.route && !!edge.route.points?.length))
    ) {
      const points = edgeRoutePoints(
        edge,
        edgeTerminalPosition(store, edge.source, edge.target, geometry),
        edgeTerminalPosition(store, edge.target, edge.source, geometry),
      );
      addSegments(points);
      fixedRoutes.push({
        id: edge.id,
        points,
        bridgeable:
          edge.route.mode !== 'curve' &&
          context.registry?.get(edge.kind)?.routable !== false,
      });
    }
  }
  const fixedSegments = [...occupied];
  // All congestion inputs belong to the batch, not just each edge's endpoints.
  const signature = JSON.stringify([
    frameId,
    context.clearance,
    crossingPenalty,
    'optimized-v1',
    [...(context.optimizeIds ?? [])].sort(),
    [...(context.fixedTerminalIds ?? [])].sort(),
    context.obstacles.map(({ id, x, y, width, height }) => [
      id,
      x,
      y,
      width,
      height,
    ]),
    occupied.map(({ start, end }) => [...start, ...end]),
    edges.map((edge) => {
      const { source, target } = terminals.get(edge.id)!;
      return [
        edge.id,
        'cellId' in edge.source ? edge.source.cellId : null,
        'cellId' in edge.target ? edge.target.cellId : null,
        ...source.point,
        source.side,
        ...target.point,
        target.side,
        edge.appearance?.strokeWidth,
      ];
    }),
  ]);
  const oldBatch = previous && routingBatches.get(previous);
  const reusable =
    oldBatch?.signature === signature ? oldBatch.results : undefined;
  const results = new Map<string, OrthogonalRoutingResult>();
  context.routes.clear();
  for (const edge of edges) {
    const { source, target } = terminals.get(edge.id)!;
    const canonical = reusable?.get(edge.id);
    const published = previous?.routes.get(edge.id)?.result;
    let result =
      (canonical &&
        (published && sameRoutingResult(published, canonical)
          ? published
          : copyRoutingResult(canonical))) ??
      routeOrthogonalAvoiding(
        source.point,
        source.side,
        target.point,
        target.side,
        context.obstacles,
        {
          sourceId: 'cellId' in edge.source ? edge.source.cellId : undefined,
          targetId: 'cellId' in edge.target ? edge.target.cellId : undefined,
          clearance: context.clearance,
          strokeWidth: edge.appearance?.strokeWidth,
          occupied,
          crossingPenalty,
          obstacleQuery: context.queryObstacles,
        },
      );
    const old = previous?.routes.get(edge.id);
    if (
      old?.edge === edge &&
      old.result.status === result.status &&
      old.result.points.length === result.points.length &&
      result.points.every(
        (p, at) =>
          p[0] === old.result.points[at][0] &&
          p[1] === old.result.points[at][1],
      )
    )
      result = old.result;
    context.routes.set(edge.id, { edge, source, target, result });
    results.set(edge.id, copyRoutingResult(result));
    addSegments(result.points);
  }
  if (!reusable) {
    const segmentList = (points: readonly Point[]) =>
      points.slice(1).map((end, at) => ({ start: points[at], end }));
    const score = (points: readonly Point[], other: RoutingSegment[]) =>
      points
        .slice(1)
        .reduce(
          (sum, end, at) =>
            sum +
            Math.abs(end[0] - points[at][0]) +
            Math.abs(end[1] - points[at][1]) +
            routingSegmentPenalty(points[at], end, other, crossingPenalty) +
            24,
          0,
        );
    const congestion = (edge: EdgeCell) => {
      const other = [
        ...fixedSegments,
        ...edges
          .filter((peer) => peer !== edge)
          .flatMap((peer) =>
            segmentList(context.routes.get(peer.id)!.result.points),
          ),
      ];
      const points = context.routes.get(edge.id)!.result.points;
      return points
        .slice(1)
        .reduce(
          (sum, end, at) =>
            sum +
            routingSegmentPenalty(points[at], end, other, crossingPenalty),
          0,
        );
    };
    const crowded = edges
      .map((edge) => ({ edge, cost: congestion(edge) }))
      .filter((item) => item.cost > 0)
      .sort((a, b) => b.cost - a.cost || a.edge.id.localeCompare(b.edge.id));
    for (const { edge } of crowded.slice(
      0,
      edges.length <= 64 ? Math.floor(1024 / edges.length) : 4,
    )) {
      const old = context.routes.get(edge.id)!;
      const other = [
        ...fixedSegments,
        ...edges
          .filter((peer) => peer !== edge)
          .flatMap((peer) =>
            segmentList(context.routes.get(peer.id)!.result.points),
          ),
      ];
      const candidate = routeOrthogonalAvoiding(
        old.source.point,
        old.source.side,
        old.target.point,
        old.target.side,
        context.obstacles,
        {
          sourceId: 'cellId' in edge.source ? edge.source.cellId : undefined,
          targetId: 'cellId' in edge.target ? edge.target.cellId : undefined,
          clearance: context.clearance,
          strokeWidth: edge.appearance?.strokeWidth,
          occupied: other,
          crossingPenalty,
          obstacleQuery: context.queryObstacles,
        },
      );
      if (
        candidate.status !== 'blocked' &&
        score(candidate.points, other) < score(old.result.points, other) - 1e-6
      ) {
        old.result = candidate;
        results.set(edge.id, copyRoutingResult(candidate));
      }
    }
    for (let pass = 0; pass < (edges.length <= 64 ? 2 : 1); pass++)
      for (const edge of edges.length <= 64
        ? edges
        : crowded.slice(0, 4).map((item) => item.edge)) {
        const old = context.routes.get(edge.id)!;
        if (old.result.status === 'blocked') continue;
        const other = [
          ...fixedSegments,
          ...edges
            .filter((peer) => peer !== edge)
            .flatMap((peer) =>
              segmentList(context.routes.get(peer.id)!.result.points),
            ),
        ];
        const points = separateOrthogonalSegments(
          old.result.points,
          old.source.side,
          old.target.side,
          context.obstacles,
          {
            sourceId: 'cellId' in edge.source ? edge.source.cellId : undefined,
            targetId: 'cellId' in edge.target ? edge.target.cellId : undefined,
            strokeWidth: edge.appearance?.strokeWidth,
            occupied: other,
            crossingPenalty,
          },
        );
        if (
          points.length === old.result.points.length &&
          points.every(
            (point, at) =>
              point[0] === old.result.points[at][0] &&
              point[1] === old.result.points[at][1],
          )
        )
          continue;
        old.result = { status: 'routed', points };
        results.set(edge.id, copyRoutingResult(old.result));
      }
    // Last pass: lane nudging must never reintroduce compacted short steps.
    let remainingCrossings = Math.max(1, Math.floor(edges.length / 10));
    const compactable =
      edges.length <= 64
        ? [...edges]
        : [...edges]
            .sort(
              (a, b) =>
                context.routes.get(b.id)!.result.points.length -
                  context.routes.get(a.id)!.result.points.length ||
                a.id.localeCompare(b.id),
            )
            .slice(0, 16);
    // Dense frames spend their bounded cleanup work on the most complicated paths.
    for (const edge of compactable.sort((a, b) => a.id.localeCompare(b.id))) {
      const old = context.routes.get(edge.id)!;
      if (old.result.status === 'blocked') continue;
      const others: CompactionRoute[] = [
        ...fixedRoutes,
        ...edges
          .filter((peer) => peer !== edge)
          .map((peer) => ({
            id: peer.id,
            points: context.routes.get(peer.id)!.result.points,
            bridgeable: true,
          })),
      ];
      const compacted = compactOrthogonalRoute(
        { id: edge.id, points: old.result.points, bridgeable: true },
        old.source.side,
        old.target.side,
        context.obstacles,
        others,
        {
          sourceId: 'cellId' in edge.source ? edge.source.cellId : undefined,
          targetId: 'cellId' in edge.target ? edge.target.cellId : undefined,
          clearance: context.clearance,
          strokeWidth: edge.appearance?.strokeWidth,
        },
        remainingCrossings,
      );
      if (!compacted) continue;
      remainingCrossings -= compacted.crossingDelta;
      old.result = { status: 'routed', points: compacted.points };
      results.set(edge.id, copyRoutingResult(old.result));
    }
  }
  if (!reusable) {
    if (context.optimizeIds?.size)
      optimizeFrameRoutes(edges, context, fixedRoutes, crossingPenalty);
    for (const edge of edges)
      results.set(
        edge.id,
        copyRoutingResult(context.routes.get(edge.id)!.result),
      );
  }
  routingBatches.set(context, {
    signature,
    results,
    previousLabels: oldBatch?.labels,
  });
}

export const relativeAnchor = (
  geometry: NodeGeometry,
  anchor: Point,
): Point => {
  const point: Point = [
    geometry.x + geometry.width * anchor[0],
    geometry.y + geometry.height * anchor[1],
  ];
  const rotation = geometry.rotation ?? 0,
    cx = geometry.x + geometry.width / 2,
    cy = geometry.y + geometry.height / 2;
  const dx = point[0] - cx,
    dy = point[1] - cy;
  return [
    cx + dx * Math.cos(rotation) - dy * Math.sin(rotation),
    cy + dx * Math.sin(rotation) + dy * Math.cos(rotation),
  ];
};

export const portAnchor = (
  geometry: NodeGeometry,
  port: Pick<PortSpec, 'side' | 'offset'>,
): { point: Point; side: GeometrySide } => {
  const point =
    nodeShapeGeometry(geometry.outline)?.anchor?.(
      geometry,
      port.side,
      port.offset ?? 0.5,
    ) ?? sideAnchor(geometry, port.side, port.offset ?? 0.5);
  const rotation = geometry.rotation ?? 0;
  if (!rotation) return { point, side: port.side };
  const cx = geometry.x + geometry.width / 2,
    cy = geometry.y + geometry.height / 2;
  const cos = Math.cos(rotation),
    sin = Math.sin(rotation),
    dx = point[0] - cx,
    dy = point[1] - cy;
  const sides: GeometrySide[] = ['right', 'bottom', 'left', 'top'];
  const original = sides.indexOf(port.side),
    quarter = Math.round(rotation / (Math.PI / 2));
  return {
    point: [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos],
    side: sides[(((original + quarter) % 4) + 4) % 4],
  };
};

export const edgeTerminalPosition = (
  store: CellStore,
  terminal: EdgeCell['source'],
  other: EdgeCell['source'],
  geometry?: ReadonlyMap<string, NodeGeometry>,
): { point: Point; side: GeometrySide } => {
  if ('point' in terminal) return { point: terminal.point, side: 'right' };
  const node = store.cells[terminal.cellId];
  if (!isNodeCell(node)) throw new Error('Missing edge endpoint');
  const bounds = geometry?.get(node.id) ?? node.geometry,
    port = node.ports?.find((port) => port.id === terminal.portId);
  if (port)
    return {
      point: terminal.anchor
        ? relativeAnchor(bounds, terminal.anchor)
        : portAnchor(bounds, port).point,
      side: portAnchor(bounds, port).side,
    };
  const otherNode = 'cellId' in other ? store.cells[other.cellId] : undefined;
  const otherBounds = isNodeCell(otherNode)
    ? (geometry?.get(otherNode.id) ?? otherNode.geometry)
    : {
        x: 'point' in other ? other.point[0] : 0,
        y: 'point' in other ? other.point[1] : 0,
        width: 0,
        height: 0,
      };
  const side = facingSides(bounds, otherBounds).sourceSide;
  return {
    point: terminal.anchor
      ? relativeAnchor(bounds, terminal.anchor)
      : portAnchor(bounds, { side }).point,
    side,
  };
};
export const edgePolyline = (
  store: CellStore,
  edge: EdgeCell,
  geometry?: ReadonlyMap<string, NodeGeometry>,
  routing?: EdgeRoutingContext,
) => {
  if (
    !routing &&
    (edge.route.mode === 'auto' || edge.route.mode === 'orthogonal')
  ) {
    const frame = Object.values(store.cells).find(
      (cell) => isFrameCell(cell) && cell.children.includes(edge.id),
    );
    if (frame) routing = createEdgeRoutingContext(store, frame.id, geometry);
  }
  return edgeRoutePoints(
    edge,
    edgeTerminalPosition(store, edge.source, edge.target, geometry),
    edgeTerminalPosition(store, edge.target, edge.source, geometry),
    routing,
  );
};

export const flattenCurve = (points: readonly Point[], steps = 24): Point[] => {
  if (points.length < 3) return points.map((p) => [...p]);
  const result: Point[] = [[...points[0]]];
  for (let i = 0; i < points.length - 1; i++) {
    const before = points[Math.max(0, i - 1)],
      start = points[i],
      end = points[i + 1],
      after = points[Math.min(points.length - 1, i + 2)];
    const a: Point = [
        start[0] + (end[0] - before[0]) / 6,
        start[1] + (end[1] - before[1]) / 6,
      ],
      b: Point = [
        end[0] - (after[0] - start[0]) / 6,
        end[1] - (after[1] - start[1]) / 6,
      ];
    for (let at = 1; at <= steps; at++) {
      const t = at / steps,
        u = 1 - t;
      result.push([
        u ** 3 * start[0] +
          3 * u ** 2 * t * a[0] +
          3 * u * t ** 2 * b[0] +
          t ** 3 * end[0],
        u ** 3 * start[1] +
          3 * u ** 2 * t * a[1] +
          3 * u * t ** 2 * b[1] +
          t ** 3 * end[1],
      ]);
    }
  }
  return result;
};

/** Cheap endpoint following, shared by editable paths and interaction previews. */
function followOrthogonalEnds(
  original: readonly Point[],
  source: TerminalPosition,
  target: TerminalPosition,
  sourceMoved: boolean,
  targetMoved: boolean,
): Point[] {
  let points = simplifyOrthogonal(original.map((point) => [...point] as Point));
  if (points.length < 2)
    return routeOrthogonal(
      source.point,
      source.side,
      target.point,
      target.side,
    );
  const firstHorizontal = points[0][1] === points[1][1];
  const lastHorizontal = points.at(-1)![1] === points.at(-2)![1];
  if (sourceMoved) points[0] = source.point;
  if (targetMoved) points[points.length - 1] = target.point;
  if (points.length <= 2)
    return points[0][0] !== points[1][0] && points[0][1] !== points[1][1]
      ? routeOrthogonal(source.point, source.side, target.point, target.side)
      : points;
  if (sourceMoved)
    points[1] = firstHorizontal
      ? [points[1][0], source.point[1]]
      : [source.point[0], points[1][1]];
  if (targetMoved) {
    const at = points.length - 2;
    points[at] = lastHorizontal
      ? [points[at][0], target.point[1]]
      : [target.point[0], points[at][1]];
  }
  return isOrthogonalPolyline(points)
    ? simplifyOrthogonal(points)
    : routeOrthogonal(source.point, source.side, target.point, target.side);
}

export const edgeRoutePoints = (
  edge: EdgeCell,
  source: { point: Point; side: GeometrySide },
  target: { point: Point; side: GeometrySide },
  routing?: EdgeRoutingContext,
): Point[] => {
  edge = normalizeEdgeRoute(edge, routing?.registry);
  if (routing?.preview && automaticRoute(edge, routing.registry)) {
    const settled = routing.preview;
    const prior = settled.routes.get(edge.id);
    const terminals = settled.terminals?.get(edge.id);
    if (prior) {
      if (
        sameTerminal(source, terminals?.originalSource ?? prior.source) &&
        sameTerminal(target, terminals?.originalTarget ?? prior.target)
      )
        return prior.result.points;
      const oldSource = terminals?.originalSource ?? prior.source;
      const oldTarget = terminals?.originalTarget ?? prior.target;
      const ds = [
        source.point[0] - oldSource.point[0],
        source.point[1] - oldSource.point[1],
      ];
      const dt = [
        target.point[0] - oldTarget.point[0],
        target.point[1] - oldTarget.point[1],
      ];
      if (Math.abs(ds[0] - dt[0]) < 1e-6 && Math.abs(ds[1] - dt[1]) < 1e-6)
        return prior.result.points.map((point): Point => [
          point[0] + ds[0],
          point[1] + ds[1],
        ]);
      return followOrthogonalEnds(
        prior.result.points,
        source,
        target,
        !!(ds[0] || ds[1]),
        !!(dt[0] || dt[1]),
      );
    }
    return routeOrthogonal(
      source.point,
      source.side,
      target.point,
      target.side,
    );
  }
  if ('points' in edge.route && edge.route.points?.length) {
    const points = edge.route.points.map((point) => [...point] as Point);
    const moved = (point: Point, next: Point) =>
      point[0] !== next[0] || point[1] !== next[1];
    const sourceMoved =
      ('cellId' in edge.source || edge.route.mode === 'orthogonal') &&
      moved(points[0], source.point);
    const targetMoved =
      ('cellId' in edge.target || edge.route.mode === 'orthogonal') &&
      moved(points.at(-1)!, target.point);
    if (edge.route.mode === 'orthogonal' && (sourceMoved || targetMoved))
      return followOrthogonalEnds(
        points,
        source,
        target,
        sourceMoved,
        targetMoved,
      );
    if ('cellId' in edge.source) points[0] = source.point;
    if ('cellId' in edge.target) points[points.length - 1] = target.point;
    return points;
  }
  if (edge.route.mode === 'straight' || edge.route.mode === 'curve')
    return [source.point, target.point];
  if (
    routing &&
    (edge.route.mode === 'auto' || edge.route.mode === 'orthogonal')
  ) {
    routing.prepare?.();
    const planned = routing.terminals?.get(edge.id);
    if (
      planned?.edge === edge &&
      sameTerminal(source, planned.originalSource) &&
      sameTerminal(target, planned.originalTarget)
    ) {
      source = planned.source;
      target = planned.target;
    }
    const cached = routing.routes.get(edge.id);
    if (
      cached?.edge === edge &&
      sameTerminal(cached.source, source) &&
      sameTerminal(cached.target, target)
    )
      return cached.result.points;
    const result = routeOrthogonalAvoiding(
      source.point,
      source.side,
      target.point,
      target.side,
      routing.obstacles,
      {
        sourceId: 'cellId' in edge.source ? edge.source.cellId : undefined,
        targetId: 'cellId' in edge.target ? edge.target.cellId : undefined,
        clearance: routing.clearance,
        strokeWidth: edge.appearance?.strokeWidth,
      },
    );
    routing.routes.set(edge.id, { edge, source, target, result });
    routing.labelLayouts = undefined;
    return result.points;
  }
  return routeOrthogonal(source.point, source.side, target.point, target.side);
};

/** Smooth curve through editable route points; endpoints remain bound to ports. */
export const curvePath = (points: readonly Point[]): string => {
  if (points.length < 3) return polylinePath(points);
  let path = `M${points[0][0]} ${points[0][1]}`;
  for (let at = 0; at < points.length - 1; at++) {
    const before = points[Math.max(0, at - 1)],
      start = points[at],
      end = points[at + 1],
      after = points[Math.min(points.length - 1, at + 2)];
    path += ` C${start[0] + (end[0] - before[0]) / 6} ${start[1] + (end[1] - before[1]) / 6} ${end[0] - (after[0] - start[0]) / 6} ${end[1] - (after[1] - start[1]) / 6} ${end[0]} ${end[1]}`;
  }
  return path;
};

/** A bound two-terminal curve retains the source and target port tangents. */
export const terminalCurvePath = (
  source: { point: Point; side: GeometrySide },
  target: { point: Point; side: GeometrySide },
): string => {
  const dx = target.point[0] - source.point[0],
    dy = target.point[1] - source.point[1];
  const gap =
    source.side === 'right' && target.side === 'left' && dx > 0
      ? dx
      : source.side === 'left' && target.side === 'right' && dx < 0
        ? -dx
        : source.side === 'bottom' && target.side === 'top' && dy > 0
          ? dy
          : source.side === 'top' && target.side === 'bottom' && dy < 0
            ? -dy
            : undefined;
  const distance =
    gap !== undefined
      ? gap / 2
      : Math.max(
          24,
          Math.hypot(
            target.point[0] - source.point[0],
            target.point[1] - source.point[1],
          ) / 2,
        );
  const control = (terminal: typeof source): Point => [
    terminal.point[0] +
      (terminal.side === 'right'
        ? distance
        : terminal.side === 'left'
          ? -distance
          : 0),
    terminal.point[1] +
      (terminal.side === 'bottom'
        ? distance
        : terminal.side === 'top'
          ? -distance
          : 0),
  ];
  const first = control(source),
    last = control(target);
  return `M${source.point[0]} ${source.point[1]} C${first[0]} ${first[1]} ${last[0]} ${last[1]} ${target.point[0]} ${target.point[1]}`;
};

export interface ArrowMarkerGeometry {
  path: string;
  fill: 'none' | 'stroke' | 'background';
}
export const arrowMarkerGeometry = (
  points: readonly Point[],
  marker: string,
  source = false,
  size = 12,
): ArrowMarkerGeometry | undefined => {
  if (marker === 'none' || points.length < 2) return;
  const end = source ? points[0] : points.at(-1)!;
  const previous = source ? points[1] : points.at(-2)!;
  const dx = end[0] - previous[0],
    dy = end[1] - previous[1],
    length = Math.hypot(dx, dy) || 1;
  const ux = dx / length,
    uy = dy / length;
  const point = (along: number, across: number) =>
    `${end[0] - ux * along - uy * across} ${end[1] - uy * along + ux * across}`;
  const triangle = `M${point(size, size * 0.5)} L${point(0, 0)} L${point(size, -size * 0.5)}`;
  if (marker === 'single-slash')
    return {
      path: `M${point(size * 0.5, size * 0.5)} L${point(-size * 0.2, -size * 0.5)}`,
      fill: 'none',
    };
  if (marker === 'one-side-up' || marker === 'one-side-down')
    return {
      path: `M${point(0, 0)} L${point(size, marker === 'one-side-up' ? size * 0.5 : -size * 0.5)}`,
      fill: 'none',
    };
  if (
    marker === 'diamond' ||
    marker === 'diamond_outline' ||
    marker === 'composition' ||
    marker === 'aggregation'
  )
    return {
      path: `M${point(0, 0)} L${point(size * 0.5, size * 0.4)} L${point(size, 0)} L${point(size * 0.5, -size * 0.4)} Z`,
      fill:
        marker === 'composition' || marker === 'diamond'
          ? 'stroke'
          : 'background',
    };
  if (marker === 'circle' || marker === 'lollipop')
    return {
      path: `M${point(size * 0.5, size * 0.4)} A${size * 0.4} ${size * 0.4} 0 1 0 ${point(size * 0.5, -size * 0.4)} A${size * 0.4} ${size * 0.4} 0 1 0 ${point(size * 0.5, size * 0.4)}`,
      fill: 'background',
    };
  if (marker === 'cross')
    return {
      path: `M${point(0, size * 0.4)} L${point(size, -size * 0.4)} M${point(size, size * 0.4)} L${point(0, -size * 0.4)}`,
      fill: 'none',
    };
  if (marker === 'solid-triangle' || marker === 'sharp-arrow')
    return { path: `${triangle} Z`, fill: 'stroke' };
  if (marker === 'hollow-triangle' || marker === 'triangle_outline')
    return { path: `${triangle} Z`, fill: 'background' };
  return { path: triangle, fill: 'none' };
};
