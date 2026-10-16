/* eslint-disable jsx-a11y/no-autofocus -- These tests explicitly prevent editors from taking focus on mount. */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Editor } from '@tiptap/react';
import { describe, expect, it, vi } from 'vitest';
import {
  Alignment,
  createBlockText,
  type BoardTextDocument,
  type BoardTextController,
} from '@sue/board-common';
import { TextPreview } from './text-preview';
import { LineText } from './components/line/line-text';
import { ParagraphText } from './components/paragraph/paragraph-text';
import { contentExtensions, lineExtensions } from './constants/editor-config';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const richDocument = (): BoardTextDocument => ({
  ...createBlockText('Title\nList\nCode\nCell'),
  content: {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 2, textAlign: 'right' },
        content: [{ type: 'text', text: 'Title' }],
      },
      { type: 'paragraph', content: [] },
      {
        type: 'orderedList',
        attrs: { start: 3 },
        content: [
          {
            type: 'listItem',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'List' }] },
            ],
          },
        ],
      },
      {
        type: 'blockquote',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Quote' }] },
        ],
      },
      { type: 'codeBlock', content: [{ type: 'text', text: 'Code' }] },
      { type: 'horizontalRule' },
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              {
                type: 'tableCell',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Cell' }],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'Formatted',
            marks: [
              {
                type: 'textStyle',
                attrs: {
                  fontFamily: 'Georgia',
                  fontSize: '24px',
                  color: '#ff0000',
                },
              },
              { type: 'highlight', attrs: { color: '#ffff00' } },
              { type: 'superscript' },
            ],
          },
          { type: 'text', text: 'Sub', marks: [{ type: 'subscript' }] },
        ],
      },
      {
        type: 'image',
        attrs: { src: 'data:image/png;base64,AA==', alt: 'Image' },
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Trailing' }, { type: 'hardBreak' }],
      },
    ],
  },
});

describe('shared text content', () => {
  it('serializes block structure, empty lines and trailing hard breaks without an editor', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
      await act(async () => root.render(<TextPreview text={richDocument()} />));
      expect(container.querySelector('h2')?.textContent).toBe('Title');
      expect(container.querySelector('ol')?.start).toBe(3);
      expect(container.querySelector('blockquote')?.textContent).toBe('Quote');
      expect(container.querySelector('pre code')?.textContent).toBe('Code');
      expect(container.querySelector('td')?.textContent).toBe('Cell');
      expect(container.querySelector('hr')).not.toBeNull();
      expect(container.querySelector('h2 + p')?.innerHTML).toBe('<br>');
      expect(
        container
          .querySelector('.board-text-content > p:last-child')
          ?.querySelectorAll('br'),
      ).toHaveLength(2);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('retains every displayed format through either editor schema', () => {
    for (const extensions of [contentExtensions, lineExtensions]) {
      const editor = new Editor({
        extensions,
        content: richDocument().content,
      });
      try {
        const before = editor.getJSON();
        editor.commands.setTextSelection(2);
        editor.commands.insertContent('Z');
        const serialized = editor.getHTML();
        expect(serialized).toContain('font-family: Georgia');
        expect(serialized).toContain('background-color: rgb(255, 255, 0)');
        expect(serialized).toContain('<sup>');
        expect(serialized).toContain('<sub>');
        expect(serialized).toContain('alt="Image"');
        expect(editor.getJSON().content?.slice(1)).toEqual(
          before.content?.slice(1),
        );
      } finally {
        editor.destroy();
      }
    }
  });

  it.each([LineText, ParagraphText])(
    'synchronizes external marks, block attributes and document alignment without emitting input',
    async (Component) => {
      const container = document.createElement('div');
      document.body.append(container);
      const root = createRoot(container);
      const text = createBlockText('Same text');
      const onChange = vi.fn();
      let controller: BoardTextController | undefined;
      try {
        await act(async () =>
          root.render(
            <Component
              text={text}
              autoFocus={false}
              onChange={onChange}
              afterInit={(next) => {
                controller = next;
              }}
            />,
          ),
        );
        await act(async () => controller!.selectRange(2, 5));
        const next: BoardTextDocument = {
          ...text,
          align: Alignment.right,
          content: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                attrs: { textAlign: 'left' },
                content: [
                  {
                    type: 'text',
                    text: 'Same text',
                    marks: [{ type: 'bold' }],
                  },
                ],
              },
            ],
          },
        };
        await act(async () =>
          root.render(
            <Component
              text={next}
              autoFocus={false}
              onChange={onChange}
              afterInit={(value) => {
                controller = value;
              }}
            />,
          ),
        );
        expect(container.querySelector('strong')?.textContent).toBe(
          'Same text',
        );
        expect(container.querySelector('p')?.style.textAlign).toBe('left');
        expect((container.firstChild as HTMLElement).style.textAlign).toBe(
          'right',
        );
        expect(controller!.getSelection()).toMatchObject({ from: 2, to: 5 });
        expect(onChange).not.toHaveBeenCalled();
        await act(async () =>
          root.render(
            <Component
              text={next}
              readonly
              autoFocus={false}
              onChange={onChange}
            />,
          ),
        );
        expect(onChange).not.toHaveBeenCalled();
      } finally {
        await act(async () => root.unmount());
        container.remove();
      }
    },
  );
});
