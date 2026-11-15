import { act } from 'react';
import { createPortal } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/react';
import {
  BubbleMenuPlugin,
  type BubbleMenuPluginProps,
} from '@tiptap/extension-bubble-menu';
import { useDocumentBubble } from './document-editor-bubble';

vi.mock('@tiptap/extension-bubble-menu', () => ({
  BubbleMenuPlugin: vi.fn((options) => options),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLElement;
let shell: HTMLElement;
let editor: Editor;
const positioned = vi.fn();
const key = 'testDocumentBubble';
const anchor = () => ({
  contextElement: editor.view.dom,
  getBoundingClientRect: () => new DOMRect(100, 100, 1, 20),
});
function Bubble({ visible = true, placement = 'top' as 'top' | 'bottom' }) {
  const content = useDocumentBubble(
    editor,
    key,
    visible,
    anchor,
    positioned,
    placement,
  );
  return createPortal(<button>Menu action</button>, content);
}
const latest = () => vi.mocked(BubbleMenuPlugin).mock.calls.at(-1)![0];
function show(plugin: BubbleMenuPluginProps) {
  // Match the dependency's synchronous show before async computePosition.
  shell.append(plugin.element);
  plugin.element.style.visibility = 'visible';
  plugin.options?.onShow?.();
}
function hide(plugin: BubbleMenuPluginProps) {
  plugin.element.style.visibility = 'hidden';
  plugin.element.remove();
  plugin.options?.onHide?.();
}
async function completePosition(plugin: BubbleMenuPluginProps, x = 80, y = 60) {
  await act(async () => {
    // The dependency writes the element before invoking onUpdate, even when
    // this result belongs to a plugin which has already been destroyed.
    await Promise.resolve();
    Object.assign(plugin.element.style, {
      position: 'fixed',
      left: `${x}px`,
      top: `${y}px`,
      visibility: 'visible',
    });
    plugin.options?.onUpdate?.();
  });
}
beforeEach(() => {
  vi.mocked(BubbleMenuPlugin).mockClear();
  positioned.mockReset();
  shell = document.createElement('div');
  shell.className = 'board-document-editor';
  const dom = document.createElement('div');
  shell.append(dom);
  container = document.createElement('div');
  document.body.append(shell, container);
  editor = {
    isDestroyed: false,
    view: { dom },
    registerPlugin: vi.fn((plugin: BubbleMenuPluginProps) => show(plugin)),
    unregisterPlugin: vi.fn(() => {
      const plugin = latest();
      hide(plugin);
      plugin.options?.onDestroy?.();
    }),
  } as unknown as Editor;
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  shell.remove();
  container.remove();
});

it('stays out of document flow and waits for coordinates before enabling focus', async () => {
  positioned.mockImplementation((element: HTMLElement) => {
    expect(element.hasAttribute('data-positioned')).toBe(true);
    expect(element.inert).toBe(false);
  });
  await act(async () => root.render(<Bubble />));
  const plugin = latest();
  const element = plugin.element;
  expect(element.style.position).toBe('fixed');
  expect(element.inert).toBe(true);
  expect(element.getAttribute('aria-hidden')).toBe('true');
  expect(element.hasAttribute('data-positioned')).toBe(false);
  expect(positioned).not.toHaveBeenCalled();
  await completePosition(plugin);
  expect(element.style.left).toBe('80px');
  expect(element.style.top).toBe('60px');
  expect(element.hasAttribute('aria-hidden')).toBe(false);
  expect(positioned).toHaveBeenCalled();

  // Ordinary repositioning keeps the last valid position while calculating.
  expect(element.hasAttribute('data-positioned')).toBe(true);
  await completePosition(plugin, 90, 70);
  expect(element.style.top).toBe('70px');
  hide(plugin);
  expect(element.inert).toBe(true);
  expect(element.hasAttribute('data-positioned')).toBe(false);
  show(plugin);
  expect(element.hasAttribute('data-positioned')).toBe(false);
  await completePosition(plugin);
  expect(element.inert).toBe(false);
});

it('isolates late results across closing, reopening, placement changes and unmounting', async () => {
  await act(async () => root.render(<Bubble />));
  const original = latest();
  const content = original.element.firstElementChild;
  const button = original.element.querySelector('button');
  await act(async () => root.render(<Bubble visible={false} />));
  expect(original.element.isConnected).toBe(false);
  await act(async () => root.render(<Bubble />));
  const reopened = latest();
  expect(reopened.element).not.toBe(original.element);
  expect(reopened.element.firstElementChild).toBe(content);
  expect(reopened.element.querySelector('button')).toBe(button);
  show(original);
  expect(original.element.isConnected).toBe(false);
  await completePosition(original);
  expect(positioned).not.toHaveBeenCalled();
  expect(reopened.element.hasAttribute('data-positioned')).toBe(false);
  await completePosition(reopened);
  expect(reopened.element.hasAttribute('data-positioned')).toBe(true);

  await act(async () => root.render(<Bubble placement="bottom" />));
  const replaced = latest();
  expect(replaced.element).not.toBe(reopened.element);
  expect(replaced.element.firstElementChild).toBe(content);
  expect(replaced.element.inert).toBe(true);
  const calls = positioned.mock.calls.length;
  await act(async () => root.render(null));
  await completePosition(replaced);
  expect(positioned).toHaveBeenCalledTimes(calls);
  expect(replaced.element.isConnected).toBe(false);
  expect(replaced.element.hasAttribute('data-positioned')).toBe(false);
});
