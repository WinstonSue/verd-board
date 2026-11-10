import { simplifyOrthogonal } from '../geometry/route';
import type { Point } from '../interfaces/point';
import type { EdgeCell } from './types';

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
      route: {
        mode: 'orthogonal',
        origin: 'manual',
        points: simplifyOrthogonal(points),
        ...(edge.route.strategy ? { strategy: edge.route.strategy } : {}),
      },
    };
  }
  return {
    ...edge,
    route: {
      mode: edge.route.mode === 'curve' ? 'curve' : 'fixed',
      points,
      origin: 'manual',
    },
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
      route: {
        mode: 'orthogonal',
        origin: 'manual',
        points: simplifyOrthogonal(points),
        ...(edge.route.strategy ? { strategy: edge.route.strategy } : {}),
      },
    };
  }
  points.splice(index + 1, 0, [...point]);
  return {
    ...edge,
    route: {
      mode: edge.route.mode === 'curve' ? 'curve' : 'fixed',
      points,
      origin: 'manual',
    },
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
