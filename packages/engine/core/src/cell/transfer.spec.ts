import { describe, expect, it } from 'vitest';
import {
  applyCellOperations,
  commitCellOperations,
  emptyCellHistory,
  undoCells,
} from './index';
import { createCellStore, createFrameCell, type NodeCell } from './types';
import { moveWhiteboardCells } from './transfer';
const node = (id: string): NodeCell => ({
  id,
  kind: 'geometry',
  cellType: 'node',
  geometry: { x: 20, y: 30, width: 100, height: 40 },
  ports: [{ id: 'r', side: 'right', direction: 'both' }],
});
const setup = () =>
  applyCellOperations(createCellStore(createFrameCell('root')), [
    { type: 'insert_cell', cell: createFrameCell('nested'), parentId: 'root' },
    { type: 'insert_cell', cell: node('a'), parentId: 'root' },
    { type: 'insert_cell', cell: node('b'), parentId: 'root' },
    {
      type: 'insert_cell',
      cell: { id: 'g', kind: 'group', cellType: 'group', members: ['a', 'b'] },
      parentId: 'root',
    },
    {
      type: 'insert_cell',
      cell: {
        id: 'e',
        kind: 'arrow',
        cellType: 'edge',
        source: { cellId: 'a', portId: 'r' },
        target: { cellId: 'b' },
        route: { mode: 'auto' },
      },
      parentId: 'root',
    },
  ]);
describe('whiteboard frame transfers', () => {
  it('rejects locked group members and locked targets without changing the store', () => {
    const store = setup();
    store.cells.a = { ...store.cells.a, locked: true };
    expect(() => moveWhiteboardCells(store, ['g'], 'nested')).toThrow('locked');
    expect(store.cells.nested).toMatchObject({ children: [] });
    store.cells.a = { ...store.cells.a, locked: false };
    store.cells.nested = { ...store.cells.nested, locked: true };
    expect(() => moveWhiteboardCells(store, ['g'], 'nested')).toThrow('locked');
  });
  it('dissolves partial groups and frees arrows across the boundary, with complete undo', () => {
    const store = setup();
    const next = commitCellOperations(
      store,
      emptyCellHistory(),
      moveWhiteboardCells(store, ['a'], 'nested'),
    );
    expect(next.store.cells.g).toBeUndefined();
    expect(next.store.cells.e).toMatchObject({
      source: { point: [120, 50] },
      target: { cellId: 'b' },
    });
    expect(next.store.cells.nested).toMatchObject({ children: ['a'] });
    expect(undoCells(next.store, next.history).store).toEqual(store);
  });
  it('moves full groups with their internal edges', () => {
    const next = applyCellOperations(
      setup(),
      moveWhiteboardCells(setup(), ['g'], 'nested'),
    );
    expect(next.cells.nested).toMatchObject({
      children: ['a', 'b', 'e'],
      groups: ['g'],
    });
    expect(next.cells.e).toMatchObject({
      source: { cellId: 'a' },
      target: { cellId: 'b' },
    });
  });
  it('rejects a frame being moved into a descendant before changing anything', () => {
    const store = applyCellOperations(setup(), [
      {
        type: 'insert_cell',
        cell: createFrameCell('child'),
        parentId: 'nested',
      },
    ]);
    expect(() => moveWhiteboardCells(store, ['nested'], 'child')).toThrow(
      'descendant',
    );
    expect(store.cells.root).toMatchObject({
      children: ['nested', 'a', 'b', 'e'],
    });
  });
});
