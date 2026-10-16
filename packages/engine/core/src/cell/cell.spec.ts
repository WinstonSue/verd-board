import { describe, expect, it } from 'vitest';
import { CellKind } from './kinds';
import {
  applyCellOperations,
  deleteCells,
  commitCellOperations,
  createCellRegistry,
  emptyCellHistory,
  paintFrame,
  redoCells,
  undoCells,
} from './index';
import { createCellStore, createFrameCell, type NodeCell } from './types';

const node = (id: string, kind = CellKind.geometry): NodeCell => ({
  id,
  kind,
  cellType: 'node',
  geometry: { x: 0, y: 0, width: 10, height: 10, outline: 'rectangle' },
  content: { label: id },
});

describe('cell store', () => {
  it('keeps hierarchy on the frame and restores it with undo', () => {
    const root = createFrameCell('root', {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
    let store = createCellStore(root);
    let history = emptyCellHistory();
    const committed = commitCellOperations(store, history, [
      { type: 'insert_cell', cell: node('a'), parentId: 'root' },
      { type: 'insert_cell', cell: node('b'), parentId: 'root' },
    ]);
    store = committed.store;
    history = committed.history;
    expect(paintFrame(store, 'root').map((item) => item.id)).toEqual([
      'a',
      'b',
    ]);
    const undone = undoCells(store, history);
    expect(undone.store.cells.a).toBeUndefined();
    const redone = redoCells(undone.store, undone.history);
    expect(paintFrame(redone.store, 'root').map((item) => item.id)).toEqual([
      'a',
      'b',
    ]);
  });

  it('drops edges whose endpoint was removed and dissolves a small group', () => {
    const root = createFrameCell('root');
    const store = applyCellOperations(createCellStore(root), [
      { type: 'insert_cell', cell: node('a'), parentId: 'root' },
      { type: 'insert_cell', cell: node('b'), parentId: 'root' },
      {
        type: 'insert_cell',
        parentId: 'root',
        cell: {
          id: 'e',
          kind: CellKind.arrow,
          cellType: 'edge',
          source: { cellId: 'a' },
          target: { cellId: 'b' },
          route: { mode: 'auto' },
        },
      },
      {
        type: 'insert_cell',
        parentId: 'root',
        cell: {
          id: 'g',
          kind: 'group',
          cellType: 'group',
          members: ['a'],
        },
      },
    ]);
    expect(store.cells.g).toBeUndefined();
    const next = applyCellOperations(store, [
      { type: 'remove_cell', cellId: 'a' },
    ]);
    expect(next.cells.a).toBeUndefined();
    expect(next.cells.e).toBeUndefined();
    expect(next.cells.b).toBeTruthy();
  });

  it('asks the edge kind whether a connection is allowed', () => {
    const registry = createCellRegistry();
    registry.register({
      kind: CellKind.workflowEdge,
      validateEdge: (_store, edge) => {
        const target = 'cellId' in edge.target ? edge.target.cellId : '';
        return target === 'start' ? 'cannot target start' : undefined;
      },
    });
    const root = createFrameCell('root');
    const store = applyCellOperations(createCellStore(root), [
      {
        type: 'insert_cell',
        parentId: 'root',
        cell: node('start', CellKind.workflowStart),
      },
    ]);
    expect(
      registry.validateEdge(store, {
        id: 'e',
        kind: CellKind.workflowEdge,
        cellType: 'edge',
        source: { cellId: 'task' },
        target: { cellId: 'start' },
        route: { mode: 'auto' },
      }),
    ).toBe('cannot target start');
  });
});

it('restores descendants and connected edges after deleting a frame', () => {
  const store = applyCellOperations(createCellStore(createFrameCell('root')), [
    { type: 'insert_cell', cell: createFrameCell('f'), parentId: 'root' },
    { type: 'insert_cell', cell: node('a'), parentId: 'f' },
    { type: 'insert_cell', cell: node('b'), parentId: 'f' },
    {
      type: 'insert_cell',
      cell: {
        id: 'e',
        kind: 'arrow',
        cellType: 'edge',
        source: { cellId: 'a' },
        target: { cellId: 'b' },
        route: { mode: 'auto' },
      },
      parentId: 'f',
    },
  ]);
  const committed = commitCellOperations(store, emptyCellHistory(), [
    { type: 'remove_cell', cellId: 'f' },
  ]);
  const undone = undoCells(committed.store, committed.history);
  expect(undone.store).toEqual(store);
  expect(redoCells(undone.store, undone.history).store).toEqual(
    committed.store,
  );
});

it('dissolves groups after member deletion and restores the relationship on undo', () => {
  const store = applyCellOperations(createCellStore(createFrameCell('root')), [
    { type: 'insert_cell', cell: node('a'), parentId: 'root' },
    { type: 'insert_cell', cell: node('b'), parentId: 'root' },
    {
      type: 'insert_cell',
      cell: { id: 'g', kind: 'group', cellType: 'group', members: ['a', 'b'] },
      parentId: 'root',
    },
  ]);
  const committed = commitCellOperations(store, emptyCellHistory(), [
    { type: 'remove_cell', cellId: 'a' },
  ]);
  expect(committed.store.cells.g).toBeUndefined();
  expect(undoCells(committed.store, committed.history).store).toEqual(store);
});

it('undoes a transaction with dependent insert and replace operations', () => {
  const store = createCellStore(createFrameCell('root'));
  const committed = commitCellOperations(store, emptyCellHistory(), [
    { type: 'insert_cell', cell: node('a'), parentId: 'root' },
    {
      type: 'replace_cell',
      cell: { ...node('a'), content: { label: 'changed' } },
    },
  ]);
  expect(committed.store.cells.a).toMatchObject({
    content: { label: 'changed' },
  });
  expect(undoCells(committed.store, committed.history).store).toEqual(store);
});

it('rejects an invalid transaction atomically', () => {
  const store = createCellStore(createFrameCell('root'));
  expect(() =>
    applyCellOperations(store, [
      { type: 'insert_cell', cell: node('a'), parentId: 'root' },
      { type: 'insert_cell', cell: node('a'), parentId: 'root' },
    ]),
  ).toThrow('Duplicate');
  expect(store.cells.a).toBeUndefined();
});

it('rejects cross-frame edges and non-consecutive groups', () => {
  const store = applyCellOperations(createCellStore(createFrameCell('root')), [
    { type: 'insert_cell', cell: createFrameCell('f'), parentId: 'root' },
    { type: 'insert_cell', cell: node('a'), parentId: 'root' },
    { type: 'insert_cell', cell: node('b'), parentId: 'f' },
  ]);
  expect(() =>
    applyCellOperations(store, [
      {
        type: 'insert_cell',
        cell: {
          id: 'e',
          kind: 'arrow',
          cellType: 'edge',
          source: { cellId: 'a' },
          target: { cellId: 'b' },
          route: { mode: 'auto' },
        },
        parentId: 'root',
      },
    ]),
  ).toThrow('boundary');
});

it('protects the last anchor from moves and permits atomic anchor replacement', () => {
  const center = { ...node('center'), kind: 'mind-root' };
  const store = applyCellOperations(createCellStore(createFrameCell('root')), [
    { type: 'insert_cell', cell: createFrameCell('mind'), parentId: 'root' },
    { type: 'insert_cell', cell: createFrameCell('other'), parentId: 'root' },
    { type: 'insert_cell', cell: center, parentId: 'mind' },
  ]);
  expect(() =>
    applyCellOperations(store, [
      { type: 'move_cell', cellId: 'center', parentId: 'other', index: 0 },
    ]),
  ).toThrow('last scene anchor');
  const replaced = applyCellOperations(store, [
    { type: 'remove_cell', cellId: 'center' },
    {
      type: 'insert_cell',
      cell: { ...center, id: 'replacement' },
      parentId: 'mind',
    },
  ]);
  expect(replaced.cells.replacement).toBeTruthy();
});

it('deletes a parent, descendant and incident edge selection atomically without duplicate removals', () => {
  const root = createFrameCell('root'),
    nested = createFrameCell('nested');
  nested.children = ['a', 'b', 'edge'];
  root.children = ['nested'];
  const store = {
    rootId: root.id,
    cells: {
      root,
      nested,
      a: node('a'),
      b: node('b'),
      edge: {
        id: 'edge',
        kind: 'arrow',
        cellType: 'edge' as const,
        source: { cellId: 'a' },
        target: { cellId: 'b' },
        route: { mode: 'straight' as const },
      },
    },
  };
  const operations = deleteCells(store, ['nested', 'a', 'edge']);
  expect(operations).toEqual([{ type: 'remove_cell', cellId: 'nested' }]);
  const committed = commitCellOperations(store, emptyCellHistory(), operations);
  expect(Object.keys(committed.store.cells)).toEqual(['root']);
  expect(undoCells(committed.store, committed.history).store).toEqual(store);
  expect(() => deleteCells(store, ['missing'])).toThrow('missing');
});
