import { describe, expect, it } from 'vitest';
import { createTestCellRegistry as createFixtureRegistry } from '../../../../../tests/fixtures/core/registry';
import { clearFrameCells } from './commands';
import { applyCellOperations } from './index';
import { createCellRuntime } from './runtime';
import { createCellStore, createFrameCell } from './types';
const testCellRegistry = createFixtureRegistry();
describe('clear mounted frame', () => {
  it('clears descendants and groups inside one frame without touching its sibling', () => {
    const store = applyCellOperations(
      createCellStore(createFrameCell('root')),
      [
        {
          type: 'insert_cell',
          parentId: 'root',
          cell: createFrameCell('inside'),
        },
        {
          type: 'insert_cell',
          parentId: 'inside',
          cell: createFrameCell('descendant'),
        },
        {
          type: 'insert_cell',
          parentId: 'root',
          cell: createFrameCell('sibling'),
        },
      ],
      testCellRegistry,
    );
    const runtime = createCellRuntime({ store }, testCellRegistry);
    runtime.transact({
      id: 'clear',
      operations: clearFrameCells(store, 'inside', testCellRegistry),
    });
    expect(runtime.store.cells.descendant).toBeUndefined();
    expect(runtime.store.cells.sibling).toEqual(store.cells.sibling);
    runtime.undo();
    expect(runtime.store).toEqual(store);
  });
});
