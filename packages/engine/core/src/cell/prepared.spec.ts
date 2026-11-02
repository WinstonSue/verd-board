import { expect, it, vi } from 'vitest';
import {
  createCellRegistry,
  applyCellOperations,
  changedCellIds,
  indexCells,
} from './index';
import { createCellRuntime } from './runtime';
import { createCellStore, createFrameCell } from './types';

it('reuses preparation, retains topology on content edits and rejects stale candidates', () => {
  const normalize = vi.fn((_before, candidate) => candidate);
  const registry = createCellRegistry({
    plugins: [{ id: 'count', install() {}, normalize }],
  });
  const runtime = createCellRuntime(
    { store: createCellStore(createFrameCell('root')) },
    registry,
  );
  const operation = {
    type: 'replace_cell' as const,
    cell: { ...runtime.store.cells.root, name: 'updated' },
  };
  const before = runtime.store,
    index = runtime.index;
  const expected = applyCellOperations(before, [operation], registry);
  expect(changedCellIds(before, expected)).toEqual(['root']);
  const notify = vi.fn();
  runtime.subscribe(notify);
  runtime.transact({ id: 'one', operations: [operation] }, expected);
  expect(normalize).toHaveBeenCalledTimes(1);
  expect(notify).toHaveBeenCalledTimes(1);
  expect(runtime.index).toBe(index);
  runtime.transact({ id: 'two', operations: [operation] }, expected);
  expect(normalize).toHaveBeenCalledTimes(2);
  expect(runtime.index).toEqual(indexCells(runtime.store, registry));
  runtime.undo();
  expect(runtime.store.cells.root.name).not.toBe('updated');
});
it('a failing batch never changes the source store', () => {
  const store = createCellStore(createFrameCell('root'));
  expect(() =>
    applyCellOperations(store, [
      {
        type: 'replace_cell',
        cell: { ...store.cells.root, name: 'candidate' },
      },
      { type: 'remove_cell', cellId: 'missing' },
    ]),
  ).toThrow();
  expect(store.cells.root.name).not.toBe('candidate');
});
