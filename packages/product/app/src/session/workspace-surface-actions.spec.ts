import { afterEach, describe, expect, it, vi } from 'vitest';
import { actionLabel } from '@sue/board-common';
import { createDocumentFile } from '../documents/document-files';
import { createMemoryWorkspaceHost } from '../host/memory-workspace-host';
import { deleteWorkspaceTabGroup } from './workspace-navigation';
import {
  openWorkspaceSession,
  type WorkspaceSession,
} from './workspace-session';
import { createWorkspaceActionRegistry } from './workspace-actions';
import {
  createWorkspaceSurfaceActions,
  WORKSPACE_UI_ACTION_IDS,
  WORKSPACE_ACTION_SURFACES,
} from './workspace-surface-actions';
const sessions: WorkspaceSession[] = [];
afterEach(() => sessions.splice(0).forEach((session) => session.dispose()));
async function open() {
  const host = createMemoryWorkspaceHost();
  const handle = (await host.openWorkspace({
    name: 'Surface',
    default: true,
  }))!;
  const session = await openWorkspaceSession(host, handle, { delayMs: 60_000 });
  sessions.push(session);
  await session.apply({
    type: 'create-file',
    file: createDocumentFile('a', 'Alpha'),
  });
  await session.apply({
    type: 'create-file',
    file: createDocumentFile('b', 'Beta'),
  });
  return session;
}
const ui = () => ({
  allowWorkspaceSwitching: true,
  isDefaultWorkspace: false,
  hasOrigin: false,
});
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
};
describe('workspace discrete surface inventory', () => {
  it('registers every inventoried semantic entry once with stable bilingual metadata', () => {
    const definitions = createWorkspaceSurfaceActions({
      getState: ui,
      invoke: () => {},
    });
    expect(definitions.map((entry) => entry.id).sort()).toEqual(
      WORKSPACE_UI_ACTION_IDS.map((id) => `workspace.${id}`).sort(),
    );
    expect(new Set(definitions.map((entry) => entry.id)).size).toBe(
      definitions.length,
    );
    const registry = createWorkspaceActionRegistry({
      getContext: () => ({ session: null }),
      dialogs: definitions,
    });
    for (const ids of Object.values(WORKSPACE_ACTION_SURFACES))
      for (const id of ids)
        expect(
          registry.actions().some((action) => action.id === `workspace.${id}`),
          `Missing migration entry ${id}`,
        ).toBe(true);
    registry.dispose();
    expect(
      definitions.every(
        (entry) =>
          typeof entry.label === 'object' && entry.label.zh && entry.label.en,
      ),
    ).toBe(true);
  });
  it('shares readonly/paused/missing-target availability and never invokes rejected UI capabilities', async () => {
    const session = await open();
    let readonly = false;
    let paused = false;
    const invoke = vi.fn();
    const registry = createWorkspaceActionRegistry({
      getContext: () => ({ session, readonly, paused }),
      dialogs: createWorkspaceSurfaceActions({ getState: ui, invoke }),
    });
    expect(
      actionLabel(
        registry
          .actions()
          .find((action) => action.id === 'workspace.file.duplicate')!.label,
        'en',
      ),
    ).toBe('Duplicate independently');
    readonly = true;
    expect(
      registry.getActionState('workspace.file.duplicate', { fileId: 'a' }),
    ).toMatchObject({ visible: false, enabled: false, reason: 'readonly' });
    expect(
      registry.getActionState('workspace.file.open', { fileId: 'a' }).enabled,
    ).toBe(true);
    readonly = false;
    paused = true;
    expect(await registry.executeAction('workspace.create-canvas')).toEqual({
      status: 'rejected',
      code: 'workspace-paused',
    });
    expect(invoke).not.toHaveBeenCalled();
    paused = false;
    expect(
      await registry.executeAction('workspace.file.open', {
        fileId: 'missing',
      }),
    ).toEqual({ status: 'rejected', code: 'missing-target' });
    expect(registry.getActionState('workspace.return')).toMatchObject({
      visible: false,
      enabled: false,
    });
    registry.dispose();
  });
  it('blocks reference navigation on rejected edits and rejects a source tab changed during the flush', async () => {
    const session = await open();
    session.setSessionState({
      tabs: [{ fileId: 'a' }, { fileId: 'b' }],
      activeTabId: 'a',
    });
    const invoke = vi.fn();
    let reject = true;
    let switchTab = false;
    const registry = createWorkspaceActionRegistry({
      getContext: () => ({
        session,
        readonly: true,
        flushEditing: async () => {
          if (reject)
            return { status: 'rejected' as const, code: 'host-rejected' };
          if (switchTab) session.setSessionState({ activeTabId: 'b' });
          return { status: 'completed' as const };
        },
      }),
      dialogs: createWorkspaceSurfaceActions({
        getState: () => ({ ...ui(), returnSources: new Map([['a', 'b']]) }),
        invoke,
      }),
    });
    expect(
      registry.getActionState('workspace.file.return', { fileId: 'a' }).enabled,
    ).toBe(true);
    expect(
      await registry.executeAction('workspace.file.return', { fileId: 'a' }),
    ).toMatchObject({ status: 'rejected', code: 'host-rejected' });
    expect(invoke).not.toHaveBeenCalled();
    reject = false;
    switchTab = true;
    const args = {
      fileId: 'b',
      fromFileId: 'a',
      location: {
        kind: 'document',
        sourceFileId: 'b',
        targetFileId: 'a',
        ordinal: 1,
        occurrence: 0,
        revision: 'body',
      },
    };
    expect(
      (await registry.executeAction('workspace.reference.locate', args)).status,
    ).toBe('rejected');
    expect(invoke).not.toHaveBeenCalled();
    registry.dispose();
  });

  it('keeps a captured file/session target and cancels it after the target disappears or session changes', async () => {
    let session = await open();
    const invoke = vi.fn();
    const registry = createWorkspaceActionRegistry({
      getContext: () => ({ session }),
      dialogs: createWorkspaceSurfaceActions({ getState: ui, invoke }),
    });
    const target = registry
      .actions()
      .find((action) => action.id === 'workspace.file.open')!
      .capture();
    await session.apply({ type: 'trash-file', frameId: 'a' });
    expect(await target.execute({ fileId: 'a' })).toEqual({
      status: 'rejected',
      code: 'missing-target',
    });
    session = await open();
    expect(await target.execute({ fileId: 'b' })).toEqual({
      status: 'cancelled',
      code: 'stale-context',
    });
    expect(invoke).not.toHaveBeenCalled();
    registry.dispose();
  });
  it('flushes the captured editor before entering the workspace content queue and preserves latest committed content', async () => {
    const session = await open();
    const events: string[] = [];
    let registry!: ReturnType<typeof createWorkspaceActionRegistry>;
    const flush = vi.fn(async () => {
      events.push('flush');
      const file = session.getState().documents.get('a')!.file;
      const result = await registry.executeAction('workspace.file', {
        type: 'file',
        file: { ...file, title: 'Committed before duplicate' },
        label: 'editor',
      });
      events.push('committed');
      return result;
    });
    registry = createWorkspaceActionRegistry({
      getContext: () => ({ session, flushEditing: flush }),
      dialogs: createWorkspaceSurfaceActions({
        getState: ui,
        invoke: () => {},
      }),
    });
    expect(
      (
        await registry.executeAction('workspace.file.duplicate', {
          fileId: 'a',
        })
      ).status,
    ).toBe('completed');
    expect(events).toEqual(['flush', 'committed']);
    expect(
      [...session.getState().documents.values()].filter(
        (entry) => entry.file.title === 'Committed before duplicate',
      ),
    ).toHaveLength(2);
    registry.dispose();
  });
  it('keeps a view command original editor and target across asynchronous preparation, then rejects a changed session', async () => {
    let session = await open();
    const gate = deferred();
    const firstFlush = vi.fn(async () => {
      await gate.promise;
    });
    const otherFlush = vi.fn(async () => {});
    let flush = firstFlush;
    const invoke = vi.fn();
    const registry = createWorkspaceActionRegistry({
      getContext: () => ({ session, flushEditing: flush }),
      dialogs: createWorkspaceSurfaceActions({ getState: ui, invoke }),
    });
    const action = registry
      .actions()
      .find((action) => action.id === 'workspace.file.open')!
      .capture();
    flush = otherFlush;
    const work = action.execute({ fileId: 'b' });
    gate.resolve();
    expect(await work).toEqual({ status: 'completed' });
    expect(firstFlush).toHaveBeenCalledTimes(1);
    expect(otherFlush).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith('file.open', { fileId: 'b' });
    const next = deferred();
    flush = vi.fn(async () => {
      await next.promise;
    });
    const stale = registry.executeAction('workspace.file.open', {
      fileId: 'a',
    });
    session = await open();
    next.resolve();
    expect(await stale).toEqual({ status: 'cancelled', code: 'stale-context' });
    expect(invoke).toHaveBeenCalledTimes(1);
    registry.dispose();
  });
  it('allows closing the final group and exposes current directory expansion through action state', async () => {
    const session = await open();
    session.mkdir('docs');
    session.setSessionState({
      tabs: [{ fileId: 'a' }],
      activeTabId: 'a',
      expandedDirs: [],
      groups: [
        {
          id: 'default',
          name: 'Default',
          tabs: [{ fileId: 'a' }],
          activeTabId: 'a',
        },
      ],
      activeGroupId: 'default',
    });
    const registry = createWorkspaceActionRegistry({
      getContext: () => ({ session }),
      dialogs: createWorkspaceSurfaceActions({
        getState: ui,
        invoke: (id, args) => {
          if (id === 'group.delete')
            session.setSessionState(
              deleteWorkspaceTabGroup(
                session.getState().session,
                (args as { groupId: string }).groupId,
              ),
            );
        },
      }),
    });
    expect(
      registry.getActionState('workspace.directory.toggle', { path: 'docs' })
        .checked,
    ).toBe(false);
    session.setSessionState({
      ...session.getState().session,
      expandedDirs: ['docs'],
    });
    expect(
      registry.getActionState('workspace.directory.toggle', { path: 'docs' })
        .checked,
    ).toBe(true);
    expect(
      registry.getActionState('workspace.group.delete', { groupId: 'default' })
        .enabled,
    ).toBe(true);
    expect(
      await registry.executeAction('workspace.group.delete', {
        groupId: 'default',
      }),
    ).toEqual({ status: 'completed' });
    expect(session.getState().session.tabs).toEqual([]);
    registry.dispose();
  });

  it('allows recovery during a paused mutation but keeps normal writes blocked', async () => {
    const session = await open();
    const state = session.getState();
    vi.spyOn(session, 'getState').mockImplementation(() => ({
      ...state,
      mutationsPaused: true,
      trashUnconfirmed: true,
    }));
    const retry = vi
      .spyOn(session, 'retryTrashOperation')
      .mockResolvedValue({ ok: true, diagnostics: [] });
    const registry = createWorkspaceActionRegistry({
      getContext: () => ({ session }),
      dialogs: createWorkspaceSurfaceActions({
        getState: ui,
        invoke: () => {},
      }),
    });
    expect(
      (await registry.executeAction('workspace.file.trash', { fileId: 'a' }))
        .status,
    ).toBe('rejected');
    expect(await registry.executeAction('workspace.trash.retry')).toEqual({
      status: 'completed',
    });
    expect(retry).toHaveBeenCalledTimes(1);
    registry.dispose();
  });
});

it('validates recorded workspace targets without a session and rejects current, missing, paused or readonly entries', async () => {
  let readonly = false;
  let paused = false;
  const invoke = vi.fn();
  const registry = createWorkspaceActionRegistry({
    getContext: () => ({ session: null, readonly, paused }),
    dialogs: createWorkspaceSurfaceActions({
      getState: () => ({
        ...ui(),
        workspaceHistory: new Set(['a', 'b']),
        currentHistoryId: 'a',
      }),
      invoke,
    }),
  });
  expect(
    await registry.executeAction('workspace.open-history', { historyId: 'a' }),
  ).toMatchObject({ status: 'rejected', code: 'already-active' });
  expect(
    await registry.executeAction('workspace.open-history', {
      historyId: 'missing',
    }),
  ).toMatchObject({ status: 'rejected', code: 'missing-target' });
  expect(
    (await registry.executeAction('workspace.open-history', { historyId: 1 }))
      .status,
  ).toBe('rejected');
  paused = true;
  expect(
    (await registry.executeAction('workspace.open-history', { historyId: 'b' }))
      .status,
  ).toBe('rejected');
  paused = false;
  readonly = true;
  expect(
    registry.getActionState('workspace.open-history', { historyId: 'b' }),
  ).toMatchObject({ visible: false, enabled: false });
  expect(
    (await registry.executeAction('workspace.open-history', { historyId: 'b' }))
      .status,
  ).toBe('rejected');
  expect(invoke).not.toHaveBeenCalled();
  readonly = false;
  expect(
    (await registry.executeAction('workspace.open-history', { historyId: 'b' }))
      .status,
  ).toBe('completed');
  expect(invoke).toHaveBeenCalledWith('open-history', { historyId: 'b' });
  registry.dispose();
});

it('copies readonly file targets without flushing content and rejects stale or missing targets', async () => {
  const session = await open();
  let current: WorkspaceSession | null = session;
  const flushEditing = vi.fn();
  const invoke = vi.fn();
  const registry = createWorkspaceActionRegistry({
    getContext: () => ({ session: current, readonly: true, flushEditing }),
    dialogs: createWorkspaceSurfaceActions({ getState: ui, invoke }),
  });
  const action = registry
    .actions()
    .find((item) => item.id === 'workspace.file.copy-link')!;
  expect(action.getState({ fileId: 'a' }).enabled).toBe(true);
  await action.execute({ fileId: 'a' });
  expect(flushEditing).not.toHaveBeenCalled();
  expect(invoke).toHaveBeenCalledWith('file.copy-link', { fileId: 'a' });
  expect(action.getState({ fileId: 'missing' }).enabled).toBe(false);
  const captured = action.capture();
  current = null;
  expect((await captured.execute({ fileId: 'a' })).status).toBe('cancelled');
  registry.dispose();
});

it('merges queued project field patches against the latest configuration', async () => {
  const session = await open();
  session.setWorkspaceConfig({
    identity: 'stable',
    project: {
      description: 'Original',
      entryDocumentIds: ['a'],
      extra: 'preserve',
    },
  });
  await session.flush();
  const registry = createWorkspaceActionRegistry({
    getContext: () => ({ session }),
    dialogs: createWorkspaceSurfaceActions({ getState: ui, invoke: () => {} }),
  });
  const first = registry.executeAction('workspace.settings.patch', {
    project: { description: 'Updated' },
  });
  const second = registry.executeAction('workspace.settings.patch', {
    project: { entryDocumentIds: ['b', 'a'] },
  });
  expect((await first).status).toBe('completed');
  expect((await second).status).toBe('completed');
  expect(session.getState().config.value).toEqual({
    identity: 'stable',
    project: {
      description: 'Updated',
      entryDocumentIds: ['b', 'a'],
      extra: 'preserve',
    },
  });
  registry.dispose();
});

it('queues favorite changes against live config and preserves manual ordering', async () => {
  const session = await open();
  session.setWorkspaceConfig({
    navigation: { favorites: [], sort: 'manual', order: { '': ['b', 'a'] } },
  });
  await session.flush();
  let readonly = false;
  const registry = createWorkspaceActionRegistry({
    getContext: () => ({ session, readonly }),
    dialogs: createWorkspaceSurfaceActions({ getState: ui, invoke: () => {} }),
  });
  const favorite = 'workspace.file.favorite';
  const unfavorite = 'workspace.file.unfavorite';
  expect(registry.getActionState(favorite, { fileId: 'a' }).visible).toBe(true);
  expect(registry.getActionState(unfavorite, { fileId: 'a' }).visible).toBe(
    false,
  );
  const result = await Promise.all([
    registry.executeAction(favorite, { fileId: 'a' }),
    registry.executeAction(favorite, { fileId: 'b' }),
  ]);
  expect(result.map((item) => item.status)).toEqual(['completed', 'completed']);
  expect(registry.getActionState(unfavorite, { fileId: 'a' }).visible).toBe(
    true,
  );
  await registry.executeAction(unfavorite, { fileId: 'a' });
  expect(session.getState().config.value['navigation']).toEqual({
    favorites: ['b'],
    sort: 'manual',
    order: { '': ['b', 'a'] },
  });
  readonly = true;
  expect(registry.getActionState(unfavorite, { fileId: 'b' }).visible).toBe(
    false,
  );
  registry.dispose();
});
