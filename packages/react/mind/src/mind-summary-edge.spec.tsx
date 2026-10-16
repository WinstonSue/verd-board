import React, { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { createCellRegistry, createCellRuntime } from '@sue/board-core';
import {
  addMindChild,
  createMindChildCell,
  createMindFrameSnapshot,
  createMindSummary,
  setMindSummaryRange,
} from '@sue/board-mind';
import {
  FrameCanvas,
  type FrameCanvasController,
  type FrameIntentResult,
} from '@sue/board-react';
import { createMindFrameExtensions } from './frame-extension';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const fixture = () => {
  const registry = createCellRegistry(),
    extensions = createMindFrameExtensions(registry);
  const runtime = createCellRuntime(
    createMindFrameSnapshot('frame', 'root'),
    registry,
  );
  for (const id of ['a', 'b'])
    runtime.transact({
      id,
      operations: addMindChild(
        runtime.store,
        'root',
        createMindChildCell(id),
        `branch-${id}`,
      ),
    });
  runtime.transact({
    id: 'summary',
    operations: createMindSummary(
      runtime.store,
      'root',
      'a',
      'b',
      'summary',
      'range',
    ),
  });
  return { registry, extensions, value: { store: runtime.store } };
};
describe('native summary renderer', () => {
  it('shows a bracket but disables range editing in a readonly view', async () => {
    const { registry, extensions, value } = fixture(),
      container = document.createElement('div'),
      root = createRoot(container),
      ref = createRef<FrameCanvasController>(),
      onChange = vi.fn();
    await act(async () =>
      root.render(
        <FrameCanvas
          ref={ref}
          value={value}
          registry={registry}
          extensions={extensions}
          readonly
          onChange={onChange}
        />,
      ),
    );
    await act(async () =>
      ref.current!.runtime.select({ focus: ['frame'], ids: ['summary'] }),
    );
    expect(container.querySelector('[data-mind-summary-bracket]')).toBeTruthy();
    expect(container.querySelector('[data-summary-handle]')).toBeNull();
    const result = await ref.current!.dispatch({
      id: 'edit',
      operations: setMindSummaryRange(value.store, 'range', 'b', 'b'),
    });
    expect(result.status).toBe('rejected');
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });
  it('hides both handles while awaiting the host and restores them on rejection', async () => {
    const { registry, extensions, value } = fixture(),
      container = document.createElement('div'),
      root = createRoot(container),
      ref = createRef<FrameCanvasController>();
    let resolve!: (result: FrameIntentResult) => void;
    const onIntent = () =>
      new Promise<FrameIntentResult>((done) => {
        resolve = done;
      });
    await act(async () =>
      root.render(
        <FrameCanvas
          ref={ref}
          value={value}
          adapter={{ toFrameSnapshot: (value) => value }}
          registry={registry}
          extensions={extensions}
          onIntent={onIntent}
        />,
      ),
    );
    await act(async () =>
      ref.current!.runtime.select({ focus: ['frame'], ids: ['summary'] }),
    );
    expect(container.querySelectorAll('[data-summary-handle]')).toHaveLength(2);
    let request!: Promise<FrameIntentResult>;
    await act(async () => {
      request = ref.current!.dispatch({
        id: 'edit',
        operations: setMindSummaryRange(value.store, 'range', 'b', 'b'),
      });
    });
    expect(container.querySelector('[data-summary-handle]')).toBeNull();
    expect(ref.current!.runtime.store).toBe(value.store);
    await act(async () => {
      resolve({ status: 'rejected', message: 'Host declined' });
      await request;
    });
    expect(container.querySelectorAll('[data-summary-handle]')).toHaveLength(2);
    expect(ref.current!.runtime.store).toBe(value.store);
    await act(async () => root.unmount());
  });
});
