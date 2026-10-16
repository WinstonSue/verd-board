import { describe, expect, it } from 'vitest';
import {
  alignCells,
  arrangeCells,
  arrangementAvailability,
  collectArrangementBlocks,
  distributeCells,
} from './arrangement';
import {
  applyCellOperations,
  createCellRuntime,
  groupCells,
  groupBounds,
  setCellsLocked,
  translateCellSelection,
  ungroupCells,
  deleteCells,
  selectionAllows,
} from './index';
import {
  createCellStore,
  createFrameCell,
  type CellStore,
  type NodeCell,
  type EdgeCell,
  type GroupCell,
} from './types';

const node = (
  id: string,
  x: number,
  y = 0,
  width = 40,
  height = 20,
): NodeCell => ({
  id,
  cellType: 'node',
  kind: 'geometry',
  geometry: { x, y, width, height },
});
const fixture = () =>
  applyCellOperations(
    createCellStore(createFrameCell('root')),
    ['a', 'b', 'c', 'd'].map((id, i) => ({
      type: 'insert_cell' as const,
      parentId: 'root',
      cell: node(id, i * 100, i * 40),
    })),
  );
const geometry = (store: CellStore, id: string) =>
  (store.cells[id] as NodeCell).geometry;

describe('explicit arrangement', () => {
  it('aligns rotated visual bounds in one reversible transaction', () => {
    const store = applyCellOperations(fixture(), [
      {
        type: 'replace_cell',
        cell: {
          ...node('a', -50),
          geometry: { ...node('a', -50).geometry, rotation: Math.PI / 2 },
        },
      },
    ]);
    const runtime = createCellRuntime({ store });
    runtime.transact({
      id: 'align',
      operations: alignCells(store, ['a', 'b'], 'left'),
    });
    expect(
      collectArrangementBlocks(runtime.store, 'root', ['a', 'b']).map((b) =>
        Math.round(b.bounds.x),
      ),
    ).toEqual([-40, -40]);
    expect(runtime.history.undos).toHaveLength(1);
    runtime.undo();
    expect(runtime.store).toEqual(store);
  });

  it.each(['horizontal', 'vertical'] as const)(
    'distributes different sizes along %s with fixed ends and bounded rounding',
    (axis) => {
      let store = fixture();
      store = applyCellOperations(store, [
        { type: 'replace_cell', cell: node('b', 93, 62, 61, 37) },
      ]);
      const next = applyCellOperations(
        store,
        distributeCells(store, ['d', 'b', 'a', 'c'], axis),
      );
      expect(geometry(next, 'a')).toEqual(geometry(store, 'a'));
      expect(geometry(next, 'd')).toEqual(geometry(store, 'd'));
      const p = axis === 'horizontal' ? 'x' : 'y',
        size = axis === 'horizontal' ? 'width' : 'height';
      const sorted = ['a', 'b', 'c', 'd']
        .map((id) => geometry(next, id))
        .sort((a, b) => a[p] - b[p]);
      const gaps = sorted
        .slice(1)
        .map((g, i) => g[p] - sorted[i][p] - sorted[i][size]);
      expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1);
      expect(distributeCells(store, ['a', 'b'], axis)).toEqual([]);
    },
  );

  it('moves nested groups and their free routes as one block, keeping Frame interiors intact', () => {
    let store = applyCellOperations(fixture(), [
      { type: 'replace_cell', cell: node('d', 300, 500) },
      {
        type: 'insert_cell',
        parentId: 'root',
        cell: createFrameCell('shell', {
          x: 400,
          y: 100,
          width: 80,
          height: 60,
        }),
      },
      { type: 'insert_cell', parentId: 'shell', cell: node('inside', 7, 13) },
      {
        type: 'insert_cell',
        parentId: 'root',
        cell: {
          id: 'edge',
          kind: 'arrow',
          cellType: 'edge',
          source: { point: [10, 20] },
          target: { point: [30, 40] },
          route: {
            mode: 'fixed',
            points: [
              [10, 20],
              [30, 40],
            ],
          },
        } as EdgeCell,
      },
    ]);
    store = applyCellOperations(
      store,
      groupCells(store, 'root', ['a', 'b', 'edge'], 'inner'),
    );
    store = applyCellOperations(
      store,
      groupCells(store, 'root', ['inner', 'shell'], 'outer'),
    );
    const next = applyCellOperations(
      store,
      alignCells(store, ['outer', 'd'], 'bottom'),
    );
    const dy = geometry(next, 'a').y - geometry(store, 'a').y;
    expect(geometry(next, 'b').y - geometry(store, 'b').y).toBe(dy);
    expect((next.cells.edge as EdgeCell).source).toEqual({
      point: [10, 20 + dy],
    });
    expect(geometry(next, 'inside')).toEqual(geometry(store, 'inside'));
    expect(groupBounds(next, 'outer')).toBeDefined();
    expect(
      collectArrangementBlocks(next, 'root', ['outer', 'a', 'inner']),
    ).toHaveLength(1);
  });

  it('lays out only a selection, or the current Frame direct objects when empty', () => {
    const store = applyCellOperations(fixture(), [
      { type: 'insert_cell', parentId: 'root', cell: createFrameCell('shell') },
      { type: 'insert_cell', parentId: 'shell', cell: node('inside', 7, 13) },
    ]);
    const partial = applyCellOperations(
      store,
      arrangeCells(store, 'root', ['a', 'c'], 'horizontal'),
    );
    expect(geometry(partial, 'c').x).toBe(72);
    expect(geometry(partial, 'b')).toEqual(geometry(store, 'b'));
    const all = applyCellOperations(
      store,
      arrangeCells(store, 'root', [], 'grid'),
    );
    expect(geometry(all, 'inside')).toEqual(geometry(store, 'inside'));
    expect(() => arrangeCells(store, 'root', ['inside'], 'grid')).toThrow(
      'crosses frame',
    );
  });

  it('rejects cross-Frame scope and prevents locked objects from being partly arranged', () => {
    let store = applyCellOperations(fixture(), [
      { type: 'insert_cell', parentId: 'root', cell: createFrameCell('shell') },
      { type: 'insert_cell', parentId: 'shell', cell: node('inside', 7) },
    ]);
    expect(() => alignCells(store, ['a', 'inside'], 'left')).toThrow(
      'crosses frame',
    );
    store = applyCellOperations(
      store,
      groupCells(store, 'root', ['a', 'b'], 'g1'),
    );
    store = applyCellOperations(
      store,
      groupCells(store, 'root', ['g1', 'c'], 'g2'),
    );
    store = applyCellOperations(
      store,
      groupCells(store, 'root', ['g2', 'd'], 'g3'),
    );
    store = applyCellOperations(store, setCellsLocked(store, ['g1'], true));
    expect(translateCellSelection(store, ['g3'], [10, 10])).toEqual([]);
    expect(ungroupCells(store, ['g3'])).toEqual([]);
    expect(
      arrangementAvailability(store, 'root', ['g3', 'shell'], {
        type: 'align',
        axis: 'top',
      }).enabled,
    ).toBe(false);
  });

  it('supports nested focus, nested regrouping and one-level ungrouping without changing z-order', () => {
    let store = fixture();
    store = applyCellOperations(
      store,
      groupCells(store, 'root', ['b', 'a', 'c'], 'g1'),
    );
    expect(
      (store.cells.root as ReturnType<typeof createFrameCell>).children.slice(
        0,
        3,
      ),
    ).toEqual(['a', 'b', 'c']);
    store = applyCellOperations(
      store,
      groupCells(store, 'root', ['a', 'b'], 'g2'),
    );
    const runtime = createCellRuntime({ store });
    runtime.select({ focus: ['root', 'g1', 'g2'], ids: ['a'] });
    runtime.transact({
      id: 'ungroup',
      operations: ungroupCells(store, ['g2']),
    });
    expect((runtime.store.cells.g1 as GroupCell).members).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(geometry(runtime.store, 'a')).toEqual(geometry(store, 'a'));
    expect(runtime.selection.focus).toEqual(['root', 'g1']);
    runtime.undo();
    expect(runtime.store).toEqual(store);
  });
});

it('locked groups protect nested Frame content and cascaded deletions', () => {
  let store = applyCellOperations(fixture(), [
    { type: 'insert_cell', parentId: 'root', cell: createFrameCell('shell') },
    { type: 'insert_cell', parentId: 'shell', cell: node('inside', 7) },
  ]);
  store = applyCellOperations(
    store,
    groupCells(store, 'root', ['shell', 'a'], 'group'),
  );
  store = applyCellOperations(store, setCellsLocked(store, ['group'], true));
  const runtime = createCellRuntime({ store });
  expect(selectionAllows(store, ['inside'], runtime.registry, 'edit')).toBe(
    false,
  );
  expect(() => deleteCells(store, ['shell'])).toThrow('locked content');
});
