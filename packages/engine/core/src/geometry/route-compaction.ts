import type { Point } from '../interfaces/point';
import {
  edgeCrossingJumps,
  strictSegmentIntersection,
  type EdgeJump,
} from './edge-intersections';
import {
  isClearOrthogonalRoute,
  type OrthogonalRoutingOptions,
  type RoutingObstacle,
} from './obstacle-route';
import { routeOrthogonal, simplifyOrthogonal } from './route';
import type { GeometrySide } from './side';

export interface CompactionRoute {
  id: string;
  points: readonly Point[];
  bridgeable: boolean;
}
const epsilon = 1e-6;
const length = (points: readonly Point[]) =>
  points
    .slice(1)
    .reduce(
      (sum, end, at) =>
        sum +
        Math.abs(end[0] - points[at][0]) +
        Math.abs(end[1] - points[at][1]),
      0,
    );
const segments = (points: readonly Point[]) =>
  points.slice(1).map((end, at) => [points[at], end] as const);
const near = (a: Point, b: Point) =>
  Math.hypot(a[0] - b[0], a[1] - b[1]) < epsilon;

/** Strict crossings exclude shared terminals and corners, as does the jump renderer. */
function intersections(
  first: readonly Point[],
  second: readonly Point[],
): Point[] {
  const result: Point[] = [];
  for (const [a, b] of segments(first))
    for (const [c, d] of segments(second)) {
      const point = strictSegmentIntersection(a, b, c, d);
      if (point && !result.some((existing) => near(existing, point)))
        result.push(point);
    }
  return result;
}
function overlap(first: readonly Point[], second: readonly Point[]) {
  let sum = 0;
  for (const [a, b] of segments(first))
    for (const [c, d] of segments(second)) {
      const ux = b[0] - a[0],
        uy = b[1] - a[1],
        vx = d[0] - c[0],
        vy = d[1] - c[1];
      const distance = Math.hypot(ux, uy);
      if (
        !distance ||
        Math.abs(ux * vy - uy * vx) > epsilon ||
        Math.abs(ux * (c[1] - a[1]) - uy * (c[0] - a[0])) > epsilon
      )
        continue;
      const first = ((c[0] - a[0]) * ux + (c[1] - a[1]) * uy) / distance;
      const last = ((d[0] - a[0]) * ux + (d[1] - a[1]) * uy) / distance;
      sum += Math.max(
        0,
        Math.min(distance, Math.max(first, last)) -
          Math.max(0, Math.min(first, last)),
      );
    }
  return sum;
}
function selfCrosses(points: readonly Point[]) {
  const parts = segments(points);
  return parts.some(([a, b], at) =>
    parts
      .slice(at + 2)
      .some(
        ([c, d]) =>
          intersections([a, b], [c, d]).length > 0 ||
          overlap([a, b], [c, d]) > epsilon,
      ),
  );
}
function visibleCrossings(
  route: CompactionRoute,
  others: readonly CompactionRoute[],
  added: ReadonlyMap<string, Point[]>,
  obstacles: readonly RoutingObstacle[],
): boolean {
  if (!added.size) return true;
  if (others.some((other) => added.has(other.id) && !other.bridgeable))
    return false;
  const routes = [route, ...others.filter((other) => other.bridgeable)];
  const jumpCache = new Map<string, EdgeJump[]>();
  const ownedJumps = (owner: CompactionRoute) => {
    let cached = jumpCache.get(owner.id);
    if (!cached) {
      cached = routes
        .filter((peer) => peer.id !== owner.id)
        .flatMap(
          (peer) => edgeCrossingJumps([owner, peer]).get(owner.id) ?? [],
        );
      jumpCache.set(owner.id, cached);
    }
    return cached;
  };
  for (const [peerId, points] of added) {
    const peer = others.find((item) => item.id === peerId)!;
    const pair = edgeCrossingJumps([route, peer]);
    for (const point of points) {
      const owner = [route, peer].find((item) =>
        pair.get(item.id)?.some((jump) => near(jump.point, point)),
      );
      if (!owner) return false;
      const jump = pair.get(owner.id)!.find((item) => near(item.point, point))!;
      // Leave room for the rendered corner rounding and neighboring jump arcs.
      if (
        jump.radius < 2 ||
        owner.points
          .slice(1, -1)
          .some(
            (corner) =>
              Math.hypot(corner[0] - point[0], corner[1] - point[1]) < 12,
          )
      )
        return false;
      if (
        ownedJumps(owner).some(
          (other) =>
            !near(other.point, point) &&
            Math.hypot(other.point[0] - point[0], other.point[1] - point[1]) <
              8,
        )
      )
        return false;
      if (
        obstacles.some(
          (box) =>
            Math.hypot(
              Math.max(box.x - point[0], 0, point[0] - box.x - box.width),
              Math.max(box.y - point[1], 0, point[1] - box.y - box.height),
            ) < 3,
        )
      )
        return false;
    }
  }
  return true;
}

/** A single bounded pass after lane separation: fewer bends may buy one readable crossing. */
export function compactOrthogonalRoute(
  route: CompactionRoute,
  sourceSide: GeometrySide,
  targetSide: GeometrySide,
  obstacles: readonly RoutingObstacle[],
  others: readonly CompactionRoute[],
  options: OrthogonalRoutingOptions,
  extraCrossingBudget: number,
): { points: Point[]; crossingDelta: number } | undefined {
  const original = route.points;
  if (original.length < 6) return;
  const steps: number[] = [];
  for (let at = 1; at + 2 < original.length; at++) {
    const before = original[at - 1],
      a = original[at],
      b = original[at + 1],
      after = original[at + 2];
    if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) > 24) continue;
    const horizontal = a[1] === b[1];
    if (
      horizontal
        ? (a[1] - before[1]) * (after[1] - b[1]) > 0
        : (a[0] - before[0]) * (after[0] - b[0]) > 0
    )
      steps.push(at);
  }
  if (!steps.length) return;
  const candidates = [
    routeOrthogonal(original[0], sourceSide, original.at(-1)!, targetSide),
  ];
  for (const at of steps.slice(0, others.length > 64 ? 4 : 16)) {
    const start = original[at - 1],
      end = original[at + 2];
    for (const corner of [
      [start[0], end[1]],
      [end[0], start[1]],
    ] as Point[])
      candidates.push(
        simplifyOrthogonal([
          ...original.slice(0, at),
          corner,
          ...original.slice(at + 2),
        ]),
      );
  }
  const minimum = Math.max(0, options.strokeWidth ?? 2) / 2 + 1;
  const clearance = Math.max(minimum, options.clearance ?? 12);
  const oldLength = length(original);
  const viable = candidates.filter(
    (points) =>
      points.length <= original.length - 2 &&
      length(points) <= oldLength + epsilon &&
      isClearOrthogonalRoute(points, sourceSide, targetSide, obstacles, {
        ...options,
        clearance,
      }) &&
      !selfCrosses(points),
  );
  if (!viable.length) return;
  const before = new Map(
    others.map((other) => [
      other.id,
      {
        crosses: intersections(original, other.points),
        overlap: overlap(original, other.points),
      },
    ]),
  );
  const oldCrossings = [...before.values()].reduce(
    (sum, value) => sum + value.crosses.length,
    0,
  );
  let best:
    { points: Point[]; crossingDelta: number; distance: number } | undefined;
  for (const points of viable) {
    const added = new Map<string, Point[]>();
    let crossings = 0,
      safe = true;
    for (const other of others) {
      const previous = before.get(other.id)!,
        next = intersections(points, other.points);
      if (overlap(points, other.points) > previous.overlap + epsilon) {
        safe = false;
        break;
      }
      crossings += next.length;
      const newPoints = next.filter(
        (point) => !previous.crosses.some((old) => near(old, point)),
      );
      if (newPoints.length) added.set(other.id, newPoints);
    }
    const crossingDelta = crossings - oldCrossings;
    if (!safe || crossingDelta > Math.min(1, extraCrossingBudget)) continue;
    if (
      best &&
      (points.length > best.points.length ||
        (points.length === best.points.length &&
          (crossingDelta > best.crossingDelta ||
            (crossingDelta === best.crossingDelta &&
              length(points) >= best.distance - epsilon))))
    )
      continue;
    if (!visibleCrossings({ ...route, points }, others, added, obstacles))
      continue;
    best = { points, crossingDelta, distance: length(points) };
  }
  return best;
}
