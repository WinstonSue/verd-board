import { describe, expect, it } from 'vitest';
import {
  createCellRegistry,
  createCellRuntime,
  type NodeCell,
  type MindChildData,
  type MindRootData,
} from '@sue/board-core';
import { MindLayoutType } from '@sue/board-layouts';
import { registerMindCells } from './cell-utils';
import {
  createMindFrameSnapshot,
  createMindChildCell,
  addMindChild,
} from './cell-commands';
import {
  mindTreeRootId,
  mindTreeLayout,
  mindTreeLayoutOverrides,
  setMindTreeLayout,
  setMindTreeRightNodeCount,
} from './cell-tree';

const runtime = (count = 3) => {
  const registry = createCellRegistry();
  registerMindCells(registry);
  const r = createCellRuntime(
    createMindFrameSnapshot('frame', 'root'),
    registry,
  );
  for (const id of Array.from({ length: count }, (_, i) => `n${i}`))
    r.transact({
      id,
      operations: addMindChild(
        r.store,
        'root',
        createMindChildCell(id),
        `e-${id}`,
      ),
    });
  return r;
};

const setLayout = (
  r: ReturnType<typeof runtime>,
  id: string,
  layout: string,
) => {
  const cell = r.store.cells[id] as NodeCell<MindChildData>;
  r.transact({
    id: 'local',
    operations: [
      {
        type: 'replace_cell',
        cell: { ...cell, data: { ...cell.data, layout } },
      },
    ],
  });
};

describe('mind tree layout operations', () => {
  it('finds the owning root from any descendant', () => {
    const r = runtime();
    expect(mindTreeRootId(r.store, 'n1')).toBe('root');
    expect(mindTreeRootId(r.store, 'root')).toBe('root');
  });

  it('reports the root layout for any selected topic', () => {
    const r = runtime();
    expect(mindTreeLayout(r.store, 'n0')).toBe(MindLayoutType.right);
    setMindTreeLayout(r.store, 'n1', MindLayoutType.downward).forEach(
      (operation) => r.transact({ id: 'x', operations: [operation] }),
    );
    expect(mindTreeLayout(r.store, 'n2')).toBe(MindLayoutType.downward);
  });

  it('clears local overrides across the tree in one operation set', () => {
    const r = runtime();
    setLayout(r, 'n0', 'upward');
    setLayout(r, 'n2', 'left');
    expect(mindTreeLayoutOverrides(r.store, 'n1')).toEqual(['n0', 'n2']);
    const operations = setMindTreeLayout(
      r.store,
      'n1',
      MindLayoutType.downward,
    );
    r.transact({ id: 'layout', operations });
    const root = r.store.cells.root as NodeCell<MindRootData>;
    expect(root.data?.layout).toBe(MindLayoutType.downward);
    expect(root.geometry.x).toBe(0);
    for (const id of ['n0', 'n1', 'n2'])
      expect(
        (r.store.cells[id] as NodeCell<MindChildData>).data?.layout,
      ).toBeUndefined();
    expect(mindTreeLayoutOverrides(r.store, 'n0')).toEqual([]);
  });

  it('clears overrides under collapsed subtrees', () => {
    const r = runtime();
    // Give n0 a collapsed child carrying a local override.
    r.transact({
      id: 'grandchild',
      operations: addMindChild(
        r.store,
        'n0',
        createMindChildCell('g0'),
        'e-g0',
      ),
    });
    const parent = r.store.cells.n0 as NodeCell<MindChildData>;
    r.transact({
      id: 'collapse',
      operations: [
        {
          type: 'replace_cell',
          cell: { ...parent, data: { ...parent.data, collapsed: true } },
        },
      ],
    });
    setLayout(r, 'g0', 'upward');
    const operations = setMindTreeLayout(
      r.store,
      'n0',
      MindLayoutType.standard,
    );
    r.transact({ id: 'layout', operations });
    expect(
      (r.store.cells.g0 as NodeCell<MindChildData>).data?.layout,
    ).toBeUndefined();
  });

  it('restores automatic allocation entering the bilateral layout', () => {
    const r = runtime(5);
    const root = r.store.cells.root as NodeCell<MindRootData>;
    r.transact({
      id: 'manual',
      operations: [
        {
          type: 'replace_cell',
          cell: { ...root, data: { ...root.data, rightNodeCount: 4 } },
        },
      ],
    });
    const operations = setMindTreeLayout(
      r.store,
      'n0',
      MindLayoutType.standard,
    );
    r.transact({ id: 'layout', operations });
    const after = r.store.cells.root as NodeCell<MindRootData>;
    expect(after.data?.layout).toBe(MindLayoutType.standard);
    expect(after.data?.rightNodeCount).toBeUndefined();
  });

  it('clears a legacy rightNodeCount of zero on relayout', () => {
    const r = runtime();
    const root = r.store.cells.root as NodeCell<MindRootData>;
    r.transact({
      id: 'legacy',
      operations: [
        {
          type: 'replace_cell',
          cell: { ...root, data: { ...root.data, rightNodeCount: 0 } },
        },
      ],
    });
    setMindTreeLayout(r.store, 'root', MindLayoutType.standard).forEach(
      (operation) => r.transact({ id: 'x', operations: [operation] }),
    );
    expect(
      (r.store.cells.root as NodeCell<MindRootData>).data?.rightNodeCount,
    ).toBeUndefined();
  });

  it('keeps a manual right split when the tree is already bilateral', () => {
    const r = runtime(5);
    const root = r.store.cells.root as NodeCell<MindRootData>;
    r.transact({
      id: 'manual',
      operations: [
        {
          type: 'replace_cell',
          cell: {
            ...root,
            data: {
              ...root.data,
              layout: MindLayoutType.standard,
              rightNodeCount: 2,
            },
          },
        },
      ],
    });
    setMindTreeLayout(r.store, 'root', MindLayoutType.standard).forEach(
      (operation) => r.transact({ id: 'x', operations: [operation] }),
    );
    expect(
      (r.store.cells.root as NodeCell<MindRootData>).data?.rightNodeCount,
    ).toBe(2);
  });

  it('emits no operations when the tree already matches', () => {
    const r = runtime();
    expect(setMindTreeLayout(r.store, 'n0', MindLayoutType.right)).toEqual([]);
  });

  it('unifies overrides even when the root already holds the target', () => {
    const r = runtime();
    setLayout(r, 'n1', 'upward');
    const operations = setMindTreeLayout(r.store, 'n1', MindLayoutType.right);
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({ type: 'replace_cell' });
  });

  it('validates the right-topic count and restores auto allocation', () => {
    const r = runtime(3);
    expect(() => setMindTreeRightNodeCount(r.store, 'n0', 5)).toThrow();
    expect(() => setMindTreeRightNodeCount(r.store, 'n0', 1.5)).toThrow();
    setMindTreeRightNodeCount(r.store, 'n0', 2).forEach((operation) =>
      r.transact({ id: 'n', operations: [operation] }),
    );
    expect(
      (r.store.cells.root as NodeCell<MindRootData>).data?.rightNodeCount,
    ).toBe(2);
    setMindTreeRightNodeCount(r.store, 'n0', undefined).forEach((operation) =>
      r.transact({ id: 'n2', operations: [operation] }),
    );
    expect(
      (r.store.cells.root as NodeCell<MindRootData>).data?.rightNodeCount,
    ).toBeUndefined();
  });
});
