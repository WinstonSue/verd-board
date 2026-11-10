import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFrameCell } from '@sue/board-core';
import { createDocumentFile } from '../documents/document-files';
import { createFrameFile } from '../frames/frame-files';
import { createMemoryWorkspaceHost } from '../host/memory-workspace-host';
import type { WorkspaceHost } from '../host/workspace-host';
import {
  openWorkspaceSession,
  type WorkspaceSession,
  type WorkspaceSessionOptions,
  type WorkspaceSessionSnapshot,
} from './workspace-session';

const sessions: WorkspaceSession[] = [];
afterEach(() => sessions.splice(0).forEach((session) => session.dispose()));

async function setup(options: WorkspaceSessionOptions = {}) {
  const inner = createMemoryWorkspaceHost();
  // External changes are installed explicitly so each assertion has one cause.
  const host: WorkspaceHost = { ...inner, subscribe: () => () => {} };
  const handle = (await host.openWorkspace({ path: 'snapshot-cache' }))!;
  await host.commit(handle, {
    transactionId: 'seed',
    writes: [
      {
        path: 'board.verd.json',
        content: JSON.stringify(createFrameFile(createFrameCell('board'))),
        expectedVersion: null,
      },
      {
        path: 'note.verd-doc.json',
        content: JSON.stringify(createDocumentFile('note', 'Note')),
        expectedVersion: null,
      },
    ],
  });
  const session = await openWorkspaceSession(host, handle, {
    delayMs: 60_000,
    ...options,
  });
  sessions.push(session);
  return { host, handle, session };
}

describe('workspace session snapshots', () => {
  it('reuses an unchanged snapshot and file maps across navigation notifications', async () => {
    const { session } = await setup();
    const initial = session.getState();
    expect(session.getState()).toBe(initial);
    const notified: WorkspaceSessionSnapshot[] = [];
    session.subscribe(() => notified.push(session.getState()));

    session.setSessionState({
      ...initial.session,
      tabs: [{ fileId: 'note' }],
      activeTabId: 'note',
    });
    const navigated = session.getState();
    expect(navigated).not.toBe(initial);
    expect(session.getState()).toBe(navigated);
    expect(notified).toEqual([navigated]);
    expect(navigated.files).toBe(initial.files);
    expect(navigated.documents).toBe(initial.documents);
    expect(navigated.session.activeTabId).toBe('note');
    expect(initial.session.tabs).toEqual([]);
    expect(initial.session.activeTabId).toBeNull();

    expect(await session.flush()).toBe(true);
    const saved = session.getState();
    expect(saved.dirty).toBe(false);
    expect(saved.files).toBe(initial.files);
    expect(saved.documents).toBe(initial.documents);
    expect(navigated.dirty).toBe(true);
  });

  it('replaces only changed file maps and leaves previous contents intact through history', async () => {
    const { session } = await setup();
    const initial = session.getState();
    expect(
      (
        await session.apply({
          type: 'file',
          file: createDocumentFile('note', 'Edited'),
        })
      ).ok,
    ).toBe(true);
    const edited = session.getState();
    expect(edited.files).toBe(initial.files);
    expect(edited.documents).not.toBe(initial.documents);
    expect(edited.documents.get('note')?.file.title).toBe('Edited');
    expect(initial.documents.get('note')?.file.title).toBe('Note');
    expect(initial.documents.get('note')?.dirty).toBe(false);
    expect(edited.canUndo).toBe(true);
    expect(initial.canUndo).toBe(false);

    expect((await session.undo()).ok).toBe(true);
    const undone = session.getState();
    expect(undone.documents.get('note')?.file.title).toBe('Note');
    expect(undone.canUndo).toBe(false);
    expect(undone.canRedo).toBe(true);
    expect((await session.redo()).ok).toBe(true);
    expect(session.getState().documents.get('note')?.file.title).toBe('Edited');
    expect(edited.documents.get('note')?.file.title).toBe('Edited');
  });

  it('publishes current save state before status and commit callbacks can read it', async () => {
    let session!: WorkspaceSession;
    const statuses: WorkspaceSessionSnapshot[] = [];
    const commits: WorkspaceSessionSnapshot[] = [];
    ({ session } = await setup({
      onStatus: (status) => {
        const snapshot = session.getState();
        expect(snapshot.saveStatus).toBe(status);
        statuses.push(snapshot);
      },
      onCommitted: () => commits.push(session.getState()),
    }));
    const initial = session.getState();
    await session.apply({
      type: 'file',
      file: createDocumentFile('note', 'Saved title'),
    });
    session.setWorkspaceConfig({ name: 'Saved workspace' });
    const dirty = session.getState();
    const saving = session.flush();
    expect(session.getState().saveStatus).toBe('saving');
    expect(await saving).toBe(true);

    expect(statuses.map((snapshot) => snapshot.saveStatus)).toEqual([
      'saving',
      'saved',
    ]);
    expect(commits).toHaveLength(1);
    expect(commits[0].dirty).toBe(false);
    expect(commits[0].documents.get('note')?.dirty).toBe(false);
    expect(commits[0].documents.get('note')?.version).not.toBe(
      initial.documents.get('note')?.version,
    );
    expect(commits[0].config.version).toBe(initial.config.version + 1);
    expect(commits[0].config.value).toEqual({ name: 'Saved workspace' });
    expect(dirty.documents.get('note')?.dirty).toBe(true);
    expect(dirty.config.version).toBe(initial.config.version);
    expect(initial.config.value).not.toHaveProperty('name');
    expect(session.getState()).toBe(session.getState());
  });

  it('refreshes cached configuration when an external config-only change arrives', async () => {
    const { session, host, handle } = await setup();
    const initial = session.getState();
    const listener = vi.fn();
    session.subscribe(listener);
    await host.commit(handle, {
      transactionId: 'external-config',
      config: {
        value: { name: 'External workspace' },
        expectedVersion: initial.config.version,
      },
    });
    await session.syncFromHost();
    const external = session.getState();
    expect(listener).toHaveBeenCalledOnce();
    expect(external.config.value).toEqual({ name: 'External workspace' });
    expect(external.config.version).toBe(initial.config.version + 1);
    expect(external.files).toBe(initial.files);
    expect(external.documents).toBe(initial.documents);
    expect(initial.config.value).not.toHaveProperty('name');
  });

  it('updates failure and path indexes without modifying previously published snapshots', async () => {
    const { session, host, handle } = await setup();
    const initial = session.getState();
    await host.commit(handle, {
      transactionId: 'break-document',
      writes: [
        {
          path: 'note.verd-doc.json',
          content: '{ incomplete',
          expectedVersion: initial.documents.get('note')!.version!,
        },
      ],
    });
    await session.syncFromHost();
    const failed = session.getState();
    expect(failed.documents.has('note')).toBe(false);
    expect(failed.fileIdByPath.has('note.verd-doc.json')).toBe(false);
    expect(failed.failedFiles.get('note.verd-doc.json')?.fileId).toBe('note');
    expect(initial.failedFiles.size).toBe(0);
    expect(initial.documents.has('note')).toBe(true);

    const raw = await host.readFile(handle, 'note.verd-doc.json');
    await host.commit(handle, {
      transactionId: 'repair-document',
      writes: [
        {
          path: 'note.verd-doc.json',
          content: JSON.stringify(createDocumentFile('note', 'Recovered')),
          expectedVersion: raw.version,
        },
      ],
    });
    await session.syncFromHost();
    const recovered = session.getState();
    expect(recovered.documents.get('note')?.file.title).toBe('Recovered');
    expect(recovered.fileIdByPath.get('note.verd-doc.json')).toBe('note');
    expect(recovered.failedFiles.size).toBe(0);
    expect(failed.failedFiles.size).toBe(1);
    expect(failed.documents.size).toBe(0);
    expect(session.getState()).toBe(recovered);
  });
});
