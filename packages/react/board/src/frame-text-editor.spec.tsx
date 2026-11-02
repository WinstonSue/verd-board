import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import {
  createActionRegistry,
  createBlockText,
  createInlineText,
} from '@sue/board-common';
import { ActionScope } from '@sue/board-react-actions';
import type { TextChangeData } from '@sue/board-react-text';

vi.mock('@sue/board-react-text', async () => ({
  useRichTextLinks: (await import('../../text/src/rich-text-links'))
    .useRichTextLinks,
  LineText: ({
    text,
    onChange,
  }: {
    text: { plainText: string };
    onChange(change: TextChangeData): void;
  }) => (
    <button
      type="button"
      data-testid="editor-text"
      onClick={() =>
        onChange({
          newText: { ...text, plainText: `${text.plainText}Z` },
          oldText: text,
        } as TextChangeData)
      }
    >
      {text.plainText}
    </button>
  ),
  ParagraphText: () => <div data-testid="paragraph-editor" />,
}));

import { FrameTextEditor } from './frame-text-editor';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('FrameTextEditor', () => {
  it('keeps editing while its action panel owns focus and still closes for outside controls', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const source = createActionRegistry({ getContext: () => ({}) });
    source.seal();
    const onClose = vi.fn();
    try {
      await act(async () =>
        root.render(
          <ActionScope registry={source}>
            <FrameTextEditor
              text={createInlineText('Original')}
              readonly
              onChange={() => {}}
              onClose={onClose}
              onHistory={() => {}}
            />
            <button data-outside>Outside</button>
          </ActionScope>,
        ),
      );
      const editor = container.querySelector<HTMLButtonElement>(
        '[data-testid="editor-text"]',
      )!;
      await act(async () => editor.focus());
      await act(async () =>
        editor.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'p',
            ctrlKey: true,
            shiftKey: true,
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
      const input = container.querySelector<HTMLInputElement>('dialog input')!;
      expect(document.activeElement).toBe(input);
      expect(onClose).not.toHaveBeenCalled();
      await act(async () =>
        input.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        ),
      );
      expect(document.activeElement).toBe(editor);
      expect(onClose).not.toHaveBeenCalled();
      await act(async () =>
        container.querySelector<HTMLButtonElement>('[data-outside]')!.focus(),
      );
      expect(onClose).toHaveBeenCalledOnce();
    } finally {
      await act(async () => root.unmount());
      source.dispose();
      container.remove();
    }
  });

  it('uses document kind and base styles, keeps controls outside the text box and ignores composition Enter', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const onClose = vi.fn();
    try {
      await act(async () =>
        root.render(
          <FrameTextEditor
            text={createBlockText('Block')}
            style={{ fontSize: 13, color: '#475569' }}
            readonly={false}
            onChange={() => undefined}
            onClose={onClose}
            onHistory={() => undefined}
          />,
        ),
      );
      const body = container.querySelector(
        '[data-frame-text-editor]',
      ) as HTMLElement;
      expect(
        container.querySelector('[data-testid="paragraph-editor"]'),
      ).not.toBeNull();
      expect(body.style.fontSize).toBe('13px');
      expect(body.style.color).toBe('rgb(71, 85, 105)');
      expect(body.style.paddingTop).toBe('');
      const toolbar = document.querySelector('[aria-label="Text formatting"]')!;
      expect(toolbar).toBeNull();
      await act(async () => {
        body.dispatchEvent(
          new KeyboardEvent('keydown', {
            bubbles: true,
            key: 'Enter',
            ctrlKey: true,
            isComposing: true,
          }),
        );
      });
      expect(onClose).not.toHaveBeenCalled();
      await act(async () => {
        body.dispatchEvent(
          new KeyboardEvent('keydown', {
            bubbles: true,
            key: 'Enter',
            ctrlKey: true,
          }),
        );
      });
      expect(onClose).toHaveBeenCalledOnce();
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it('remounts the original document when a commit is rejected', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const onClose = vi.fn();
    const onChange = vi.fn(async () => ({ status: 'rejected' as const }));
    await act(async () =>
      root.render(
        <FrameTextEditor
          text={createInlineText('Hello')}
          readonly={false}
          onChange={onChange}
          onClose={onClose}
          onHistory={() => undefined}
        />,
      ),
    );
    const editor = () =>
      container.querySelector(
        '[data-testid="editor-text"]',
      ) as HTMLButtonElement;
    expect(editor().textContent).toBe('Hello');
    await act(async () => {
      editor().click();
      await Promise.resolve();
    });
    expect(onChange).toHaveBeenCalledOnce();
    expect(editor().textContent).toBe('Hello');
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => root.unmount());
    container.remove();
  });
});
