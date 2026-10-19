import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { createFrameCell, type FrameSnapshot } from '@sue/board-core';
import { CanvasPreview } from './canvas-preview';

const probe = vi.hoisted(() => ({
  fit: vi.fn(),
  values: [] as FrameSnapshot[],
}));
vi.mock('@sue/board-react', async (importOriginal) => {
  const original = await importOriginal<typeof import('@sue/board-react')>();
  const React = await import('react');
  return {
    ...original,
    FrameCanvas: React.forwardRef(function PreviewProbe(
      props: { value: FrameSnapshot },
      ref,
    ) {
      probe.values.push(props.value);
      React.useImperativeHandle(ref, () => ({ fit: probe.fit }), []);
      return <svg />;
    }),
  };
});

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  probe.fit.mockClear();
  probe.values = [];
});

it('fits once across wrapper and unrelated store updates, then fits changed preview content', async () => {
  let observers = 0;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor() {
        observers++;
      }
      observe() {}
      disconnect() {}
    },
  );
  const callbacks = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    callbacks.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
    callbacks.delete(id);
  });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  cleanups.push(async () => {
    await act(() => root.unmount());
    host.remove();
  });
  const board = createFrameCell('board');
  let store = {
    rootId: board.id,
    cells: { board, unused: createFrameCell('unused') },
  };
  const render = async () => {
    await act(() =>
      root.render(<CanvasPreview value={{ store }} frameId={board.id} />),
    );
    await act(() => {
      const pending = [...callbacks.values()];
      callbacks.clear();
      pending.forEach((callback) => callback(0));
    });
  };
  await render();
  const initial = probe.values.at(-1);
  await render();
  store = {
    ...store,
    cells: { ...store.cells, unused: createFrameCell('unused') },
  };
  await render();
  expect(probe.values.at(-1)).toBe(initial);
  expect(probe.fit).toHaveBeenCalledTimes(1);
  expect(observers).toBe(1);
  store = {
    ...store,
    cells: { ...store.cells, board: { ...board, name: 'Updated' } },
  };
  await render();
  expect(probe.values.at(-1)).not.toBe(initial);
  expect(probe.fit).toHaveBeenCalledTimes(2);
  expect(observers).toBe(2);
});
