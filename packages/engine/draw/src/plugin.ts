import {
  groupAncestors,
  isNodeCell,
  type Cell,
  type CellPlugin,
} from '@sue/board-core';
import { mapBoardTextLinks, type BoardTextDocument } from '@sue/board-common';
import type { TableCellData } from './cell-commands';
import { registerDrawCells } from './cell-utils';
import {
  normalizeSwimlaneMembers,
  remapSwimlaneMembers,
  swimlaneTracks,
} from './swimlane-members';

export const createDrawPlugin = (): CellPlugin => ({
  id: 'draw',
  scenes: [],
  normalize: normalizeSwimlaneMembers,
  remap: remapSwimlaneMembers,
  copyReferences: (store, cell) =>
    swimlaneTracks(cell).flatMap((track) =>
      track.members.flatMap((id) => [id, ...groupAncestors(store, id)]),
    ),
  mapLinks(cell, rewriteHref) {
    if (!isNodeCell(cell) || !['table', 'swimlane'].includes(cell.kind))
      return cell;
    const data = cell.data as TableCellData | undefined;
    if (!Array.isArray(data?.cells)) return cell;
    let changed = false;
    const cells = data.cells.map((entry) => {
      const text = mapBoardTextLinks(entry.text, rewriteHref) as
        BoardTextDocument | undefined;
      if (text === entry.text) return entry;
      changed = true;
      return { ...entry, text };
    });
    return changed ? { ...cell, data: { ...data, cells } } : cell;
  },
  install(registry) {
    registerDrawCells({
      ...registry,
      register(util) {
        Object.assign(util, {
          fitText: util.kind === 'geometry',
          canConnect: (node: Cell) => isNodeCell(node),
          freeTerminals: util.kind === 'arrow',
          groupable: true,
        });
        registry.register(util);
      },
    });
  },
});
