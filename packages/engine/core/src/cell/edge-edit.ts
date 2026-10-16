import {
  isFrameCell,
  isNodeCell,
  type CellStore,
  type EdgeCell,
  type EdgeTerminal,
} from './types';
import type { Point } from '../interfaces/point';
import {
  nodeShapeGeometry,
  unrotateNodePoint,
  hitNodeShape,
} from '../geometry/node';
import { portAnchor, edgeTerminalPosition } from '../geometry/edge';
import { simplifyOrthogonal } from '../geometry/route';

/** Only direct siblings are eligible: snapping can never create a cross-Frame edge. */
export const snapEdgeTerminal = (
  store: CellStore,
  frameId: string,
  point: Point,
  end: 'source' | 'target',
  kind = 'arrow',
  tolerance = 12,
): EdgeTerminal => {
  const frame = store.cells[frameId];
  if (!isFrameCell(frame)) throw new Error('Missing edge frame');
  for (const id of [...frame.children].reverse()) {
    const node = store.cells[id];
    if (!isNodeCell(node) || isFrameCell(node) || node.hidden || node.locked)
      continue;
    if (kind === 'workflow-edge' && !node.kind.startsWith('workflow-'))
      continue;
    if (kind === 'architecture-edge' && node.kind !== 'architecture-module')
      continue;
    const ports =
      node.ports?.filter((port) =>
        end === 'source'
          ? port.direction !== 'input'
          : port.direction !== 'output',
      ) ?? [];
    const nearestPort = ports
      .map((port) => ({ port, point: portAnchor(node.geometry, port).point }))
      .sort(
        (a, b) =>
          Math.hypot(a.point[0] - point[0], a.point[1] - point[1]) -
          Math.hypot(b.point[0] - point[0], b.point[1] - point[1]),
      )[0];
    const inside = hitNodeShape(node, point, tolerance);
    if (
      nearestPort &&
      (Math.hypot(
        nearestPort.point[0] - point[0],
        nearestPort.point[1] - point[1],
      ) <= tolerance ||
        (kind !== 'arrow' && inside))
    )
      return { cellId: node.id, portId: nearestPort.port.id };
    if (kind !== 'arrow' || !inside) continue;
    const g = node.geometry,
      local = unrotateNodePoint(g, point);
    const boundary = nodeShapeGeometry(g.outline)?.nearest?.(g, local) ?? local;
    return {
      cellId: node.id,
      anchor: [
        (boundary[0] - g.x) / (g.width || 1),
        (boundary[1] - g.y) / (g.height || 1),
      ],
    };
  }
  return { point: [...point] };
};
export const replaceEdgeTerminal = (
  store: CellStore,
  edge: EdgeCell,
  end: 'source' | 'target',
  terminal: EdgeTerminal,
): EdgeCell => {
  const next = { ...edge, [end]: terminal };
  if ('points' in next.route && next.route.points) {
    const points = next.route.points.map((p) => [...p] as Point);
    points[end === 'source' ? 0 : points.length - 1] = edgeTerminalPosition(
      store,
      terminal,
      end === 'source' ? next.target : next.source,
    ).point;
    next.route = { ...next.route, points };
  }
  return next;
};

/** Capture derived attachment points only when an automatic connector becomes
 * an authored path. Otherwise its endpoints would snap back to side midpoints. */
export const bindEdgeRouteTerminals = (
  store: CellStore,
  edge: EdgeCell,
  route: readonly Point[],
): EdgeCell => {
  if (
    !['auto', 'orthogonal'].includes(edge.route.mode) ||
    ('points' in edge.route && edge.route.points?.length) ||
    route.length < 2
  )
    return edge;
  let next = edge;
  for (const end of ['source', 'target'] as const) {
    const terminal = edge[end];
    if (!('cellId' in terminal) || terminal.portId || terminal.anchor) continue;
    const node = store.cells[terminal.cellId];
    if (
      !isNodeCell(node) ||
      node.geometry.width <= 0 ||
      node.geometry.height <= 0
    )
      continue;
    const position = end === 'source' ? route[0] : route.at(-1)!;
    const point = node.geometry.rotation
      ? unrotateNodePoint(node.geometry, position)
      : position;
    next = {
      ...next,
      [end]: {
        ...terminal,
        anchor: [
          (point[0] - node.geometry.x) / node.geometry.width,
          (point[1] - node.geometry.y) / node.geometry.height,
        ],
      },
    };
  }
  return next;
};
export const moveEdgeRoutePoint = (
  edge: EdgeCell,
  route: readonly Point[],
  index: number,
  point: Point,
): EdgeCell => {
  if (index <= 0 || index >= route.length - 1)
    throw new Error('Use endpoint editing for route endpoints');
  const points = route.map((p) => [...p] as Point),
    old = points[index];
  points[index] = [...point];
  if (edge.route.mode === 'auto' || edge.route.mode === 'orthogonal') {
    const before = points[index - 1],
      after = points[index + 1];
    const prevCorner: Point =
      old[0] === before[0] ? [point[0], before[1]] : [before[0], point[1]];
    const nextCorner: Point =
      old[0] === after[0] ? [point[0], after[1]] : [after[0], point[1]];
    points.splice(index, 1, prevCorner, [...point], nextCorner);
    return {
      ...edge,
      route: { mode: 'orthogonal', points: simplifyOrthogonal(points) },
    };
  }
  return {
    ...edge,
    route: { mode: edge.route.mode === 'curve' ? 'curve' : 'fixed', points },
  };
};
export const moveEdgeSegment = (
  edge: EdgeCell,
  route: readonly Point[],
  index: number,
  point: Point,
): EdgeCell => {
  if (index < 0 || index >= route.length - 1)
    throw new Error('Missing route segment');
  const points = route.map((p) => [...p] as Point),
    a = points[index],
    b = points[index + 1];
  if (edge.route.mode === 'auto' || edge.route.mode === 'orthogonal') {
    const corners: Point[] =
      a[1] === b[1]
        ? [
            [a[0], point[1]],
            [b[0], point[1]],
          ]
        : [
            [point[0], a[1]],
            [point[0], b[1]],
          ];
    points.splice(index + 1, 0, ...corners);
    return {
      ...edge,
      route: { mode: 'orthogonal', points: simplifyOrthogonal(points) },
    };
  }
  points.splice(index + 1, 0, [...point]);
  return {
    ...edge,
    route: { mode: edge.route.mode === 'curve' ? 'curve' : 'fixed', points },
  };
};
export const polylineClosestPosition = (
  points: readonly Point[],
  point: Point,
): number => {
  const lengths = points
      .slice(1)
      .map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1])),
    total = lengths.reduce((a, b) => a + b, 0);
  if (!total) return 0.5;
  let walked = 0,
    nearest = Infinity,
    position = 0.5;
  lengths.forEach((length, i) => {
    const a = points[i],
      b = points[i + 1],
      dx = b[0] - a[0],
      dy = b[1] - a[1];
    const t = Math.max(
      0,
      Math.min(
        1,
        ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (length ** 2 || 1),
      ),
    );
    const distance = Math.hypot(
      a[0] + dx * t - point[0],
      a[1] + dy * t - point[1],
    );
    if (distance < nearest) {
      nearest = distance;
      position = (walked + length * t) / total;
    }
    walked += length;
  });
  return position;
};
