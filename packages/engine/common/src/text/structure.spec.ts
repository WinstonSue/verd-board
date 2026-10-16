import { describe, expect, it } from 'vitest';
import {
  deriveBoardTextPlainText,
  isBoardTextDocumentShape,
  isBoardTextNode,
} from './structure';
import type { BoardTextDocument, BoardTextNode } from './editor-types';

const doc = (content: BoardTextNode): BoardTextDocument => ({
  schemaVersion: 1,
  id: 'doc-1',
  kind: 'block',
  content,
  plainText: '',
});

describe('isBoardTextNode', () => {
  it('accepts text, marks and nested content', () => {
    expect(
      isBoardTextNode({
        type: 'paragraph',
        content: [
          { type: 'text', text: 'hi', marks: [{ type: 'bold' }] },
          { type: 'hardBreak' },
        ],
      }),
    ).toBe(true);
  });

  it('rejects non-records, missing types and malformed children', () => {
    expect(isBoardTextNode(null)).toBe(false);
    expect(isBoardTextNode('text')).toBe(false);
    expect(isBoardTextNode({ content: [] })).toBe(false);
    expect(isBoardTextNode({ type: 'text', text: 42 })).toBe(false);
    expect(isBoardTextNode({ type: 'x', marks: [{ attrs: {} }] })).toBe(false);
    expect(isBoardTextNode({ type: 'x', content: 'not-an-array' })).toBe(false);
    expect(isBoardTextNode({ type: 'x', content: [{ noType: true }] })).toBe(
      false,
    );
    expect(isBoardTextNode({ type: 'x', attrs: [] })).toBe(false);
  });
});

describe('isBoardTextDocumentShape', () => {
  it('accepts a minimal document', () => {
    expect(
      isBoardTextDocumentShape(
        doc({ type: 'doc', content: [{ type: 'paragraph' }] }),
      ),
    ).toBe(true);
  });

  it('rejects wrong versions, kinds and malformed envelopes', () => {
    expect(isBoardTextDocumentShape(null)).toBe(false);
    expect(isBoardTextDocumentShape({})).toBe(false);
    expect(
      isBoardTextDocumentShape({ ...doc({ type: 'doc' }), schemaVersion: 2 }),
    ).toBe(false);
    expect(
      isBoardTextDocumentShape({ ...doc({ type: 'doc' }), kind: 'page' }),
    ).toBe(false);
    expect(isBoardTextDocumentShape({ ...doc({ type: 'doc' }), id: 7 })).toBe(
      false,
    );
    expect(
      isBoardTextDocumentShape({ ...doc({ type: 'doc' }), plainText: 1 }),
    ).toBe(false);
    expect(
      isBoardTextDocumentShape({
        ...doc({ type: 'doc' }),
        content: { type: 'doc', content: [{ bad: true }] },
      }),
    ).toBe(false);
  });

  it('does not police unknown node types — that is the editor schema role', () => {
    expect(
      isBoardTextDocumentShape(
        doc({ type: 'doc', content: [{ type: 'futureNode' }] }),
      ),
    ).toBe(true);
  });
});

describe('deriveBoardTextPlainText', () => {
  it('joins block containers with newlines and inline runs directly', () => {
    const text = deriveBoardTextPlainText({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'ab' },
            { type: 'text', text: 'cd', marks: [{ type: 'bold' }] },
          ],
        },
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Title' }],
        },
      ],
    });
    expect(text).toBe('abcd\nTitle');
  });

  it('handles empty and missing content', () => {
    expect(deriveBoardTextPlainText(undefined)).toBe('');
    expect(deriveBoardTextPlainText({ type: 'doc' })).toBe('');
    expect(deriveBoardTextPlainText({ type: 'doc', content: [] })).toBe('');
  });

  it('emits newlines for hard breaks inside paragraphs', () => {
    expect(
      deriveBoardTextPlainText({
        type: 'paragraph',
        content: [
          { type: 'text', text: 'a' },
          { type: 'hardBreak' },
          { type: 'text', text: 'b' },
        ],
      }),
    ).toBe('a\nb');
  });
});
