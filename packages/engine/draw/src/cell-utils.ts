import {
  NodeUtil,
  EdgeUtil,
  CellKind,
  type CellRegistry,
  type CellStore,
  type NodeCell,
  type Point,
  type NodeGeometry,
  type Cell,
  distanceToPolyline,
  unrotateNodePoint,
  hitVectorLine,
  type VectorLineData,
} from '@sue/board-core';
import { validateTableData } from './cell-table';
import type { TableCellData } from './cell-commands';
export class GeometryNodeUtil extends NodeUtil {
  readonly kind = CellKind.geometry;
}
export class ImageNodeUtil extends NodeUtil {
  readonly kind = CellKind.image;
}
export class TableNodeUtil extends NodeUtil {
  readonly kind: typeof CellKind.table | typeof CellKind.swimlane =
    CellKind.table;
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
  override readonly kind: typeof CellKind.table | typeof CellKind.swimlane =
    CellKind.swimlane;
}
export class FreehandNodeUtil extends NodeUtil {
  readonly kind: string = CellKind.freehand;
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
  override readonly kind = CellKind.vectorLine;
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
  readonly kind = CellKind.arrow;
}
export const registerDrawCells = (registry: CellRegistry) => {
  [
    new GeometryNodeUtil(),
    new ImageNodeUtil(),
    new TableNodeUtil(),
    new SwimlaneNodeUtil(),
    new FreehandNodeUtil(),
    new VectorLineNodeUtil(),
    new ArrowEdgeUtil(),
  ].forEach((util) => registry.register(util));
};
