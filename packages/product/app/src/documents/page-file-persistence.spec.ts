import { describe, expect, it } from 'vitest';
import { createPageFilePersistence } from './page-file-persistence';
import type { FilePersistenceState } from '../session/file-persistence';

describe('page persistence scope', () => {
  it('includes referenced editable sources, handles cycles and excludes unrelated failures', () => {
    const files = new Map<string, FilePersistenceState>([
      ['a', { status: 'saved', lastSavedAt: 10 }],
      ['embedded', { status: 'idle', lastSavedAt: 20 }],
      ['other', { status: 'error', lastSavedAt: 30 }],
    ]);
    const references = {
      targetsOf: new Map([
        [
          'a',
          [
            {
              sourceId: 'a',
              targetId: 'embedded',
              targetKind: 'document' as const,
            },
          ],
        ],
        [
          'embedded',
          [
            {
              sourceId: 'embedded',
              targetId: 'a',
              targetKind: 'canvas' as const,
            },
          ],
        ],
      ]),
      referencedBy: new Map(),
    };
    const state = createPageFilePersistence(files, references);
    expect(state('a')).toEqual({ status: 'idle', lastSavedAt: 20 });
    expect(state('a')).toBe(state('a'));
    expect(state('other').status).toBe('error');
    files.set('embedded', { status: 'saved', lastSavedAt: 25 });
    expect(createPageFilePersistence(files, references)('a')).toEqual({
      status: 'saved',
      lastSavedAt: 25,
    });
  });
});
