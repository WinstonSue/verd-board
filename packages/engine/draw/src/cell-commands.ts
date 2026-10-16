import { replaceVectorLinePoints, type VectorLineData } from '@sue/board-core';
import { type NodeCell, type Point, type PortSpec } from '@sue/board-core';
import {
  createInlineText,
  createBlockText,
  type BoardTextDocument,
} from '@sue/board-common';
import { createSwimlaneCell } from './cell-table';
export interface FreehandCellData {
  points: Point[];
  shape: 'nibPen' | 'feltTipPen' | 'artisticBrush' | 'markerHighlight';
}
export interface TableEntry {
  id: string;
  rowId: string;
  columnId: string;
  rowspan?: number;
  colspan?: number;
  text?: BoardTextDocument;
  textDirection?: 'horizontal' | 'vertical';
  fill?: string;
  role?: 'title' | 'lane' | 'body';
}
export interface TableCellData {
  rows: { id: string; height?: number }[];
  columns: { id: string; width?: number }[];
  cells: TableEntry[];
  direction?: 'horizontal' | 'vertical';
  header?: boolean;
}
export const drawCellPorts = (): PortSpec[] =>
  ['top', 'right', 'bottom', 'left'].map((side) => ({
    id: side,
    side: side as PortSpec['side'],
    direction: 'both',
  }));
export const gestureBounds = (
  points: Point[],
  defaultSize: Point = [160, 100],
) => {
  const first = points[0],
    last = points.at(-1)!;
  if (!first || !last) throw new Error('Drawing requires a point');
  const click = Math.hypot(last[0] - first[0], last[1] - first[1]) < 4;
  return {
    x: click ? first[0] : Math.min(first[0], last[0]),
    y: click ? first[1] : Math.min(first[1], last[1]),
    width: click ? defaultSize[0] : Math.max(8, Math.abs(last[0] - first[0])),
    height: click ? defaultSize[1] : Math.max(8, Math.abs(last[1] - first[1])),
  };
};
export const createGeometryCell = (
  id: string,
  shape: string,
  points: Point[],
): NodeCell => ({
  id,
  kind: 'geometry',
  cellType: 'node',
  geometry: {
    ...gestureBounds(points, shape === 'text' ? [180, 48] : [160, 100]),
    outline: shape,
  },
  ports: drawCellPorts(),
  appearance: {
    fill: shape === 'text' ? 'none' : '#fff',
    strokeColor: shape === 'text' ? 'none' : '#64748b',
    strokeWidth: 2,
  },
  content:
    shape === 'text'
      ? { label: 'Text', text: createInlineText('Text') }
      : undefined,
});
export const createFreehandCell = (
  id: string,
  points: Point[],
  shape: FreehandCellData['shape'] = 'feltTipPen',
): NodeCell<FreehandCellData> => {
  if (!points.length) throw new Error('Freehand requires points');
  const x = Math.min(...points.map((point) => point[0])),
    y = Math.min(...points.map((point) => point[1]));
  return {
    id,
    kind: 'freehand',
    cellType: 'node',
    geometry: {
      x,
      y,
      width: Math.max(1, Math.max(...points.map((point) => point[0])) - x),
      height: Math.max(1, Math.max(...points.map((point) => point[1])) - y),
    },
    appearance: {
      strokeColor: '#334155',
      strokeWidth:
        shape === 'markerHighlight' ? 16 : shape === 'artisticBrush' ? 6 : 3,
      opacity: shape === 'markerHighlight' ? 0.35 : 1,
    },
    data: { shape, points: points.map(([px, py]) => [px - x, py - y]) },
  };
};
export const createTableCell = (
  id: string,
  points: Point[],
  rows = 3,
  columns = 3,
  swimlane = false,
): NodeCell<TableCellData> => {
  if (swimlane)
    return createSwimlaneCell(id, points, 'horizontal', false, rows);
  if (
    !Number.isInteger(rows) ||
    !Number.isInteger(columns) ||
    rows < 1 ||
    columns < 1
  )
    throw new Error('Table requires rows and columns');
  const data: TableCellData = {
    rows: Array.from({ length: rows }, (_, i) => ({ id: `${id}-r${i}` })),
    columns: Array.from({ length: columns }, (_, i) => ({ id: `${id}-c${i}` })),
    cells: [],
    ...(swimlane ? { direction: 'horizontal' as const } : {}),
  };
  data.rows.forEach((row) =>
    data.columns.forEach((column) =>
      data.cells.push({
        id: `${row.id}-${column.id}`,
        rowId: row.id,
        columnId: column.id,
        text: createBlockText(''),
      }),
    ),
  );
  return {
    id,
    kind: swimlane ? 'swimlane' : 'table',
    cellType: 'node',
    geometry: gestureBounds(points, [420, 240]),
    appearance: { fill: '#fff', strokeColor: '#64748b', strokeWidth: 1 },
    data,
  };
};

export const createVectorLineCell = (
  id: string,
  points: Point[],
  shape: VectorLineData['shape'] = 'straight',
): NodeCell<VectorLineData> =>
  replaceVectorLinePoints(
    {
      id,
      kind: 'vector-line',
      cellType: 'node',
      geometry: { x: 0, y: 0, width: 1, height: 1 },
      appearance: {
        strokeColor: '#334155',
        strokeWidth: 2,
        fill: 'none',
        opacity: 1,
      },
      data: { points: [], shape },
    },
    points,
  );
