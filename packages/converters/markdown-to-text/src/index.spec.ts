import { describe, expect, it } from 'vitest';
import {
  parseMarkdownToTextDocument,
  serializeTextDocumentToMarkdown,
} from './index';
import { Alignment } from '@sue/board-common';

const parse = (md: string) => parseMarkdownToTextDocument(md).document;

describe('parseMarkdownToTextDocument', () => {
  it('parses paragraphs, headings, blockquote, lists and code', () => {
    const doc = parse(
      [
        '# Title',
        '',
        'Hello **bold** and *italic* with `code` and ~~gone~~.',
        '',
        '> quoted',
        '',
        '1. one',
        '2. two',
        '',
        '- a',
        '  - nested',
        '',
        '```ts',
        'const x = 1;',
        '```',
        '',
        '---',
      ].join('\n'),
    );
    const c = doc.content.content!;
    expect(c[0]).toMatchObject({ type: 'heading', attrs: { level: 1 } });
    const p = c[1];
    expect(p.type).toBe('paragraph');
    const marks = (p.content ?? []).flatMap((n) =>
      (n.marks ?? []).map((m) => m.type),
    );
    expect(marks).toEqual(
      expect.arrayContaining(['bold', 'italic', 'code', 'strike']),
    );
    expect(c[2].type).toBe('blockquote');
    expect(c[3].type).toBe('orderedList');
    expect(c[3].content).toHaveLength(2);
    expect(c[4].type).toBe('bulletList');
    // Nested list lives inside the first list item.
    expect(c[4].content?.[0].content?.[1].type).toBe('bulletList');
    expect(c[5]).toMatchObject({
      type: 'codeBlock',
      attrs: { language: 'ts' },
    });
    expect(c[6].type).toBe('horizontalRule');
    expect(doc.kind).toBe('block');
    expect(doc.align).toBe(Alignment.left);
    expect(doc.plainText).toContain('Title');
  });

  it('resolves inline and reference links, splits images out of paragraphs', () => {
    const doc = parse(
      [
        'See [site](https://example.com "hint") and [ref][r].',
        '',
        'before ![alt](pic.png) after',
        '',
        '[r]: https://ref.example',
      ].join('\n'),
    );
    const c = doc.content.content!;
    const linkMark = c[0].content?.flatMap((n) => n.marks ?? []) ?? [];
    expect(linkMark).toContainEqual({
      type: 'link',
      attrs: { href: 'https://example.com', title: 'hint' },
    });
    expect(linkMark).toContainEqual({
      type: 'link',
      attrs: { href: 'https://ref.example' },
    });
    expect(c[1].type).toBe('paragraph');
    expect(c[2]).toMatchObject({
      type: 'image',
      attrs: { src: 'pic.png', alt: 'alt' },
    });
    expect(c[3].type).toBe('paragraph');
  });

  it('imports GFM tables with a header row and warns on task lists and html', () => {
    const { document, warnings } = parseMarkdownToTextDocument(
      [
        '| a | b |',
        '| - | - |',
        '| 1 | 2 |',
        '',
        '- [ ] todo',
        '',
        '<div>x</div>',
      ].join('\n'),
    );
    const c = document.content.content!;
    const table = c[0];
    expect(table.type).toBe('table');
    expect(table.content?.[0].content?.[0].type).toBe('tableHeader');
    expect(table.content?.[1].content?.[0].type).toBe('tableCell');
    const item = c[1].content?.[0];
    expect(item?.content?.[0].content?.[0].text).toBe('[ ] ');
    expect(warnings.some((w) => w.message.includes('Task list'))).toBe(true);
    expect(warnings.some((w) => w.message.includes('HTML'))).toBe(true);
  });
});

describe('serializeTextDocumentToMarkdown', () => {
  const doc = (content: object[]) => ({
    schemaVersion: 1 as const,
    id: 'd1',
    kind: 'block' as const,
    content: { type: 'doc', content },
    plainText: '',
  });
  const p = (...children: object[]) => ({
    type: 'paragraph',
    content: children,
  });
  const t = (value: string, marks?: object[]) => ({
    type: 'text',
    text: value,
    ...(marks ? { marks } : {}),
  });

  it('serializes blocks, marks, lists, code and links', () => {
    const { markdown } = serializeTextDocumentToMarkdown(
      doc([
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [t('Title')],
        },
        p(
          t('A '),
          t('bold', [{ type: 'bold' }]),
          t(' '),
          t('link', [{ type: 'link', attrs: { href: 'https://x.dev' } }]),
          t(' '),
          t('code', [{ type: 'code' }]),
        ),
        { type: 'blockquote', content: [p(t('q'))] },
        {
          type: 'orderedList',
          attrs: { start: 3 },
          content: [
            { type: 'listItem', content: [p(t('i1'))] },
            {
              type: 'listItem',
              content: [
                p(t('i2')),
                {
                  type: 'bulletList',
                  content: [{ type: 'listItem', content: [p(t('n'))] }],
                },
              ],
            },
          ],
        },
        {
          type: 'codeBlock',
          attrs: { language: 'js' },
          content: [t('let a=1;')],
        },
        { type: 'horizontalRule' },
      ]),
    );
    expect(markdown).toContain('## Title');
    expect(markdown).toContain('**bold**');
    expect(markdown).toContain('[link](https://x.dev)');
    expect(markdown).toContain('`code`');
    expect(markdown).toContain('> q');
    expect(markdown).toContain('3. i1');
    expect(markdown).toContain('* n');
    expect(markdown).toContain('```js');
    expect(markdown).toContain('***');
  });

  it('round-trips tables, images and hard breaks', () => {
    const source = [
      '| h1 | h2 |',
      '| -- | -- |',
      '| a | b |',
      '',
      'x  ',
      'y',
      '',
      '![i](i.png "cap")',
    ].join('\n');
    const parsed = parse(source);
    const { markdown } = serializeTextDocumentToMarkdown(parsed);
    const again = parse(markdown);
    expect(again.content.content?.[0].type).toBe('table');
    expect(
      again.content.content?.some(
        (n) => n.type === 'image' && n.attrs?.['src'] === 'i.png',
      ),
    ).toBe(true);
    // The hard break survives the round trip.
    const para = parsed.content.content?.[1];
    expect(para?.content?.some((n) => n.type === 'hardBreak')).toBe(true);
  });

  it('keeps formatting warnings for marks markdown cannot express', () => {
    const { markdown, warnings } = serializeTextDocumentToMarkdown(
      doc([
        p(
          t('size', [{ type: 'textStyle', attrs: { fontSize: '24px' } }]),
          t('hi', [{ type: 'highlight', attrs: { color: '#ff0' } }]),
        ),
      ]),
    );
    expect(markdown).toContain('size');
    expect(markdown).toContain('hi');
    expect(warnings.length).toBeGreaterThanOrEqual(2);
  });

  it('exports a synthetic header for tables without header cells', () => {
    const { markdown, warnings } = serializeTextDocumentToMarkdown(
      doc([
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                { type: 'tableCell', content: [p(t('a'))] },
                { type: 'tableCell', content: [p(t('b'))] },
              ],
            },
          ],
        },
      ]),
    );
    expect(markdown).toMatch(/\|[^\n]*\|\s*\n\s*\|?\s*[-–—]/);
    expect(warnings.some((w) => w.message.includes('header'))).toBe(true);
    // And the data row still round-trips.
    expect(markdown).toContain('a');
  });
});
