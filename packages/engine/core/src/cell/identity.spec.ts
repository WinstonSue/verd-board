import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyCellOperations,
  commitCellOperations,
  emptyCellHistory,
  redoCells,
  undoCells,
} from './index';
import { createCellStore, createFrameCell, type NodeCell } from './types';
afterEach(() => vi.restoreAllMocks());
describe('transaction structural sharing', () => {
  it('keeps unaffected frames and memberships identical and records only the edited cell', () => {
    const root = createFrameCell('root');
    const store = createCellStore(root);
    for (let at = 0; at < 100; at++) {
      const cell: NodeCell = {
        id: `node-${at}`,
        kind: 'geometry',
        cellType: 'node',
        geometry: { x: at * 20, y: 0, width: 10, height: 10 },
        content: { label: 'Original' },
      };
      store.cells[cell.id] = cell;
      root.children.push(cell.id);
    }
    store.cells.group = {
      id: 'group',
      kind: 'group',
      cellType: 'group',
      members: ['node-0', 'node-1'],
    };
    root.groups.push('group');
    const previous = store.cells['node-0'] as NodeCell;
    const stringify = vi.spyOn(JSON, 'stringify');
    const committed = commitCellOperations(store, emptyCellHistory(), [
      {
        type: 'replace_cell',
        cell: { ...previous, content: { label: 'Edited' } },
      },
    ]);
    expect(committed.store.cells.root).toBe(root);
    expect(committed.store.cells.group).toBe(store.cells.group);
    expect(committed.store.cells['node-1']).toBe(store.cells['node-1']);
    expect(stringify.mock.calls.length).toBeLessThan(20);
    const entry = committed.history.undos[0];
    expect(entry.forward).toEqual([
      {
        type: 'patch_cells',
        cells: { 'node-0': committed.store.cells['node-0'] },
      },
    ]);
    const undone = undoCells(committed.store, committed.history);
    expect(undone.store.cells['node-0']).toEqual(previous);
    expect(redoCells(undone.store, undone.history).store).toEqual(
      committed.store,
    );
    const noop = commitCellOperations(committed.store, committed.history, [
      {
        type: 'replace_cell',
        cell: structuredClone(committed.store.cells['node-0']),
      },
    ]);
    expect(noop.store).toBe(committed.store);
    expect(noop.history).toBe(committed.history);
  });
  it('still prunes removed children and memberships after a transaction', () => {
    const root = createFrameCell('root');
    root.children = ['a', 'b'];
    root.groups = ['group'];
    const a: NodeCell = {
      id: 'a',
      kind: 'geometry',
      cellType: 'node',
      geometry: { x: 0, y: 0, width: 10, height: 10 },
    };
    const store = {
      ...createCellStore(root),
      cells: {
        root,
        a,
        b: { ...a, id: 'b' },
        group: {
          id: 'group',
          kind: 'group',
          cellType: 'group' as const,
          members: ['a', 'b'],
        },
      },
    };
    const next = applyCellOperations(store, [
      { type: 'remove_cell', cellId: 'a' },
    ]);
    expect(next.cells.root).not.toBe(root);
    expect(next.cells.root).toMatchObject({ children: ['b'], groups: [] });
    expect(next.cells.group).toBeUndefined();
  });
});
