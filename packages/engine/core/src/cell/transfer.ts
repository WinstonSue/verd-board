import { resolveTerminal } from '../terminal/resolve';
import type { Terminal } from '../terminal/types';

import type { Point } from '../interfaces/point';
import { copyCellFragment } from './clipboard';
import { convertFramePoint, frameScene } from './frame';
import { indexCells, type CellOperation } from './index';
import { normalizeCellPositionOperations } from './position';
import { createCellRegistry, type CellRegistry } from './registry';
import {
  isEdgeCell,
  isFrameCell,
  isGroupCell,
  isNodeCell,
  type CellStore,
} from './types';

const terminalPosition = (store: CellStore, terminal: Terminal): Point => {
  const position = resolveTerminal(store, terminal, undefined, {
    automatic: 'center',
  });
  if (!position) throw new Error('Missing transfer endpoint');
  return [...position.point];
};

/** Moves whiteboard content and complete embedded frames while retaining their internal coordinates. */
export const moveWhiteboardCells = (
  store: CellStore,
  ids: readonly string[],
  targetFrameId: string,
  geometryStore: CellStore = store,
  registry: CellRegistry = createCellRegistry(),
): CellOperation[] => {
  const target = store.cells[targetFrameId];
  if (!isFrameCell(target) || frameScene(store, targetFrameId, registry))
    throw new Error('Transfer target must be a whiteboard frame');
  const index = indexCells(store);
  const sourceIds = new Set(ids.map((id) => index.parentOf.get(id)));
  if (sourceIds.size !== 1 || sourceIds.has(undefined))
    throw new Error('Transfer selection must have one source frame');
  const sourceFrameId = [...sourceIds][0]!;
  if (sourceFrameId === targetFrameId) return [];
  if (frameScene(store, sourceFrameId, registry))
    throw new Error('Transfer source must be a whiteboard frame');
  const fragment = copyCellFragment(store, ids, registry);
  const included = new Set(Object.keys(fragment.cells));
  if (
    target.locked ||
    store.cells[sourceFrameId].locked ||
    [...included].some(
      (id) =>
        store.cells[id].locked ||
        store.cells[index.groupOf.get(id) ?? '']?.locked,
    )
  )
    throw new Error('Cannot transfer locked content');
  if (included.has(targetFrameId))
    throw new Error('Cannot move a frame into its descendant');
  const moved = new Set(fragment.ids);
  const operations: CellOperation[] = [];
  const convert = (point: Point) =>
    convertFramePoint(geometryStore, point, sourceFrameId, targetFrameId);
  // Sever boundary relationships in the source frame before moving their nodes.
  Object.values(store.cells).forEach((cell) => {
    if (isEdgeCell(cell) && !included.has(cell.id)) {
      const sourceMoved =
        'cellId' in cell.source && moved.has(cell.source.cellId);
      const targetMoved =
        'cellId' in cell.target && moved.has(cell.target.cellId);
      if (!sourceMoved && !targetMoved) return;
      operations.push(
        registry.get(cell.kind)?.freeTerminals === true
          ? {
              type: 'replace_cell',
              cell: {
                ...cell,
                source: sourceMoved
                  ? { point: terminalPosition(geometryStore, cell.source) }
                  : cell.source,
                target: targetMoved
                  ? { point: terminalPosition(geometryStore, cell.target) }
                  : cell.target,
              },
            }
          : { type: 'remove_cell', cellId: cell.id },
      );
    }
    if (
      isGroupCell(cell) &&
      !included.has(cell.id) &&
      cell.members.some((id) => moved.has(id))
    ) {
      const members = cell.members.filter((id) => !moved.has(id));
      operations.push(
        members.length < 2
          ? { type: 'remove_cell', cellId: cell.id }
          : { type: 'replace_cell', cell: { ...cell, members } },
      );
    }
  });
  fragment.ids.forEach((id, at) => {
    let cell = fragment.cells[id];
    if (isNodeCell(cell)) {
      const geometry = geometryStore.cells[id];
      const position = convert(
        isNodeCell(geometry)
          ? [geometry.geometry.x, geometry.geometry.y]
          : [cell.geometry.x, cell.geometry.y],
      );
      cell = {
        ...cell,
        geometry: { ...cell.geometry, x: position[0], y: position[1] },
      };
    } else if (isEdgeCell(cell)) {
      cell = {
        ...cell,
        source:
          'point' in cell.source
            ? { point: convert(cell.source.point) }
            : cell.source,
        target:
          'point' in cell.target
            ? { point: convert(cell.target.point) }
            : cell.target,
        route:
          'points' in cell.route && cell.route.points
            ? { ...cell.route, points: cell.route.points.map(convert) }
            : cell.route,
      };
    }
    operations.push(
      { type: 'replace_cell', cell },
      {
        type: 'move_cell',
        cellId: id,
        parentId: targetFrameId,
        index: target.children.length + at,
      },
    );
  });
  return normalizeCellPositionOperations(store, operations);
};
