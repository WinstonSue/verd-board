import { describe, expect, it } from 'vitest';
import { createBlockText, createInlineText } from './editor-factory';
import { reviseBoardText, sameBoardText } from './revise-document';

const marks = [
  { type: 'bold' },
  { type: 'textStyle', attrs: { color: '#ff0000', fontSize: '18px' } },
  { type: 'link', attrs: { href: 'https://example.com' } },
];

describe('reviseBoardText', () => {
  it('keeps marks, links and untouched paragraphs when only part of the text changes', () => {
    const original = createBlockText('Hello');
    original.plainText = 'Hello\nKept';
    original.content.content!.push({
      type: 'paragraph',
      content: [{ type: 'text', text: 'Kept' }],
    });
    original.content.content![0].content![0].marks = marks.map((mark) => ({
      ...mark,
      attrs: mark.attrs && { ...mark.attrs },
    }));
    const revised = reviseBoardText(original, 'Hello!\nKept');
    const first = revised.content.content![0].content!;
    expect(first[0]).toMatchObject({ text: 'Hello!', marks });
    expect(revised.content.content![1].content![0].text).toBe('Kept');
    expect(original.content.content![0].content![0].text).toBe('Hello');
    expect(reviseBoardText(revised, 'Hello!\nKept')).toBe(revised);
  });
  it('does not rebuild an inline document when the plain text is unchanged', () => {
    const original = createInlineText('Hello');
    original.content.content![0].content![0].marks = marks;
    expect(reviseBoardText(original, 'Hello')).toBe(original);
  });
});

describe('sameBoardText', () => {
  it('treats a label-only document and an editor paragraph with the same words as equal', () => {
    const label = createInlineText('Topic');
    const edited = createInlineText('Topic');
    edited.content.content![0].attrs = { textAlign: null };
    expect(sameBoardText(label, edited)).toBe(true);
    edited.content.content![0].attrs = { textAlign: 'center' };
    expect(sameBoardText(label, edited)).toBe(false);
    edited.content.content![0].attrs = { textAlign: null };
    edited.content.content![0].content![0].marks = [{ type: 'bold' }];
    expect(sameBoardText(label, edited)).toBe(false);
  });
});
