import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { createWebWorkspaceHost } from './web-workspace-host';
import { workspaceHostSupports } from './workspace-host';

describe('Web workspace capabilities and names', () => {
  const setup = () =>
    createWebWorkspaceHost({
      indexedDB: new IDBFactory(),
      dbName: crypto.randomUUID(),
    });
  it('rejects unsupported requests before resolving default or active history', async () => {
    const host = setup();
    const initial = (await host.openWorkspace({ default: true }))!;
    const other = (await host.createWorkspace!({ name: 'Other' }))!;
    await host.activateWorkspace!(other);
    expect(host.capabilities).toEqual({
      pickWorkspace: false,
      openBuiltinWorkspace: false,
      openPatternWorkspace: false,
    });
    await expect(host.openWorkspace({ pick: true })).rejects.toThrow(
      'not supported',
    );
    await expect(host.openWorkspace({ patterns: true })).rejects.toThrow(
      'not supported',
    );
    expect((await host.openWorkspace())?.key).toBe(other.key);
    expect((await host.openWorkspace({ default: true }))?.key).toBe(
      initial.key,
    );
    expect(
      (await host.openWorkspace({ historyId: other.historyId }))?.key,
    ).toBe(other.key);
  });
  it('derives history and reopened handles from the saved config without changing ordering', async () => {
    const host = setup();
    const handle = (await host.createWorkspace!({ name: 'Before' }))!;
    await host.activateWorkspace!(handle);
    const before = (await host.listWorkspaceHistory!())[0];
    const config = (await host.readSnapshot(handle)).config;
    expect(
      (
        await host.commit(handle, {
          transactionId: 'rename',
          config: {
            value: { ...config.value, name: '  After  ' },
            expectedVersion: config.version,
          },
        })
      ).outcome,
    ).toBe('applied');
    expect((await host.listWorkspaceHistory!())[0]).toEqual({
      ...before,
      name: 'After',
    });
    expect(
      (await host.openWorkspace({ historyId: handle.historyId }))?.name,
    ).toBe('After');
    expect(
      (
        await host.commit(handle, {
          transactionId: 'stale-rename',
          config: {
            value: { name: 'Rejected' },
            expectedVersion: config.version,
          },
        })
      ).outcome,
    ).toBe('rejected');
    expect((await host.listWorkspaceHistory!())[0].name).toBe('After');
  });
  it('preserves legacy third-party hosts without declarations', () => {
    expect(workspaceHostSupports({}, 'pickWorkspace')).toBe(true);
    expect(
      workspaceHostSupports(
        {
          capabilities: {
            pickWorkspace: false,
            openBuiltinWorkspace: true,
            openPatternWorkspace: false,
          },
        },
        'pickWorkspace',
      ),
    ).toBe(false);
  });
});
