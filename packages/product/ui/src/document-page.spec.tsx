import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBlockText } from '@sue/board-common';
import type {
  DocumentEditorController,
  DocumentEditorProps,
} from '@sue/board-react-text';
import { DocumentPage, type DocumentPageProps } from './document-page';

const { controller } = vi.hoisted(() => ({
  controller: {
    focus: vi.fn(),
    locateHeading: vi.fn(),
    getToolbarState: vi.fn(() => ({
      marks: {},
      block: 'paragraph',
      align: 'left',
      inTable: false,
      editable: true,
      link: 'verd://file/guide#章节',
    })),
    getHeadings: vi.fn(() => [
      { level: 2, text: '章节', anchor: '章节', pos: 10 },
      { level: 2, text: '章节', anchor: '章节-1', pos: 20 },
    ]),
    getCharacterCount: vi.fn(() => 4),
    subscribe: vi.fn(() => () => {}),
  },
}));

vi.mock('@sue/board-react-text', () => ({
  DocumentEditor: ({ onReady }: DocumentEditorProps) => {
    useEffect(() => {
      onReady?.(controller as unknown as DocumentEditorController);
      return () => onReady?.(null);
    }, [onReady]);
    return (
      <div className="board-document-editor">
        <a href="verd://file/guide#章节">
          <span>Open guide</span>
        </a>
        <a href="https://example.com/">Website</a>
      </div>
    );
  },
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
let frames: Map<number, FrameRequestCallback>;
let sequence = 0;
const value = createBlockText('Body');

const render = async (props: Partial<DocumentPageProps> = {}) => {
  await act(async () =>
    root.render(
      <DocumentPage
        value={value}
        title="Guide"
        onChange={() => {}}
        onTitleCommit={() => {}}
        {...props}
      />,
    ),
  );
};
const flushFrames = async () => {
  await act(async () => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((frame) => frame(0));
  });
};
const click = async (target: Element, options: MouseEventInit = {}) => {
  const event = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    button: 0,
    ...options,
  });
  await act(async () => target.dispatchEvent(event));
  return event;
};

beforeEach(() => {
  vi.clearAllMocks();
  frames = new Map();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = ++sequence;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('document navigation', () => {
  it('keeps ordinary editing clicks local and activates modifier clicks', async () => {
    const onOpenLink = vi.fn();
    await render({ onOpenLink });
    const label = container.querySelector('a span')!;
    expect((await click(label)).defaultPrevented).toBe(true);
    expect(onOpenLink).not.toHaveBeenCalled();
    await click(label, { ctrlKey: true });
    await click(label, { metaKey: true });
    expect(onOpenLink.mock.calls).toEqual([
      ['verd://file/guide#章节'],
      ['verd://file/guide#章节'],
    ]);
    const middle = new MouseEvent('auxclick', {
      bubbles: true,
      cancelable: true,
      button: 1,
    });
    label.dispatchEvent(middle);
    expect(middle.defaultPrevented).toBe(true);
    expect(onOpenLink).toHaveBeenCalledTimes(2);
  });

  it('opens on a normal readonly click and suppresses native navigation without a handler', async () => {
    const onOpenLink = vi.fn();
    await render({ readonly: true, onOpenLink });
    await click(container.querySelector('a')!);
    expect(onOpenLink).toHaveBeenCalledWith('verd://file/guide#章节');
    await render({ readonly: true });
    expect((await click(container.querySelector('a')!)).defaultPrevented).toBe(
      true,
    );
  });

  it('provides an explicit open action for the current link', async () => {
    const onOpenLink = vi.fn();
    await render({ onOpenLink });
    await click(container.querySelector('button[title="链接"]')!);
    const button = [...container.querySelectorAll('button')].find(
      (item) => item.textContent === '打开链接',
    )!;
    await click(button);
    expect(onOpenLink).toHaveBeenCalledWith('verd://file/guide#章节');
  });

  it('waits for the editor and applies each navigation request once', async () => {
    await render({ navigation: { anchor: '章节-1', requestId: 1 } });
    expect(controller.locateHeading).not.toHaveBeenCalled();
    await flushFrames();
    expect(controller.locateHeading).toHaveBeenCalledExactlyOnceWith(20);
    await render({ navigation: { anchor: '章节-1', requestId: 1 } });
    await flushFrames();
    expect(controller.locateHeading).toHaveBeenCalledTimes(1);
    await render({ navigation: { anchor: '章节', requestId: 2 } });
    await flushFrames();
    expect(controller.locateHeading).toHaveBeenLastCalledWith(10);
    await render({ navigation: { anchor: null, requestId: 3 } });
    await flushFrames();
    expect(controller.focus).toHaveBeenCalledWith('start');
  });

  it('reports a missing heading and returns to the document start', async () => {
    await render({ navigation: { anchor: 'removed', requestId: 1 } });
    await flushFrames();
    expect(controller.focus).toHaveBeenCalledWith('start');
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      '未找到目标章节',
    );
  });
});
