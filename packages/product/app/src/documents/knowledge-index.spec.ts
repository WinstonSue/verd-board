import { describe, expect, it } from 'vitest';
import { createFrameCell } from '@sue/board-core';
import { createDocumentFile } from '@sue/verd-board-workspace';
import { createFrameFile } from '@sue/verd-board-workspace';
import { workspaceFileClosure } from '@sue/verd-board-workspace';
import {
  createKnowledgeIndexer,
  queryKnowledgeTargets,
} from './knowledge-index';
const linked = (href: string, text = '技术结论') => ({
  type: 'paragraph',
  content: [{ type: 'text', text, marks: [{ type: 'link', attrs: { href } }] }],
});
describe('knowledge relationships independent of content dependencies', () => {
  it('indexes ordinary links, heading/cell links and embeds without expanding export closure', () => {
    const a = createDocumentFile('a', '技术方案'),
      b = createFrameFile(createFrameCell('b'));
    a.text.content = {
      type: 'doc',
      content: [
        linked('verd://file/b#cell%3Anode'),
        linked('verd://file/b'),
        linked('https://example.com'),
        { type: 'codeBlock', content: linked('verd://file/b').content },
      ],
    };
    const before = JSON.stringify([a, b]);
    const index = createKnowledgeIndexer()([a, b]);
    expect(index.relations.map((r) => r.kind)).toEqual(['cell', 'text']);
    expect(index.relations[0]).toMatchObject({
      sourceFileId: 'a',
      context: '技术结论',
      target: { kind: 'cell', fileId: 'b', cellId: 'node' },
    });
    expect(workspaceFileClosure([a, b], 'a')).toEqual([a]);
    expect(JSON.stringify([a, b])).toBe(before);
  });
  it('uses the editor heading slugs, searches headings and keeps unresolved targets', () => {
    const a = createDocumentFile('a', '系统设计');
    const heading = {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: '架构' }],
    };
    a.text.content = {
      type: 'doc',
      content: [
        heading,
        heading,
        linked('#架构-1'),
        linked('verd://file/missing'),
      ],
    };
    const index = createKnowledgeIndexer()([a]);
    expect(index.targets.map((t) => t.target)).toEqual([
      { kind: 'file', fileId: 'a' },
      { kind: 'heading', fileId: 'a', slug: '架构' },
      { kind: 'heading', fileId: 'a', slug: '架构-1' },
    ]);
    expect(queryKnowledgeTargets(index.targets, '系统 架构')).toHaveLength(2);
    expect(index.relations[1].target.fileId).toBe('missing');
  });
  it('refreshes on rename, edits, removal and restore without changing identity', () => {
    const index = createKnowledgeIndexer();
    const a = createDocumentFile('a', '旧名称');
    a.text.content = { type: 'doc', content: [linked('verd://file/a')] };
    expect(index([a]).relations).toHaveLength(1);
    const renamed = { ...a, title: '新名称' };
    expect(index([renamed]).targets[0].title).toBe('新名称');
    expect(index([]).relations).toHaveLength(0);
    expect(index([renamed]).relations).toHaveLength(1);
    expect(
      index([
        {
          ...renamed,
          text: { ...a.text, content: { type: 'doc', content: [] } },
        },
      ]).relations,
    ).toHaveLength(0);
  });
  it('indexes rich text in cells and direct embeds without following cycles', () => {
    const a = createFrameFile(createFrameCell('a')),
      b = createFrameFile(createFrameCell('b'));
    a.cells = {
      ref: {
        id: 'ref',
        kind: 'frame-reference',
        cellType: 'node',
        geometry: { x: 0, y: 0, width: 100, height: 100 },
        data: { targetFrameId: 'b' },
      },
    };
    a.frame.children = ['ref'];
    const doc = createDocumentFile('d');
    doc.text.content = {
      type: 'doc',
      content: [
        { type: 'frameReference', attrs: { targetFrameId: 'a' } },
        linked('verd://file/a'),
      ],
    };
    expect(
      createKnowledgeIndexer()([a, b, doc])
        .relations.map((r) => r.kind)
        .sort(),
    ).toEqual(['embed', 'embed', 'text']);
  });
  it('follows moved Cell identities and locates repeated source links independently', () => {
    const doc = createDocumentFile('doc');
    doc.text.content = {
      type: 'doc',
      content: [
        linked('verd://file/old#cell%3An'),
        linked('verd://file/old#cell%3An'),
      ],
    };
    const board = createFrameFile(createFrameCell('new'));
    board.cells = {
      n: {
        id: 'n',
        kind: 'frame-reference',
        cellType: 'node',
        geometry: { x: 0, y: 0, width: 100, height: 100 },
        data: { targetFrameId: 'doc' },
      },
    };
    const index = createKnowledgeIndexer();
    const initial = index([doc]);
    const moved = index([doc, board]);
    expect(initial.relations[0].target.fileId).toBe('old');
    expect(moved.relations[0].target.fileId).toBe('new');
    expect(moved.relations[0].sourceFrom).toBe(1);
    expect(moved.relations[1].sourceFrom).toBe(7);
    expect(initial.relations[0].target.fileId).toBe('old');
  });
  it('keeps warm indexing bounded for a thousand documents and ten thousand cells', () => {
    const docs = Array.from({ length: 1000 }, (_, i) =>
      createDocumentFile(`d${i}`, `资料${i}`),
    );
    const board = createFrameFile(createFrameCell('board'));
    for (let i = 0; i < 10000; i++)
      board.cells[`n${i}`] = {
        id: `n${i}`,
        kind: 'frame-reference',
        cellType: 'node',
        geometry: { x: 0, y: 0, width: 100, height: 100 },
        data: { targetFrameId: 'd0' },
      };
    const index = createKnowledgeIndexer();
    index([...docs, board]);
    const times = Array.from({ length: 10 }, () => {
      const start = performance.now();
      const result = index([...docs, board]);
      expect(result.targets.length).toBe(11001);
      return performance.now() - start;
    }).sort((a, b) => a - b);
    expect(times[9]).toBeLessThan(200);
  });
});

it('keeps an empty heading editable without creating an invalid link target', () => {
  const file = createDocumentFile('empty');
  file.text.content = {
    type: 'doc',
    content: [{ type: 'heading', attrs: { level: 2 }, content: [] }],
  };
  expect(() => createKnowledgeIndexer()([file])).not.toThrow();
  expect(createKnowledgeIndexer()([file]).targets).toHaveLength(1);
});
