import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { DocumentEditorController } from '@sue/board-react-text';
import type { ActionResult } from '@sue/board-common';
import { DocumentFindBar } from './document-find-bar';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
const setup = async (
  mode: false | 'find' | 'replace' = 'find',
  readonly = false,
) => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  let body = 'cat cat';
  const listeners = new Set<() => void>();
  const controller = {
    find: vi.fn((query: string, options: { caseSensitive: boolean }) => {
      const haystack = options.caseSensitive ? body : body.toLowerCase();
      const term = options.caseSensitive ? query : query.toLowerCase();
      const found = [];
      let pos = 0;
      while (term && (pos = haystack.indexOf(term, pos)) >= 0) {
        found.push({ from: pos, to: pos + term.length, index: found.length });
        pos += term.length;
      }
      return found;
    }),
    getDocument: () => ({ content: body }),
    selectMatch: vi.fn(() => {
      for (const listener of listeners) listener();
    }),
    clearReveal: vi.fn(),
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    flushEditing: vi.fn(async (): Promise<ActionResult> => ({
      status: 'completed',
    })),
    executeAction: vi.fn(async (): Promise<ActionResult> => ({
      status: 'completed',
    })),
    getActionState: vi.fn((_id: string, args?: unknown) => ({
      enabled: !!args,
      visible: true,
    })),
  };
  const inputRef = { current: null as HTMLInputElement | null };
  const render = async (next = mode) =>
    act(async () =>
      root.render(
        <DocumentFindBar
          controller={controller as unknown as DocumentEditorController}
          mode={next}
          locale="zh"
          readonly={readonly}
          inputRef={inputRef}
          onMode={() => {}}
          onClose={() => {}}
        />,
      ),
    );
  await render();
  return {
    controller,
    render,
    input: inputRef.current!,
    changeBody: async (next: string) =>
      act(async () => {
        body = next;
        for (const listener of listeners) listener();
      }),
  };
};
const fill = async (input: HTMLInputElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
const button = (text: string) =>
  [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (node) => node.textContent === text,
  )!;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
});

it('refreshes only for body changes, retains focus and remembers the query across close/reopen', async () => {
  const { controller, input, changeBody, render } = await setup();
  await fill(input, 'cat');
  expect(container.textContent).toContain('1/2');
  expect(controller.selectMatch).toHaveBeenCalledWith(
    expect.objectContaining({ from: 0 }),
    { focus: false },
  );
  expect(document.activeElement).toBe(input);
  await changeBody('cat');
  expect(container.textContent).toContain('1/1');
  expect(controller.selectMatch).toHaveBeenCalledTimes(2);
  await render(false);
  expect(container.querySelector('[role="search"]')).toBeNull();
  await render('find');
  expect(container.querySelector<HTMLInputElement>('input')!.value).toBe('cat');
  expect(container.textContent).toContain('1/1');
  expect(controller.clearReveal).toHaveBeenCalled();
});

it('does not replace an invalidated range while waiting for the host', async () => {
  const { controller, input, changeBody } = await setup('replace');
  await fill(input, 'cat');
  await fill(
    container.querySelector<HTMLInputElement>('[aria-label="替换为…"]')!,
    'dog',
  );
  let finish!: (result: ActionResult) => void;
  controller.flushEditing.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => button('替换当前').click());
  await changeBody('new cat');
  await act(async () => finish({ status: 'completed' }));
  expect(controller.executeAction).not.toHaveBeenCalled();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    '匹配内容已变化',
  );
  expect(input.value).toBe('cat');
  expect(
    container.querySelector<HTMLInputElement>('[aria-label="替换为…"]')!.value,
  ).toBe('dog');
});

it('prevents duplicate replacement submissions and shows a rejected receipt', async () => {
  const { controller, input } = await setup('replace');
  await fill(input, 'cat');
  let finish!: (result: ActionResult) => void;
  controller.executeAction.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => button('全部替换').click());
  await act(async () => button('全部替换').click());
  expect(controller.executeAction).toHaveBeenCalledOnce();
  await act(async () =>
    finish({
      status: 'rejected',
      code: 'host-rejected',
      message: 'Disk unavailable',
    }),
  );
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    'Disk unavailable',
  );
  expect(input.value).toBe('cat');
  expect(button('全部替换').disabled).toBe(false);
});

it('keeps readonly documents searchable without replacement controls', async () => {
  const { input } = await setup('replace', true);
  await fill(input, 'cat');
  expect(container.textContent).toContain('1/2');
  expect(container.querySelector('[aria-label="替换为…"]')).toBeNull();
  expect(
    [...container.querySelectorAll('button')].some(
      (node) => node.textContent === '替换',
    ),
  ).toBe(false);
});
