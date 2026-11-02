import type { Point } from '../interfaces/point';
import { isEdgeCell, isFrameCell, type CellStore } from '../cell/types';
import { edgePolyline, type EdgeRoutingContext } from './edge';

import {
  edgeCrossingJumps,
  type CrossingRoute,
  type EdgeJump,
} from './edge-intersections';
export {
  edgeCrossingJumps,
  type CrossingRoute,
  type EdgeJump,
} from './edge-intersections';
const delta = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const cross = (a: Point, b: Point) => a[0] * b[1] - a[1] * b[0];

const frameCrossings = new WeakMap<
  EdgeRoutingContext,
  Map<string, EdgeJump[]>
>();
/** Canonical paths, not clipped port paths, determine intersections for screen and export. */
export function frameEdgeCrossingJumps(
  store: CellStore,
  frameId: string,
  routing: EdgeRoutingContext,
) {
  const cached = frameCrossings.get(routing);
  if (cached) return cached;
  const frame = store.cells[frameId];
  const routes: CrossingRoute[] = isFrameCell(frame)
    ? frame.children.flatMap((id) => {
        const edge = store.cells[id];
        return isEdgeCell(edge) &&
          !edge.hidden &&
          edge.route.mode !== 'curve' &&
          routing.registry?.get(edge.kind)?.routable !== false
          ? [{ id, points: edgePolyline(store, edge, undefined, routing) }]
          : [];
      })
    : [];
  const signature = JSON.stringify([routes, routing.obstacles]);
  const shared = routing.crossingsCache;
  if (shared?.signature === signature && shared.value) {
    frameCrossings.set(routing, shared.value);
    return shared.value;
  }
  const result = edgeCrossingJumps(routes);
  // Do not let a bridge bulge into a nearby node in a cramped manual drawing.
  for (const [id, jumps] of result) {
    const safe = jumps.flatMap((jump) => {
      const radius = Math.min(
        jump.radius,
        ...routing.obstacles.map(
          (box) =>
            Math.hypot(
              Math.max(
                box.x - jump.point[0],
                0,
                jump.point[0] - box.x - box.width,
              ),
              Math.max(
                box.y - jump.point[1],
                0,
                jump.point[1] - box.y - box.height,
              ),
            ) - 1,
        ),
      );
      return radius >= 2 ? [{ point: jump.point, radius }] : [];
    });
    result.set(id, safe);
  }
  if (shared) {
    shared.signature = signature;
    shared.value = result;
  }
  frameCrossings.set(routing, result);
  return result;
}

/** Decorate a polyline without changing its edit/hit/label geometry. */
export function decoratedPolylinePath(
  points: readonly Point[],
  jumps: readonly EdgeJump[] = [],
  cornerRadius = 0,
): string {
  if (points.length < 2) return '';
  const towards = (a: Point, b: Point, amount: number): Point => {
    const length = Math.hypot(...delta(b, a));
    return length
      ? [
          a[0] + ((b[0] - a[0]) * amount) / length,
          a[1] + ((b[1] - a[1]) * amount) / length,
        ]
      : a;
  };
  const corners = points.map((point, at) =>
    at === 0 || at === points.length - 1
      ? 0
      : Math.min(
          cornerRadius,
          Math.hypot(...delta(point, points[at - 1])) / 3,
          Math.hypot(...delta(point, points[at + 1])) / 3,
        ),
  );
  let path = `M${points[0].join(' ')}`;
  for (let at = 1; at < points.length; at++) {
    const a = points[at - 1],
      b = points[at];
    const start = towards(a, b, corners[at - 1]),
      end = towards(b, a, corners[at]);
    const direction = delta(end, start),
      length = Math.hypot(...direction);
    if (!length) continue;
    const projected = jumps
      .flatMap((jump) => {
        const relative = delta(jump.point, start),
          distance =
            (relative[0] * direction[0] + relative[1] * direction[1]) / length;
        return Math.abs(cross(relative, direction)) / length < 1e-6 &&
          distance > 0 &&
          distance < length
          ? [{ ...jump, distance }]
          : [];
      })
      .sort((a, b) => a.distance - b.distance);
    projected.forEach((jump, index) => {
      const radius = Math.min(
        jump.radius,
        jump.distance / 2,
        (length - jump.distance) / 2,
        index ? (jump.distance - projected[index - 1].distance) / 2 : Infinity,
        index + 1 < projected.length
          ? (projected[index + 1].distance - jump.distance) / 2
          : Infinity,
      );
      if (radius < 1) return;
      const before = towards(jump.point, start, radius),
        after = towards(jump.point, end, radius);
      path += ` L${before.join(' ')} A${radius} ${radius} 0 0 1 ${after.join(' ')}`;
    });
    path += ` L${end.join(' ')}`;
    if (corners[at])
      path += ` Q${b.join(' ')} ${towards(b, points[at + 1], corners[at]).join(' ')}`;
  }
  return path;
}
