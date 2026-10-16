import {
  isEdgeCell,
  isNodeCell,
  polylinePath,
  type CellStore,
  type EdgeCell,
  type MindSummaryData,
  type NodeGeometry,
  type Point,
} from '@sue/board-core';
import { mindChildIds } from './cell-utils';

export interface MindSummaryGeometry {
  path: string;
  start: Point;
  end: Point;
  siblings: string[];
  /** Visible branch bounds, including descendants, in the mounted Frame. */
  branches: Map<string, NodeGeometry>;
}

/** Brackets use layout geometry; saved endpoints always remain stable Cell ids. */
export const mindSummaryGeometry = (
  store: CellStore,
  edge: EdgeCell<MindSummaryData>,
  geometry: (id: string) => NodeGeometry | undefined,
): MindSummaryGeometry | undefined => {
  if (!edge.data || !('cellId' in edge.target)) return;
  const target = geometry(edge.target.cellId);
  const incoming = Object.values(store.cells).find(
    (cell) =>
      isEdgeCell(cell) &&
      cell.kind === 'mind-branch' &&
      'cellId' in cell.target &&
      cell.target.cellId === edge.data!.startSiblingId,
  );
  if (!target || !isEdgeCell(incoming) || !('cellId' in incoming.source))
    return;
  const siblings = mindChildIds(store, incoming.source.cellId);
  const start = siblings.indexOf(edge.data.startSiblingId),
    end = siblings.indexOf(edge.data.endSiblingId);
  if (start < 0 || end < start) return;
  const branches = new Map<string, NodeGeometry>();
  const subtree = (id: string): NodeGeometry | undefined => {
    const bounds = geometry(id),
      node = store.cells[id];
    if (!bounds || !isNodeCell(node) || node.hidden) return;
    const childIds = (node.data as { collapsed?: boolean } | undefined)
      ?.collapsed
      ? []
      : mindChildIds(store, id);
    const summaryIds = Object.values(store.cells).flatMap((cell) =>
      isEdgeCell(cell) &&
      cell.kind === 'mind-summary-edge' &&
      'cellId' in cell.target &&
      childIds.includes(
        (cell.data as MindSummaryData | undefined)?.startSiblingId ?? '',
      )
        ? [cell.target.cellId]
        : [],
    );
    const children = [...childIds, ...summaryIds]
      .map(subtree)
      .filter((g): g is NodeGeometry => !!g);
    const x = Math.min(bounds.x, ...children.map((g) => g.x)),
      y = Math.min(bounds.y, ...children.map((g) => g.y));
    return {
      x,
      y,
      width:
        Math.max(
          bounds.x + bounds.width,
          ...children.map((g) => g.x + g.width),
        ) - x,
      height:
        Math.max(
          bounds.y + bounds.height,
          ...children.map((g) => g.y + g.height),
        ) - y,
    };
  };
  siblings.forEach((id) => {
    const bounds = subtree(id);
    if (bounds) branches.set(id, bounds);
  });
  const covered = siblings
    .slice(start, end + 1)
    .flatMap((id) => (branches.has(id) ? [branches.get(id)!] : []));
  if (!covered.length) return;
  const x0 = Math.min(...covered.map((g) => g.x)),
    x1 = Math.max(...covered.map((g) => g.x + g.width)),
    y0 = Math.min(...covered.map((g) => g.y)),
    y1 = Math.max(...covered.map((g) => g.y + g.height));
  const horizontal = target.x + target.width <= x0 || target.x >= x1;
  const direction = horizontal
    ? target.x >= x1
      ? 1
      : -1
    : target.y >= y1
      ? 1
      : -1;
  const far = horizontal ? (direction > 0 ? x1 : x0) : direction > 0 ? y1 : y0;
  const near = horizontal
    ? direction > 0
      ? target.x
      : target.x + target.width
    : direction > 0
      ? target.y
      : target.y + target.height;
  const axis = (far + near) / 2;
  const first = horizontal ? y0 : x0,
    last = horizontal ? y1 : x1,
    middle = (first + last) / 2;
  const point = (along: number, cross: number): Point =>
    horizontal ? [along, cross] : [cross, along];
  const cap = Math.min(8, Math.abs(near - far) / 4);
  const startPoint = point(axis - direction * cap, first),
    endPoint = point(axis - direction * cap, last);
  const bracket = [
    startPoint,
    point(axis, first),
    point(axis, middle - cap),
    point(axis + direction * cap, middle),
    point(axis, middle + cap),
    point(axis, last),
    endPoint,
  ];
  const terminal = horizontal
    ? point(near, target.y + target.height / 2)
    : point(near, target.x + target.width / 2);
  return {
    path: `${polylinePath(bracket)} ${polylinePath([point(axis + direction * cap, middle), terminal])}`,
    start: startPoint,
    end: endPoint,
    siblings,
    branches,
  };
};
