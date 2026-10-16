import { describe, expect, it } from 'vitest';
import { Alignment, type BoardTextDocument } from './editor-types';
import {
  boardTextFormatState,
  boardTextAlignments,
  formatBoardText,
} from './format-state';
import { createInlineText, createBlockText } from './editor-factory';

const leaf = (
  text: string,
  marks?: { type: string; attrs?: Record<string, unknown> }[],
) => ({ type: 'text', text, ...(marks ? { marks } : {}) });

describe('boardTextFormatState', () => {
  it('reports defaults and empty state for a note without leaves', () => {
    const state = boardTextFormatState(createBlockText(''), {
      fontSize: '13px',
      color: '#475569',
      align: Alignment.left,
    });
    expect(state.empty).toBe(true);
    expect(state.bold).toBe(false);
    expect(state.fontSize).toBe('13px');
  });

  it('reads effective values through defaults', () => {
    const document = createInlineText('plain');
    const state = boardTextFormatState(document, {
      fontSize: '16px',
      color: '#111111',
    });
    expect(state.fontSize).toBe('16px');
    expect(state.color).toBeUndefined();
    expect(state.align).toBe(Alignment.left);
  });

  it('reports mixed marks and values across leaves', () => {
    const document: BoardTextDocument = {
      schemaVersion: 1,
      id: 't',
      kind: 'block',
      plainText: 'ab',
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              leaf('a', [
                { type: 'bold' },
                { type: 'textStyle', attrs: { fontSize: '13px' } },
              ]),
            ],
          },
          {
            type: 'paragraph',
            attrs: { textAlign: 'right' },
            content: [
              leaf('b', [
                {
                  type: 'textStyle',
                  attrs: { fontSize: '20px', color: '#f00' },
                },
              ]),
            ],
          },
        ],
      },
    };
    const state = boardTextFormatState(document, { fontSize: '13px' });
    expect(state.bold).toBe('mixed');
    expect(state.fontSize).toBe('mixed');
    expect(state.color).toBe('mixed');
    expect(state.align).toBe('mixed');
  });

  it('keeps non-preset font sizes readable as the actual value', () => {
    const document: BoardTextDocument = {
      schemaVersion: 1,
      id: 't',
      kind: 'inline',
      plainText: 'x',
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              leaf('x', [{ type: 'textStyle', attrs: { fontSize: '17px' } }]),
            ],
          },
        ],
      },
    };
    expect(boardTextFormatState(document).fontSize).toBe('17px');
  });
});

describe('formatBoardText', () => {
  it('toggles marks on every leaf while keeping links', () => {
    const document: BoardTextDocument = {
      schemaVersion: 1,
      id: 't',
      kind: 'block',
      plainText: 'ab',
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              leaf('a', [{ type: 'link', attrs: { href: 'https://x' } }]),
            ],
          },
          { type: 'paragraph', content: [leaf('b')] },
        ],
      },
    };
    const next = formatBoardText(document, { bold: true });
    const [first, second] = next.content.content!;
    expect(first.content![0].marks).toEqual([
      { type: 'link', attrs: { href: 'https://x' } },
      { type: 'bold' },
    ]);
    expect(second.content![0].marks).toEqual([{ type: 'bold' }]);
    const toggled = formatBoardText(next, { bold: false });
    expect(toggled.content.content![0].content![0].marks).toEqual([
      { type: 'link', attrs: { href: 'https://x' } },
    ]);
  });

  it('clears only the color attribute when following the theme', () => {
    const document: BoardTextDocument = {
      schemaVersion: 1,
      id: 't',
      kind: 'inline',
      plainText: 'x',
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              leaf('x', [
                {
                  type: 'textStyle',
                  attrs: { color: '#ff0000', fontSize: '18px' },
                },
              ]),
            ],
          },
        ],
      },
    };
    const next = formatBoardText(document, { color: null });
    expect(next.content.content![0].content![0].marks).toEqual([
      { type: 'textStyle', attrs: { fontSize: '18px' } },
    ]);
    const cleared = formatBoardText(next, { fontSize: null });
    expect(cleared.content.content![0].content![0].marks).toEqual([]);
  });

  it('applies alignment to every block and the document', () => {
    const document = createBlockText('a\nb');
    const next = formatBoardText(document, { align: Alignment.center });
    expect(next.align).toBe(Alignment.center);
    for (const paragraph of next.content.content ?? [])
      expect(paragraph.attrs?.['textAlign']).toBe('center');
    expect(boardTextAlignments(next)).toEqual(['center']);
  });
});
