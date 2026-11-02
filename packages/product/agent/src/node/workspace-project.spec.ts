import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { digest, readNativeSnapshot } from './workspace-lock';
import { createFsWorkspaceHost } from './workspace-host-fs';
import { deployAgentResources } from './agent-resources';
import { discoverWorkspace } from './workspace-metadata';
import { initializeWorkspaceProject } from './workspace-init';
import {
  inspectWorkspaceAgent,
  readWorkspaceProjectContext,
} from './workspace-project';
import { prepareAuthoringBatch } from '../authoring';
import { applyPreparedBatch } from '../apply';
import { runCli } from '../cli';

const roots: string[] = [];
const hosts: {
  host: ReturnType<typeof createFsWorkspaceHost>;
  handle: { key: string; name: string };
}[] = [];
afterEach(async () => {
  for (const { host, handle } of hosts.splice(0))
    await host.closeWorkspace(handle);
  for (const root of roots.splice(0))
    await fs.rm(root, { recursive: true, force: true });
});
async function directory() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'verd-project space-'));
  roots.push(root);
  return root;
}
async function provider(root: string, id = 'test-v1') {
  const dir = path.join(root, id);
  const contents: Record<string, string> = {
    'bin/verd': '#!/bin/sh\n',
    'bin/verd.cmd': '@echo off\r\n',
    'skills/verd-authoring/SKILL.md': 'Read rules then context',
    'rules.json': '{}',
    'catalog.json': '[]',
    'app/node_modules/@sue/verd-board-agent/dist/cli.js': 'mock cli',
    [process.platform === 'win32' ? 'runtime/node.exe' : 'runtime/node']:
      'mock node',
  };
  for (const [file, text] of Object.entries(contents)) {
    await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await fs.writeFile(path.join(dir, file), text);
  }
  await fs.writeFile(
    path.join(dir, 'manifest.json'),
    JSON.stringify({
      format: 'verd-agent-resources',
      version: 1,
      id,
      toolVersion: '0.1.0',
      specificationVersion: '0.1.0',
      nodeVersion: '24.18.1',
      platform: process.platform,
      arch: process.arch,
      files: Object.fromEntries(
        Object.entries(contents).map(([file, text]) => [file, digest(text)]),
      ),
    }),
  );
  return dir;
}
async function open(root: string, resources?: string) {
  const host = createFsWorkspaceHost({
    defaultRoot: () => root,
    sharedResources: resources ? () => resources : undefined,
  });
  const handle = (await host.openWorkspace({ path: root }))!;
  hosts.push({ host, handle });
  return { host, handle };
}

describe('automatic project context and resources', () => {
  it('initializes a folder once, keeps AGENTS prose and config as the only project authority', async () => {
    const base = await directory(),
      root = path.join(base, 'project'),
      shared = await provider(base);
    await fs.mkdir(root);
    await fs.writeFile(
      path.join(root, 'AGENTS.md'),
      '# Existing rules\nKeep this exactly.\n',
    );
    const first = await initializeWorkspaceProject(root, {
      resources: shared,
      name: 'My project',
    });
    expect(first).toMatchObject({
      name: 'My project',
      description: '',
      entryDocumentIds: [],
      entries: [],
      agent: { ready: true },
      resourceId: 'test-v1',
    });
    const text = await fs.readFile(path.join(root, 'AGENTS.md'), 'utf8'),
      stat = await fs.stat(path.join(root, 'AGENTS.md'));
    expect(text.startsWith('# Existing rules\nKeep this exactly.\n')).toBe(
      true,
    );
    const next = await initializeWorkspaceProject(root, {
      resources: shared,
      name: 'Do not replace',
    });
    expect(next.identity).toBe(first.identity);
    expect(next.name).toBe(first.name);
    expect((await fs.stat(path.join(root, 'AGENTS.md'))).mtimeMs).toBe(
      stat.mtimeMs,
    );
    const { host, handle } = await open(root, shared),
      snapshot = await host.readSnapshot(handle);
    await host.commit(handle, {
      transactionId: 'project-settings',
      config: {
        expectedVersion: snapshot.config.version,
        value: {
          ...snapshot.config.value,
          name: 'Renamed',
          project: {
            description: 'Service context',
            entryDocumentIds: ['entry-1'],
          },
        },
      },
    });
    expect(await readWorkspaceProjectContext(root)).toMatchObject({
      name: 'Renamed',
      description: 'Service context',
      entryDocumentIds: ['entry-1'],
    });
    const ignored = await fs.readFile(
      path.join(root, '.verdscrolls/.gitignore'),
      'utf8',
    );
    expect(ignored).toContain('!config.json');
    expect(
      (await host.readSnapshot(handle)).entries.some((e) =>
        e.path.includes('shared'),
      ),
    ).toBe(false);
  });
  it('discovers nearest roots, respects explicit paths and uninitialized Git boundaries', async () => {
    const base = await directory(),
      root = path.join(base, 'project');
    await initializeWorkspaceProject(root);
    const sub = path.join(root, 'a/b');
    await fs.mkdir(sub, { recursive: true });
    expect(await discoverWorkspace(sub)).toBe(await fs.realpath(root));
    expect(
      (await runCli(['context', '--workspace', sub + '/../..', '--json']))
        .result,
    ).toMatchObject({ root: await fs.realpath(root) });
    const nested = path.join(root, 'nested');
    await initializeWorkspaceProject(nested);
    expect(await discoverWorkspace(nested)).toBe(await fs.realpath(nested));
    const outer = await open(root);
    expect(
      (await outer.host.readSnapshot(outer.handle)).entries.some((e) =>
        e.path.includes('.verdscrolls'),
      ),
    ).toBe(false);
    await fs.mkdir(path.join(sub, '.git'));
    await expect(discoverWorkspace(sub)).rejects.toThrow('WORKSPACE_NOT_FOUND');
    expect(await discoverWorkspace(sub, root)).toBe(await fs.realpath(root));
  });
  it('keeps read-only commands from initializing metadata, guides or recovering logs', async () => {
    const root = await directory();
    expect(
      (await runCli(['doctor', '--workspace', root])).result,
    ).toMatchObject({ ready: false });
    await expect(fs.access(path.join(root, '.verdscrolls'))).rejects.toThrow();
    await expect(fs.access(path.join(root, 'AGENTS.md'))).rejects.toThrow();
    await expect(runCli(['context', '--workspace', root])).rejects.toThrow();
    expect(await fs.readdir(root)).toEqual([]);
  });
  it('preserves occupied guide/link paths and reports unready instead of copying specifications', async () => {
    const base = await directory(),
      shared = await provider(base),
      root = path.join(base, 'project');
    await fs.mkdir(path.join(root, '.verdscrolls/shared'), { recursive: true });
    const outside = path.join(base, 'external');
    await fs.writeFile(outside, 'foreign guide');
    await fs.symlink(outside, path.join(root, 'AGENTS.md'));
    const result = await initializeWorkspaceProject(root, {
      resources: shared,
    });
    expect(result.agent.ready).toBe(false);
    expect(await fs.readFile(outside, 'utf8')).toBe('foreign guide');
    expect(await fs.readdir(path.join(root, '.verdscrolls/shared'))).toEqual(
      [],
    );
  });
  it('relinks moved/cloned projects, upgrades resources and retains old provider versions', async () => {
    const base = await directory(),
      source = await provider(base),
      hub = path.join(base, 'hub');
    const deployed = await deployAgentResources(source, hub),
      root = path.join(base, 'project');
    const context = await initializeWorkspaceProject(root, {
      resources: deployed,
    });
    const moved = path.join(base, 'moved project');
    await fs.rename(root, moved);
    expect((await readWorkspaceProjectContext(moved)).identity).toBe(
      context.identity,
    );
    await fs.unlink(path.join(moved, '.verdscrolls/shared'));
    expect((await inspectWorkspaceAgent(moved)).ready).toBe(false);
    const newer = await deployAgentResources(
      await provider(base, 'test-v2'),
      hub,
    );
    expect(
      (await initializeWorkspaceProject(moved, { resources: newer })).agent
        .ready,
    ).toBe(true);
    expect(await fs.realpath(path.join(moved, '.verdscrolls/shared'))).toBe(
      await fs.realpath(newer),
    );
    expect(await fs.readdir(hub)).toEqual(['test-v1', 'test-v2']);
    expect(await fs.readFile(path.join(source, 'rules.json'), 'utf8')).toBe(
      '{}',
    );
  });
  it('rejects pending plans after a resource upgrade while confirming old receipts', async () => {
    const base = await directory(),
      root = path.join(base, 'project');
    await initializeWorkspaceProject(root, { resources: await provider(base) });
    const plan = await prepareAuthoringBatch(await readNativeSnapshot(root), [
      {
        type: 'file.create',
        kind: 'document',
        id: 'doc',
        title: 'Doc',
        path: 'doc.verd-doc.json',
      },
    ]);
    await applyPreparedBatch(root, plan);
    const pending = await prepareAuthoringBatch(
      await readNativeSnapshot(root),
      [
        {
          type: 'file.create',
          kind: 'document',
          title: 'Next',
          path: 'next.verd-doc.json',
        },
      ],
    );
    await initializeWorkspaceProject(root, {
      resources: await provider(base, 'test-v2'),
    });
    expect((await applyPreparedBatch(root, plan)).outcome).toBe('applied');
    await expect(applyPreparedBatch(root, pending)).rejects.toThrow(
      'VERSION_CONFLICT',
    );
  });
});

describe('metadata migration with the existing journal protocol', () => {
  it('moves config, receipts, sessions and trash intact, then blocks a reappearing old writer', async () => {
    const root = await directory();
    let opened = await open(root);
    await opened.host.commit(opened.handle, {
      transactionId: 'seed',
      writes: [
        { path: 'old.txt', content: 'keep bytes', expectedVersion: null },
      ],
    });
    await opened.host.commit(opened.handle, {
      transactionId: 'trash',
      trash: [{ path: 'old.txt', expectedVersion: digest('keep bytes') }],
      session: { tabs: [], activeTabId: null, expandedDirs: ['a'] },
    });
    const before = await opened.host.readSnapshot(opened.handle);
    await opened.host.closeWorkspace(opened.handle);
    hosts.pop();
    const config = await fs.readFile(
      path.join(root, '.verdscrolls/config.json'),
    );
    await fs.rename(
      path.join(root, '.verdscrolls'),
      path.join(root, '.verdboard'),
    );
    opened = await open(root);
    const after = await opened.host.readSnapshot(opened.handle);
    expect(
      await fs.readFile(path.join(root, '.verdscrolls/config.json')),
    ).toEqual(config);
    expect(after.trash).toEqual(before.trash);
    expect(after.session).toEqual(before.session);
    expect(
      (await opened.host.commit(opened.handle, { transactionId: 'seed' }))
        .outcome,
    ).toBe('applied');
    await fs.mkdir(path.join(root, '.verdboard'));
    await expect(initializeWorkspaceProject(root)).rejects.toThrow(
      'WORKSPACE_LEGACY_WRITER',
    );
    await expect(
      opened.host.commit(opened.handle, {
        transactionId: 'blocked',
        writes: [{ path: 'bad.txt', content: 'bad', expectedVersion: null }],
      }),
    ).rejects.toThrow('WORKSPACE_LEGACY_WRITER');
    await expect(fs.access(path.join(root, 'bad.txt'))).rejects.toThrow();
  });
  it.each(['prepared', 'applying', 'applied'])(
    'recovers %s journals after atomic metadata migration',
    async (phase) => {
      const root = await directory(),
        { host, handle } = await open(root);
      await host.closeWorkspace(handle);
      hosts.pop();
      await fs.rename(
        path.join(root, '.verdscrolls'),
        path.join(root, '.verdboard'),
      );
      const old = path.join(root, '.verdboard'),
        tx = 'migrated-tx',
        staged = `transactions/${tx}.staging/0.bin`;
      await fs.mkdir(path.dirname(path.join(old, staged)), { recursive: true });
      await fs.writeFile(path.join(old, staged), 'after');
      await fs.writeFile(
        path.join(old, 'transactions', tx + '.json'),
        JSON.stringify({
          transactionId: tx,
          phase,
          createdAt: 1,
          ops: [
            {
              kind: 'write',
              path: 'a.txt',
              before: null,
              after: digest('after'),
              staged,
            },
          ],
        }),
      );
      await open(root);
      await expect(
        fs.access(path.join(root, '.verdscrolls/transactions', tx + '.json')),
      ).rejects.toThrow();
      if (phase === 'applying') {
        expect(await fs.readFile(path.join(root, 'a.txt'), 'utf8')).toBe(
          'after',
        );
        expect(
          JSON.parse(
            await fs.readFile(
              path.join(root, '.verdscrolls/receipts', tx + '.json'),
              'utf8',
            ),
          ).outcome,
        ).toBe('applied');
      }
      await expect(fs.access(path.join(root, '.verdboard'))).rejects.toThrow();
    },
  );
  it('stops on two populated directories and preserves unreadable recovery records', async () => {
    const root = await directory();
    await fs.mkdir(path.join(root, '.verdboard'));
    await fs.writeFile(path.join(root, '.verdboard/evidence'), 'old');
    await fs.mkdir(path.join(root, '.verdscrolls'));
    await fs.writeFile(path.join(root, '.verdscrolls/evidence'), 'new');
    await expect(open(root)).rejects.toThrow('WORKSPACE_METADATA_CONFLICT');
    expect(
      await fs.readFile(path.join(root, '.verdboard/evidence'), 'utf8'),
    ).toBe('old');
    await fs.rm(path.join(root, '.verdscrolls'), { recursive: true });
    const { host, handle } = await open(root);
    const log = path.join(root, '.verdscrolls/transactions/broken.json');
    await fs.mkdir(path.dirname(log), { recursive: true });
    await fs.writeFile(log, '{broken');
    await host.closeWorkspace(handle);
    hosts.pop();
    const next = await open(root);
    expect(
      (await next.host.readSnapshot(next.handle)).diagnostics.some((d) =>
        d.message.includes('preserved'),
      ),
    ).toBe(true);
    expect(await fs.readFile(log, 'utf8')).toBe('{broken');
    expect(
      (await next.host.commit(next.handle, { transactionId: 'blocked' }))
        .outcome,
    ).toBe('rejected');
  });
});

it('reports an unsuccessful resource upgrade even if an older shared link still works', async () => {
  const base = await directory(),
    root = path.join(base, 'project');
  await initializeWorkspaceProject(root, { resources: await provider(base) });
  const failed = await initializeWorkspaceProject(root, {
    resources: path.join(base, 'missing-release'),
  });
  expect(failed.agent.ready).toBe(false);
  expect(
    failed.agent.diagnostics.some((d) => d.code === 'agent.shared-conflict'),
  ).toBe(true);
  expect((await inspectWorkspaceAgent(root)).resourceId).toBe('test-v1');
});
