import { describe, expect, it } from 'vitest';
import { createDocumentFile } from '../documents/document-files';
import type { GitVersionFile } from '../host/workspace-git';
import { validateGitVersionFiles } from './workspace-git-validation';
const entry = (path: string, value: unknown): GitVersionFile => ({
  path,
  content: new TextEncoder().encode(JSON.stringify(value)),
});

describe('Git candidate validation', () => {
  it('validates native files alongside arbitrary non-native content', () => {
    expect(() =>
      validateGitVersionFiles([
        entry('Doc.verd-doc.json', createDocumentFile('doc', 'Title')),
        entry('notes.json', { ordinary: true }),
      ]),
    ).not.toThrow();
  });
  it('rejects duplicate identities and mismatched body identities before publication', () => {
    const file = createDocumentFile('doc', 'Title');
    expect(() =>
      validateGitVersionFiles([
        entry('one.verd-doc.json', file),
        entry('two.verd-doc.json', file),
      ]),
    ).toThrow('Duplicate');
    expect(() =>
      validateGitVersionFiles([
        entry('one.verd-doc.json', {
          ...file,
          text: { ...file.text, id: 'wrong' },
        }),
      ]),
    ).toThrow('identity');
  });
  it('requires managed resources in the candidate tree, even if available live', () => {
    const file = createDocumentFile('doc', 'Title');
    file.text.content = {
      type: 'doc',
      content: [
        {
          type: 'image',
          attrs: {
            src: 'verd-asset:.verd-resources/assets/' + 'a'.repeat(64) + '.png',
          },
        },
      ],
    };
    const version = [entry('Doc.verd-doc.json', file)];
    expect(() => validateGitVersionFiles(version)).toThrow(
      'missing attachment',
    );
    expect(() =>
      validateGitVersionFiles([
        ...version,
        {
          path: '.verdscrolls/resources/assets/' + 'a'.repeat(64) + '.png',
          content: new Uint8Array([1]),
        },
      ]),
    ).not.toThrow();
  });
  it('rejects a newly referenced native source missing from the proposed commit', () => {
    const file = createDocumentFile('doc', 'References');
    file.text.content = {
      type: 'doc',
      content: [
        { type: 'frameReference', attrs: { targetFrameId: 'not-committed' } },
      ],
    };
    expect(() =>
      validateGitVersionFiles(
        [entry('Doc.verd-doc.json', file)],
        undefined,
        [],
      ),
    ).toThrow('not-committed');
  });
  it('retains established missing-source placeholders when a referenced source is deleted', () => {
    const file = createDocumentFile('doc', 'References');
    file.text.content = {
      type: 'doc',
      content: [
        { type: 'frameReference', attrs: { targetFrameId: 'removed-source' } },
      ],
    };
    const prior = [entry('Doc.verd-doc.json', file)];
    expect(() =>
      validateGitVersionFiles(prior, undefined, prior),
    ).not.toThrow();
    expect(() => validateGitVersionFiles(prior)).not.toThrow();
  });
});
