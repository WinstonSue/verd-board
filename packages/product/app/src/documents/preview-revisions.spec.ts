import { beforeAll, describe, expect, it } from 'vitest';
import {
  createDocumentFrameCell,
  createDocumentReferenceCell,
  createFrameCell,
  createFrameReferenceCell,
} from '@sue/board-core';
import { createFrameFile, type FrameFileV2 } from '../frames/frame-files';
import { createMemoryWorkspaceHost } from '../host/memory-workspace-host';
import {
  openWorkspaceSession,
  type WorkspaceFileEntry,
  type WorkspaceSessionSnapshot,
} from '../session/workspace-session';
import {
  createDocumentFile,
  type DocumentFileV1,
  type WorkspaceFile,
} from './document-files';
import { createPreviewRevisions } from './preview-revisions';

let empty: WorkspaceSessionSnapshot;
beforeAll(async () => {
  const host = createMemoryWorkspaceHost();
  const handle = (await host.openWorkspace({ path: 'preview-revisions' }))!;
  const session = await openWorkspaceSession(host, handle);
  empty = session.getState();
  session.dispose();
});

const bounds = { x: 0, y: 0, width: 400, height: 300 };
const canvas = (
  id: string,
  references: readonly (readonly [
    'canvas' | 'document' | 'document-frame',
    string,
  ])[] = [],
): FrameFileV2 => {
  const file = createFrameFile({ ...createFrameCell(id), name: id });
  references.forEach(([kind, target], index) => {
    const cellId = `${id}-ref-${index}`;
    const cell =
      kind === 'canvas'
        ? createFrameReferenceCell(cellId, target, bounds)
        : kind === 'document-frame'
          ? createDocumentFrameCell(cellId, target, bounds)
          : createDocumentReferenceCell(cellId, target, bounds);
    file.frame.children.push(cellId);
    file.cells[cellId] = cell;
  });
  return file;
};
const doc = (id: string, frameIds: readonly string[] = []): DocumentFileV1 => {
  const file = createDocumentFile(id, id);
  file.text.content = {
    type: 'doc',
    content: frameIds.length
      ? frameIds.map((targetFrameId) => ({
          type: 'frameReference',
          attrs: { targetFrameId },
        }))
      : [{ type: 'paragraph', content: [{ type: 'text', text: id }] }],
  };
  return file;
};
const snapshot = (...entries: WorkspaceFile[]): WorkspaceSessionSnapshot => {
  const files = new Map<string, WorkspaceFileEntry<FrameFileV2>>();
  const documents = new Map<string, WorkspaceFileEntry<DocumentFileV1>>();
  for (const file of entries) {
    if (file.format === 'verd-frame')
      files.set(file.frame.id, {
        file,
        path: `${file.frame.id}.verd.json`,
        dirty: false,
      });
    else
      documents.set(file.id, {
        file,
        path: `${file.id}.verd-doc.json`,
        dirty: false,
      });
  }
  return { ...empty, files, documents };
};
const moved = (file: FrameFileV2): FrameFileV2 => ({
  ...file,
  frame: {
    ...file.frame,
    geometry: { ...file.frame.geometry, x: file.frame.geometry.x + 100 },
  },
});

describe('preview revisions', () => {
  it('keeps its token through unrelated files, ancestor movement and save-state changes', () => {
    const revisions = createPreviewRevisions();
    const root = canvas('root', [['document', 'D']]);
    const D = doc('D', ['C']);
    const C = canvas('C', [['document-frame', 'E']]);
    const E = doc('E');
    const unrelated = doc('unrelated');
    const before = snapshot(root, D, C, E, unrelated);
    const token = revisions(before, ['root'], 'D');
    expect(typeof token).toBe('object');
    expect(revisions(before, ['root'], 'D')).toBe(token);
    const next = snapshot(moved(root), D, C, E, {
      ...unrelated,
      title: 'Unrelated edit',
    });
    next.saveStatus = 'saving';
    next.canUndo = true;
    expect(revisions(next, ['root'], 'D')).toBe(token);
    const entryOnly = {
      ...next,
      documents: new Map(
        [...next.documents].map(([id, entry]) => [
          id,
          { ...entry, dirty: true, version: 'new-disk-version' },
        ]),
      ),
    };
    expect(revisions(entryOnly, ['root'], 'D')).toBe(token);
    const editedE = {
      ...E,
      text: { ...E.text, plainText: 'Edited nested document' },
    };
    const nestedEdit = revisions(snapshot(root, D, C, editedE), ['root'], 'D');
    expect(nestedEdit).not.toBe(token);
    expect(
      revisions(snapshot(root, D, moved(C), editedE), ['root'], 'D'),
    ).not.toBe(nestedEdit);
  });

  it('invalidates visible renames, missing targets, deletion and restoration', () => {
    const revisions = createPreviewRevisions();
    const D = doc('D', ['C']);
    const C = canvas('C', [['document', 'E']]);
    const E = doc('E');
    const initial = revisions(snapshot(D, C, E), [], 'D');
    const renamed = revisions(
      snapshot(D, C, { ...E, title: 'Renamed' }),
      [],
      'D',
    );
    expect(renamed).not.toBe(initial);
    const deleted = revisions(snapshot(D, C), [], 'D');
    expect(deleted).not.toBe(renamed);
    expect(revisions(snapshot(D, C, doc('unrelated')), [], 'D')).toBe(deleted);
    const restored = revisions(snapshot(D, C, E), [], 'D');
    expect(restored).not.toBe(deleted);
    const missingCanvas = revisions(snapshot(D), [], 'D');
    expect(missingCanvas).not.toBe(restored);
    const unnamedCanvas = { ...C, frame: { ...C.frame, name: undefined } };
    expect(revisions(snapshot(D, unnamedCanvas), [], 'D')).not.toBe(
      missingCanvas,
    );
    const missingRoot = revisions(snapshot(C, E), [], 'D');
    expect(revisions(snapshot(D, C, E), [], 'D')).not.toBe(missingRoot);
  });

  it('tracks only existence and titles when a document path blocks a body', () => {
    const revisions = createPreviewRevisions();
    const root = canvas('root');
    const D = doc('D', ['root']);
    const initial = revisions(snapshot(root, D), ['root'], 'D');
    expect(revisions(snapshot(moved(root), D), ['root'], 'D')).toBe(initial);
    const renamed = {
      ...root,
      frame: { ...root.frame, name: 'New root title' },
    };
    const titleChange = revisions(snapshot(renamed, D), ['root'], 'D');
    expect(titleChange).not.toBe(initial);
    expect(revisions(snapshot(D), ['root'], 'D')).not.toBe(titleChange);

    const repeated = revisions(snapshot(D, root), ['D'], 'D');
    const bodyEdit = { ...D, text: doc('D', ['unreachable']).text };
    expect(
      revisions(snapshot(bodyEdit, root, canvas('unreachable')), ['D'], 'D'),
    ).toBe(repeated);
    expect(
      revisions(
        snapshot({ ...bodyEdit, title: 'New doc title' }, root),
        ['D'],
        'D',
      ),
    ).not.toBe(repeated);
  });

  it('ignores blocked canvas ancestor movement but refreshes its title or existence', () => {
    const revisions = createPreviewRevisions();
    const A = canvas('A', [['canvas', 'B']]);
    const B = canvas('B', [['canvas', 'A']]);
    const initial = revisions(snapshot(A, B), ['A'], 'B', ['A', 'B']);
    expect(revisions(snapshot(moved(A), B), ['A'], 'B', ['A', 'B'])).toBe(
      initial,
    );
    const renamedA = { ...A, frame: { ...A.frame, name: 'Renamed ancestor' } };
    const renamed = revisions(snapshot(renamedA, B), ['A'], 'B', ['A', 'B']);
    expect(renamed).not.toBe(initial);
    expect(revisions(snapshot(B), ['A'], 'B', ['A', 'B'])).not.toBe(renamed);
  });

  it('allows cross-domain references to actually render the root canvas again', () => {
    const revisions = createPreviewRevisions();
    const A = canvas('A', [
      ['document', 'D'],
      ['document-frame', 'E'],
    ]);
    const D = doc('D', ['C']);
    const C = canvas('C', [['canvas', 'A']]);
    const E = doc('E');
    const initial = revisions(snapshot(A, D, C, E), ['A'], 'D');
    const rootMoved = revisions(snapshot(moved(A), D, C, E), ['A'], 'D');
    expect(rootMoved).not.toBe(initial);
    expect(
      revisions(
        snapshot(moved(A), D, C, { ...E, title: 'Nested E' }),
        ['A'],
        'D',
      ),
    ).not.toBe(rootMoved);
  });

  it('keeps blocked titles separate from full bodies when the same target is reached both ways', () => {
    const revisions = createPreviewRevisions();
    const D = doc('D', ['A', 'C']);
    const A = canvas('A', [['canvas', 'C']]);
    const C = canvas('C', [['canvas', 'A']]);
    const initial = revisions(snapshot(A, C, D), ['A'], 'D');
    // D's first block stops at A, but D -> C -> A really displays A.
    expect(revisions(snapshot(moved(A), C, D), ['A'], 'D')).not.toBe(initial);
  });

  it('resets canvas seen when a document opens a native canvas block', () => {
    const revisions = createPreviewRevisions();
    const A = canvas('A', [
      ['canvas', 'B'],
      ['document', 'D'],
    ]);
    const B = canvas('B', [['document', 'E']]);
    const D = doc('D', ['C']);
    const C = canvas('C', [['canvas', 'B']]);
    const E = doc('E');
    const initial = revisions(snapshot(A, B, C, D, E), ['root'], 'A', [
      'A',
      'B',
    ]);
    // A's direct B is blocked, but A -> D -> C starts fresh and renders B/E.
    expect(
      revisions(
        snapshot(A, B, C, D, { ...E, title: 'Visible E' }),
        ['root'],
        'A',
        ['A', 'B'],
      ),
    ).not.toBe(initial);
  });

  it('stops repeated documents without traversing their native canvas descendants', () => {
    const revisions = createPreviewRevisions();
    const A = canvas('A', [
      ['document', 'D'],
      ['document', 'E'],
    ]);
    const D = doc('D', ['hidden']);
    const E = doc('E');
    const C = canvas('C', [['canvas', 'A']]);
    const hidden = canvas('hidden');
    const initial = revisions(
      snapshot(A, C, D, E, hidden),
      ['A', 'D', 'C'],
      'C',
      ['C'],
    );
    expect(
      revisions(snapshot(A, C, D, E, moved(hidden)), ['A', 'D', 'C'], 'C', [
        'C',
      ]),
    ).toBe(initial);
    const bodyOnly = {
      ...D,
      text: { ...D.text, plainText: 'Hidden body update' },
    };
    expect(
      revisions(snapshot(A, C, bodyOnly, E, hidden), ['A', 'D', 'C'], 'C', [
        'C',
      ]),
    ).toBe(initial);
    expect(
      revisions(
        snapshot(A, C, D, { ...E, title: 'Visible E' }, hidden),
        ['A', 'D', 'C'],
        'C',
        ['C'],
      ),
    ).not.toBe(initial);
  });

  it('ignores navigation links but includes native references inside group-owned cells', () => {
    const revisions = createPreviewRevisions();
    const A = canvas('A', [['document-frame', 'D']]);
    A.cells.group = {
      id: 'group',
      cellType: 'group',
      kind: 'group',
      members: [...A.frame.children],
    };
    A.frame.children = [];
    A.frame.groups = ['group'];
    const D = doc('D');
    D.text.content.content = [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'Navigation only',
            marks: [
              { type: 'link', attrs: { href: 'verd://file/navigation' } },
            ],
          },
        ],
      },
    ];
    const navigation = doc('navigation');
    const initial = revisions(snapshot(A, D, navigation), [], 'A');
    expect(
      revisions(
        snapshot(A, D, { ...navigation, title: 'Not embedded' }),
        [],
        'A',
      ),
    ).toBe(initial);
    expect(
      revisions(
        snapshot(A, { ...D, title: 'Grouped document' }, navigation),
        [],
        'A',
      ),
    ).not.toBe(initial);
  });

  it('caches distinct occurrence paths and distinguishes native from pure-canvas entry', () => {
    const revisions = createPreviewRevisions();
    const A = canvas('A');
    const state = snapshot(A);
    const native = revisions(state, ['A'], 'A');
    const surface = revisions(state, ['A'], 'A', ['A']);
    expect(surface).not.toBe(native);
    expect(revisions(state, ['A'], 'A')).toBe(native);
    expect(revisions(state, ['A'], 'A', ['A'])).toBe(surface);
    const movedState = snapshot(moved(A));
    expect(revisions(movedState, ['A'], 'A')).toBe(native);
    expect(revisions(movedState, ['A'], 'A', ['A'])).not.toBe(surface);
  });
});
