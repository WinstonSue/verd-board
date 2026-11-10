import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInlineText } from '@sue/board-common';
import { FrameTextEditor } from './frame-text-editor';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => vi.unstubAllGlobals());

describe('canvas text selection feedback', () => {
  it.each(['keyup', 'mouseup'])(
    'updates the toolbar on %s before another selectionchange or animation frame',
    async (type) => {
      const frames: FrameRequestCallback[] = [];
      vi.stubGlobal(
        'requestAnimationFrame',
        (callback: FrameRequestCallback) => {
          frames.push(callback);
          return frames.length;
        },
      );
      vi.stubGlobal('cancelAnimationFrame', () => undefined);
      const originalRect = Object.getOwnPropertyDescriptor(
        Range.prototype,
        'getBoundingClientRect',
      );
      Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
        configurable: true,
        value: () => new DOMRect(10, 20, 100, 18),
      });
      const container = document.createElement('div');
      document.body.append(container);
      const root = createRoot(container);
      const onChange = vi.fn();
      try {
        await act(async () => {
          root.render(
            <FrameTextEditor
              text={createInlineText('Selection sample')}
              readonly={false}
              onChange={onChange}
              onClose={() => undefined}
              onHistory={() => undefined}
            />,
          );
        });
        const editor = container.querySelector<HTMLElement>('.ProseMirror')!;
        expect(editor).not.toBeNull();
        const paragraph = editor.querySelector('p')!;
        const native = document.getSelection()!;
        await act(async () => {
          editor.focus();
          native.selectAllChildren(paragraph);
          document.dispatchEvent(new Event('selectionchange'));
          for (const frame of frames.splice(0)) frame(0);
        });
        expect(
          document.querySelector('[data-frame-text-toolbar]'),
        ).not.toBeNull();
        await act(async () => {
          native.collapse(paragraph.firstChild!, 0);
          editor.dispatchEvent(
            type === 'keyup'
              ? new KeyboardEvent(type, { key: 'ArrowLeft', bubbles: true })
              : new MouseEvent(type, { bubbles: true }),
          );
        });
        expect(native.isCollapsed).toBe(true);
        expect(document.activeElement).toBe(editor);
        expect(document.querySelector('[data-frame-text-toolbar]')).toBeNull();
        expect(onChange).not.toHaveBeenCalled();
      } finally {
        await act(async () => root.unmount());
        container.remove();
        if (originalRect)
          Object.defineProperty(
            Range.prototype,
            'getBoundingClientRect',
            originalRect,
          );
        else Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect');
      }
    },
  );
});
