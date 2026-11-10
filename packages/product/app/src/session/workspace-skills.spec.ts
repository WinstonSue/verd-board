import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryWorkspaceHost } from '../host/memory-workspace-host';
import { createWebWorkspaceHost } from '../host/web-workspace-host';
import {
  openWorkspaceSession,
  type WorkspaceSession,
} from './workspace-session';
import { serializeWorkspaceSkill } from '../workspace-skills';
import { createWorkspaceActionRegistry } from './workspace-actions';
import { createWorkspaceSurfaceActions } from './workspace-surface-actions';

const path = '.agents/skills/verd-workspace/SKILL.md';
const content = (body = 'Use Chinese.') =>
  serializeWorkspaceSkill(path, {
    description: 'Workspace writing requirements',
    body,
  });
const sessions: WorkspaceSession[] = [];
afterEach(() => sessions.splice(0).forEach((session) => session.dispose()));
for (const kind of ['memory', 'web'] as const)
  describe(`${kind} workspace Skills`, () => {
    const setup = async () => {
      const host =
        kind === 'memory'
          ? createMemoryWorkspaceHost()
          : createWebWorkspaceHost({
              indexedDB: new IDBFactory(),
              dbName: crypto.randomUUID(),
            });
      const handle = (await host.openWorkspace({ path: crypto.randomUUID() }))!;
      const session = await openWorkspaceSession(host, handle);
      sessions.push(session);
      return { host, handle, session };
    };
    it('saves and reopens standard text, isolates workspaces and conditionally recycles only SKILL.md', async () => {
      const { host, handle, session } = await setup();
      const write = {
        transactionId: crypto.randomUUID(),
        writes: [{ path, content: content(), expectedVersion: null }],
      };
      expect((await session.commitWorkspaceSkills(write)).outcome).toBe(
        'applied',
      );
      expect((await session.commitWorkspaceSkills(write)).outcome).toBe(
        'applied',
      );
      expect(session.getState().canUndo).toBe(false);
      const reopened = await openWorkspaceSession(host, handle);
      sessions.push(reopened);
      const raw = await reopened.readRawFile(path);
      expect(new TextDecoder().decode(raw.content)).toBe(content());
      const other = (await host.openWorkspace({ path: crypto.randomUUID() }))!;
      await expect(host.readFile(other, path)).rejects.toThrow();
      const reference = '.agents/skills/verd-workspace/references/details.md';
      await host.commit(handle, {
        transactionId: crypto.randomUUID(),
        writes: [
          {
            path: reference,
            content: 'Keep references',
            expectedVersion: null,
          },
        ],
      });
      expect(
        (
          await reopened.commitWorkspaceSkills({
            transactionId: crypto.randomUUID(),
            trash: [{ path, expectedVersion: raw.version }],
          })
        ).outcome,
      ).toBe('applied');
      await expect(reopened.readRawFile(path)).rejects.toThrow();
      expect(
        new TextDecoder().decode(
          (await reopened.readRawFile(reference)).content,
        ),
      ).toBe('Keep references');
      expect(
        reopened.getState().trash.some((item) => item.originalPath === path),
      ).toBe(true);
    });
    it('rejects stale versions, readonly/frozen sessions and unrecognized Skill paths', async () => {
      const { session } = await setup();
      await session.commitWorkspaceSkills({
        transactionId: crypto.randomUUID(),
        writes: [{ path, content: content(), expectedVersion: null }],
      });
      const raw = await session.readRawFile(path);
      await session.commitWorkspaceSkills({
        transactionId: crypto.randomUUID(),
        writes: [
          {
            path,
            content: content('Use project terms.'),
            expectedVersion: raw.version,
          },
        ],
      });
      const result = await session.commitWorkspaceSkills({
        transactionId: crypto.randomUUID(),
        writes: [
          { path, content: content('Stale'), expectedVersion: raw.version },
        ],
      });
      expect(result).toMatchObject({
        outcome: 'rejected',
        reason: 'version-conflict',
      });
      await expect(
        session.commitWorkspaceSkills({
          transactionId: crypto.randomUUID(),
          writes: [
            {
              path: '.agents/skills/unrelated/SKILL.md',
              content: content(),
              expectedVersion: null,
            },
          ],
        }),
      ).rejects.toThrow();
      session.setReadonly(true);
      await expect(
        session.commitWorkspaceSkills({
          transactionId: crypto.randomUUID(),
          trash: [{ path, expectedVersion: raw.version }],
        }),
      ).rejects.toThrow();
      session.setReadonly(false);
      session.freeze();
      await expect(
        session.commitWorkspaceSkills({
          transactionId: crypto.randomUUID(),
          trash: [{ path, expectedVersion: raw.version }],
        }),
      ).rejects.toThrow();
    });
    it('retries an unknown outcome with the original transaction and rejects changing the request', async () => {
      const { host, session } = await setup();
      const commit = host.commit.bind(host);
      const intercepted = vi
        .spyOn(host, 'commit')
        .mockImplementationOnce(async (handle, request) => {
          await commit(handle, request);
          throw new Error('Lost acknowledgement');
        });
      const request = {
        transactionId: crypto.randomUUID(),
        writes: [{ path, content: content(), expectedVersion: null }],
      };
      expect((await session.commitWorkspaceSkills(request)).reason).toBe(
        'io-error',
      );
      await expect(
        session.commitWorkspaceSkills({
          ...request,
          transactionId: crypto.randomUUID(),
        }),
      ).rejects.toThrow('Confirm');
      expect((await session.commitWorkspaceSkills(request)).outcome).toBe(
        'applied',
      );
      expect(intercepted.mock.calls[0][1].transactionId).toBe(
        intercepted.mock.calls[1][1].transactionId,
      );
    });
    it('routes settings mutations through the registered content Actions', async () => {
      const { session } = await setup();
      const registry = createWorkspaceActionRegistry({
        getContext: () => ({ session }),
        dialogs: createWorkspaceSurfaceActions({
          getState: () => ({
            allowWorkspaceSwitching: true,
            isDefaultWorkspace: false,
            hasOrigin: false,
          }),
          invoke: () => {},
        }),
      });
      const result = await registry.executeAction('workspace.skills.save', {
        transactionId: crypto.randomUUID(),
        writes: [{ path, content: content(), expectedVersion: null }],
      });
      expect(result.status).toBe('completed');
      const raw = await session.readRawFile(path);
      expect(
        (
          await registry.executeAction('workspace.skills.remove', {
            transactionId: crypto.randomUUID(),
            trash: [{ path, expectedVersion: raw.version }],
          })
        ).status,
      ).toBe('completed');
      registry.dispose();
    });
    it('accepts UTF-8 bytes while keeping the Skill API limited to Skill file mutations', async () => {
      const { session } = await setup();
      const before = session.getState().config;
      const request = {
        transactionId: crypto.randomUUID(),
        writes: [
          {
            path,
            content: new TextEncoder().encode(content()),
            expectedVersion: null,
          },
        ],
        config: {
          expectedVersion: before.version,
          value: { name: 'Unexpected config mutation' },
        },
        mkdirs: ['unexpected-directory'],
      };
      expect((await session.commitWorkspaceSkills(request)).outcome).toBe(
        'applied',
      );
      expect(
        new TextDecoder().decode((await session.readRawFile(path)).content),
      ).toBe(content());
      expect(session.getState().config).toEqual(before);
      expect(
        session
          .getState()
          .entries.some((entry) => entry.path === 'unexpected-directory'),
      ).toBe(false);
    });
  });
