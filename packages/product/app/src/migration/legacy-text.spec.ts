import { createInlineText } from '@sue/board-common';
import { migrateLegacyTextDocument } from './legacy/text-document';
import legacyRawBlocks from '../../../../../tests/fixtures/legacy/text-raw-blocks.json';
import legacyChildren from '../../../../../tests/fixtures/legacy/text-slate-children.json';

describe('migrateLegacyTextDocument', () => {
  it('preserves plain string labels from legacy records', () => {
    expect(migrateLegacyTextDocument('Arrow label', 'inline')).toMatchObject({
      kind: 'inline',
      plainText: 'Arrow label',
    });
  });

  it('keeps BoardTextDocument as-is', () => {
    const doc = createInlineText('Hello');
    expect(migrateLegacyTextDocument(doc).plainText).toBe('Hello');
    expect(migrateLegacyTextDocument(doc).kind).toBe('inline');
  });

  it('migrates legacy raw.blocks documents', () => {
    const doc = migrateLegacyTextDocument(legacyRawBlocks, 'block');
    expect(doc.schemaVersion).toBe(1);
    expect(doc.kind).toBe('block');
    expect(doc.plainText).toContain('Hello');
    expect(doc.content.type).toBe('doc');
  });

  it('migrates legacy children documents', () => {
    const doc = migrateLegacyTextDocument(legacyChildren, 'inline');
    expect(doc.kind).toBe('inline');
    expect(doc.plainText).toContain('Bold');
    expect(doc.content.content?.[0].content?.some((node) => node.marks)).toBe(
      true,
    );
  });
});
