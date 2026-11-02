import { expect, it, vi } from 'vitest';
import {
  createCellRegistry,
  indexCells,
  memoizeCellValidationRead,
  groupAncestors,
  lockedByAncestor,
} from './index';
import { validateCellStore } from './validation';
import { createCellStore, createFrameCell, type NodeCell } from './types';

it('reuses pure reads only within each complete validation and refreshes mutated inputs', () => {
  const frame = createFrameCell('root'),
    store = createCellStore(frame);
  for (let i = 0; i < 1000; i++) {
    const id = `n${i}`;
    frame.children.push(id);
    store.cells[id] = {
      id,
      kind: 'test-node',
      cellType: 'node',
      geometry: { x: i * 20, y: 0, width: 10, height: 10 },
    };
  }
  const read = vi.fn(() => Object.keys(store.cells).length),
    key = Symbol();
  const indexes = new Set();
  const registry = createCellRegistry();
  registry.register({
    kind: 'test-node',
    validate(candidate) {
      expect(memoizeCellValidationRead(candidate, key, read)).toBe(1001);
      indexes.add(indexCells(candidate));
      expect(groupAncestors(candidate, 'n0')).toEqual([]);
      expect(lockedByAncestor(candidate, 'n0')).toBe(false);
      return undefined;
    },
  });
  expect(validateCellStore(store, registry)).toEqual([]);
  expect(read).toHaveBeenCalledTimes(1);
  expect(indexes.size).toBe(1);
  (store.cells.n0 as NodeCell).geometry.width = -1;
  expect(
    validateCellStore(store, registry).some(
      (issue) => issue.message === 'Invalid geometry',
    ),
  ).toBe(true);
  expect(read).toHaveBeenCalledTimes(2);
  expect(indexes.size).toBe(2);
  memoizeCellValidationRead(store, key, read);
  memoizeCellValidationRead(store, key, read);
  expect(read).toHaveBeenCalledTimes(4);
});

it('cleans up scoped reads when a plugin throws', () => {
  const frame = createFrameCell('root'),
    store = createCellStore(frame),
    key = Symbol();
  const read = vi.fn(() => frame.name);
  const registry = createCellRegistry({
    plugins: [
      {
        id: 'throwing',
        install() {},
        validate(candidate) {
          memoizeCellValidationRead(candidate, key, read);
          throw new Error('plugin rejected');
        },
      },
    ],
  });
  expect(() => validateCellStore(store, registry)).toThrow('plugin rejected');
  frame.name = 'new';
  expect(memoizeCellValidationRead(store, key, read)).toBe('new');
  expect(read).toHaveBeenCalledTimes(2);
});
