import { describe, expect, it } from 'vitest';
import type { FrameCell } from '@sue/board-core';
import { WORKSPACE_ROOT_ID, type FrameFileV2 } from '../frames/frame-files';
import {
  createDocumentFile,
  type DocumentFileV1,
} from '../documents/document-files';
import { createMemoryWorkspaceHost } from '../host/memory-workspace-host';
import type { WorkspaceHost } from '../host/workspace-host';
import { openWorkspaceSession } from './workspace-session';

const frameCell = (id: string, name = id): FrameCell =>
  ({
    id,
    kind: 'frame',
    cellType: 'frame',
    name,
    geometry: { x: 0, y: 0, width: 960, height: 640 },
    children: [],
    groups: [],
  }) as FrameCell;

const frameFile = (id: string, name = id): FrameFileV2 => ({
  format: 'verd-frame',
  version: 2,
  frame: frameCell(id, name),
  cells: {},
});

const workspaceStore = (...frames: FrameCell[]) => ({
  rootId: WORKSPACE_ROOT_ID,
  cells: Object.fromEntries([
    ...frames.map((frame) => [frame.id, frame] as const),
    [
      WORKSPACE_ROOT_ID,
      { ...frameCell(WORKSPACE_ROOT_ID), children: frames.map((f) => f.id) },
    ],
  ]),
});

const openSession = async () => {
  const host: WorkspaceHost = createMemoryWorkspaceHost({
    now: () => 1_700_000_000_000,
  });
  const handle = (await host.openWorkspace({ path: `ws-${Math.random()}` }))!;
  const session = await openWorkspaceSession(host, handle, {
    delayMs: 60_000,
  });
  return { host, handle, session };
};

const docFile = (id: string, title = id): DocumentFileV1 =>
  createDocumentFile(id, title);

describe('WorkspaceSession documents', () => {
  it('creates a document file, persists it and exposes it via documents', async () => {
    const { session, host, handle } = await openSession();
    const result = await session.apply({
      type: 'create-file',
      file: docFile('doc-1', 'Notes'),
    });
    expect(result.ok).toBe(true);
    const state = session.getState();
    expect(state.documents.size).toBe(1);
    expect(state.files.size).toBe(0);
    expect(state.documents.get('doc-1')?.path).toBe('Notes.verd-doc.json');
    expect(state.dirty).toBe(true);

    await session.flush();
    const snapshot = await host.readSnapshot(handle);
    expect(snapshot.documents?.map((doc) => doc.path)).toEqual([
      'Notes.verd-doc.json',
    ]);
    expect(snapshot.documents?.[0].file?.id).toBe('doc-1');
    expect(session.getState().dirty).toBe(false);
  });

  it('loads existing documents from the host snapshot', async () => {
    const { session, host, handle } = await openSession();
    await session.apply({
      type: 'create-file',
      file: docFile('doc-1', 'Journal'),
    });
    await session.flush();

    const reopened = await openWorkspaceSession(host, handle);
    const state = reopened.getState();
    expect(state.documents.get('doc-1')?.file.title).toBe('Journal');
    expect(state.documents.get('doc-1')?.dirty).toBe(false);
    expect(state.documents.get('doc-1')?.version).toBeTruthy();
  });

  it('keeps invalid document payloads out of files but surfaces diagnostics', async () => {
    const host = createMemoryWorkspaceHost();
    const handle = (await host.openWorkspace({ path: 'ws-bad' }))!;
    await host.commit(handle, {
      transactionId: 'seed-bad',
      writes: [
        {
          path: 'broken.verd-doc.json',
          content: '{"format":"verd-document","version":99}',
          expectedVersion: null,
        },
      ],
    });
    const session = await openWorkspaceSession(host, handle);
    const state = session.getState();
    expect(state.documents.size).toBe(0);
    expect(
      state.diagnostics.some((d) => d.path === 'broken.verd-doc.json'),
    ).toBe(true);
  });

  it('canvas store commands never touch document files', async () => {
    const { session } = await openSession();
    await session.apply({ type: 'create-file', file: frameFile('f-1') });
    await session.apply({ type: 'create-file', file: docFile('doc-1') });

    // A store update that omits every canvas keeps the document alive.
    const result = await session.apply({
      type: 'store',
      store: workspaceStore(),
    });
    expect(result.ok).toBe(true);
    const state = session.getState();
    expect(state.files.size).toBe(0);
    expect(state.documents.size).toBe(1);
  });

  it('updates document content through the file command with undo/redo', async () => {
    const { session } = await openSession();
    await session.apply({ type: 'create-file', file: docFile('doc-1') });
    const edited = docFile('doc-1', 'doc-1');
    edited.text.content = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'hello' }] },
      ],
    };
    const change = await session.apply({
      type: 'file',
      file: edited,
      history: { name: 'input', group: 'doc-1:text:1' },
    });
    expect(change.ok).toBe(true);
    expect(
      session.getState().documents.get('doc-1')?.file.text.content,
    ).toEqual(edited.text.content);

    const undo = await session.undo();
    expect(undo.ok).toBe(true);
    expect(undo.restored?.fileId).toBe('doc-1');
    expect(
      session.getState().documents.get('doc-1')?.file.text.content.content,
    ).toEqual([{ type: 'paragraph' }]);
    const redo = await session.redo();
    expect(redo.ok).toBe(true);
    expect(
      session.getState().documents.get('doc-1')?.file.text.content,
    ).toEqual(edited.text.content);
  });

  it('merges consecutive same-group edits into one undo step', async () => {
    const { session } = await openSession();
    await session.apply({ type: 'create-file', file: docFile('doc-1') });
    for (const ch of ['a', 'b', 'c']) {
      const next = docFile('doc-1', 'doc-1');
      next.text.content = {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: ch }] }],
      };
      await session.apply({
        type: 'file',
        file: next,
        history: { name: 'input', group: `doc-1:text` },
      });
    }
    await session.undo();
    expect(
      session.getState().documents.get('doc-1')?.file.text.content.content,
    ).toEqual([{ type: 'paragraph' }]);
    expect(session.getState().canUndo).toBe(true); // the create remains
    await session.undo();
    expect(session.getState().canUndo).toBe(false);
  });

  it('renames a document atomically: title and path in one entry', async () => {
    const { session } = await openSession();
    await session.apply({ type: 'create-file', file: docFile('doc-1') });
    const result = await session.apply({
      type: 'rename-document',
      fileId: 'doc-1',
      title: '日记',
    });
    expect(result.ok).toBe(true);
    const entry = session.getState().documents.get('doc-1');
    expect(entry?.file.title).toBe('日记');
    expect(entry?.path).toBe('日记.verd-doc.json');
    await session.undo();
    expect(session.getState().documents.get('doc-1')?.path).toBe(
      'doc-1.verd-doc.json',
    );
  });

  it('rejects renames onto occupied paths and empty titles', async () => {
    const { session } = await openSession();
    await session.apply({
      type: 'create-file',
      file: docFile('doc-1', 'A'),
    });
    await session.apply({
      type: 'create-file',
      file: docFile('doc-2', 'B'),
    });
    expect(
      (
        await session.apply({
          type: 'rename-document',
          fileId: 'doc-2',
          title: 'A',
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await session.apply({
          type: 'rename-document',
          fileId: 'doc-1',
          title: '   ',
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await session.apply({
          type: 'rename-document',
          fileId: 'doc-9',
          title: 'X',
        })
      ).ok,
    ).toBe(false);
  });

  it('moves and trashes documents through the generic file commands', async () => {
    const { session } = await openSession();
    await session.apply({ type: 'create-file', file: docFile('doc-1') });
    session.mkdir('notes');
    // Persist first — only files that reached disk produce trash entries.
    await session.flush();
    const moved = await session.apply({
      type: 'move-file',
      fileId: 'doc-1',
      toPath: 'notes/doc-1.verd-doc.json',
    });
    expect(moved.ok).toBe(true);
    expect(session.getState().documents.get('doc-1')?.path).toBe(
      'notes/doc-1.verd-doc.json',
    );
    // Hosts execute trash before moves inside one commit — settle the move
    // first so the trash targets an existing path.
    await session.flush();

    const trashed = await session.apply({
      type: 'trash-file',
      fileId: 'doc-1',
    });
    expect(trashed.ok).toBe(true);
    expect(session.getState().documents.size).toBe(0);
    await session.flush();
    const trashEntry = session.getState().trash[0];
    expect(trashEntry.originalPath).toBe('notes/doc-1.verd-doc.json');

    const restored = await session.apply({
      type: 'restore-file',
      entryId: trashEntry.entryId,
    });
    expect(restored.ok).toBe(true);
    expect(session.getState().documents.get('doc-1')?.path).toBe(
      'notes/doc-1.verd-doc.json',
    );
  });

  it('duplicates a document with a fresh independent identity', async () => {
    const { session } = await openSession();
    await session.apply({
      type: 'create-file',
      file: docFile('doc-1', 'Original'),
    });
    const result = await session.apply({
      type: 'duplicate-file',
      fileId: 'doc-1',
    });
    expect(result.ok).toBe(true);
    const docs = session.getState().documents;
    expect(docs.size).toBe(2);
    const copy = [...docs.values()].find((e) => e.file.id !== 'doc-1');
    expect(copy).toBeTruthy();
    expect(copy!.file.title).toBe('Original');
    expect((copy!.file as DocumentFileV1).text.id).toBe(copy!.file.id);
    expect(copy!.path).toBe('Original 2.verd-doc.json');
  });

  it('imports documents remapping colliding identities', async () => {
    const { session } = await openSession();
    await session.apply({ type: 'create-file', file: docFile('doc-1') });
    const imported = docFile('doc-1', 'Imported');
    const result = await session.apply({
      type: 'import-files',
      files: [imported],
    });
    expect(result.ok).toBe(true);
    const docs = session.getState().documents;
    expect(docs.size).toBe(2);
    const copy = [...docs.values()].find((e) => e.file.title === 'Imported');
    expect(copy?.file.id).not.toBe('doc-1');
  });

  it('normalizes legacy {frameId} tab state at open', async () => {
    const host = createMemoryWorkspaceHost();
    const handle = (await host.openWorkspace({ path: 'ws-legacy' }))!;
    await host.commit(handle, {
      transactionId: 'seed-session',
      session: {
        tabs: [{ fileId: 'doc-1' }, { fileId: 'f-1' }],
        activeTabId: 'doc-1',
        expandedDirs: [],
      },
    });
    // Simulate a host returning the old {frameId} shape directly.
    const legacyHost: WorkspaceHost = {
      ...host,
      readSnapshot: async (h) => {
        const snapshot = await host.readSnapshot(h);
        return {
          ...snapshot,
          session: snapshot.session
            ? {
                ...snapshot.session,
                tabs: snapshot.session.tabs.map(
                  (tab) => ({ frameId: tab.fileId }) as never,
                ),
              }
            : null,
        };
      },
    };
    const session = await openWorkspaceSession(legacyHost, handle);
    expect(session.getState().session.tabs).toEqual([
      { fileId: 'doc-1' },
      { fileId: 'f-1' },
    ]);
  });

  it('rejects document content writes on canvas paths and vice versa', async () => {
    const { session } = await openSession();
    await session.apply({ type: 'create-file', file: docFile('doc-1') });
    const disguised = frameFile('doc-1');
    const result = await session.apply({ type: 'file', file: disguised });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0].message).toMatch(/kind/i);
  });

  const editedDoc = (id: string, title: string, body: string) => {
    const file = docFile(id, title);
    file.text.content = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: body }] }],
    };
    file.text.plainText = body;
    return file;
  };

  it('persists document edits across a dispose + reopen cycle', async () => {
    const { session, host, handle } = await openSession();
    await session.apply({ type: 'create-file', file: docFile('doc-1') });
    await session.flush();
    await session.apply({
      type: 'file',
      file: editedDoc('doc-1', 'doc-1', 'survives restart'),
    });
    await session.flush();
    session.dispose();

    const reopened = await openWorkspaceSession(host, handle);
    const entry = reopened.getState().documents.get('doc-1');
    expect(entry?.file.text.plainText).toBe('survives restart');
    expect(entry?.dirty).toBe(false);
    reopened.dispose();
  });

  it('syncs external document writes into clean documents', async () => {
    const { session, host, handle } = await openSession();
    await session.apply({ type: 'create-file', file: docFile('doc-1') });
    await session.flush();

    const snapshot = await host.readSnapshot(handle);
    await host.commit(handle, {
      transactionId: 'external-doc-tx',
      writes: [
        {
          path: 'doc-1.verd-doc.json',
          content: JSON.stringify(editedDoc('doc-1', 'doc-1', 'external')),
          expectedVersion: snapshot.documents![0].version,
        },
      ],
    });
    await session.syncFromHost();
    const entry = session.getState().documents.get('doc-1');
    expect(entry?.file.text.plainText).toBe('external');
    expect(entry?.conflicted).toBeFalsy();
  });

  const makeDocConflict = async (
    session: Awaited<ReturnType<typeof openSession>>['session'],
    host: WorkspaceHost,
    handle: Parameters<WorkspaceHost['readSnapshot']>[0],
  ) => {
    await session.apply({
      type: 'file',
      file: editedDoc('doc-1', 'doc-1', 'local dirty'),
    });
    const snapshot = await host.readSnapshot(handle);
    await host.commit(handle, {
      transactionId: 'external-doc-tx',
      writes: [
        {
          path: 'doc-1.verd-doc.json',
          content: JSON.stringify(editedDoc('doc-1', 'doc-1', 'external')),
          expectedVersion: snapshot.documents![0].version,
        },
      ],
    });
    await session.flush();
    expect(session.getState().documents.get('doc-1')?.conflicted).toBe(true);
  };

  it('marks a dirty document conflicted when its base moves externally', async () => {
    const { session, host, handle } = await openSession();
    await session.apply({ type: 'create-file', file: docFile('doc-1') });
    await session.flush();
    await makeDocConflict(session, host, handle);
    // Local content is preserved, not overwritten.
    expect(session.getState().documents.get('doc-1')?.file.text.plainText).toBe(
      'local dirty',
    );
  });

  it('resolves a document conflict keeping local content', async () => {
    const { session, host, handle } = await openSession();
    await session.apply({ type: 'create-file', file: docFile('doc-1') });
    await session.flush();
    await makeDocConflict(session, host, handle);

    const result = await session.resolveConflict('doc-1', 'keep-local');
    expect(result.ok).toBe(true);
    const entry = session.getState().documents.get('doc-1');
    expect(entry?.conflicted).toBeFalsy();
    expect(entry?.dirty).toBe(false);
    const snapshot = await host.readSnapshot(handle);
    expect(snapshot.documents![0].file?.text.plainText).toBe('local dirty');
  });

  it('resolves a document conflict by loading the disk version, undoably', async () => {
    const { session, host, handle } = await openSession();
    await session.apply({ type: 'create-file', file: docFile('doc-1') });
    await session.flush();
    await makeDocConflict(session, host, handle);

    const result = await session.resolveConflict('doc-1', 'load-disk');
    expect(result.ok).toBe(true);
    const entry = session.getState().documents.get('doc-1');
    expect(entry?.conflicted).toBeFalsy();
    expect(entry?.file.text.plainText).toBe('external');
    // Undo restores the discarded local edit rather than losing it.
    await session.undo();
    expect(session.getState().documents.get('doc-1')?.file.text.plainText).toBe(
      'local dirty',
    );
  });

  it('handles a large document end to end', async () => {
    const { session, host, handle } = await openSession();
    const paragraphs = Array.from({ length: 800 }, (_, index) => ({
      type: 'paragraph' as const,
      content: [{ type: 'text' as const, text: `line ${index}` }],
    }));
    const file = docFile('doc-big', 'Big');
    file.text.content = { type: 'doc', content: paragraphs };
    file.text.plainText = paragraphs.map((p) => p.content[0].text).join('\n');
    const result = await session.apply({ type: 'create-file', file });
    expect(result.ok).toBe(true);
    await session.flush();
    session.dispose();

    const reopened = await openWorkspaceSession(host, handle);
    const entry = reopened.getState().documents.get('doc-big');
    expect(entry?.file.text.content.content).toHaveLength(800);
    expect(entry?.file.text.plainText).toContain('line 799');
    reopened.dispose();
  });
});
