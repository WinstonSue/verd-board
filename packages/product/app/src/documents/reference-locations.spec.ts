import { describe, expect, it } from 'vitest';
import { createFrameCell } from '@sue/board-core';
import { createDocumentFile } from '@sue/verd-board-workspace';
import { createFrameFile } from '@sue/verd-board-workspace';
import {
  buildReferenceLocations,
  referenceLocationKey,
} from './reference-locations';

const reference = (id: string, targetFrameId: string) => ({
  id,
  kind: 'frame-reference',
  cellType: 'node' as const,
  geometry: { x: 0, y: 0, width: 100, height: 100 },
  data: { targetFrameId },
});

describe('direct embed locations', () => {
  it('counts repeated canvas and document embeds separately, ignores links, and never follows cycles', () => {
    const a = createFrameFile(createFrameCell('a'));
    const b = createFrameFile(createFrameCell('b'));
    a.frame.children = ['second', 'first'];
    a.cells = {
      first: reference('first', 'b'),
      second: { ...reference('second', 'b'), name: '详细视图' },
    };
    b.frame.children = ['cycle'];
    b.cells = { cycle: reference('cycle', 'a') };
    const document = createDocumentFile('document');
    document.text.content = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: '架构说明' }],
        },
        { type: 'frameReference', attrs: { targetFrameId: 'b' } },
        { type: 'frameReference', attrs: { targetFrameId: 'a' } },
        { type: 'frameReference', attrs: { targetFrameId: 'b' } },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: '链接',
              marks: [{ type: 'link', attrs: { href: 'verd://file/b' } }],
            },
          ],
        },
        {
          type: 'codeBlock',
          content: [{ type: 'text', text: 'verd://file/b' }],
        },
      ],
    };
    const before = JSON.stringify([a, b, document]);
    const index = buildReferenceLocations([a, b, document]);
    expect(index.get('b')).toMatchObject([
      { kind: 'canvas', refId: 'second', ordinal: 1, name: '详细视图' },
      { kind: 'canvas', refId: 'first', ordinal: 2 },
      {
        kind: 'document',
        sourceFileId: 'document',
        occurrence: 0,
        ordinal: 1,
        name: '架构说明',
      },
      { kind: 'document', sourceFileId: 'document', occurrence: 1, ordinal: 2 },
    ]);
    expect(index.get('a')).toHaveLength(2);
    expect(new Set(index.get('b')!.map(referenceLocationKey)).size).toBe(4);
    expect(JSON.stringify([a, b, document])).toBe(before);
  });

  it('derives fresh document addresses after removal without changing file identity', () => {
    const document = createDocumentFile('document');
    const ref = { type: 'frameReference', attrs: { targetFrameId: 'b' } };
    document.text.content = { type: 'doc', content: [ref, ref] };
    const original = buildReferenceLocations([document]).get('b')!;
    document.text.content = { type: 'doc', content: [ref] };
    const current = buildReferenceLocations([document]).get('b')!;
    expect(current).toHaveLength(1);
    expect(current[0]).toMatchObject({
      sourceFileId: 'document',
      occurrence: 0,
    });
    expect(current[0]).not.toEqual(original[0]);
  });
});
