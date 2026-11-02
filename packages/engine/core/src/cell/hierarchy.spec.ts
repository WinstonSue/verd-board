import { expect, it, vi } from 'vitest';
import {
  createCellHierarchy,
  focusedCellIds,
  groupAncestors,
  lockedByAncestor,
} from './group';
import { collectArrangementBlocks } from './arrangement';
import { createCellRegistry } from './registry';
import { createCellStore, createFrameCell, type GroupCell } from './types';

it.each([5000, 10000])(
  'bounds hierarchy scans while preparing %i snap candidates',
  (count) => {
    const frame = createFrameCell('root'),
      store = createCellStore(frame);
    for (let i = 0; i < count; i++) {
      const id = `n${i}`;
      frame.children.push(id);
      store.cells[id] = {
        id,
        cellType: 'node',
        kind: 'test-node',
        geometry: { x: i * 40, y: 0, width: 20, height: 20 },
      };
    }
    const registry = createCellRegistry();
    registry.register({ kind: 'test-node' });
    const values = Object.values;
    let scans = 0;
    const spy = vi.spyOn(Object, 'values').mockImplementation((value) => {
      if (value === store.cells) scans++;
      return values(value);
    });
    try {
      const ids = focusedCellIds(store, frame.id);
      const blocks = collectArrangementBlocks(store, frame.id, ids, registry);
      expect(blocks).toHaveLength(count);
      expect(blocks.every((block) => !block.locked)).toBe(true);
      expect(scans).toBeLessThanOrEqual(4);
    } finally {
      spy.mockRestore();
    }
  },
);

it('matches group and frame ancestor locks, refreshes each calculation and terminates on cycles', () => {
  const root = createFrameCell('root'),
    nested = createFrameCell('nested');
  const store = createCellStore(root);
  root.children = ['nested'];
  root.groups = ['outer'];
  nested.children = ['leaf'];
  nested.groups = ['inner'];
  const outer: GroupCell = {
    id: 'outer',
    kind: 'group',
    cellType: 'group',
    members: ['nested'],
    locked: true,
  };
  const inner: GroupCell = {
    id: 'inner',
    kind: 'group',
    cellType: 'group',
    members: ['leaf'],
  };
  store.cells = {
    ...store.cells,
    nested,
    outer,
    inner,
    leaf: {
      id: 'leaf',
      kind: 'test-node',
      cellType: 'node',
      geometry: { x: 0, y: 0, width: 20, height: 20 },
    },
  };
  const hierarchy = createCellHierarchy(store);
  for (const id of Object.keys(store.cells)) {
    expect(hierarchy.groupAncestors(id)).toEqual(groupAncestors(store, id));
    expect(hierarchy.lockedByAncestor(id)).toBe(lockedByAncestor(store, id));
  }
  expect(hierarchy.lockedByAncestor('leaf')).toBe(true);
  outer.locked = false;
  expect(createCellHierarchy(store).lockedByAncestor('leaf')).toBe(false);
  inner.members = ['inner', 'leaf'];
  expect(createCellHierarchy(store).groupAncestors('leaf')).toEqual(['inner']);
  expect(createCellHierarchy(store).lockedByAncestor('leaf')).toBe(false);
});
