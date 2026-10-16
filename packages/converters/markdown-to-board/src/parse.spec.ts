import { describe, expect, it } from 'vitest';
import { CellKind, isNodeCell, validateCellStore } from '@sue/board-core';
import { createCellRegistry } from '@sue/board-core';
import { mindChildIds, registerMindCells } from '@sue/board-mind';
import type { BoardTextDocument } from '@sue/board-common';
import {
  parseMarkdownToFrameSnapshot,
  serializeFrameToMarkdown,
} from './index';

const registry = createCellRegistry();
registerMindCells(registry);

type Snapshot = ReturnType<typeof parseMarkdownToFrameSnapshot>;

const tree = (snapshot: Snapshot, parentId?: string): unknown => {
  const id =
    parentId ??
    Object.values(snapshot.store.cells).find(
      (cell) => cell.kind === CellKind.mindRoot,
    )!.id;
  const node = snapshot.store.cells[id];
  return {
    label: isNodeCell(node) ? node.content?.label : '',
    note: isNodeCell(node)
      ? (
          (node.data as { note?: BoardTextDocument } | undefined)?.note
            ?.plainText ?? ''
        ).trim()
      : '',
    children: mindChildIds(snapshot.store, id).map((child) =>
      tree(snapshot, child),
    ),
  };
};

const rootTrees = (snapshot: Snapshot) =>
  Object.values(snapshot.store.cells)
    .filter((cell) => cell.kind === CellKind.mindRoot)
    .map((root) => tree(snapshot, root.id));

describe('Markdown import', () => {
  it('attaches preamble content to the first root note', () => {
    const snapshot = parseMarkdownToFrameSnapshot(
      'Intro paragraph.\n\n# Root\n\nRoot note.\n\n## Child',
    );
    expect(tree(snapshot)).toEqual({
      label: 'Root',
      note: 'Intro paragraph.\nRoot note.',
      children: [{ label: 'Child', note: '', children: [] }],
    });
  });

  it('hangs skipped-depth headings on the nearest shallower heading', () => {
    const snapshot = parseMarkdownToFrameSnapshot(
      '# Root\n#### Deep\n## Mid\n##### Deeper',
    );
    // Deeper hangs on Mid, the nearest shallower heading at that point.
    expect(tree(snapshot)).toEqual({
      label: 'Root',
      note: '',
      children: [
        { label: 'Deep', note: '', children: [] },
        {
          label: 'Mid',
          note: '',
          children: [{ label: 'Deeper', note: '', children: [] }],
        },
      ],
    });
  });

  it('keeps explicitly empty headings and list items as empty topics', () => {
    // List items nest under the last heading, empty or not.
    const snapshot = parseMarkdownToFrameSnapshot('# Root\n##\n- \n- Item');
    expect(tree(snapshot)).toEqual({
      label: 'Root',
      note: '',
      children: [
        {
          label: '',
          note: '',
          children: [
            { label: '', note: '', children: [] },
            { label: 'Item', note: '', children: [] },
          ],
        },
      ],
    });
  });

  it('synthesizes a center for heading-less input via fallbackTitle', () => {
    const snapshot = parseMarkdownToFrameSnapshot(
      'just a paragraph',
      undefined,
      {
        fallbackTitle: 'Draft',
      },
    );
    expect(tree(snapshot)).toEqual({
      label: 'Draft',
      note: 'just a paragraph',
      children: [],
    });
  });

  it('defaults the synthetic center title for pasted content', () => {
    const snapshot = parseMarkdownToFrameSnapshot('- a\n- b');
    const roots = rootTrees(snapshot);
    expect(roots[0].label).toBe('中心主题');
    expect(roots[0].children).toEqual([
      { label: 'a', note: '', children: [] },
      { label: 'b', note: '', children: [] },
    ]);
  });

  it('uses one synthetic center for several equally shallow headings', () => {
    const snapshot = parseMarkdownToFrameSnapshot('## A\n## B\n### C');
    expect(tree(snapshot)).toEqual({
      label: '中心主题',
      note: '',
      children: [
        { label: 'A', note: '', children: [] },
        {
          label: 'B',
          note: '',
          children: [{ label: 'C', note: '', children: [] }],
        },
      ],
    });
  });

  it('keeps blockquote children out of the topic tree', () => {
    const snapshot = parseMarkdownToFrameSnapshot(
      [
        '# Root',
        '',
        '> note para',
        '>',
        '> ## not a topic',
        '> - not a topic',
      ].join('\n'),
    );
    const result = tree(snapshot) as {
      label: string;
      note: string;
      children: unknown[];
    };
    expect(result.children).toEqual([]);
    expect(result.note).toContain('note para');
    expect(result.note).toContain('not a topic');
  });

  it('maps list items: first paragraph is the title, later paragraphs notes', () => {
    const snapshot = parseMarkdownToFrameSnapshot(
      '# Root\n\n- Item\n\n  continuation note\n\n  - nested\n\n- Second',
    );
    expect(tree(snapshot)).toEqual({
      label: 'Root',
      note: '',
      children: [
        {
          label: 'Item',
          note: 'continuation note',
          children: [{ label: 'nested', note: '', children: [] }],
        },
        { label: 'Second', note: '', children: [] },
      ],
    });
  });

  it('preserves bold, italic, code and link marks in titles', () => {
    const snapshot = parseMarkdownToFrameSnapshot(
      '# Root with **bold** and `code`\n\n## [Link text](https://example.com) *em*',
    );
    const root = snapshot.store.cells['markdown:root'];
    if (!isNodeCell(root)) throw new Error('missing root');
    const title = (root.content as { text: BoardTextDocument }).text;
    const marks = title.content.content[0].content!.flatMap(
      (node) => node.marks ?? [],
    );
    expect(marks.map((mark) => mark.type)).toEqual(
      expect.arrayContaining(['bold', 'code']),
    );
    const childId = mindChildIds(snapshot.store, 'markdown:root')[0];
    const child = snapshot.store.cells[childId];
    if (!isNodeCell(child)) throw new Error('missing child');
    const childMarks = (
      child.content as { text: BoardTextDocument }
    ).text.content.content[0].content!.flatMap((node) => node.marks ?? []);
    expect(
      childMarks.find((mark) => mark.type === 'link')?.attrs?.['href'],
    ).toBe('https://example.com');
    expect(childMarks.map((mark) => mark.type)).toContain('italic');
  });

  it('stacks multiple roots so imported trees never overlap', () => {
    const snapshot = parseMarkdownToFrameSnapshot(
      '# A\n## a1\n## a2\n\n# B\n## b1',
    );
    const roots = Object.values(snapshot.store.cells).filter(
      (cell) => cell.kind === CellKind.mindRoot,
    );
    expect(roots).toHaveLength(2);
    const ys = roots.map((root) => (isNodeCell(root) ? root.geometry.y : 0));
    expect(Math.abs(ys[1] - ys[0])).toBeGreaterThan(0);
    expect(validateCellStore(snapshot.store, registry)).toEqual([]);
  });
});

describe('Markdown export and round-trip', () => {
  it('keeps deep level 6-7-8 trees with notes through round-trip', () => {
    const definition = [
      '# L1',
      '## L2',
      '### L3',
      '#### L4',
      '##### L5',
      '###### L6',
      '> note on six',
      '',
      '- L7',
      '  - L8',
      '',
      '    > note on eight',
    ].join('\n');
    const once = rootTrees(parseMarkdownToFrameSnapshot(definition));
    const markdown = serializeFrameToMarkdown(
      parseMarkdownToFrameSnapshot(definition),
    );
    const twice = rootTrees(parseMarkdownToFrameSnapshot(markdown));
    expect(twice).toEqual(once);
    interface Level {
      label: string;
      note: string;
      children: Level[];
    }
    const l6 = (once[0] as Level).children[0].children[0].children[0]
      .children[0].children[0];
    const l7 = l6.children[0];
    const l8 = l7.children[0];
    expect(l6.note).toContain('note on six');
    expect(l7.children).toHaveLength(1);
    expect(l8.note).toContain('note on eight');
  });

  it('exports notes as blockquotes that re-import as notes', () => {
    const snapshot = parseMarkdownToFrameSnapshot(
      '# Root\n\n## Topic\n\n> a note line\n>\n> - list inside note',
    );
    const markdown = serializeFrameToMarkdown(snapshot);
    expect(markdown).toContain('> a note line');
    const again = tree(parseMarkdownToFrameSnapshot(markdown)) as {
      children: { label: string; note: string }[];
    };
    expect(again.children[0].note).toContain('a note line');
    expect(again.children[0].note).toContain('list inside note');
  });

  it('escapes special characters so labels survive the round-trip', () => {
    const definition = '# Root\n\n## a [bracket] and *star*';
    const once = tree(parseMarkdownToFrameSnapshot(definition));
    const again = tree(
      parseMarkdownToFrameSnapshot(
        serializeFrameToMarkdown(parseMarkdownToFrameSnapshot(definition)),
      ),
    );
    expect(again).toEqual(once);
  });

  it('keeps marks on export through the rich text document', () => {
    const snapshot = parseMarkdownToFrameSnapshot(
      '# Root\n\n## **bold** topic\n\n> note with `code` and [link](https://x.y)',
    );
    const markdown = serializeFrameToMarkdown(snapshot);
    expect(markdown).toMatch(/\*\*bold\*\*/);
    expect(markdown).toContain('`code`');
    expect(markdown).toContain('[link](https://x.y)');
  });
});
