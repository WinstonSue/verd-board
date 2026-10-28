import {
  distanceToPolyline,
  EdgeUtil,
  NodeUtil,
  unrotateNodePoint,
  type Cell,
  type CellRegistry,
  type CellStore,
  type NodeCell,
  type NodeGeometry,
  type Point,
} from '@sue/board-core';
import type { TableCellData } from './cell-commands';
import { validateTableData } from './cell-table';
import { hitVectorLine, type VectorLineData } from './path';
import { DrawKind } from './public-api';
export class TextNodeUtil extends NodeUtil {
  readonly kind = 'text';
}
export class GeometryNodeUtil extends NodeUtil {
  readonly kind = DrawKind.geometry;
}
export class ImageNodeUtil extends NodeUtil {
  readonly kind = DrawKind.image;
}
export class TableNodeUtil extends NodeUtil {
  readonly kind: typeof DrawKind.table | typeof DrawKind.swimlane =
    DrawKind.table;
  override validate(_store: CellStore, cell: Cell) {
    return cell.cellType === 'node'
      ? validateTableData(cell as NodeCell<TableCellData>)
      : 'Table must be a node';
  }
  override resize(_store: CellStore, cell: Cell, geometry: NodeGeometry) {
    if (cell.cellType !== 'node') return [];
    const data = cell.data as TableCellData;
    const sx = cell.geometry.width ? geometry.width / cell.geometry.width : 1,
      sy = cell.geometry.height ? geometry.height / cell.geometry.height : 1;
    return [
      {
        type: 'replace_cell' as const,
        cell: {
          ...cell,
          geometry,
          data: {
            ...data,
            rows: data.rows.map((row) => ({
              ...row,
              height: row.height === undefined ? undefined : row.height * sy,
            })),
            columns: data.columns.map((column) => ({
              ...column,
              width: column.width === undefined ? undefined : column.width * sx,
            })),
          },
        },
      },
    ];
  }
}
export class SwimlaneNodeUtil extends TableNodeUtil {
  override readonly kind: typeof DrawKind.table | typeof DrawKind.swimlane =
    DrawKind.swimlane;
}
export class FreehandNodeUtil extends NodeUtil {
  readonly kind: string = DrawKind.freehand;
  override resize(_store: CellStore, cell: Cell, geometry: NodeGeometry) {
    if (cell.cellType !== 'node') return [];
    const data = cell.data as { points?: Point[] } | undefined;
    const sx = cell.geometry.width ? geometry.width / cell.geometry.width : 1,
      sy = cell.geometry.height ? geometry.height / cell.geometry.height : 1;
    return [
      {
        type: 'replace_cell' as const,
        cell: {
          ...cell,
          geometry,
          data: {
            ...data,
            points: data?.points?.map(([x, y]) => [x * sx, y * sy] as Point),
          },
        },
      },
    ];
  }
  override rotate(_store: CellStore, cell: Cell, geometry: NodeGeometry) {
    return cell.cellType === 'node'
      ? [{ type: 'replace_cell' as const, cell: { ...cell, geometry } }]
      : [];
  }
  override hitTest(
    _store: CellStore,
    cell: NodeCell,
    point: Point,
    tolerance = 6,
  ): boolean {
    const points =
      (cell.data as { points?: Point[] } | undefined)?.points ?? [];
    return (
      distanceToPolyline(
        unrotateNodePoint(cell.geometry, point),
        points.map(([x, y]) => [x + cell.geometry.x, y + cell.geometry.y]),
      ) <=
      tolerance + (cell.appearance?.strokeWidth ?? 3) / 2
    );
  }
}
export class VectorLineNodeUtil extends FreehandNodeUtil {
  override readonly kind = DrawKind.vectorLine;
  override validate(_store: CellStore, cell: Cell) {
    const data =
      cell.cellType === 'node'
        ? (cell.data as VectorLineData | undefined)
        : undefined;
    return cell.cellType !== 'node' ||
      !data ||
      !['straight', 'curve'].includes(data.shape) ||
      !Array.isArray(data.points) ||
      data.points.length < 2 ||
      data.points.some(
        (point) =>
          !Array.isArray(point) ||
          point.length !== 2 ||
          point.some((value) => !Number.isFinite(value)),
      )
      ? 'Invalid vector line points or shape'
      : undefined;
  }
  override hitTest(
    _store: CellStore,
    cell: NodeCell,
    point: Point,
    tolerance = 6,
  ) {
    return hitVectorLine(cell as NodeCell<VectorLineData>, point, tolerance);
  }
}
export class ArrowEdgeUtil extends EdgeUtil {
  readonly kind = DrawKind.arrow;
}
export const registerDrawCells = (registry: CellRegistry) => {
  [
    new GeometryNodeUtil(),
    new TextNodeUtil(),
    new ImageNodeUtil(),
    new TableNodeUtil(),
    new SwimlaneNodeUtil(),
    new FreehandNodeUtil(),
    new VectorLineNodeUtil(),
    new ArrowEdgeUtil(),
  ].forEach((util) => registry.register(util));
};
