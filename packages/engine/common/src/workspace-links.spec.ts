import { describe, expect, it } from 'vitest';
import {
  createWorkspaceLink,
  parseWorkspaceLink,
  remapWorkspaceLink,
  parseExternalLink,
  type WorkspaceTarget,
} from './workspace-links';
import { mapBoardTextLinks } from './text/map-links';
import { createBlockText } from './text/editor-factory';

describe('workspace target protocol', () => {
  it.each<WorkspaceTarget>([
    { kind: 'file', fileId: '文档/目标:%#' },
    { kind: 'heading', fileId: '文档/目标:%#', slug: '重复标题-1' },
    { kind: 'cell', fileId: '图/服务:%#', cellId: '模块:%#服务' },
  ])('round trips opaque identities once: %j', (target) =>
    expect(parseWorkspaceLink(createWorkspaceLink(target))).toEqual(target),
  );
  it('keeps legacy headings and relative fragments distinct from typed cells', () => {
    expect(parseWorkspaceLink('#%E7%AB%A0%E8%8A%82', 'source')).toEqual({
      kind: 'heading',
      fileId: 'source',
      slug: '章节',
    });
    expect(parseWorkspaceLink('#cell%3A%E6%A8%A1%E5%9D%97', 'source')).toEqual({
      kind: 'cell',
      fileId: 'source',
      cellId: '模块',
    });
    expect(parseWorkspaceLink('#cell:')).toBeNull();
    expect(parseWorkspaceLink('#', 'source')).toEqual({
      kind: 'file',
      fileId: 'source',
    });
    expect(parseWorkspaceLink('#title')).toBeNull();
  });
  it.each([
    'verd://file/',
    'verd://file/id/other',
    'verd://file/id?query',
    'verd://file/%broken',
    'verd://file/id#%broken',
    'verd://file/id%00',
    'verd://file/id#cell%3A',
    'verd://other/id',
    'javascript:alert(1)',
    'data:text/html,hello',
    'file:///etc/passwd',
    '../docs/readme.md',
    ' https://example.com',
    'https://example.com\n',
  ])('rejects unsupported target %s', (href) =>
    expect(parseWorkspaceLink(href, 'source')).toBeNull(),
  );
  it('handles HTTP navigation separately', () => {
    expect(parseExternalLink('https://example.com/docs?q=1#code')).toBe(
      'https://example.com/docs?q=1#code',
    );
    expect(parseExternalLink('http://localhost:3000')).toBe(
      'http://localhost:3000/',
    );
    expect(parseExternalLink('https://user:secret@example.com')).toBeNull();
    expect(parseExternalLink('javascript:alert(1)')).toBeNull();
  });
  it('remaps a copied cell even when the original file was not copied', () => {
    const href = createWorkspaceLink({
      kind: 'cell',
      fileId: 'source',
      cellId: 'node',
    });
    expect(
      parseWorkspaceLink(
        remapWorkspaceLink(href, {
          idMap: new Map([['node', 'copy']]),
          targetOwnerOf: () => 'destination',
        }),
      ),
    ).toEqual({ kind: 'cell', fileId: 'destination', cellId: 'copy' });
    expect(
      remapWorkspaceLink(href, { idMap: new Map([['source', 'file-copy']]) }),
    ).toBe(href);
  });
  it('keeps no-op import fragments and anchors a carrier moved to another file to its original target', () => {
    const href = '#cell%3Atarget';
    expect(
      remapWorkspaceLink(href, {
        idMap: new Map(),
        sourceFileId: 'source',
        targetFileId: 'source',
      }),
    ).toBe(href);
    expect(
      parseWorkspaceLink(
        remapWorkspaceLink(href, {
          idMap: new Map([['carrier', 'copy-carrier']]),
          sourceFileId: 'source',
          targetFileId: 'destination',
        }),
      ),
    ).toEqual({ kind: 'cell', fileId: 'source', cellId: 'target' });
    const heading = '#local-heading';
    expect(
      remapWorkspaceLink(heading, {
        idMap: new Map(),
        sourceFileId: 'source',
        targetFileId: 'source',
      }),
    ).toBe(heading);
    expect(
      parseWorkspaceLink(
        remapWorkspaceLink(heading, {
          idMap: new Map(),
          sourceFileId: 'source',
          targetFileId: 'destination',
        }),
      ),
    ).toEqual({ kind: 'heading', fileId: 'source', slug: 'local-heading' });
  });
  it('only rewrites explicit link marks, preserving literal code and unchanged identities', () => {
    const href = createWorkspaceLink({
      kind: 'cell',
      fileId: 'source',
      cellId: 'node',
    });
    const text = createBlockText('');
    text.content = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Module',
              marks: [{ type: 'link', attrs: { href } }],
            },
          ],
        },
        {
          type: 'codeBlock',
          content: [
            {
              type: 'text',
              text: href,
              marks: [{ type: 'link', attrs: { href } }],
            },
          ],
        },
      ],
    };
    expect(mapBoardTextLinks(text, (x) => x)).toBe(text);
    const next = mapBoardTextLinks(
      text,
      () => 'https://example.com',
    ) as typeof text;
    expect(next.content.content?.[0].content?.[0].marks?.[0].attrs?.href).toBe(
      'https://example.com',
    );
    expect(next.content.content?.[1]).toBe(text.content.content![1]);
  });
});
