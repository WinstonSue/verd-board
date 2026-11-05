import {
  createFrameCell,
  edgeTerminalPosition,
  frameMinimumSize,
  isFrameCell,
  normalizeCellPositionOperations,
  roundFramePoint,
  snapEdgeTerminal,
  type CellOperation,
  type CellStore,
  type EdgeCell,
  type Point,
} from '@sue/board-core';
import {
  createFreehandCell,
  createGeometryCell,
  createTableCell,
  createVectorLineCell,
  gestureBounds,
  type FreehandCellData,
} from '@sue/board-draw';
import type {
  FrameCanvasDrawingContext,
  FrameCanvasTool,
} from '@sue/board-react';

/** One pure factory supplies both the visible draft and the committed cells. */
export function createFrameDrawingTool({
  pointer,
  shape,
  pen,
  onComplete,
  semanticSwimlane = false,
  frameFactories = {},
}: {
  pointer: string;
  shape: string;
  pen: FreehandCellData['shape'];
  frameFactories?: Record<
    string,
    (
      frameId: string,
      anchorId: string,
    ) => import('@sue/board-core').FrameSnapshot
  >;
  onComplete?(): void;
  semanticSwimlane?: boolean;
}): FrameCanvasTool {
  const key = `${pointer}:${pointer === 'shape' ? shape : pointer === 'pen' ? pen : ''}`;
  if (pointer === 'select' || pointer === 'hand' || pointer === 'erase')
    return { mode: pointer, key };
  const build = (
    store: CellStore,
    parentId: string,
    points: Point[],
    context?: FrameCanvasDrawingContext,
  ): CellOperation[] => {
    if (!points.length) return [];
    const allocate = context?.idFor ?? (() => crypto.randomUUID());
    const cellId = allocate('root');
    const frameBounds = () => {
      const geometry = gestureBounds(points, [560, 360]);
      return {
        ...geometry,
        width: Math.max(frameMinimumSize, geometry.width),
        height: Math.max(frameMinimumSize, geometry.height),
      };
    };
    const factory = frameFactories[pointer];
    if (factory) {
      const anchorId = allocate('anchor');
      const snapshot = factory(cellId, anchorId);
      const root = snapshot.store.cells[cellId];
      if (!isFrameCell(root)) return [];
      return [
        {
          type: 'insert_cell',
          parentId,
          cell: {
            ...root,
            geometry: frameBounds(),
            children: [],
          },
        },
        ...root.children.map((childId) => ({
          type: 'insert_cell' as const,
          parentId: cellId,
          cell: snapshot.store.cells[childId],
        })),
      ];
    }
    if (pointer === 'frame')
      return [
        {
          type: 'insert_cell',
          parentId,
          cell: createFrameCell(cellId, frameBounds()),
        },
      ];
    if (['arrow', 'bidirectional', 'line', 'curve'].includes(pointer)) {
      points = points.map(roundFramePoint);
      const tolerance = 12 / (context?.zoom ?? 1);
      const source = snapEdgeTerminal(
        store,
        parentId,
        points[0],
        'source',
        'arrow',
        tolerance,
      );
      const target = snapEdgeTerminal(
        store,
        parentId,
        points.at(-1)!,
        'target',
        'arrow',
        tolerance,
      );
      const edge: EdgeCell = {
        id: cellId,
        kind: 'arrow',
        cellType: 'edge',
        source,
        target,
        route: { mode: pointer === 'curve' ? 'curve' : 'straight' },
        data: {
          targetMarker: ['arrow', 'bidirectional'].includes(pointer)
            ? 'arrow'
            : 'none',
          sourceMarker: pointer === 'bidirectional' ? 'arrow' : 'none',
        },
      };
      if (pointer === 'curve') {
        const start = edgeTerminalPosition(store, source, target).point;
        const end = edgeTerminalPosition(store, target, source).point;
        const dx = end[0] - start[0],
          dy = end[1] - start[1];
        const length = Math.hypot(dx, dy);
        if (length < 1e-6) return [];
        const bow = Math.min(80, length / 4);
        edge.route = {
          mode: 'curve',
          points: [
            start,
            [
              (start[0] + end[0]) / 2 - (dy / length) * bow,
              (start[1] + end[1]) / 2 + (dx / length) * bow,
            ],
            end,
          ],
        };
      }
      return [{ type: 'insert_cell', parentId, cell: edge }];
    }
    if (pointer === 'vector-line') points = points.map(roundFramePoint);
    const cell =
      pointer === 'pen'
        ? createFreehandCell(cellId, points, pen)
        : pointer === 'table' || pointer === 'swimlane'
          ? createTableCell(
              cellId,
              points,
              3,
              pointer === 'swimlane' ? 2 : 3,
              pointer === 'swimlane',
            )
          : pointer === 'vector-line'
            ? createVectorLineCell(cellId, points)
            : createGeometryCell(
                cellId,
                pointer === 'text' ? 'text' : shape,
                points,
              );
    if (
      semanticSwimlane &&
      pointer === 'swimlane' &&
      cell.kind === 'swimlane' &&
      cell.data
    )
      return [
        {
          type: 'insert_cell',
          parentId,
          cell: { ...cell, data: { ...cell.data, laneMembers: {} } },
        },
      ];
    return [{ type: 'insert_cell', parentId, cell }];
  };
  return {
    key,
    mode:
      pointer === 'vector-line'
        ? 'polyline'
        : pointer === 'pen'
          ? 'path'
          : ['arrow', 'bidirectional', 'line', 'curve'].includes(pointer)
            ? 'line'
            : 'box',
    preview: (store, ...args) =>
      normalizeCellPositionOperations(store, build(store, ...args)),
    complete: (store, ...args) =>
      normalizeCellPositionOperations(store, build(store, ...args)),
    onComplete,
  };
}
