import { describe, expect, it } from 'vitest';
import {
  createCellRuntime,
  createCellRegistry,
  createCellStore,
  createFrameCell,
  moveVectorLinePoint,
  pathNodePoints,
} from '@sue/board-core';
import { createVectorLineCell } from '../cell-commands';
import { registerDrawCells } from '../cell-utils';
describe('native vector line runtime', () => {
  it('rejects malformed path data atomically and restores inserted vertices with history', () => {
    const registry = createCellRegistry();
    registerDrawCells(registry);
    const runtime = createCellRuntime(
      { store: createCellStore(createFrameCell('root')) },
      registry,
    );
    const line = createVectorLineCell(
      'line',
      [
        [10, 20],
        [150, 20],
        [200, 100],
      ],
      'curve',
    );
    runtime.transact({
      id: 'create',
      operations: [{ type: 'insert_cell', cell: line, parentId: 'root' }],
    });
    const before = runtime.store;
    expect(() =>
      runtime.transact({
        id: 'invalid',
        operations: [
          {
            type: 'replace_cell',
            cell: {
              ...line,
              data: {
                ...line.data!,
                points: [
                  [NaN, 0],
                  [10, 0],
                ],
              },
            },
          },
        ],
      }),
    ).toThrow();
    expect(runtime.store).toBe(before);
    expect(runtime.history.undos).toHaveLength(1);
    const changed = moveVectorLinePoint(line, 0, [90, 60], true);
    runtime.transact({
      id: 'insert-point',
      operations: [{ type: 'replace_cell', cell: changed }],
    });
    expect(pathNodePoints(changed)).toHaveLength(4);
    runtime.undo();
    expect(runtime.store.cells.line).toEqual(line);
    runtime.redo();
    expect(runtime.store.cells.line).toEqual(changed);
  });
});
