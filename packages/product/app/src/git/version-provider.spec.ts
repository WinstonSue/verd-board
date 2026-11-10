import { describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createMemoryWorkspaceHost } from '../host/memory-workspace-host';
import { createWebWorkspaceHost } from '../host/web-workspace-host';
import type { WorkspaceHost } from '../host/workspace-host';
import { createDocumentFile } from '../documents/document-files';
import { openWorkspaceSession } from '../session/workspace-session';
import type { VersionScope, VersionStatus } from '../host/workspace-versions';

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
for (const storage of ['memory', 'browser'])
  describe(`${storage} neutral versions`, () => {
    async function fixture() {
      const host: WorkspaceHost =
        storage === 'memory'
          ? createMemoryWorkspaceHost()
          : createWebWorkspaceHost({
              indexedDB: new IDBFactory(),
              dbName: crypto.randomUUID(),
            });
      const handle = (await host.openWorkspace({ default: true }))!;
      const write = async (path: string, content: string) => {
        let expectedVersion: string | null = null;
        try {
          expectedVersion = (await host.readFile(handle, path)).version;
        } catch {}
        expect(
          (
            await host.commit(handle, {
              transactionId: crypto.randomUUID(),
              writes: [{ path, content, expectedVersion }],
            })
          ).outcome,
        ).toBe('applied');
      };
      const doc = createDocumentFile('inside', 'First');
      await write('old/note.verd-doc.json', JSON.stringify(doc));
      await host.commit(handle, {
        transactionId: crypto.randomUUID(),
        mkdirs: ['old/empty'],
      });
      await host.git!(handle, {
        type: 'init',
        author: { name: 'Tester', email: 'tester@example.com' },
      });
      const versions = (
        request: Parameters<NonNullable<WorkspaceHost['versions']>>[1],
      ) => host.versions!(handle, request);
      const create = async (scope: VersionScope, message: string) => {
        const result = await versions({ type: 'create-plan', scope, message });
        expect(result.plan).toBeDefined();
        return versions({
          type: 'create',
          planId: result.plan!.id,
          expectedToken: result.plan!.token,
        });
      };
      return { host, handle, write, versions, create, doc };
    }
    it('plans without writes, follows a moved directory and restores at its current location without advancing history', async () => {
      const { host, handle, write, versions, create, doc } = await fixture();
      expect(
        (
          await versions({
            type: 'list',
            scope: { kind: 'directory', path: 'old' },
          })
        ).versions,
      ).toEqual([]);
      const plan = await versions({
        type: 'create-plan',
        scope: { kind: 'directory', path: 'old' },
        message: 'First directory',
      });
      await expect(
        host.readFile(handle, 'old/.verd-folder.json'),
      ).rejects.toThrow();
      const first = await versions({
        type: 'create',
        planId: plan.plan!.id,
        expectedToken: plan.plan!.token,
      });
      const id = JSON.parse(
        text((await host.readFile(handle, 'old/.verd-folder.json')).content),
      ).id;
      expect(
        JSON.parse(
          text(
            (await host.readFile(handle, 'old/empty/.verd-folder.json'))
              .content,
          ),
        ).id,
      ).toBeTruthy();
      expect(
        (
          await host.commit(handle, {
            transactionId: crypto.randomUUID(),
            moves: [{ from: 'old', to: 'new' }],
          })
        ).outcome,
      ).toBe('applied');
      await write(
        'new/note.verd-doc.json',
        JSON.stringify({ ...doc, title: 'Second' }),
      );
      const second = await create(
        { kind: 'directory', path: 'new', folderId: id },
        'Moved directory',
      );
      const history = await versions({
        type: 'list',
        scope: { kind: 'directory', path: 'new', folderId: id },
      });
      expect(history.versions?.map((v) => v.id)).toEqual([
        second.versionId,
        first.versionId,
      ]);
      expect(history.versions?.[1].path).toBe('old');
      await write('unrelated.txt', 'Unrelated draft');
      const restore = await versions({
        type: 'restore-plan',
        scope: { kind: 'directory', path: 'new', folderId: id },
        versionId: first.versionId!,
      });
      expect(
        restore.plan?.paths.some(
          (p) => p.path.startsWith('old/') || p.path === 'unrelated.txt',
        ),
      ).toBe(false);
      await versions({
        type: 'restore',
        planId: restore.plan!.id,
        expectedToken: restore.plan!.token,
      });
      expect(
        JSON.parse(
          text((await host.readFile(handle, 'new/note.verd-doc.json')).content),
        ).title,
      ).toBe('First');
      expect(text((await host.readFile(handle, 'unrelated.txt')).content)).toBe(
        'Unrelated draft',
      );
      expect(
        (await versions({ type: 'list', scope: { kind: 'workspace' } }))
          .versions?.[0].id,
      ).toBe(second.versionId);
      await host.closeWorkspace(handle);
    });
    it('refuses stale creation plans and identities moved outside the directory', async () => {
      const { host, handle, write, versions, create } = await fixture();
      const first = await create(
        { kind: 'directory', path: 'old' },
        'Directory',
      );
      await write('old/changed.txt', 'Pending');
      const plan = await versions({
        type: 'create-plan',
        scope: { kind: 'directory', path: 'old' },
        message: 'Stale',
      });
      await write('other.txt', 'Concurrent edit');
      await expect(
        versions({
          type: 'create',
          planId: plan.plan!.id,
          expectedToken: plan.plan!.token,
        }),
      ).rejects.toMatchObject({ code: 'stale-plan' });
      const move = await host.commit(handle, {
        transactionId: crypto.randomUUID(),
        moves: [
          {
            from: 'old/note.verd-doc.json',
            to: 'outside.verd-doc.json',
            expectedVersion: (
              await host.readFile(handle, 'old/note.verd-doc.json')
            ).version,
          },
        ],
      });
      expect(move.outcome, JSON.stringify(move)).toBe('applied');
      await create({ kind: 'workspace' }, 'Move out');
      await expect(
        versions({
          type: 'restore-plan',
          scope: { kind: 'directory', path: 'old' },
          versionId: first.versionId!,
        }),
      ).rejects.toMatchObject({ code: 'scope-collision' });
      await host.closeWorkspace(handle);
    });
  });

it('uses an injected version provider with no Git API and keeps the session save barrier', async () => {
  const host = createMemoryWorkspaceHost();
  const handle = (await host.openWorkspace({ default: true }))!;
  const status: VersionStatus = {
    available: true,
    enabled: true,
    token: 'opaque',
    changes: [],
    capabilities: {
      create: true,
      restore: true,
      directory: true,
      cleanup: false,
      sync: false,
    },
  };
  const provider = vi.fn(async () => ({
    status,
    versionId: 'independent-version',
  }));
  host.versions = provider;
  host.git = vi.fn(async () => {
    throw new Error('Git must not be called');
  });
  const session = await openWorkspaceSession(host, handle);
  const result = await session.versions({
    type: 'create',
    planId: 'independent-plan',
    expectedToken: 'opaque',
  });
  expect(result.versionId).toBe('independent-version');
  expect(provider).toHaveBeenCalledOnce();
  expect(host.git).not.toHaveBeenCalled();
  session.dispose();
  await host.closeWorkspace(handle);
});
