import type { CellOperation } from './index';
import {
  isNodeCell,
  isEdgeCell,
  type Cell,
  type CellStore,
  type NodeGeometry,
  type EdgeTerminal,
} from './types';
import type { Point } from '../interfaces/point';

/** Integer pixels belong to the cell's owning Frame, never the screen. */
export const roundFramePoint = (point: Point): Point => [
  Math.round(point[0]) + 0,
  Math.round(point[1]) + 0,
];

export function roundNodePosition(geometry: NodeGeometry): NodeGeometry {
  const [x, y] = roundFramePoint([geometry.x, geometry.y]);
  return x === geometry.x && y === geometry.y
    ? geometry
    : { ...geometry, x, y };
}

/** Preserve invalid dimensions so validation can reject them. */
export function roundNodeDimensions(geometry: NodeGeometry): NodeGeometry {
  const round = (value: number) =>
    Number.isFinite(value) && value >= 0 ? Math.round(value) + 0 : value;
  const width = round(geometry.width),
    height = round(geometry.height);
  return width === geometry.width && height === geometry.height
    ? geometry
    : { ...geometry, width, height };
}

export const roundNodeGeometry = (geometry: NodeGeometry): NodeGeometry =>
  roundNodeDimensions(roundNodePosition(geometry));

const samePoint = (a: Point, b: Point) => a[0] === b[0] && a[1] === b[1];
const roundTerminal = (
  next: EdgeTerminal,
  previous?: EdgeTerminal,
): EdgeTerminal =>
  'point' in next &&
  (!previous ||
    !('point' in previous) ||
    !samePoint(next.point, previous.point))
    ? { point: roundFramePoint(next.point) }
    : next;

/** For authored edits only: loading and history must retain exact old values. */
export function normalizeCellPositionOperations(
  store: CellStore,
  operations: readonly CellOperation[],
): CellOperation[] {
  const normalize = (cell: Cell, inserted = false): Cell => {
    const previous = inserted ? undefined : store.cells[cell.id];
    if (isNodeCell(cell)) {
      const old = isNodeCell(previous) ? previous.geometry : undefined;
      let geometry = cell.geometry;
      if (!old || old.x !== geometry.x || old.y !== geometry.y)
        geometry = roundNodePosition(geometry);
      if (
        !old ||
        old.width !== geometry.width ||
        old.height !== geometry.height
      )
        geometry = roundNodeDimensions(geometry);
      return geometry === cell.geometry ? cell : { ...cell, geometry };
    }
    if (!isEdgeCell(cell)) return cell;
    const old = isEdgeCell(previous) ? previous : undefined;
    const source = roundTerminal(cell.source, old?.source);
    const target = roundTerminal(cell.target, old?.target);
    let route = cell.route;
    if (route.mode === 'curve' && route.points?.length) {
      // Endpoint caches must follow free terminal placement. The middle
      // control points retain the precision of the curve calculations.
      if (source !== cell.source || target !== cell.target) {
        const points = route.points.map((point) => [...point] as Point);
        if (source !== cell.source && 'point' in source)
          points[0] = source.point;
        if (target !== cell.target && 'point' in target)
          points[points.length - 1] = target.point;
        route = { ...route, points };
      }
    } else if (route.mode !== 'auto' && 'points' in route && route.points) {
      const points = route.points;
      const previousPoints =
        old && 'points' in old.route ? old.route.points : undefined;
      if (
        !previousPoints ||
        points.length !== previousPoints.length ||
        points.some((point, at) => !samePoint(point, previousPoints[at]))
      )
        route = { ...route, points: points.map(roundFramePoint) };
    }
    return { ...cell, source, target, route };
  };
  return operations.map((operation) => {
    if (operation.type === 'insert_cell')
      return { ...operation, cell: normalize(operation.cell, true) };
    if (operation.type === 'replace_cell')
      return { ...operation, cell: normalize(operation.cell) };
    if (operation.type === 'patch_cells')
      return {
        ...operation,
        cells: Object.fromEntries(
          Object.entries(operation.cells).map(([id, cell]) => [
            id,
            cell ? normalize(cell) : null,
          ]),
        ),
      };
    return operation;
  });
}
