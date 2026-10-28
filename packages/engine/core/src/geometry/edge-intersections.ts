import type { Point } from '../interfaces/point';

export interface EdgeJump {
  point: Point;
  radius: number;
}
export interface CrossingRoute {
  id: string;
  points: readonly Point[];
}
const cross = (a: Point, b: Point) => a[0] * b[1] - a[1] * b[0];
const delta = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];

export function strictSegmentIntersection(
  a: Point,
  b: Point,
  c: Point,
  d: Point,
): Point | undefined {
  const u = delta(b, a),
    v = delta(d, c),
    divisor = cross(u, v);
  if (Math.abs(divisor) < 1e-8) return;
  const difference = delta(c, a),
    t = cross(difference, v) / divisor,
    s = cross(difference, u) / divisor;
  if (t <= 1e-8 || t >= 1 - 1e-8 || s <= 1e-8 || s >= 1 - 1e-8) return;
  return [a[0] + t * u[0], a[1] + t * u[1]];
}

/** Strict interior crossings only. Ownership is geometric, independent of paint order. */
export function edgeCrossingJumps(
  routes: readonly CrossingRoute[],
): Map<string, EdgeJump[]> {
  const result = new Map<string, EdgeJump[]>();
  const sorted = [...routes].sort((a, b) => a.id.localeCompare(b.id));
  for (let i = 0; i < sorted.length; i++)
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i],
        b = sorted[j];
      for (let ai = 1; ai < a.points.length; ai++)
        for (let bi = 1; bi < b.points.length; bi++) {
          const start = a.points[ai - 1],
            other = b.points[bi - 1];
          const u = delta(a.points[ai], start),
            v = delta(b.points[bi], other);
          const point = strictSegmentIntersection(
            start,
            a.points[ai],
            other,
            b.points[bi],
          );
          if (!point) continue;
          const owner =
            Math.abs(u[0]) / Math.hypot(...u) >
            Math.abs(v[0]) / Math.hypot(...v)
              ? a
              : b;
          const from = owner === a ? start : other,
            to = owner === a ? a.points[ai] : b.points[bi];
          const radius = Math.min(
            6,
            Math.min(
              Math.hypot(...delta(point, from)),
              Math.hypot(...delta(point, to)),
            ) / 2,
          );
          if (
            radius < 2 ||
            [owner.points[0], owner.points.at(-1)!].some(
              (end) => Math.hypot(...delta(end, point)) < 16,
            )
          )
            continue;
          const jumps = result.get(owner.id) ?? [];
          if (
            !jumps.some(
              (jump) => Math.hypot(...delta(jump.point, point)) < 1e-6,
            )
          )
            jumps.push({ point, radius });
          result.set(owner.id, jumps);
        }
    }
  return result;
}
