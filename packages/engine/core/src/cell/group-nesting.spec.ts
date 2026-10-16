import { describe, expect, it } from 'vitest';
import {
  applyCellOperations,
  copyCellFragment,
  createCellRegistry,
  createCellRuntime,
  deleteCells,
  groupCells,
  moveWhiteboardCells,
  pasteCellFragment,
  planCellPaste,
  reorderCells,
  selectionAllows,
  translateCellSelection,
} from './index';
import {
  createCellStore,
  createFrameCell,
  isFrameCell,
  isGroupCell,
  isNodeCell,
  type EdgeCell,
  type FrameCell,
  type NodeCell,
} from './types';
import { NodeUtil } from './util';

const node = (id: string, x: number): NodeCell => ({
  id,
  kind: 'geometry',
  cellType: 'node',
  geometry: { x, y: 0, width: 40, height: 20 },
});
const build = () => {
  let store = applyCellOperations(createCellStore(createFrameCell('root')), [
    ...['n1', 'n2', 'n3', 'n4'].map((id, index) => ({
      type: 'insert_cell' as const,
      parentId: 'root',
      cell: node(id, index * 50),
    })),
    {
      type: 'insert_cell',
      parentId: 'root',
      cell: createFrameCell('shell', { x: 300, y: 0, width: 80, height: 40 }),
    },
    {
      type: 'insert_cell',
      parentId: 'shell',
      cell: node('inner', 4),
    },
    {
      type: 'insert_cell',
      parentId: 'root',
      cell: {
        id: 'arrow',
        kind: 'arrow',
        cellType: 'edge',
        source: { point: [0, 0] },
        target: { point: [20, 0] },
        route: {
          mode: 'fixed',
          points: [
            [0, 0],
            [20, 0],
          ],
        },
      } satisfies EdgeCell,
    },
    {
      type: 'insert_cell',
      parentId: 'root',
      cell: createFrameCell('board2', { x: 0, y: 400, width: 200, height: 80 }),
    },
  ]);
  store = applyCellOperations(
    store,
    groupCells(store, 'root', ['n1', 'n2'], 'g1'),
  );
  store = applyCellOperations(
    store,
    groupCells(store, 'root', ['g1', 'n3'], 'g2'),
  );
  store = applyCellOperations(
    store,
    groupCells(store, 'root', ['g2', 'n4', 'shell', 'arrow'], 'g3'),
  );
  return store;
};

describe('three-level groups', () => {
  it('keeps nodes, arrows and a nested frame across move, copy, ungroup, reorder, transfer, delete and undo', () => {
    const store = build();
    const runtime = createCellRuntime({ store });
    const before = {
      n1: (store.cells.n1 as NodeCell).geometry.x,
      inner: (store.cells.inner as NodeCell).geometry.x,
      shell: (store.cells.shell as NodeCell).geometry.x,
    };
    runtime.transact({
      id: 'move',
      operations: translateCellSelection(store, ['g3'], [15, 0]),
    });
    expect((runtime.store.cells.n1 as NodeCell).geometry.x).toBe(
      before.n1 + 15,
    );
    expect((runtime.store.cells.n4 as NodeCell).geometry.x).toBe(
      (store.cells.n4 as NodeCell).geometry.x + 15,
    );
    expect((runtime.store.cells.shell as NodeCell).geometry.x).toBe(
      before.shell + 15,
    );
    expect((runtime.store.cells.inner as NodeCell).geometry.x).toBe(
      before.inner,
    );
    expect((runtime.store.cells.g3 as { members: string[] }).members).toEqual([
      'g2',
      'n4',
      'shell',
      'arrow',
    ]);
    expect((runtime.store.cells.arrow as EdgeCell).route).toMatchObject({
      points: [
        [15, 0],
        [35, 0],
      ],
    });
    runtime.undo();
    expect(runtime.store).toEqual(store);
    runtime.redo();
    runtime.undo();

    const locked = applyCellOperations(store, [
      {
        type: 'replace_cell',
        cell: { ...store.cells.n3, locked: true },
      },
    ]);
    expect(translateCellSelection(locked, ['g3'], [15, 0])).toEqual([]);

    runtime.transact({
      id: 'ungroup',
      operations: [{ type: 'remove_cell', cellId: 'g3' }],
    });
    expect(runtime.store.cells.g3).toBeUndefined();
    expect(isGroupCell(runtime.store.cells.g2)).toBe(true);
    expect((runtime.store.cells.g2 as { members: string[] }).members).toEqual([
      'g1',
      'n3',
    ]);
    runtime.undo();
    expect(isGroupCell(runtime.store.cells.g3)).toBe(true);

    const fragment = copyCellFragment(runtime.store, ['g3']);
    const plan = planCellPaste({
      store: runtime.store,
      frameId: 'root',
      selectionIds: [],
      fragment,
      allocateId: (id) => `c-${id}`,
      offset: [5, 0],
      intent: 'paste',
    });
    expect(plan.selection).toEqual({ focus: ['root'], ids: ['c-g3'] });
    runtime.transact({ id: 'copy', operations: plan.operations });
    expect(
      (runtime.store.cells['c-g3'] as { members: string[] }).members,
    ).toEqual(['c-g2', 'c-n4', 'c-shell', 'c-arrow']);
    expect((runtime.store.cells['c-inner'] as NodeCell).geometry.x).toBe(
      before.inner,
    );
    runtime.undo();

    runtime.transact({
      id: 'order',
      operations: reorderCells(runtime.store, 'root', ['g3'], 'front'),
    });
    const children = (runtime.store.cells.root as FrameCell).children;
    expect(children.slice(-6)).toEqual([
      'n1',
      'n2',
      'n3',
      'n4',
      'shell',
      'arrow',
    ]);
    runtime.undo();

    runtime.transact({
      id: 'transfer',
      operations: moveWhiteboardCells(runtime.store, ['g3'], 'board2'),
    });
    expect((runtime.store.cells.board2 as FrameCell).groups).toContain('g3');
    expect((runtime.store.cells.inner as NodeCell).geometry.x).toBe(
      before.inner,
    );
    runtime.undo();
    expect((runtime.store.cells.root as FrameCell).groups).toContain('g3');

    runtime.transact({
      id: 'delete',
      operations: deleteCells(runtime.store, ['g3']),
    });
    expect(runtime.store.cells.n1).toBeUndefined();
    expect(runtime.store.cells.shell).toBeUndefined();
    expect(runtime.store.cells.inner).toBeUndefined();
    runtime.undo();
    expect(isNodeCell(runtime.store.cells.inner)).toBe(true);
    expect(isFrameCell(runtime.store.cells.shell)).toBe(true);
    runtime.redo();
    runtime.undo();
  });

  it('refuses a mixed delete when one object cannot be deleted', () => {
    const store = build();
    class Fixed extends NodeUtil {
      readonly kind = 'geometry';
      override capabilities() {
        return {
          move: true,
          resize: true,
          rotate: true,
          delete: false,
          edit: true,
          connect: true,
        };
      }
    }
    const registry = createCellRegistry();
    registry.register(new Fixed());
    expect(selectionAllows(store, ['n1', 'n4'], registry, 'delete')).toBe(
      false,
    );
    expect(selectionAllows(store, ['arrow'], registry, 'delete')).toBe(true);
  });

  it('pastes a nested frame without shifting its interior and selects only the shell', () => {
    const store = build();
    const plan = planCellPaste({
      store,
      frameId: 'root',
      selectionIds: [],
      fragment: copyCellFragment(store, ['shell']),
      allocateId: (id) => `f-${id}`,
      offset: [10, 6],
      intent: 'paste',
    });
    expect(plan.selection).toEqual({ focus: ['root'], ids: ['f-shell'] });
    const next = applyCellOperations(store, plan.operations);
    expect((next.cells['f-shell'] as NodeCell).geometry.x).toBe(
      (store.cells.shell as NodeCell).geometry.x + 10,
    );
    expect((next.cells['f-inner'] as NodeCell).geometry).toEqual(
      (store.cells.inner as NodeCell).geometry,
    );
  });

  it('pastes a copied group without selecting its members', () => {
    const store = build();
    const pasted = applyCellOperations(
      store,
      pasteCellFragment(
        copyCellFragment(store, ['g1']),
        'root',
        (id) => `p-${id}`,
        [8, 0],
      ),
    );
    expect(isGroupCell(pasted.cells['p-g1'])).toBe(true);
    expect((pasted.cells['p-n1'] as NodeCell).geometry.x).toBe(
      (store.cells.n1 as NodeCell).geometry.x + 8,
    );
  });

  it('rejects a fragment that is not a complete cell without planning a change', () => {
    const board = createFrameCell('root');
    const store = createCellStore(board);
    expect(() =>
      planCellPaste({
        store,
        frameId: 'root',
        selectionIds: [],
        fragment: {
          cells: { missing: { id: 'missing' } as never },
          ids: ['nope'],
        },
        allocateId: (id) => `next-${id}`,
        intent: 'paste',
      }),
    ).toThrow(/Verd cells/);
    expect(store.cells.root).toEqual(board);
  });
});
