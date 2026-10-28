import type { EdgeRoutingContext } from './edge';
import type { EdgeCell } from '../cell/types';
import type { Point } from '../interfaces/point';
import {
  isClearOrthogonalRoute,
  routeOrthogonalAvoiding,
  routingSegmentPenalty,
  separateOrthogonalSegments,
  type OrthogonalRoutingResult,
  type RoutingSegment,
} from './obstacle-route';
import {
  compactOrthogonalRoute,
  type CompactionRoute,
} from './route-compaction';

const segments = (points: readonly Point[]): RoutingSegment[] =>
  points.slice(1).map((end, at) => ({ start: points[at], end }));
const length = (points: readonly Point[]) =>
  segments(points).reduce(
    (sum, { start, end }) =>
      sum + Math.abs(end[0] - start[0]) + Math.abs(end[1] - start[1]),
    0,
  );
type Paths = Map<string, OrthogonalRoutingResult>;

/** Deterministic extra work, always measured against the default router's output. */
export function optimizeFrameRoutes(
  edges: readonly EdgeCell[],
  context: EdgeRoutingContext,
  fixed: readonly CompactionRoute[],
  crossingPenalty: number,
): void {
  const targets = edges.filter((edge) => context.optimizeIds?.has(edge.id));
  if (!targets.length) return;
  const baseline: Paths = new Map(
    edges.map((edge) => [edge.id, context.routes.get(edge.id)!.result]),
  );
  const fixedSegments = fixed.flatMap((route) =>
    segments(route.points).filter(
      ({ start, end }) => start[0] === end[0] || start[1] === end[1],
    ),
  );
  const occupied = (paths: Paths, id: string) => [
    ...fixedSegments,
    ...edges
      .filter((edge) => edge.id !== id)
      .flatMap((edge) => segments(paths.get(edge.id)!.points)),
  ];
  const totalLength = (paths: Paths) =>
    [...paths.values()].reduce((sum, route) => sum + length(route.points), 0);
  const baselineLength = totalLength(baseline);
  const score = (paths: Paths) => {
    let blocked = 0,
      cost = 0;
    for (let at = 0; at < edges.length; at++) {
      const path = paths.get(edges[at].id)!;
      if (path.status === 'blocked') blocked++;
      cost += length(path.points) + 24 * Math.max(0, path.points.length - 2);
      const other = [
        ...fixedSegments,
        ...edges
          .slice(at + 1)
          .flatMap((edge) => segments(paths.get(edge.id)!.points)),
      ];
      for (const { start, end } of segments(path.points))
        cost += routingSegmentPenalty(start, end, other, crossingPenalty);
    }
    return { blocked, cost };
  };
  const better = (a: ReturnType<typeof score>, b: ReturnType<typeof score>) =>
    a.blocked < b.blocked ||
    (a.blocked === b.blocked && a.cost < b.cost - 1e-6);
  let best = baseline,
    bestScore = score(baseline);
  for (const order of ['short', 'long', 'id'] as const) {
    const paths = new Map(baseline);
    let currentScore = score(paths);
    for (let pass = 0; pass < 2; pass++) {
      const crowded = [...targets]
        .sort((a, b) => {
          const congestion = (edge: EdgeCell) =>
            segments(paths.get(edge.id)!.points).reduce(
              (sum, { start, end }) =>
                sum +
                routingSegmentPenalty(
                  start,
                  end,
                  occupied(paths, edge.id),
                  crossingPenalty,
                ),
              0,
            );
          return congestion(b) - congestion(a) || a.id.localeCompare(b.id);
        })
        .slice(0, 16)
        .sort(
          (a, b) =>
            (order === 'id'
              ? 0
              : (order === 'short' ? 1 : -1) *
                (length(baseline.get(a.id)!.points) -
                  length(baseline.get(b.id)!.points))) ||
            a.id.localeCompare(b.id),
        );
      let changed = false;
      for (const edge of crowded) {
        const entry = context.routes.get(edge.id)!;
        const other = occupied(paths, edge.id);
        const options = {
          sourceId: 'cellId' in edge.source ? edge.source.cellId : undefined,
          targetId: 'cellId' in edge.target ? edge.target.cellId : undefined,
          clearance: context.clearance,
          strokeWidth: edge.appearance?.strokeWidth,
          occupied: other,
          crossingPenalty,
        };
        const routed = routeOrthogonalAvoiding(
          entry.source.point,
          entry.source.side,
          entry.target.point,
          entry.target.side,
          context.obstacles,
          options,
        );
        if (routed.status === 'blocked') continue;
        const separated = separateOrthogonalSegments(
          routed.points,
          entry.source.side,
          entry.target.side,
          context.obstacles,
          options,
        );
        const peers = [
          ...fixed,
          ...edges
            .filter((peer) => peer.id !== edge.id)
            .map((peer) => ({
              id: peer.id,
              points: paths.get(peer.id)!.points,
              bridgeable: true,
            })),
        ];
        const compacted = compactOrthogonalRoute(
          { id: edge.id, points: separated, bridgeable: true },
          entry.source.side,
          entry.target.side,
          context.obstacles,
          peers,
          options,
          0,
        );
        // Consider intermediate results too: cleanup must not discard a better route.
        for (const points of [
          routed.points,
          separated,
          ...(compacted ? [compacted.points] : []),
        ]) {
          if (
            length(points) > length(baseline.get(edge.id)!.points) * 1.2 + 48 ||
            !isClearOrthogonalRoute(
              points,
              entry.source.side,
              entry.target.side,
              context.obstacles,
              options,
            )
          )
            continue;
          const old = paths.get(edge.id)!;
          paths.set(edge.id, { status: 'routed', points });
          const next = score(paths);
          if (
            totalLength(paths) <= baselineLength * 1.1 + 1e-6 &&
            better(next, currentScore)
          ) {
            currentScore = next;
            changed = true;
          } else paths.set(edge.id, old);
        }
      }
      if (!changed) break;
    }
    if (better(currentScore, bestScore)) {
      best = paths;
      bestScore = currentScore;
    }
  }
  for (const edge of edges)
    context.routes.get(edge.id)!.result = best.get(edge.id)!;
}
