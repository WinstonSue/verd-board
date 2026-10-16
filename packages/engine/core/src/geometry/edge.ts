import {
  isNodeCell,
  isFrameCell,
  isEdgeCell,
  type CellStore,
  type EdgeCell,
  type NodeGeometry,
  type PortSpec,
} from '../cell/types';
import type { Point } from '../interfaces/point';
import { sideAnchor, facingSides, type GeometrySide } from './side';
import { routeOrthogonal, simplifyOrthogonal } from './route';
import { polylinePath } from './polyline';
import { nodeShapeGeometry } from './node';
import type { EdgeLabelLayout } from './edge-label';
import {
  routingBatches,
  copyRoutingResult,
  sameRoutingResult,
} from './routing-cache';
import {
  routeOrthogonalAvoiding,
  type RoutingObstacle,
  type OrthogonalRoutingResult,
  type RoutingSegment,
} from './obstacle-route';

type TerminalPosition = { point: Point; side: GeometrySide };
export interface EdgeRoutingContext {
  readonly obstacles: readonly RoutingObstacle[];
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
): EdgeRoutingContext => {
  const frame = store.cells[frameId];
  const obstacles: RoutingObstacle[] = [];
  if (isFrameCell(frame))
    for (const id of frame.children) {
      const node = store.cells[id];
      if (
        !isNodeCell(node) ||
        node.hidden ||
        node.kind === 'architecture-layer'
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
  const context: EdgeRoutingContext = {
    obstacles,
    routes: new Map(),
    clearance: previous?.clearance,
    terminals: new Map(),
  };
  let prepared = false;
  context.prepare = () => {
    if (prepared) return;
    prepared = true;
    planFrameRoutes(store, frameId, geometry, context, previous);
    // Retain only the current store and pure batch output after preparation.
    previous = undefined;
  };
  return context;
};

const automaticRoute = (edge: EdgeCell) =>
  (edge.route.mode === 'auto' || edge.route.mode === 'orthogonal') &&
  !('points' in edge.route && edge.route.points?.length) &&
  edge.kind !== 'mind-branch' &&
  edge.kind !== 'mind-summary-edge';

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
        isEdgeCell(cell) && !cell.hidden && automaticRoute(cell),
    );
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
    terminals.set(edge.id, {
      edge,
      source,
      target,
      originalSource: source,
      originalTarget: target,
    });
    for (const end of ['source', 'target'] as const) {
      const terminal = edge[end];
      if (!('cellId' in terminal) || terminal.portId || terminal.anchor)
        continue;
      const node = store.cells[terminal.cellId];
      if (
        !isNodeCell(node) ||
        (geometry?.get(node.id) ?? node.geometry).rotation
      )
        continue;
      const position = end === 'source' ? source : target;
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
        offset: (at + 1) / (list.length + 1),
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
      !automaticRoute(edge) &&
      'points' in edge.route &&
      edge.route.points?.length
    ) {
      addSegments(
        edgeRoutePoints(
          edge,
          edgeTerminalPosition(store, edge.source, edge.target, geometry),
          edgeTerminalPosition(store, edge.target, edge.source, geometry),
        ),
      );
    }
  }
  // All congestion inputs belong to the batch, not just each edge's endpoints.
  const signature = JSON.stringify([
    frameId,
    context.clearance,
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

export const edgeRoutePoints = (
  edge: EdgeCell,
  source: { point: Point; side: GeometrySide },
  target: { point: Point; side: GeometrySide },
  routing?: EdgeRoutingContext,
): Point[] => {
  if ('points' in edge.route && edge.route.points?.length) {
    let points = edge.route.points.map((point) => [...point] as Point);
    const moved = (point: Point, next: Point) =>
      point[0] !== next[0] || point[1] !== next[1];
    const sourceMoved =
      'cellId' in edge.source && moved(points[0], source.point);
    const targetMoved =
      'cellId' in edge.target && moved(points.at(-1)!, target.point);
    if (edge.route.mode === 'orthogonal' && (sourceMoved || targetMoved)) {
      // Remove redundant collinear corners before moving the adjoining legs;
      // a moved port or fractional anchor must not introduce diagonal segments.
      points = simplifyOrthogonal(points);
      if (points.length < 2)
        return routeOrthogonal(
          source.point,
          source.side,
          target.point,
          target.side,
        );
      const firstHorizontal = points[0][1] === points[1]?.[1];
      const lastHorizontal = points.at(-1)![1] === points.at(-2)?.[1];
      if ('cellId' in edge.source) points[0] = source.point;
      if ('cellId' in edge.target) points[points.length - 1] = target.point;
      if (points.length <= 2)
        return points.length === 2 &&
          points[0][0] !== points[1][0] &&
          points[0][1] !== points[1][1]
          ? routeOrthogonal(
              source.point,
              source.side,
              target.point,
              target.side,
            )
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
      return simplifyOrthogonal(points);
    }
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
