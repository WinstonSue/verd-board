import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDocumentFile } from '../documents/document-files';
import { createMemoryWorkspaceHost } from '../host/memory-workspace-host';
import type {
  WorkspaceGitResult,
  WorkspaceGitStatus,
} from '../host/workspace-git';
import {
  openWorkspaceSession,
  type WorkspaceSession,
} from './workspace-session';

const sessions: WorkspaceSession[] = [];
afterEach(() => sessions.splice(0).forEach((session) => session.dispose()));
const status: WorkspaceGitStatus = {
  available: true,
  initialized: true,
  head: 'head',
  branch: 'main',
  token: 'token',
  changes: [],
  canSync: false,
};
async function setup() {
  const host = createMemoryWorkspaceHost();
  const handle = (await host.openWorkspace({ path: crypto.randomUUID() }))!;
  const session = await openWorkspaceSession(host, handle, { delayMs: 60000 });
  sessions.push(session);
  const file = createDocumentFile('doc', 'Before');
  await session.apply({ type: 'import-files', files: [file] });
  await session.flush();
  const entry = session.getState().documents.get('doc')!;
  return { host, handle, session, file, path: entry.path };
}

describe('Git session save barrier', () => {
  it('flushes before a Git operation and blocks edits until its outcome is known', async () => {
    const { host, handle, session, file, path } = await setup();
    let finish!: (value: WorkspaceGitResult) => void;
    const entered = Promise.withResolvers<void>();
    host.git = vi.fn(async () => {
      const raw = await host.readFile(handle, path);
      expect(JSON.parse(new TextDecoder().decode(raw.content)).title).toBe(
        'Draft',
      );
      entered.resolve();
      return new Promise<WorkspaceGitResult>((resolve) => {
        finish = resolve;
      });
    });
    await session.apply({ type: 'file', file: { ...file, title: 'Draft' } });
    const operation = session.git({
      type: 'commit',
      message: 'Version',
      expectedToken: 'token',
    });
    await entered.promise;
    let flushed = false;
    const closingFlush = session.flush().then((result) => {
      flushed = true;
      return result;
    });
    await Promise.resolve();
    expect(flushed).toBe(false);
    expect((await session.apply({ type: 'file', file })).ok).toBe(false);
    expect(session.getState().mutationsPaused).toBe(true);
    finish({ status, oid: 'new-head' });
    await operation;
    expect(await closingFlush).toBe(true);
    expect(session.getState().mutationsPaused).toBe(false);
    expect(session.getState().documents.get('doc')?.file.title).toBe('Draft');
  });

  it('does not reload over unsaved content when the save barrier fails', async () => {
    const { host, session, file } = await setup();
    host.git = vi.fn(async () => ({ status }));
    await session.apply({
      type: 'file',
      file: { ...file, title: 'Must survive' },
    });
    host.commit = vi.fn(async (_handle, request) => ({
      transactionId: request.transactionId,
      outcome: 'rejected',
      reason: 'io-error',
    }));
    await expect(
      session.git({ type: 'commit', message: 'No', expectedToken: 'token' }),
    ).rejects.toThrow('Save pending');
    expect(host.git).not.toHaveBeenCalled();
    expect(session.getState().documents.get('doc')?.file.title).toBe(
      'Must survive',
    );
    expect(session.getState().documents.get('doc')?.dirty).toBe(true);
  });

  it('adopts a restored host version without creating another commit or recovery point', async () => {
    const { host, handle, session, file, path } = await setup();
    await session.apply({ type: 'file', file: { ...file, title: 'Newer' } });
    await session.flush();
    host.git = vi.fn(async (_handle, request) => {
      expect(request.type).toBe('restore');
      const raw = await host.readFile(handle, path);
      await host.commit(handle, {
        transactionId: crypto.randomUUID(),
        writes: [
          { path, content: JSON.stringify(file), expectedVersion: raw.version },
        ],
      });
      return {
        status: {
          ...status,
          changes: [{ path, status: 'modified', staged: false }],
        },
      };
    });
    await session.git({
      type: 'restore',
      planId: 'plan',
      expectedToken: 'token',
    });
    expect(session.getState().documents.get('doc')?.file.title).toBe('Before');
    expect(session.getState().canUndo).toBe(false);
    expect(host.git).toHaveBeenCalledTimes(1);
    expect(
      session
        .getState()
        .resources?.some((resource) => resource.key.startsWith('history/')),
    ).toBe(false);
  });

  it('prevents ordinary trash purge from bypassing version history cleanup', async () => {
    const { host, session, handle } = await setup();
    host.versions = vi.fn(async () => ({
      status: {
        available: true,
        enabled: true,
        token: 'token',
        changes: [],
        capabilities: {
          create: true,
          restore: true,
          directory: true,
          cleanup: true,
          sync: false,
        },
      },
    }));
    session.dispose();
    const guarded = await openWorkspaceSession(host, handle);
    sessions.push(guarded);
    const result = await guarded.apply({
      type: 'purge-trash',
      entryIds: ['entry'],
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0].message).toContain(
      'version history cleanup plan',
    );
  });

  it('keeps read-only history readable while rejecting Git writes', async () => {
    const { host, session } = await setup();
    host.git = vi.fn(async () => ({ status }));
    session.setReadonly(true);
    await expect(session.git({ type: 'status' })).resolves.toEqual({ status });
    await expect(session.git({ type: 'init' })).rejects.toThrow('read-only');
  });
});
