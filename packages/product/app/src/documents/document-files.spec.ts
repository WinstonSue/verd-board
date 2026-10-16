import { describe, expect, it } from 'vitest';
import type { BoardTextDocument } from '@sue/board-common';
import {
  createDocumentFile,
  createDocumentText,
  documentDisplayName,
  documentFileDiagnostic,
  documentPathFor,
  duplicateDocumentFile,
  isDocumentFileV1,
  remapImportedDocument,
  renameDocumentFile,
  workspaceFileId,
  type DocumentFileV1,
} from './document-files';

const text = (id: string): BoardTextDocument => ({
  schemaVersion: 1,
  id,
  kind: 'block',
  content: { type: 'doc', content: [{ type: 'paragraph' }] },
  plainText: '',
  align: 'left',
});

const file = (id: string, title = id): DocumentFileV1 => ({
  format: 'verd-document',
  version: 1,
  id,
  title,
  text: text(id),
});

describe('isDocumentFileV1', () => {
  it('accepts a valid document file', () => {
    expect(isDocumentFileV1(file('doc-1', 'Notes'))).toBe(true);
  });

  it('rejects malformed envelopes, versions and non-block bodies', () => {
    expect(isDocumentFileV1(null)).toBe(false);
    expect(isDocumentFileV1({})).toBe(false);
    expect(isDocumentFileV1('{ broken')).toBe(false);
    expect(isDocumentFileV1({ ...file('d'), format: 'verd-frame' })).toBe(
      false,
    );
    expect(isDocumentFileV1({ ...file('d'), version: 2 })).toBe(false);
    expect(isDocumentFileV1({ ...file('d'), id: 3 })).toBe(false);
    expect(isDocumentFileV1({ ...file('d'), title: 9 })).toBe(false);
    expect(
      isDocumentFileV1({
        ...file('d'),
        text: { ...text('d'), kind: 'inline' },
      }),
    ).toBe(false);
    expect(isDocumentFileV1({ ...file('d'), text: { garbage: true } })).toBe(
      false,
    );
  });

  it('accepts unknown body node types — schema validation is a second stage', () => {
    const doc = file('d');
    doc.text.content = {
      type: 'doc',
      content: [{ type: 'futureBlock', attrs: { a: 1 } }],
    };
    expect(isDocumentFileV1(doc)).toBe(true);
  });
});

describe('documentFileDiagnostic', () => {
  it('returns null for valid files and explains each failure mode', () => {
    expect(documentFileDiagnostic(file('d'))).toBeNull();
    expect(documentFileDiagnostic(null)).toMatch(/not a document/i);
    expect(documentFileDiagnostic({ format: 'verd-frame' })).toMatch(
      /unsupported format/i,
    );
    expect(documentFileDiagnostic({ ...file('d'), version: 99 })).toMatch(
      /unsupported document version/i,
    );
    expect(documentFileDiagnostic({ ...file('d'), id: '' })).toMatch(
      /identity/i,
    );
    expect(documentFileDiagnostic({ ...file('d'), title: 1 })).toMatch(
      /title/i,
    );
    expect(
      documentFileDiagnostic({ ...file('d'), text: { kind: 'inline' } }),
    ).toMatch(/body|block|malformed/i);
  });
});

describe('createDocumentFile', () => {
  it('creates a block document whose body identity matches the file', () => {
    const doc = createDocumentFile('doc-7', '笔记');
    expect(doc.id).toBe('doc-7');
    expect(doc.title).toBe('笔记');
    expect(doc.text.id).toBe('doc-7');
    expect(doc.text.kind).toBe('block');
    expect(doc.text.align).toBe('left');
    expect(doc.text.content).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph' }],
    });
    expect(workspaceFileId(doc)).toBe('doc-7');
  });
});

describe('duplicateDocumentFile / remapImportedDocument', () => {
  it('duplicates with fresh file and body identities', () => {
    const source = file('doc-1', 'Source');
    source.text.content = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'hello' }] },
      ],
    };
    const clone = duplicateDocumentFile(source, () => 'fresh-id');
    expect(clone.id).toBe('fresh-id');
    expect(clone.text.id).toBe('fresh-id');
    expect(clone.title).toBe('Source');
    expect(clone.text.content).toEqual(source.text.content);
    // Deep copy: mutating the clone leaves the source untouched.
    (clone.text.content.content![0].content![0] as { text: string }).text =
      'changed';
    expect(
      (source.text.content.content![0].content![0] as { text: string }).text,
    ).toBe('hello');
  });

  it('remaps colliding identities and repairs body drift', () => {
    const doc = file('doc-1');
    doc.text.id = 'other';
    const remapped = remapImportedDocument(
      doc,
      (id) => id === 'doc-1',
      () => 'new-id',
    );
    expect(remapped.id).toBe('new-id');
    expect(remapped.text.id).toBe('new-id');
  });

  it('keeps foreign identities untouched', () => {
    const doc = file('doc-9');
    expect(
      remapImportedDocument(
        doc,
        () => false,
        () => 'x',
      ),
    ).toBe(doc);
  });
});

describe('renameDocumentFile / documentPathFor', () => {
  it('writes the title only — the session derives the matching path', () => {
    expect(renameDocumentFile(file('d', 'Old'), 'New').title).toBe('New');
  });

  it('builds deduplicated doc paths inside a directory', () => {
    const taken = new Set(['docs/A.verd-doc.json', 'docs/A 2.verd-doc.json']);
    expect(documentPathFor(file('d', 'A'), 'docs', taken)).toBe(
      'docs/A 3.verd-doc.json',
    );
    expect(documentPathFor(file('d', 'a/b'), '', new Set())).toBe(
      'a-b.verd-doc.json',
    );
  });

  it('derives display names from doc paths', () => {
    expect(documentDisplayName('docs/Notes.verd-doc.json')).toBe('Notes');
    expect(documentDisplayName('Notes.verd-doc.json')).toBe('Notes');
  });
});
