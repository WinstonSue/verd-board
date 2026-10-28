import {
  applyCellOperations,
  type EdgeCell,
  type NodeCell,
} from '@sue/board-core';
import { describe, expect, it } from 'vitest';
import { createTestCellRegistry } from '../../../../tests/fixtures/plugins/registry';
import {
  addMindChild,
  createMindChildCell,
  createMindFrameSnapshot,
  createMindSummary,
} from './cell-commands';
import { prepareMindReveal } from './cell-reveal';
import { layoutMindCells } from './cell-utils';

const fixture = () => {
  const registry = createTestCellRegistry();
  let store = createMindFrameSnapshot('frame', 'root').store;
  for (const [parent, id] of [
    ['root', 'a'],
    ['root', 'b'],
    ['a', 'leaf'],
  ])
    store = applyCellOperations(
      store,
      addMindChild(store, parent, createMindChildCell(id), `edge-${id}`),
      registry,
    );
  store = applyCellOperations(
    store,
    createMindSummary(store, 'root', 'a', 'b', 'summary', 'summary-edge'),
    registry,
  );
  for (const id of ['root', 'a']) {
    const node = store.cells[id] as NodeCell;
    store = {
      ...store,
      cells: {
        ...store.cells,
        [id]: { ...node, data: { ...(node.data as object), collapsed: true } },
      },
    };
  }
  return store;
};

describe('temporary Mind reveal plans', () => {
  it('opens only target ancestors without changing canonical content or layout', () => {
    const store = fixture();
    const before = structuredClone(store);
    expect(layoutMindCells(store, 'frame').has('leaf')).toBe(false);
    expect(new Set(prepareMindReveal(store, 'leaf'))).toEqual(
      new Set(['root', 'a']),
    );
    expect(prepareMindReveal(store, 'root')).toEqual([]);
    const expanded = layoutMindCells(store, 'frame', {
      expandedCellIds: new Set(prepareMindReveal(store, 'leaf')),
    });
    expect(expanded.has('leaf')).toBe(true);
    expect(layoutMindCells(store, 'frame').has('leaf')).toBe(false);
    expect(store).toEqual(before);
  });

  it('resolves branch endpoints and summary ranges and terminates malformed cycles', () => {
    const store = fixture();
    expect(new Set(prepareMindReveal(store, 'edge-leaf'))).toEqual(
      new Set(['root', 'a']),
    );
    expect(prepareMindReveal(store, 'summary')).toEqual(['root']);
    expect(prepareMindReveal(store, 'summary-edge')).toEqual(['root']);
    const cycle = structuredClone(store);
    const branch = cycle.cells['edge-a'] as EdgeCell;
    branch.source = { cellId: 'leaf' };
    expect(() => prepareMindReveal(cycle, 'leaf')).not.toThrow();
    expect(prepareMindReveal(store, 'missing')).toEqual([]);
  });
});
