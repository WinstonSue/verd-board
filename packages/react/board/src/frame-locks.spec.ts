import { describe, expect, it } from 'vitest';
import {
  createCellStore,
  createFrameCell,
  lockedByAncestor,
  type CellStore,
  type NodeCell,
} from '@sue/board-core';
import { createFrameLockResolver } from './frame-locks';
describe('render snapshot lock index', () => {
  it('matches frame/group ancestor locks, excluding the cell itself, and refreshes with the store', () => {
    const root = createFrameCell('root'),
      nested = createFrameCell('nested');
    const node: NodeCell = {
      id: 'node',
      kind: 'geometry',
      cellType: 'node',
      geometry: { x: 0, y: 0, width: 10, height: 10 },
    };
    root.children = ['nested'];
    nested.children = ['node'];
    nested.groups = ['group'];
    const store: CellStore = {
      ...createCellStore(root),
      cells: {
        root,
        nested,
        node,
        group: {
          id: 'group',
          cellType: 'group',
          kind: 'group',
          members: ['node'],
        },
      },
    };
    for (const locked of ['root', 'nested', 'group', 'node', null]) {
      const next = structuredClone(store);
      if (locked) next.cells[locked].locked = true;
      const resolve = createFrameLockResolver(next);
      for (const id of Object.keys(next.cells))
        expect(resolve(id)).toBe(lockedByAncestor(next, id));
      expect(resolve('unknown')).toBe(false);
    }
  });
});
