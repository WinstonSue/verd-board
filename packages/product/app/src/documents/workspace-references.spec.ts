import { describe, it, expect } from 'vitest';
import {
  createDocumentReferenceCell,
  createDocumentFrameCell,
  createFrameCell,
  isDocumentReferenceCell,
} from '@sue/board-core';
import {
  createDocumentFile,
  workspaceFileId,
  type WorkspaceFile,
} from './document-files';
import { createFrameFile } from '../frames/frame-files';
import {
  workspaceFileClosure,
  remapWorkspaceFiles,
  validateWorkspaceReferences,
  workspaceExportBundle,
  parseWorkspaceExport,
} from './workspace-references';
import { createDocumentLink, parseDocumentLink } from './document-links';
import { createMemoryWorkspaceHost } from '../host/memory-workspace-host';
import { openWorkspaceSession } from '../session/workspace-session';

const fixture = (): WorkspaceFile[] => {
  const board = createFrameFile(
    createFrameCell('board', { x: 0, y: 0, width: 800, height: 600 }),
  );
  const ref = createDocumentReferenceCell('ref', 'doc', {
    x: 0,
    y: 0,
    width: 400,
    height: 300,
  });
  board.cells[ref.id] = ref;
  board.frame.children.push(ref.id);
  const doc = createDocumentFile('doc', 'Guide');
  doc.text.content.content = [
    { type: 'frameReference', attrs: { targetFrameId: 'board' } },
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'source',
          marks: [
            { type: 'link', attrs: { href: createDocumentLink('board') } },
          ],
        },
        {
          type: 'text',
          text: 'outside',
          marks: [
            { type: 'link', attrs: { href: createDocumentLink('outside') } },
          ],
        },
      ],
    },
    {
      type: 'codeBlock',
      content: [{ type: 'text', text: 'board doc ref verd://file/board' }],
    },
  ];
  return [board, doc, createDocumentFile('outside')];
};

describe('mixed workspace dependencies', () => {
  it('allows cycles, visits shared targets once, and ignores navigation links', () => {
    const files = fixture();
    expect(validateWorkspaceReferences(files, true)).toEqual([]);
    expect(workspaceFileClosure(files, 'board').map(workspaceFileId)).toEqual([
      'board',
      'doc',
    ]);
    expect(workspaceFileClosure(files, 'doc').map(workspaceFileId)).toEqual([
      'doc',
      'board',
    ]);
    const board = files[0];
    if (board.format !== 'verd-frame') throw new Error();
    board.cells['second'] = createDocumentReferenceCell('second', 'doc', {
      x: 500,
      y: 0,
      width: 400,
      height: 300,
    });
    board.frame.children.push('second');
    expect(workspaceFileClosure(files, 'board')).toHaveLength(2);
  });
  it('rewrites a complete independent copy in two passes, leaving code and external links intact', () => {
    const files = workspaceFileClosure(fixture(), 'board');
    let seq = 0;
    const { files: copies, idMap } = remapWorkspaceFiles(
      files,
      () => false,
      () => `copy-${++seq}`,
      { rootId: 'board' },
    );
    const board = copies.find((file) => file.format === 'verd-frame');
    const doc = copies.find((file) => file.format === 'verd-document');
    if (board?.format !== 'verd-frame' || doc?.format !== 'verd-document')
      throw new Error();
    expect(doc.id).toBe(idMap.get('doc'));
    expect(doc.text.id).toBe(doc.id);
    const ref = board.cells[idMap.get('ref')!];
    expect(isDocumentReferenceCell(ref) && ref.data.targetDocumentId).toBe(
      doc.id,
    );
    expect(doc.text.content.content?.[0]?.attrs?.['targetFrameId']).toBe(
      board.frame.id,
    );
    const links = doc.text.content.content?.[1]?.content?.map((node) =>
      parseDocumentLink(String(node.marks?.[0]?.attrs?.['href'])),
    );
    expect(links).toEqual([
      { kind: 'file', fileId: board.frame.id, anchor: null },
      { kind: 'file', fileId: 'outside', anchor: null },
    ]);
    expect(doc.text.content.content?.[2]?.content?.[0]?.text).toBe(
      'board doc ref verd://file/board',
    );
    expect(validateWorkspaceReferences(copies, true)).toEqual([]);
  });
  it('handles cross-type collisions atomically and rejects duplicate input identities', () => {
    let seq = 0;
    const { files } = remapWorkspaceFiles(
      fixture(),
      (id) => id === 'doc',
      () => `new-${++seq}`,
    );
    expect(validateWorkspaceReferences(files, true)).toEqual([]);
    expect(() =>
      remapWorkspaceFiles(
        [...fixture(), createDocumentFile('board')],
        () => false,
        () => 'new',
      ),
    ).toThrow(/Duplicate/);
    const board = fixture()[0];
    expect(validateWorkspaceReferences([board])).toEqual([]);
    expect(validateWorkspaceReferences([board], true)).not.toEqual([]);
    expect(
      validateWorkspaceReferences([
        board,
        createFrameFile(createFrameCell('doc')),
      ]),
    ).not.toEqual([]);
  });
  it('round-trips native bundles with either root kind', () => {
    const files = workspaceFileClosure(fixture(), 'doc');
    const bundle = workspaceExportBundle(files, 'doc');
    expect(parseWorkspaceExport(JSON.parse(JSON.stringify(bundle)))).toEqual(
      files,
    );
    expect(bundle.rootFileId).toBe('doc');
    expect(parseWorkspaceExport({ ...bundle, files: [{}] })).toBeNull();
  });
  it('persists and reopens a cyclic graph, duplicates its complete closure in one undo step', async () => {
    const host = createMemoryWorkspaceHost();
    const handle = (await host.openWorkspace({ path: 'mixed' }))!;
    let seq = 0;
    const session = await openWorkspaceSession(host, handle, {
      createId: () => `new-${++seq}`,
      delayMs: 60_000,
    });
    expect(
      (await session.apply({ type: 'import-files', files: fixture() })).ok,
    ).toBe(true);
    expect(await session.flush()).toBe(true);
    expect(session.getState().references.targetsOf.get('board')).toEqual([
      { sourceId: 'board', targetId: 'doc', targetKind: 'document' },
    ]);
    expect(session.getState().references.referencedBy.get('board')).toEqual([
      { sourceId: 'doc', targetId: 'board', targetKind: 'canvas' },
    ]);
    expect(
      (await session.apply({ type: 'duplicate-file', fileId: 'doc' })).ok,
    ).toBe(true);
    expect(session.getState().files.size).toBe(2);
    expect(session.getState().documents.size).toBe(3);
    const copy = [...session.getState().documents.keys()].find(
      (id) => !['doc', 'outside'].includes(id),
    )!;
    expect(session.exportWorkspaceFiles(copy)).toHaveLength(2);
    expect((await session.undo()).ok).toBe(true);
    expect(session.getState().files.size).toBe(1);
    expect(session.getState().documents.size).toBe(2);
    expect((await session.redo()).ok).toBe(true);
    expect(await session.flush()).toBe(true);
    const reopened = await openWorkspaceSession(host, handle);
    expect(reopened.exportWorkspaceFiles(copy)).toHaveLength(2);
    expect(reopened.getState().diagnostics).toEqual([]);
    session.dispose();
    reopened.dispose();
  });
});

it('creates a source and editable Frame atomically and remaps both forms through a circular closure', async () => {
  const host = createMemoryWorkspaceHost();
  const handle = (await host.openWorkspace({ path: 'editable-frames' }))!;
  const session = await openWorkspaceSession(host, handle, { delayMs: 60000 });
  const board = createFrameFile(createFrameCell('owner'));
  await session.apply({ type: 'create-file', file: board });
  const document = createDocumentFile('editable-source');
  document.text.content.content.push({
    type: 'frameReference',
    attrs: { targetFrameId: 'owner' },
  });
  const cell = createDocumentFrameCell('editable-shell', document.id, {
    x: 0,
    y: 0,
    width: 480,
    height: 400,
  });
  expect(
    (
      await session.apply({
        type: 'create-document-frame',
        ownerFrameId: 'owner',
        document,
        cell,
      })
    ).ok,
  ).toBe(true);
  expect(
    session
      .getState()
      .references.targetsOf.get('owner')
      ?.map((r) => r.targetId),
  ).toEqual([document.id]);
  expect((await session.undo()).ok).toBe(true);
  expect(session.getState().documents.has(document.id)).toBe(false);
  expect(
    session.getState().files.get('owner')?.file.cells[cell.id],
  ).toBeUndefined();
  await session.redo();
  const bundle = session.exportWorkspaceFiles('owner');
  expect(bundle).toHaveLength(2);
  let count = 0;
  const cloned = remapWorkspaceFiles(
    bundle,
    () => false,
    () => `edit-copy-${++count}`,
    { rootId: 'owner' },
  );
  const copy = cloned.files.find((f) => f.format === 'verd-frame')!;
  if (copy.format !== 'verd-frame') throw new Error();
  expect(copy.cells[cloned.idMap.get(cell.id)!].data).toMatchObject({
    targetDocumentId: cloned.idMap.get(document.id),
  });
  const origin = {
    canvasId: 'owner',
    cellId: cell.id,
    instanceId: 'owner/editable-shell',
  };
  await session.apply({
    type: 'file',
    file: { ...document, title: 'Updated' },
    history: { group: 'editor-a:i1', origin },
  });
  expect((await session.undo()).restored?.origin).toEqual(origin);
  expect(await session.flush()).toBe(true);
  session.dispose();
});
