import type { CellRegistry } from './registry';
import { isEdgeCell, type CellStore, type EdgeCell } from './types';
import type { Point } from '../interfaces/point';

export const isOrthogonalPolyline = (points: readonly Point[]) =>
  points.every(
    (point, index) =>
      index === 0 ||
      point[0] === points[index - 1][0] ||
      point[1] === points[index - 1][1],
  );

export function normalizeEdgeRoute(
  edge: EdgeCell,
  registry?: CellRegistry,
): EdgeCell {
  if (!registry?.get(edge.kind)?.orthogonalRoute || edge.route.mode === 'auto')
    return edge;
  const route = edge.route;
  if (
    'points' in route &&
    route.points &&
    (route.points.length < 2 ||
      route.points.some(
        (point) => point.length !== 2 || !point.every(Number.isFinite),
      ))
  )
    return edge;

  if (
    route.mode === 'orthogonal' &&
    (!route.points || isOrthogonalPolyline(route.points))
  )
    return edge;
  if (route.mode === 'fixed' && isOrthogonalPolyline(route.points))
    return {
      ...edge,
      route: { ...route, mode: 'orthogonal', points: route.points },
    };
  return {
    ...edge,
    route: {
      mode: 'orthogonal',
      ...(route.origin ? { origin: route.origin } : {}),
    },
  };
}

export function normalizeCellRoutes(
  store: CellStore,
  registry: CellRegistry,
): CellStore {
  let cells = store.cells;
  for (const cell of Object.values(store.cells)) {
    if (!isEdgeCell(cell)) continue;
    const edge = normalizeEdgeRoute(cell, registry);
    if (edge === cell) continue;
    if (cells === store.cells) cells = { ...cells };
    cells[edge.id] = edge;
  }
  return cells === store.cells ? store : { ...store, cells };
}
