import React, { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import {
  createFrameCell,
  createCellStore,
  applyCellOperations,
  type FrameSnapshot,
  type CellTransaction,
} from '@sue/board-core';
import { FrameCanvas, type FrameCanvasController } from './frame-canvas';

const snapshot = (kind = 'geometry'): FrameSnapshot => ({
  store: applyCellOperations(createCellStore(createFrameCell('root')), [
    {
      type: 'insert_cell',
      parentId: 'root',
      cell: {
        id: 'a',
        kind,
        cellType: 'node',
        geometry: { x: 10, y: 10, width: 100, height: 50 },
        appearance: { shadow: 'md' },
        content: { label: 'Topic' },
      },
    },
  ]),
});
const clipboardEvent = (type: string, data: Map<string, string>) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      setData: (type: string, value: string) => data.set(type, value),
      getData: (type: string) => data.get(type) ?? '',
    },
  });
  return event;
};
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('Frame clipboard and rendering', () => {
  it('keeps cut cells when the system clipboard fails or a new host snapshot arrives while writing', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    try {
      for (const failure of [true, false]) {
        const container = document.createElement('div'),
          root = createRoot(container),
          ref = createRef<FrameCanvasController>(),
          original = snapshot(),
          onChange = vi.fn();
        let release!: () => void;
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: {
            writeText: failure
              ? () => Promise.reject(new Error('Permission denied'))
              : () =>
                  new Promise<void>((resolve) => {
                    release = resolve;
                  }),
          },
        });
        await act(async () =>
          root.render(
            <FrameCanvas ref={ref} value={original} onChange={onChange} />,
          ),
        );
        await act(async () =>
          ref.current!.runtime.select({ focus: ['root'], ids: ['a'] }),
        );
        let result!: Promise<import('./frame-canvas').FrameIntentResult>;
        await act(async () => {
          result = ref.current!.clipboard('cut');
        });
        if (!failure) {
          expect(await ref.current!.clipboard('cut')).toMatchObject({
            status: 'rejected',
            message: 'A transaction is pending',
          });
          const changed = {
            store: applyCellOperations(original.store, [
              {
                type: 'replace_cell',
                cell: {
                  ...original.store.cells.a,
                  content: { label: 'Host update' },
                },
              },
            ]),
          };
          await act(async () =>
            root.render(
              <FrameCanvas ref={ref} value={changed} onChange={onChange} />,
            ),
          );
          await act(async () => release());
        }
        expect(await result).toMatchObject({ status: 'rejected' });
        expect(ref.current!.runtime.store.cells.a).toBeTruthy();
        expect(onChange).not.toHaveBeenCalled();
        await act(async () => root.unmount());
      }
    } finally {
      if (descriptor) Object.defineProperty(navigator, 'clipboard', descriptor);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });
  it('cuts and pastes appearance with fresh IDs and atomic undo/redo', async () => {
    const container = document.createElement('div'),
      root = createRoot(container),
      ref = createRef<FrameCanvasController>(),
      onChange = vi.fn(),
      data = new Map<string, string>();
    await act(async () =>
      root.render(
        <FrameCanvas ref={ref} value={snapshot()} onChange={onChange} />,
      ),
    );
    await act(async () => {
      ref.current!.runtime.select({ focus: ['root'], ids: ['a'] });
      container
        .querySelector('svg')!
        .dispatchEvent(clipboardEvent('cut', data));
    });
    expect(ref.current!.runtime.store.cells.a).toBeUndefined();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(data.get('application/x-verd-cells')!).cells.a.appearance
        .shadow,
    ).toBe('md');
    await act(async () => ref.current!.undo());
    expect(ref.current!.runtime.store.cells.a).toBeTruthy();
    await act(async () => ref.current!.redo());
    expect(ref.current!.runtime.store.cells.a).toBeUndefined();
    await act(async () =>
      container
        .querySelector('svg')!
        .dispatchEvent(clipboardEvent('paste', data)),
    );
    const pasted = Object.values(ref.current!.runtime.store.cells).find(
      (cell) => cell.kind === 'geometry',
    )!;
    expect(pasted.id).not.toBe('a');
    expect(pasted).toMatchObject({
      appearance: { shadow: 'md' },
      geometry: { x: 30, y: 30 },
    });
    const filter = container
      .querySelector(`[data-cell-id="${pasted.id}"] > g[filter]`)!
      .getAttribute('filter')!;
    expect(
      container.querySelector(
        `filter[id="${filter.slice(5, -1)}"] feDropShadow`,
      ),
    ).toBeTruthy();
    await act(async () => root.unmount());
  });
  it('keeps an asynchronous host unchanged until a cut is accepted and the host publishes its snapshot', async () => {
    for (const status of ['accepted', 'rejected'] as const) {
      const container = document.createElement('div'),
        root = createRoot(container),
        ref = createRef<FrameCanvasController>(),
        original = snapshot(),
        data = new Map<string, string>(),
        onReject = vi.fn();
      let release!: (value: { status: 'accepted' | 'rejected' }) => void;
      let transaction!: CellTransaction;
      const onIntent = vi.fn((value: CellTransaction) => {
        transaction = value;
        return new Promise<{ status: 'accepted' | 'rejected' }>((resolve) => {
          release = resolve;
        });
      });
      const render = (value: FrameSnapshot) =>
        root.render(
          <FrameCanvas
            ref={ref}
            value={value}
            adapter={{ toFrameSnapshot: (value) => value }}
            onIntent={onIntent}
            onReject={onReject}
          />,
        );
      await act(async () => render(original));
      await act(async () => {
        ref.current!.runtime.select({ focus: ['root'], ids: ['a'] });
        container
          .querySelector('svg')!
          .dispatchEvent(clipboardEvent('cut', data));
      });
      expect(ref.current!.runtime.store).toEqual(original.store);
      expect(ref.current!.runtime.selection.ids).toEqual(['a']);
      await act(async () =>
        container
          .querySelector('svg')!
          .dispatchEvent(clipboardEvent('cut', data)),
      );
      expect(onIntent).toHaveBeenCalledTimes(1);
      await act(async () => release({ status }));
      if (status === 'accepted') {
        await act(async () =>
          render({
            store: applyCellOperations(original.store, transaction.operations),
          }),
        );
        expect(ref.current!.runtime.store.cells.a).toBeUndefined();
        expect(ref.current!.runtime.selection.ids).toEqual([]);
      } else {
        expect(ref.current!.runtime.store).toEqual(original.store);
        expect(onReject).toHaveBeenCalledTimes(1);
      }
      await act(async () => root.unmount());
    }
  });
  it('rejects protected anchor cuts before changing the clipboard or publishing an intent', async () => {
    const container = document.createElement('div'),
      root = createRoot(container),
      ref = createRef<FrameCanvasController>(),
      onChange = vi.fn(),
      onReject = vi.fn(),
      value = snapshot('mind-root'),
      data = new Map([['text/plain', 'original clipboard']]);
    await act(async () =>
      root.render(
        <FrameCanvas
          ref={ref}
          value={value}
          onChange={onChange}
          onReject={onReject}
        />,
      ),
    );
    await act(async () => {
      ref.current!.runtime.select({ focus: ['root'], ids: ['a'] });
      container
        .querySelector('svg')!
        .dispatchEvent(clipboardEvent('cut', data));
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(onReject).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('last scene anchor'),
      }),
    );
    expect(ref.current!.runtime.store).toEqual(value.store);
    expect([...data]).toEqual([['text/plain', 'original clipboard']]);
    await act(async () => root.unmount());
  });
  it('isolates shadow IDs between mounted canvases and keeps selection handles outside shadows', async () => {
    const container = document.createElement('div'),
      root = createRoot(container),
      first = createRef<FrameCanvasController>(),
      second = createRef<FrameCanvasController>();
    await act(async () =>
      root.render(
        <>
          <FrameCanvas ref={first} value={snapshot()} onChange={() => {}} />
          <FrameCanvas ref={second} value={snapshot()} onChange={() => {}} />
        </>,
      ),
    );
    await act(async () =>
      first.current!.runtime.select({ focus: ['root'], ids: ['a'] }),
    );
    const filters = container.querySelectorAll(
      '[data-cell-id="a"] > g[filter]',
    );
    expect(filters[0].getAttribute('filter')).not.toBe(
      filters[1].getAttribute('filter'),
    );
    expect(
      container.querySelector('[data-selection-handles]')!.closest('[filter]'),
    ).toBeNull();
    await act(async () => root.unmount());
  });
});
