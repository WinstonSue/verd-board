import { describe, expect, it } from 'vitest';
import {
  applyCellOperations,
  copyCellFragment,
  pasteCellFragment,
} from './index';
import { createCellStore, createFrameCell, type NodeCell } from './types';
const node = (id: string): NodeCell => ({
  id,
  kind: 'geometry',
  cellType: 'node',
  geometry: { x: 10, y: 20, width: 100, height: 50 },
  ports: [{ id: 'right', side: 'right', direction: 'both' }],
});
describe('cell clipboard closure', () => {
  it('makes missing arrow endpoints free at their actual port', () => {
    const store = applyCellOperations(
      createCellStore(createFrameCell('root')),
      [
        { type: 'insert_cell', cell: node('a'), parentId: 'root' },
        { type: 'insert_cell', cell: node('b'), parentId: 'root' },
        {
          type: 'insert_cell',
          parentId: 'root',
          cell: {
            id: 'e',
            kind: 'arrow',
            cellType: 'edge',
            source: { cellId: 'a', portId: 'right' },
            target: { cellId: 'b' },
            route: { mode: 'auto' },
          },
        },
      ],
    );
    const fragment = copyCellFragment(store, ['e']);
    expect(fragment.cells.e).toMatchObject({
      source: { point: [110, 45] },
      target: { point: [60, 45] },
    });
  });
  it('moves the pasted frame shell without changing its internal coordinate system', () => {
    const store = applyCellOperations(
      createCellStore(createFrameCell('root')),
      [
        { type: 'insert_cell', cell: createFrameCell('f'), parentId: 'root' },
        { type: 'insert_cell', cell: node('a'), parentId: 'f' },
      ],
    );
    const fragment = copyCellFragment(store, ['f']);
    const pasted = applyCellOperations(
      store,
      pasteCellFragment(fragment, 'root', (id) => `copy-${id}`, [30, 40]),
    );
    expect(pasted.cells['copy-f']).toMatchObject({
      geometry: { x: 30, y: 40 },
      children: ['copy-a'],
    });
    expect(pasted.cells['copy-a']).toMatchObject({
      geometry: { x: 10, y: 20 },
    });
  });
});
