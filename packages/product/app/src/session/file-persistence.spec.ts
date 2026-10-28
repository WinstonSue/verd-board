import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFrameCell } from '@sue/board-core';
import { createDocumentFile } from '../documents/document-files';
import { createFrameFile } from '../frames/frame-files';
import { createMemoryWorkspaceHost } from '../host/memory-workspace-host';
import type { WorkspaceHost } from '../host/workspace-host';
import {
  openWorkspaceSession,
  type WorkspaceSession,
} from './workspace-session';

const sessions: WorkspaceSession[] = [];
afterEach(() => {
  sessions.splice(0).forEach((session) => session.dispose());
  vi.restoreAllMocks();
});
const setup = async () => {
  const inner = createMemoryWorkspaceHost();
  const host: WorkspaceHost = { ...inner, subscribe: () => () => {} };
  const handle = (await host.openWorkspace({ path: 'file-persistence' }))!;
  await host.commit(handle, {
    transactionId: 'seed',
    writes: [
      ...['a', 'b'].map((id) => ({
        path: `${id}.verd-doc.json`,
        content: JSON.stringify(createDocumentFile(id, id)),
        expectedVersion: null,
      })),
      {
        path: 'board.verd.json',
        content: JSON.stringify(createFrameFile(createFrameCell('board'))),
        expectedVersion: null,
      },
    ],
  });
  const committed = vi.fn();
  const session = await openWorkspaceSession(host, handle, {
    delayMs: 60_000,
    onCommitted: committed,
  });
  sessions.push(session);
  return { host, handle, session, committed };
};
const edit = (session: WorkspaceSession, id = 'a', title = 'Edited') =>
  session.apply({ type: 'file', file: createDocumentFile(id, title) });
const status = (session: WorkspaceSession, id = 'a') =>
  session.getState().filePersistence.get(id)!;
const gateCommits = (host: WorkspaceHost) => {
  const commit = host.commit;
  const release: Array<() => void> = [];
  host.commit = async (handle, request) => {
    await new Promise<void>((resolve) => release.push(resolve));
    return commit(handle, request);
  };
  return release;
};

describe('per-file persistence feedback', () => {
  it('starts clean disk files as saved and keeps navigation/config saves and timestamps separate', async () => {
    const { session, committed } = await setup();
    const initial = session.getState().filePersistence;
    expect([...initial.values()].map((entry) => entry.status)).toEqual([
      'saved',
      'saved',
      'saved',
    ]);
    expect(status(session).lastSavedAt).toBeUndefined();
    session.setSessionState({
      ...session.getState().session,
      tabs: [{ fileId: 'a' }],
      activeTabId: 'a',
      expandedDirs: ['docs'],
    });
    expect(session.getState().dirty).toBe(true);
    expect(session.getState().filePersistence).toBe(initial);
    expect(await session.flush()).toBe(true);
    session.setWorkspaceConfig({ name: 'New workspace name' });
    expect(await session.flush()).toBe(true);
    expect(committed).toHaveBeenCalledTimes(2);
    expect(session.getState().filePersistence).toBe(initial);
  });

  it('tracks the file actually being saved and preserves immutable old snapshots', async () => {
    const { session, host } = await setup();
    const original = session.getState().filePersistence;
    await edit(session);
    expect(status(session).status).toBe('idle');
    const release = gateCommits(host);
    const saving = session.flush();
    expect(status(session).status).toBe('saving');
    expect(status(session, 'b').status).toBe('saved');
    release[0]();
    expect(await saving).toBe(true);
    expect(status(session)).toMatchObject({
      status: 'saved',
      lastSavedAt: expect.any(Number),
    });
    expect(original.get('a')).toEqual({
      status: 'saved',
      lastSavedAt: undefined,
    });
    const savedAt = status(session).lastSavedAt;
    session.setSessionState({
      ...session.getState().session,
      expandedDirs: ['other'],
    });
    const metadata = session.flush();
    release[1]();
    await metadata;
    expect(status(session).lastSavedAt).toBe(savedAt);
  });

  it('does not mark a newer edit saved when an older version finishes', async () => {
    const { session, host } = await setup();
    await edit(session, 'a', 'First');
    const release = gateCommits(host);
    const saving = session.flush();
    const observed: string[] = [];
    session.subscribe(() => observed.push(status(session).status));
    await edit(session, 'a', 'Second');
    expect(status(session).status).toBe('idle');
    release[0]();
    await vi.waitFor(() => expect(release).toHaveLength(2));
    expect(observed).not.toContain('saved');
    expect(status(session).status).toBe('saving');
    release[1]();
    expect(await saving).toBe(true);
    expect(status(session).status).toBe('saved');
  });

  it('does not call a new edit saving merely because navigation is in flight', async () => {
    const { session, host } = await setup();
    session.setSessionState({
      ...session.getState().session,
      expandedDirs: ['docs'],
    });
    const release = gateCommits(host);
    const saving = session.flush();
    await edit(session, 'b');
    expect(session.getState().saveStatus).toBe('saving');
    expect(status(session, 'b').status).toBe('idle');
    expect(status(session).status).toBe('saved');
    release[0]();
    await vi.waitFor(() => expect(release).toHaveLength(2));
    expect(status(session, 'b').status).toBe('saving');
    release[1]();
    await saving;
  });

  it('keeps pathless mixed-request failures until a real file write succeeds', async () => {
    const { session, host } = await setup();
    const commit = host.commit;
    host.commit = async (_handle, request) => ({
      transactionId: request.transactionId,
      outcome: 'rejected',
      reason: 'invalid-path',
    });
    await edit(session);
    session.setSessionState({
      ...session.getState().session,
      expandedDirs: ['docs'],
    });
    expect(await session.flush()).toBe(false);
    expect(status(session).status).toBe('error');
    expect(status(session, 'b').status).toBe('saved');
    expect(session.getState().documents.get('a')?.dirty).toBe(false);
    host.commit = commit;
    session.setSessionState({
      ...session.getState().session,
      expandedDirs: ['other'],
    });
    await session.flush();
    await session.syncFromHost();
    expect(status(session).status).toBe('error');
    expect(status(session).lastSavedAt).toBeUndefined();
    expect(session.getState().documents.get('a')?.file.title).toBe('Edited');
    await edit(session, 'a', 'Recovered');
    expect(await session.flush()).toBe(true);
    expect(status(session).status).toBe('saved');
  });

  it('retries the same transaction without applying its error to clean files', async () => {
    const { session, host } = await setup();
    const commit = host.commit;
    const ids: string[] = [];
    host.commit = async (handle, request) => {
      ids.push(request.transactionId);
      return ids.length === 1
        ? {
            transactionId: request.transactionId,
            outcome: 'rejected',
            reason: 'io-error',
          }
        : commit(handle, request);
    };
    await edit(session);
    expect(await session.flush()).toBe(false);
    expect(status(session).status).toBe('error');
    expect(status(session, 'b').status).toBe('saved');
    expect(await session.flush()).toBe(true);
    expect(ids[1]).toBe(ids[0]);
    expect(status(session).status).toBe('saved');
  });

  it('attributes a delayed receipt to stable identity after a move', async () => {
    const { session, host } = await setup();
    await edit(session);
    const release = gateCommits(host);
    const saving = session.flush();
    expect(
      (
        await session.apply({
          type: 'move-file',
          fileId: 'a',
          toPath: 'moved.verd-doc.json',
        })
      ).ok,
    ).toBe(true);
    release[0]();
    await vi.waitFor(() => expect(release).toHaveLength(2));
    expect(status(session).status).not.toBe('saved');
    expect(status(session).lastSavedAt).toEqual(expect.any(Number));
    release[1]();
    expect(await saving).toBe(true);
    expect(status(session).status).toBe('saved');
    expect(session.getState().documents.get('a')?.path).toBe(
      'moved.verd-doc.json',
    );
    expect(status(session, 'b').lastSavedAt).toBeUndefined();
  });

  it('records direct organization writes and explicit conflict resolution', async () => {
    const { session, host, handle } = await setup();
    expect(
      (
        await session.organize([
          {
            fileId: 'board',
            organization: { kind: 'standalone' },
            basisOrganization: null,
            basisSources: [],
          },
        ])
      ).ok,
    ).toBe(true);
    expect(status(session, 'board')).toMatchObject({
      status: 'saved',
      lastSavedAt: expect.any(Number),
    });
    await edit(session);
    const entry = session.getState().documents.get('a')!;
    await host.commit(handle, {
      transactionId: 'external',
      writes: [
        {
          path: entry.path,
          expectedVersion: entry.version!,
          content: JSON.stringify(createDocumentFile('a', 'External')),
        },
      ],
    });
    expect(await session.flush()).toBe(false);
    expect(status(session).status).toBe('error');
    expect((await session.resolveConflict('a', 'keep-local')).ok).toBe(true);
    expect(status(session)).toMatchObject({
      status: 'saved',
      lastSavedAt: expect.any(Number),
    });
    await edit(session, 'a', 'Discard me');
    expect((await session.resolveConflict('a', 'load-disk')).ok).toBe(true);
    expect(status(session)).toEqual({
      status: 'saved',
      lastSavedAt: undefined,
    });
  });

  it('publishes failed organization confirmations and then records the real successful write', async () => {
    const { session, host } = await setup();
    const commit = host.commit;
    host.commit = async (_handle, request) => ({
      transactionId: request.transactionId,
      outcome: 'rejected',
      reason: 'io-error',
    });
    expect(
      (
        await session.organize([
          {
            fileId: 'board',
            organization: { kind: 'standalone' },
            basisOrganization: null,
            basisSources: [],
          },
        ])
      ).unconfirmed,
    ).toBe(true);
    expect(status(session, 'board').status).toBe('error');
    const observed: string[] = [];
    session.subscribe(() => observed.push(status(session, 'board').status));
    expect((await session.confirmOrganize()).ok).toBe(false);
    expect(observed.at(-1)).toBe('error');
    host.commit = commit;
    expect((await session.confirmOrganize()).ok).toBe(true);
    expect(status(session, 'board')).toMatchObject({
      status: 'saved',
      lastSavedAt: expect.any(Number),
    });
  });

  it('keeps edits made while keep-local resolves and saves the newer version afterwards', async () => {
    const { session, host, handle } = await setup();
    await edit(session, 'a', 'First');
    const resolve = host.resolveConflict;
    let release!: () => void;
    host.resolveConflict = async (handle, request) => {
      await new Promise<void>((done) => {
        release = done;
      });
      return resolve(handle, request);
    };
    const resolving = session.resolveConflict('a', 'keep-local');
    await edit(session, 'a', 'Newer');
    expect(status(session).status).toBe('idle');
    release();
    expect((await resolving).ok).toBe(true);
    expect(session.getState().documents.get('a')?.file.title).toBe('Newer');
    expect(status(session).status).toBe('idle');
    expect(await session.flush()).toBe(true);
    expect(
      JSON.parse(
        new TextDecoder().decode(
          (await host.readFile(handle, 'a.verd-doc.json')).content,
        ),
      ).title,
    ).toBe('Newer');
    expect(status(session).status).toBe('saved');
  });

  it('retains edits made while reading a conflict resolution from disk', async () => {
    const { session, host } = await setup();
    await edit(session, 'a', 'Before resolution');
    const read = host.readFile;
    let release!: () => void;
    host.readFile = async (handle, path) => {
      await new Promise<void>((done) => {
        release = done;
      });
      return read(handle, path);
    };
    const resolving = session.resolveConflict('a', 'load-disk');
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    await edit(session, 'a', 'Newer');
    release();
    expect((await resolving).ok).toBe(false);
    expect(session.getState().documents.get('a')?.file.title).toBe('Newer');
    expect(status(session).status).toBe('idle');
    host.readFile = read;
    expect(await session.flush()).toBe(true);
    expect(status(session).status).toBe('saved');
  });

  it('does not keep an old session timestamp after adopting a new disk version', async () => {
    const { session, host, handle } = await setup();
    await edit(session);
    await session.flush();
    expect(status(session).lastSavedAt).toEqual(expect.any(Number));
    await host.commit(handle, {
      transactionId: 'external-clean',
      writes: [
        {
          path: 'a.verd-doc.json',
          content: JSON.stringify(createDocumentFile('a', 'Disk update')),
          expectedVersion: session.getState().documents.get('a')!.version!,
        },
      ],
    });
    await session.syncFromHost();
    expect(status(session)).toEqual({
      status: 'saved',
      lastSavedAt: undefined,
    });
  });
});
