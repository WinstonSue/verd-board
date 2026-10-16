import React, { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInlineText } from '@sue/board-common';
import {
  applyCellOperations,
  createCellStore,
  createFrameCell,
  type NodeCell,
  type FrameSnapshot,
} from '@sue/board-core';
import {
  FrameCanvas,
  type FrameCanvasController,
  type FrameIntentResult,
} from './frame-canvas';

vi.mock('@sue/board-react-text', () => ({
  LineText: ({
    text,
    onChange,
  }: {
    text: { plainText: string };
    onChange(change: unknown): void;
  }) => (
    <button
      data-name-test-editor
      onClick={() =>
        onChange({
          oldText: text,
          newText: createInlineText(text.plainText + 'x'),
        })
      }
    >
      {text.plainText}
    </button>
  ),
  ParagraphText: () => null,
  TextPreview: ({ text }: { text: { plainText: string } }) => (
    <span>{text.plainText}</span>
  ),
}));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.restoreAllMocks();
});
async function mount({ legacy = '', reject = false, host = false } = {}) {
  const frame = createFrameCell('root');
  frame.children.push('n');
  let value: FrameSnapshot = { store: createCellStore(frame) };
  value.store.cells.n = {
    id: 'n',
    kind: 'text',
    cellType: 'node',
    geometry: { x: 0, y: 0, width: 100, height: 60 },
    content: { label: legacy },
  };
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container),
    controller = createRef<FrameCanvasController>();
  const onIntent = vi.fn(async (transaction) => {
    if (reject) return { status: 'rejected' } as FrameIntentResult;
    value = {
      store: applyCellOperations(
        value.store,
        transaction.operations,
        controller.current!.runtime.registry,
      ),
    };
    render();
    return { status: 'accepted' } as FrameIntentResult;
  });
  const render = () =>
    root.render(
      <FrameCanvas
        ref={controller}
        value={value}
        autoFit={false}
        {...(host
          ? {
              adapter: { toFrameSnapshot: (value: FrameSnapshot) => value },
              onIntent,
            }
          : {
              onChange: ({ snapshot }) => {
                value = snapshot;
                render();
              },
            })}
      />,
    );
  await act(async () => render());
  cleanups.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  await act(async () =>
    container
      .querySelector('[data-cell-id="n"]')!
      .dispatchEvent(new MouseEvent('dblclick', { bubbles: true })),
  );
  const editor = () =>
    container.querySelector<HTMLButtonElement>('[data-name-test-editor]')!;
  const close = () =>
    act(async () =>
      editor().dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      ),
    );
  return {
    controller,
    editor,
    close,
    onIntent,
    cell: () => controller.current!.runtime.store.cells.n as NodeCell,
  };
}
describe('name initialization across native editing sessions', () => {
  it('waits for complete typing and freezes a legacy name before the first accepted body change', async () => {
    const test = await mount();
    for (let i = 0; i < 3; i++) {
      await act(async () => test.editor().click());
      expect(test.cell().name).toBeUndefined();
    }
    await test.close();
    expect(test.cell().name).toBe('xxx');
    await act(async () => test.controller.current!.undo());
    expect(test.cell().name).toBeUndefined();
    await act(async () => test.controller.current!.redo());
    expect(test.cell().name).toBe('xxx');
    const old = await mount({ legacy: 'Old\nname' });
    await act(async () => old.editor().click());
    expect(old.cell().name).toBe('Old name');
    expect(old.cell().content?.label).toBe('Old\nnamex');
  });
  it.each([false, true])(
    'initializes only accepted host content after the entire session (reject=%s)',
    async (reject) => {
      const test = await mount({ host: true, reject });
      await act(async () => test.editor().click());
      expect(test.cell().name).toBeUndefined();
      await test.close();
      expect(test.cell().name).toBe(reject ? undefined : 'x');
      expect(test.cell().content?.label).toBe(reject ? '' : 'x');
      expect(test.onIntent).toHaveBeenCalledTimes(reject ? 1 : 2);
    },
  );
});
