import { act, type RefObject } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { createFrameCell, type CellStore } from '@sue/board-core';
import type { FrameCanvasController } from '@sue/board-react';
import { FrameFindBar } from './frame-find-bar';
import { I18nProvider } from '../../i18n';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

it('keeps input focus, cycles by element, cancels stale reveals and clears temporary state', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  cleanups.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  const revealTarget = vi.fn(async () => ({ status: 'revealed' }));
  const clearRevealOverrides = vi.fn();
  const controller = {
    revealTarget,
    clearRevealOverrides,
  } as unknown as FrameCanvasController;
  const store: CellStore = {
    rootId: 'board',
    cells: {
      board: { ...createFrameCell('board'), children: ['a', 'b'] },
      a: { ...createFrameCell('a'), name: 'Needle', data: { label: 'Needle' } },
      b: { ...createFrameCell('b'), name: 'needle' },
    },
  };
  const inputRef: RefObject<HTMLInputElement | null> = { current: null };
  const onClose = vi.fn();
  const render = async (value: CellStore, handle = controller) =>
    act(async () =>
      root.render(
        <I18nProvider language="zh" persistLanguage={false}>
          <FrameFindBar
            store={value}
            frameId="board"
            controller={handle}
            inputRef={inputRef}
            onClose={onClose}
          />
        </I18nProvider>,
      ),
    );
  await render(store);
  const input = inputRef.current!;
  expect(document.activeElement).toBe(input);
  const fill = async (value: string) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  await fill('needle');
  expect(container.textContent).toContain('1/2');
  expect(revealTarget.mock.calls.at(-1)).toEqual([
    expect.objectContaining({ cellId: 'a' }),
  ]);
  const revealsBeforeRender = revealTarget.mock.calls.length;
  await render({ ...store }, { ...controller });
  expect(revealTarget).toHaveBeenCalledTimes(revealsBeforeRender);
  const firstSignal = (
    revealTarget.mock.calls.at(-1) as unknown as [{ signal: AbortSignal }]
  )[0].signal;
  await act(async () =>
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    ),
  );
  expect(firstSignal.aborted).toBe(true);
  expect(container.textContent).toContain('2/2');
  expect(document.activeElement).toBe(input);
  await act(async () =>
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    ),
  );
  expect(container.textContent).toContain('1/2');
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('[aria-label="区分大小写"]')!
      .click(),
  );
  expect(container.textContent).toContain('1/1');
  expect(revealTarget.mock.calls.at(-1)).toEqual([
    expect.objectContaining({ cellId: 'b' }),
  ]);
  await render({
    ...store,
    cells: { ...store.cells, b: { ...store.cells['b'], name: 'changed' } },
  });
  expect(container.textContent).toContain('0/0');
  await fill('missing');
  expect(
    container.querySelector<HTMLButtonElement>('[aria-label="下一个"]')!
      .disabled,
  ).toBe(true);
  await act(async () =>
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  );
  expect(onClose).toHaveBeenCalledOnce();
  await act(async () => root.render(null));
  expect(clearRevealOverrides).toHaveBeenCalled();
});
