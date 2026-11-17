import {
  addArchitectureModule,
  createArchitectureLayerCell,
  createArchitectureModuleCell,
  architectureLayerIds,
  layoutArchitectureCells,
} from '@sue/board-architecture';
import {
  laneContains,
  lockedByAncestor,
  normalizeCellPositionOperations,
  type CellOperation,
  type CellStore,
  type NodeCell,
  type Point,
} from '@sue/board-core';
import type {
  FrameCanvasTool,
  FrameCanvasDrawingContext,
} from '@sue/board-react';

export function createArchitecturePlacementTool(
  shape: 'layer' | 'box' | 'store',
  language: 'zh' | 'en',
  onComplete: () => void,
): FrameCanvasTool {
  const build = (
    store: CellStore,
    frameId: string,
    points: Point[],
    context?: FrameCanvasDrawingContext,
  ): CellOperation[] => {
    if (!points.length) return [];
    const first = points[0],
      last = points.at(-1)!;
    const click = Math.hypot(last[0] - first[0], last[1] - first[1]) < 4;
    const id = context?.idFor('root') ?? crypto.randomUUID();
    const cell =
      shape === 'layer'
        ? createArchitectureLayerCell(
            id,
            `${(store.cells[architectureLayerIds(store, frameId).at(-1) ?? ''] as NodeCell<{ order: string }>)?.data?.order ?? ''}~`,
          )
        : createArchitectureModuleCell(id, shape);
    cell.geometry = {
      ...cell.geometry,
      derived: false,
      x: click ? first[0] : Math.min(first[0], last[0]),
      y: click ? first[1] : Math.min(first[1], last[1]),
      width: click
        ? cell.geometry.width
        : Math.max(80, Math.abs(last[0] - first[0])),
      height: click
        ? cell.geometry.height
        : Math.max(shape === 'layer' ? 80 : 32, Math.abs(last[1] - first[1])),
    };
    if (shape === 'layer') {
      cell.content = { label: language === 'zh' ? '架构层' : 'Layer' };
      return normalizeCellPositionOperations(store, [
        { type: 'insert_cell', parentId: frameId, cell },
      ]);
    }
    cell.data = { ...(cell.data as object), placed: true };
    const layout = layoutArchitectureCells(store, frameId);
    const owner = [...architectureLayerIds(store, frameId)]
      .reverse()
      .find((layerId) => {
        const bounds = layout.get(layerId)!;
        return laneContains(
          {
            ...bounds,
            y: bounds.y + 44,
            height: Math.max(0, bounds.height - 44),
          },
          cell.geometry,
        );
      });
    if (owner && (store.cells[owner].locked || lockedByAncestor(store, owner)))
      throw new Error('Architecture layer is locked');
    return normalizeCellPositionOperations(
      store,
      addArchitectureModule(store, owner ?? frameId, cell),
    );
  };
  return {
    mode: 'box',
    key: `architecture.${shape}`,
    preview: build,
    complete: build,
    onComplete,
  };
}
