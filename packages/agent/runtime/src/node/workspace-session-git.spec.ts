import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  createDocumentFile,
  openWorkspaceSession,
  type WorkspaceSession,
  type WorkspaceHost,
  type WorkspaceHandle,
} from '@sue/verd-board-workspace';
import { createFsWorkspaceHost } from './workspace-host-fs';

const exec = promisify(execFile);
const cleanup: {
  root: string;
  host: WorkspaceHost;
  handle: WorkspaceHandle;
  session: WorkspaceSession;
}[] = [];
afterEach(async () => {
  for (const item of cleanup.splice(0)) {
    item.session.dispose();
    await item.host.closeWorkspace(item.handle);
    await fs.rm(item.root, { recursive: true, force: true });
  }
});

async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'verd-git-session-'));
  const workspace = path.join(root, 'workspace');
  const host = createFsWorkspaceHost({
    defaultRoot: () => workspace,
    globalConfigPath: () => path.join(root, 'global.json'),
    watchDebounceMs: 10000,
  });
  const handle = (await host.openWorkspace({ path: workspace }))!;
  const session = await openWorkspaceSession(host, handle, { delayMs: 60000 });
  cleanup.push({ root, host, handle, session });
  const file = createDocumentFile('secret-file', 'Private content');
  await session.apply({ type: 'import-files', files: [file] });
  await session.flush();
  const entry = session.getState().documents.get('secret-file')!;
  await session.git({
    type: 'init',
    author: { name: 'Integration Test', email: 'integration@example.com' },
  });
  const commit = async (message: string) =>
    session.git({
      type: 'commit',
      message,
      expectedToken: (await session.git({ type: 'status' })).status.token,
    });
  const initial = await commit('Initial version');
  const command = async (...args: string[]) =>
    (await exec('git', ['-C', workspace, ...args])).stdout.trim();
  return {
    root,
    workspace,
    host,
    handle,
    session,
    file,
    entry,
    initial,
    commit,
    command,
  };
}

describe(
  'Git history through the canonical filesystem session',
  { timeout: 20000 },
  () => {
    it('permanently deletes the trash copy while preserving committed Git history', async () => {
      const f = await setup();
      const head = await f.command('rev-parse', 'HEAD');
      await f.session.apply({ type: 'trash-file', fileId: f.file.id });
      await f.session.flush();
      const entryId = f.session.getState().trash[0].entryId;
      expect(
        (await f.session.apply({ type: 'purge-trash', entryIds: [entryId] }))
          .ok,
      ).toBe(true);
      expect(f.session.getState().trash).toHaveLength(0);
      expect(await f.command('rev-parse', 'HEAD')).toBe(head);
      expect(
        JSON.parse(await f.command('show', `${head}:${f.entry.path}`)).id,
      ).toBe(f.file.id);
    });
    it('preserves restored Git-managed instructions and ignore rules when reopening', async () => {
      const f = await setup();
      const instructions =
        'Historical instructions kept exactly as committed.\n';
      const ignore =
        '# Project config is portable. Runtime data and machine links are not.\n*\n!.gitignore\n!config.json\n';
      await fs.writeFile(path.join(f.workspace, 'AGENTS.md'), instructions);
      await fs.writeFile(
        path.join(f.workspace, '.verdscrolls/.gitignore'),
        ignore,
      );
      const old = await f.commit('Historical instructions');
      await fs.writeFile(
        path.join(f.workspace, 'AGENTS.md'),
        'Later instructions\n',
      );
      await f.commit('Later instructions');
      const plan = await f.session.git({ type: 'restore-plan', oid: old.oid! });
      await f.session.git({
        type: 'restore',
        planId: plan.plan!.id,
        expectedToken: plan.plan!.token,
      });
      f.session.dispose();
      await f.host.closeWorkspace(f.handle);
      const reopened = (await f.host.openWorkspace({ path: f.workspace }))!;
      expect(
        await fs.readFile(path.join(f.workspace, 'AGENTS.md'), 'utf8'),
      ).toBe(instructions);
      expect(
        await fs.readFile(
          path.join(f.workspace, '.verdscrolls/.gitignore'),
          'utf8',
        ),
      ).toBe(ignore);
      await f.host.closeWorkspace(reopened);
    });

    it('derives identities from selected trash entries and clears Git plus legacy versions', async () => {
      const f = await setup();
      const blob = await f.command('rev-parse', `HEAD:${f.entry.path}`);
      // Simulate a process stopping after an app-owned same-directory temp was
      // fsynced but before rename. Ignored copies must not survive a claimed purge.
      const orphan =
        f.entry.path + '.41.00000000-0000-4000-8000-000000000000.tmp';
      await fs.writeFile(
        path.join(f.workspace, orphan),
        JSON.stringify(f.file),
      );
      await fs.appendFile(
        path.join(f.workspace, '.git/info/exclude'),
        '\n*.tmp\n',
      );
      const legacy = {
        id: 'legacy-private',
        fileId: f.file.id,
        title: f.file.title,
        name: 'Old version',
        at: 1,
        path: '.verd-resources/history/legacy-private.snapshot.json',
      };
      await f.session.commitResources([
        {
          path: legacy.path,
          content: JSON.stringify(f.file),
          expectedVersion: null,
        },
        {
          path: '.verd-resources/history/index.json',
          content: JSON.stringify({ version: 1, revisions: [legacy] }),
          expectedVersion: null,
        },
      ]);
      expect(
        (await f.session.apply({ type: 'trash-file', fileId: f.file.id })).ok,
      ).toBe(true);
      await f.session.flush();
      const trash = f.session.getState().trash[0]!;
      const prepared = await f.session.git({
        type: 'purge-plan',
        fileIds: [],
        trashEntryIds: [trash.entryId],
      });
      expect(prepared.plan!.paths.map((entry) => entry.path)).toContain(
        f.entry.path,
      );
      expect(prepared.plan!.fileIds).toContain(f.file.id);
      await f.session.git({
        type: 'purge',
        planId: prepared.plan!.id,
        expectedToken: prepared.plan!.token,
      });
      await expect(f.command('cat-file', '-e', blob)).rejects.toThrow();
      await expect(
        f.command('cat-file', '-e', f.initial.oid!),
      ).rejects.toThrow();
      await expect(
        fs.readFile(path.join(f.workspace, orphan)),
      ).rejects.toThrow();
      expect(f.session.getState().trash).toHaveLength(0);
      const raw = await f.session.readRawFile(
        '.verd-resources/history/index.json',
      );
      expect(
        JSON.parse(new TextDecoder().decode(raw.content)).revisions,
      ).toHaveLength(0);
      await expect(f.session.readRawFile(legacy.path)).rejects.toThrow();
      expect(await f.command('fsck', '--full')).not.toContain('error');
    });

    it('restores through Session without moving HEAD or creating a recovery snapshot', async () => {
      const f = await setup();
      await f.session.apply({
        type: 'file',
        file: { ...f.file, title: 'Revised' },
      });
      const revised = await f.commit('Revised version');
      const prepared = await f.session.git({
        type: 'restore-plan',
        oid: f.initial.oid!,
        fileId: f.file.id,
      });
      await f.session.git({
        type: 'restore',
        planId: prepared.plan!.id,
        expectedToken: prepared.plan!.token,
      });
      expect(f.session.getState().documents.get(f.file.id)?.file.title).toBe(
        'Private content',
      );
      expect(await f.command('rev-parse', 'HEAD')).toBe(revised.oid);
      expect(
        f.session
          .getState()
          .resources?.some((entry) => entry.key.startsWith('history/')),
      ).toBe(false);
      expect(
        (await f.session.git({ type: 'status' })).status.changes.map(
          (change) => change.path,
        ),
      ).toContain(f.entry.path);
    });
  },
);
