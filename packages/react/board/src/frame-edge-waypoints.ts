import {
  bindRouteTerminals,
  normalizeEdgeRoute,
  simplifyOrthogonal,
  type CellRegistry,
  type CellStore,
  type EdgeCell,
  type Point,
} from '@sue/board-core';

const samePoint = (a: Point, b: Point) => a[0] === b[0] && a[1] === b[1];

/** Reset authored points without freezing the next automatically derived route. */
export function planWaypointReset(
  edge: EdgeCell,
  registry: CellRegistry,
): EdgeCell | null {
  if (!('points' in edge.route) || !edge.route.points?.length) return null;
  const normalized = normalizeEdgeRoute(edge, registry);
  const route = normalized.route;
  return {
    ...normalized,
    route: {
      mode: route.mode === 'fixed' ? 'auto' : route.mode,
      ...('strategy' in route && route.strategy
        ? { strategy: route.strategy }
        : {}),
    },
  };
}
const length = (points: readonly Point[]) =>
  points
    .slice(1)
    .reduce(
      (total, point, index) =>
        total +
        Math.hypot(point[0] - points[index][0], point[1] - points[index][1]),
      0,
    );

/** Return a local edit, or null when removing this corner cannot simplify the route. */
export function planWaypointRemoval(
  store: CellStore,
  edge: EdgeCell,
  route: readonly Point[],
  index: number,
  registry: CellRegistry,
): EdgeCell | null {
  if (index <= 0 || index >= route.length - 1) return null;
  edge = normalizeEdgeRoute(edge, registry);
  if (edge.route.mode !== 'auto' && edge.route.mode !== 'orthogonal')
    return {
      ...edge,
      route: {
        ...edge.route,
        origin: 'manual',
        points: route
          .filter((_, at) => at !== index)
          .map((point) => [...point] as Point),
      },
    };
  const candidates: {
    points: Point[];
    span: number;
    length: number;
    key: string;
  }[] = [];
  for (let left = Math.max(0, index - 2); left < index; left++) {
    for (
      let right = index + 1;
      right <= Math.min(route.length - 1, index + 2);
      right++
    ) {
      const a = route[left],
        b = route[right];
      const bridges: Point[][] =
        a[0] === b[0] || a[1] === b[1]
          ? [[a, b]]
          : [
              [a, [a[0], b[1]], b],
              [a, [b[0], a[1]], b],
            ];
      for (const bridge of bridges) {
        let points = [
          ...route.slice(0, left),
          ...bridge,
          ...route.slice(right + 1),
        ];
        // Removing a reversal can expose an earlier collinear run.
        for (;;) {
          const simplified = simplifyOrthogonal(points);
          if (simplified.length === points.length) break;
          points = simplified;
        }
        if (
          points.length < 2 ||
          points.length >= route.length ||
          !samePoint(points[0], route[0]) ||
          !samePoint(points.at(-1)!, route.at(-1)!) ||
          points.slice(1, -1).some((point) => samePoint(point, route[index])) ||
          points.some(
            (point, at) =>
              at > 0 &&
              point[0] !== points[at - 1][0] &&
              point[1] !== points[at - 1][1],
          )
        )
          continue;
        candidates.push({
          points,
          span: right - left,
          length: length(points),
          key: JSON.stringify(points),
        });
      }
    }
  }
  // Flatten a local detour before preferring a smaller edit that only moves it.
  candidates.sort(
    (a, b) =>
      a.points.length - b.points.length ||
      a.span - b.span ||
      a.length - b.length ||
      a.key.localeCompare(b.key),
  );
  const points = candidates[0]?.points;
  if (!points) return null;
  return {
    ...bindRouteTerminals(store, edge, route),
    route: {
      mode: 'orthogonal',
      origin: 'manual',
      points,
      ...(edge.route.strategy ? { strategy: edge.route.strategy } : {}),
    },
  };
}
