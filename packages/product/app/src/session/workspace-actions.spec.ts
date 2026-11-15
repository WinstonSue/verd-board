import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDocumentFile } from '@sue/verd-board-workspace';
import { createMemoryWorkspaceHost } from '@sue/verd-board-workspace';
import {
  openWorkspaceSession,
  type WorkspaceSession,
} from '@sue/verd-board-workspace';
import {
  createWorkspaceActionRegistry,
  workspaceActionCommandResult,
} from './workspace-actions';
const sessions: WorkspaceSession[] = [];
afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose();
});
async function open() {
  const host = createMemoryWorkspaceHost();
  const handle = (await host.openWorkspace({
    name: 'Actions',
    default: true,
  }))!;
  const session = await openWorkspaceSession(host, handle, { delayMs: 60_000 });
  sessions.push(session);
  return session;
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

describe('workspace action adapter', () => {
  it('queues repeated internal commands without dropping document changes and preserves one undo per command', async () => {
    const session = await open();
    const registry = createWorkspaceActionRegistry({
      getContext: () => ({ session }),
    });
    const first = registry.executeAction('workspace.create-file', {
      type: 'create-file',
      file: createDocumentFile('first', 'First'),
    });
    const second = registry.executeAction('workspace.create-file', {
      type: 'create-file',
      file: createDocumentFile('second', 'Second'),
    });
    expect(workspaceActionCommandResult(await first).ok).toBe(true);
    expect(workspaceActionCommandResult(await second).ok).toBe(true);
    expect([...session.getState().documents.keys()]).toEqual([
      'first',
      'second',
    ]);
    await session.undo();
    expect([...session.getState().documents.keys()]).toEqual(['first']);
    expect(
      registry
        .actions()
        .filter((action) => !action.id.startsWith('workspace.history.'))
        .every((action) => action.palette === false),
    ).toBe(true);
    registry.dispose();
  });

  it('preserves the original session diagnostics and rejects command/action mismatches', async () => {
    const session = await open();
    const registry = createWorkspaceActionRegistry({
      getContext: () => ({ session }),
    });
    const result = await registry.executeAction('workspace.move-file', {
      type: 'move-file',
      fileId: 'missing',
      toPath: 'missing.verd.json',
    });
    expect(result.status).toBe('rejected');
    expect(workspaceActionCommandResult(result)).toMatchObject({
      ok: false,
      diagnostics: [{ message: expect.stringContaining('Unknown file') }],
    });
    expect(
      await registry.executeAction('workspace.move-file', {
        type: 'trash-file',
        fileId: 'missing',
      }),
    ).toEqual({ status: 'rejected', code: 'invalid-arguments' });
    registry.dispose();
  });

  it('rechecks readonly state before queued commands reach the session', async () => {
    const session = await open();
    const gate = deferred();
    let readonly = false;
    const original = session.apply.bind(session);
    const apply = vi
      .spyOn(session, 'apply')
      .mockImplementation(async (command) => {
        await gate.promise;
        return original(command);
      });
    const registry = createWorkspaceActionRegistry({
      getContext: () => ({ session, readonly }),
    });
    const first = registry.executeAction('workspace.create-file', {
      type: 'create-file',
      file: createDocumentFile('first', 'First'),
    });
    const second = registry.executeAction('workspace.create-file', {
      type: 'create-file',
      file: createDocumentFile('second', 'Second'),
    });
    readonly = true;
    gate.resolve();
    expect((await first).status).toBe('completed');
    expect(await second).toEqual({ status: 'rejected', code: 'readonly' });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(session.getState().documents.has('second')).toBe(false);
    registry.dispose();
  });

  it('cancels captured commands after a workspace switch and keeps read-only navigation dialogs available', async () => {
    let session = await open();
    const navigate = vi.fn();
    const registry = createWorkspaceActionRegistry({
      getContext: () => ({ session, readonly: true }),
      dialogs: [
        { id: 'workspace.open-file', label: 'Open', execute: navigate },
      ],
    });
    const command = registry
      .actions()
      .find((action) => action.id === 'workspace.create-file')!
      .capture();
    const navigation = registry
      .actions()
      .find((action) => action.id === 'workspace.open-file')!
      .capture();
    session = await open();
    expect(
      await command.execute({
        type: 'create-file',
        file: createDocumentFile('other', 'Other'),
      }),
    ).toEqual({ status: 'cancelled', code: 'stale-context' });
    expect(await navigation.execute()).toEqual({
      status: 'cancelled',
      code: 'stale-context',
    });
    const opened = registry.executeAction('workspace.open-file');
    expect(navigate).toHaveBeenCalledTimes(1);
    expect((await opened).status).toBe('completed');
    registry.dispose();
  });
  it('routes history, directories, conflict failures and config persistence through one service adapter', async () => {
    const session = await open();
    const registry = createWorkspaceActionRegistry({
      getContext: () => ({ session }),
    });
    await registry.executeAction('workspace.create-file', {
      type: 'create-file',
      file: createDocumentFile('first', 'First'),
    });
    expect(
      workspaceActionCommandResult(
        await registry.executeAction('workspace.history.undo'),
      ).ok,
    ).toBe(true);
    expect(session.getState().documents.has('first')).toBe(false);
    expect(
      workspaceActionCommandResult(
        await registry.executeAction('workspace.history.redo'),
      ).ok,
    ).toBe(true);
    expect(session.getState().documents.has('first')).toBe(true);
    expect(
      workspaceActionCommandResult(
        await registry.executeAction('workspace.mkdir', { path: 'docs' }),
      ).ok,
    ).toBe(true);
    expect(
      session
        .getState()
        .entries.some(
          (entry) => entry.path === 'docs' && entry.kind === 'directory',
        ),
    ).toBe(true);
    const missing = workspaceActionCommandResult(
      await registry.executeAction('workspace.resolve-conflict', {
        fileId: 'missing',
        action: 'load-disk',
      }),
    );
    expect(missing).toMatchObject({
      ok: false,
      diagnostics: [{ message: expect.stringContaining('Unknown file') }],
    });
    vi.spyOn(session, 'flush').mockResolvedValueOnce(false);
    expect(
      await registry.executeAction('workspace.set-config', {
        value: { name: 'Changed' },
      }),
    ).toEqual({ status: 'failed', code: 'workspace-config-save-failed' });
    registry.dispose();
  });

  it('allows session-only navigation in read-only mode without recording history, and validates dialog arguments', async () => {
    const session = await open();
    const dialog = vi.fn();
    const registry = createWorkspaceActionRegistry({
      getContext: () => ({ session, readonly: true }),
      dialogs: [
        {
          id: 'workspace.create-dialog',
          label: 'Create dialog',
          palette: false,
          validateArgs: (args) =>
            !!args && typeof args === 'object' && 'dirPath' in args,
          execute: dialog,
        },
      ],
    });
    const state = { tabs: [], activeTabId: null, expandedDirs: ['docs'] };
    expect(
      await registry.executeAction('workspace.navigation.update', { state }),
    ).toEqual({ status: 'completed' });
    expect(session.getState().session.expandedDirs).toEqual(['docs']);
    expect(session.getState().canUndo).toBe(false);
    expect(
      await registry.executeAction('workspace.create-dialog', {
        dirPath: 'docs',
      }),
    ).toEqual({ status: 'completed' });
    expect(dialog).toHaveBeenCalledWith(expect.objectContaining({ session }), {
      dirPath: 'docs',
    });
    expect(await registry.executeAction('workspace.create-dialog')).toEqual({
      status: 'rejected',
      code: 'invalid-arguments',
    });
    registry.dispose();
  });
  it('keeps navigation metadata writable on the old paused session while a workspace opens', async () => {
    const session = await open();
    const registry = createWorkspaceActionRegistry({
      getContext: () => ({ session, paused: true }),
    });
    expect(
      await registry.executeAction('workspace.navigation.update', {
        state: { tabs: [], activeTabId: null, expandedDirs: ['old-session'] },
      }),
    ).toEqual({ status: 'completed' });
    expect(session.getState().session.expandedDirs).toEqual(['old-session']);
    expect(
      await registry.executeAction('workspace.create-file', {
        type: 'create-file',
        file: createDocumentFile('blocked', 'Blocked'),
      }),
    ).toEqual({ status: 'rejected', code: 'workspace-paused' });
    registry.dispose();
  });
});
