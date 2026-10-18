import { describe, expect, it } from 'vitest';
import { createDocumentLink, parseDocumentLink } from './document-links';

describe('document links', () => {
  it('round-trips opaque file identities and Unicode heading fragments', () => {
    const href = createDocumentLink('project-doc:指南/架构', '架构与验收-1');
    expect(parseDocumentLink(href)).toEqual({
      kind: 'file',
      fileId: 'project-doc:指南/架构',
      anchor: '架构与验收-1',
    });
    expect(parseDocumentLink(createDocumentLink('board-root'))).toEqual({
      kind: 'file',
      fileId: 'board-root',
      anchor: null,
    });
  });

  it('resolves same-document fragments only with a source identity', () => {
    expect(parseDocumentLink('#%E7%AB%A0%E8%8A%82', 'source')).toEqual({
      kind: 'file',
      fileId: 'source',
      anchor: '章节',
    });
    expect(parseDocumentLink('#', 'source')).toEqual({
      kind: 'file',
      fileId: 'source',
      anchor: null,
    });
    expect(parseDocumentLink('#章节')).toBeNull();
  });

  it('opens only HTTP(S) external URLs', () => {
    expect(parseDocumentLink('https://example.com/docs?q=1#code')).toEqual({
      kind: 'external',
      url: 'https://example.com/docs?q=1#code',
    });
    expect(parseDocumentLink('http://localhost:3000')).toEqual({
      kind: 'external',
      url: 'http://localhost:3000/',
    });
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,hello',
    'file:///etc/passwd',
    'mailto:a@example.com',
    '//example.com',
    '../docs/readme.md',
    'verd://other/id',
    'verd://user@file/id',
    'verd://file:80/id',
    'verd://file/',
    'verd://file/id/other',
    'verd://file/id?query',
    'verd://file/id?query#anchor',
    'verd://file/%broken',
    'verd://file/id#%broken',
    'verd://file/id%00',
    '#%broken',
    ' https://example.com',
    'https://example.com\n',
    'https://user:secret@example.com',
  ])('rejects unsafe or unsupported target %s', (href) => {
    expect(parseDocumentLink(href, 'source')).toBeNull();
  });
});
