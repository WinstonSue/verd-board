import type { Point } from '../interfaces/point';
import { polylinePath } from './polyline';

type Cubic = [Point, Point, Point, Point];
const mix = (a: Point, b: Point, t: number): Point => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];
const split = (c: Cubic, t: number): [Cubic, Cubic] => {
  const a = mix(c[0], c[1], t),
    b = mix(c[1], c[2], t),
    d = mix(c[2], c[3], t);
  const e = mix(a, b, t),
    f = mix(b, d, t),
    p = mix(e, f, t);
  return [
    [c[0], a, e, p],
    [p, f, d, c[3]],
  ];
};
const evaluate = (c: Cubic, t: number) => split(c, t)[0][3];
const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Clip only the display path against interactive port circles. Routes stay canonical.
 * De Casteljau subdivision preserves every retained cubic and its endpoint tangents.
 */
export function edgeDisplayGeometry(
  points: readonly Point[],
  curve: boolean,
  sourceRadius = 0,
  targetRadius = 0,
): { path: string; markerPoints: Point[] } {
  if (points.length < 2) return { path: '', markerPoints: [] };
  const segments: Cubic[] = points.slice(1).map((end, i) => {
    const start = points[i];
    if (!curve || points.length < 3)
      return [start, mix(start, end, 1 / 3), mix(start, end, 2 / 3), end];
    const before = points[Math.max(0, i - 1)],
      after = points[Math.min(points.length - 1, i + 2)];
    return [
      start,
      [
        start[0] + (end[0] - before[0]) / 6,
        start[1] + (end[1] - before[1]) / 6,
      ],
      [end[0] - (after[0] - start[0]) / 6, end[1] - (after[1] - start[1]) / 6],
      end,
    ];
  });
  const crossing = (radius: number, reverse: boolean): number => {
    if (radius <= 0) return reverse ? segments.length : 0;
    const center = reverse ? points.at(-1)! : points[0];
    const at = (v: number) => {
      const position = reverse ? segments.length - v : v;
      const index = Math.min(segments.length - 1, Math.floor(position));
      return evaluate(segments[index], position - index);
    };
    // Find the first circle exit, then solve on the original cubic, never a flattened path.
    const steps = segments.length * 128;
    for (let i = 1; i <= steps; i++) {
      const high = i / 128;
      if (distance(at(high), center) < radius) continue;
      let lo = (i - 1) / 128,
        hi = high;
      for (let j = 0; j < 40; j++) {
        const mid = (lo + hi) / 2;
        if (distance(at(mid), center) < radius) lo = mid;
        else hi = mid;
      }
      return reverse ? segments.length - hi : hi;
    }
    return reverse ? 0 : segments.length;
  };
  const start = crossing(sourceRadius, false),
    end = crossing(targetRadius, true);
  if (end - start < 1e-8) return { path: '', markerPoints: [] };
  const kept: Cubic[] = [];
  for (let i = Math.floor(start); i < Math.ceil(end); i++) {
    const from = Math.max(0, start - i),
      to = Math.min(1, end - i);
    if (to - from < 1e-8) continue;
    let c = segments[i];
    if (to < 1) c = split(c, to)[0];
    if (from > 0) c = split(c, from / to)[1];
    kept.push(c);
  }
  if (!kept.length) return { path: '', markerPoints: [] };
  const first = kept[0],
    last = kept.at(-1)!;
  const retainedPoints = [first[0], ...kept.map((c) => c[3])];
  const path =
    curve && points.length >= 3
      ? `M${first[0].join(' ')}${kept.map((c) => ` C${c[1].join(' ')} ${c[2].join(' ')} ${c[3].join(' ')}`).join('')}`
      : polylinePath(retainedPoints);
  return {
    path,
    markerPoints: [
      first[0],
      distance(first[0], first[1]) > 1e-9 ? first[1] : first[3],
      distance(last[3], last[2]) > 1e-9 ? last[2] : last[0],
      last[3],
    ],
  };
}
