import { expect, it, vi } from 'vitest';
import {
  applyCellOperations,
  createCellRegistry,
  createCellStore,
  createFrameCell,
  type CellOperation,
  type CellStore,
} from '@sue/board-core';
import {
  createWorkflowPlugin,
  createWorkflowStartCell,
} from '@sue/board-workflow';
import type { ActionExecution } from '@sue/board-common';
import type { FrameActionContext } from '@sue/board-react';
import { createWorkflowUIPlugin } from './plugin';

it('places subsequent workflow anchors beside existing graphs without moving their content', async () => {
  const registry = createCellRegistry({ plugins: [createWorkflowPlugin()] });
  const frame = createFrameCell('frame');
  frame.children = ['original'];
  const original = createWorkflowStartCell('original', [60, 80]);
  let store: CellStore = {
    ...createCellStore(frame),
    cells: { frame, original },
  };
  let sequence = 0;
  const runOperations = vi.fn(async (operations: readonly CellOperation[]) => {
    store = applyCellOperations(store, [...operations], registry);
    return { status: 'completed' as const };
  });
  const action = createWorkflowUIPlugin().actions!.find(
    (entry) => entry.id === 'workflow.start',
  )!;
  for (const x of [400, 740]) {
    const context = {
      store,
      frameId: 'frame',
      disabled: false,
      allocateId: () => `new-${++sequence}`,
      runOperations,
    } as unknown as FrameActionContext;
    await action.execute(
      context,
      undefined,
      {} as ActionExecution<FrameActionContext>,
    );
    expect(store.cells[`new-${sequence}`]).toMatchObject({
      geometry: { x, y: 80 },
      data: { origin: [x, 80] },
    });
    expect(store.cells.original).toEqual(original);
  }
  expect(runOperations).toHaveBeenCalledTimes(2);
});
