import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createDocumentFile,
  folderIdentityWrite,
} from '@sue/verd-board-workspace';
import { afterEach, expect, it, vi } from 'vitest';
import { codexHandoffUrl, createLocalCodexRunner } from './local-codex';
import { initializeWorkspaceProject } from './workspace-init';

const fake = vi.hoisted(() => ({
  script: undefined as string | undefined,
  executable: undefined as string | undefined,
}));

vi.mock('node:child_process', async (load) => {
  const actual = await load<typeof import('node:child_process')>();
  return {
    ...actual,
    execFile(executable: string, argv: string[], ...rest: unknown[]) {
      const args =
        fake.script && executable === fake.executable && argv[0] === '--version'
          ? [fake.script, ...argv]
          : argv;
      return Reflect.apply(actual.execFile, undefined, [
        executable,
        args,
        ...rest,
      ]);
    },
    spawn(executable: string, argv: string[], ...rest: unknown[]) {
      const args =
        fake.script && executable === fake.executable && argv[0] === 'exec'
          ? [fake.script, ...argv]
          : argv;
      return Reflect.apply(actual.spawn, undefined, [
        executable,
        args,
        ...rest,
      ]);
    },
  };
});

vi.mock('./workspace-project', async (load) => {
  const project = await load<typeof import('./workspace-project')>();
  return {
    ...project,
    inspectWorkspaceAgent: (root: string) =>
      fake.script
        ? Promise.resolve({
            ready: true,
            enabled: true,
            diagnostics: [],
            resourceId: null,
          })
        : project.inspectWorkspaceAgent(root),
  };
});

let root: string | undefined;
afterEach(async () => {
  fake.script = undefined;
  fake.executable = undefined;
  if (root) await fs.rm(root, { recursive: true, force: true });
  root = undefined;
});

async function openFixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'verd-codex-'));
  root = directory;
  await initializeWorkspaceProject(directory);
  fake.script = fileURLToPath(
    new URL('../../../../../tests/fixtures/local-codex.mjs', import.meta.url),
  );
  fake.executable = await fs.realpath(process.execPath);
  return {
    directory,
    runner: createLocalCodexRunner({ executable: () => process.execPath }),
  };
}

it('runs a quick task and writes a prepared change only after approval', async () => {
  const { directory, runner } = await openFixture();
  const relative = 'proposal.verd-doc.json';
  const file = path.join(directory, relative);
  const initial = createDocumentFile('proposal', 'Original proposal');
  const requestId = randomUUID();
  const status = { type: 'status' as const, requestId };
  try {
    await fs.writeFile(file, JSON.stringify(initial));
    await runner.request('owner', directory, {
      type: 'start',
      requestId,
      task: { task: 'fixture-edit', target: { fileId: initial.id } },
    });
    await expect
      .poll(() => runner.request('owner', directory, status))
      .toMatchObject({ state: 'review' });
    const state = await runner.request('owner', directory, status);
    if (!('transactionId' in state)) throw new Error('Missing proposal');
    expect(state.changes).toEqual([
      { fileId: initial.id, beforePath: relative, afterPath: relative },
    ]);
    const details = await runner.request('owner', directory, {
      type: 'review',
      requestId,
      fileId: initial.id,
    });
    expect(details).toMatchObject({
      before: [{ path: relative, file: initial }],
      after: [
        {
          path: relative,
          file: { text: { plainText: 'Reviewed Codex change' } },
        },
      ],
    });
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual(initial);
    const apply = {
      type: 'apply' as const,
      requestId,
      transactionId: state.transactionId,
    };
    expect(await runner.request('another-page', directory, apply)).toEqual({
      state: 'missing',
    });
    expect(await runner.request('owner', directory, apply)).toMatchObject({
      state: 'applied',
    });
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toMatchObject({
      text: { plainText: 'Reviewed Codex change' },
    });
  } finally {
    await runner.close();
  }
});

it('resolves empty and renamed folders for handoff without creating an identity', async () => {
  const { directory, runner } = await openFixture();
  const empty = path.join(directory, '空 文件夹');
  await fs.mkdir(empty);
  const handoff = (
    target: import('@sue/verd-board-workspace').LocalAgentTarget,
  ) =>
    runner.request('owner', directory, {
      type: 'handoff',
      task: { task: 'Focus here', target },
    });
  try {
    expect(await handoff({ kind: 'folder', path: '空 文件夹' })).toMatchObject({
      prompt: expect.stringContaining('"path": "空 文件夹"'),
      url: expect.stringContaining('codex://threads/new?'),
    });
    expect(await fs.readdir(empty)).toEqual([]);
    const folderId = randomUUID();
    const marker = folderIdentityWrite('空 文件夹', folderId);
    await fs.writeFile(path.join(directory, marker.path), marker.content);
    await fs.rename(empty, path.join(directory, 'Renamed folder'));
    const result = await handoff({
      kind: 'folder',
      path: '空 文件夹',
      folderId,
    });
    expect(result).toMatchObject({
      prompt: expect.stringContaining('"path": "Renamed folder"'),
      url: expect.stringContaining('codex://threads/new?'),
    });
    if (!('url' in result) || !result.url)
      throw new Error('Missing launch URL');
    expect(new URL(result.url).searchParams.get('path')).toBe(
      await fs.realpath(directory),
    );
    expect(result.prompt).toContain('verd://folder/' + folderId);
    await expect(
      handoff({ kind: 'folder', path: '空 文件夹' }),
    ).rejects.toThrow('TARGET_UNAVAILABLE');
    await fs.rm(path.join(directory, 'Renamed folder'), { recursive: true });
    await expect(
      handoff({ kind: 'folder', path: '空 文件夹', folderId }),
    ).rejects.toThrow('TARGET_UNAVAILABLE');
  } finally {
    await runner.close();
  }
});

it('accepts visible ordinary files and rejects hidden, excluded or linked targets', async () => {
  const { directory, runner } = await openFixture();
  const handoff = (kind: 'folder' | 'resource', path: string) =>
    runner.request('owner', directory, {
      type: 'handoff',
      task: { task: 'Inspect', target: { kind, path } },
    });
  const excluded = path.join(directory, 'exclude');
  try {
    await fs.mkdir(excluded);
    await fs.writeFile(path.join(excluded, 'notes.txt'), 'Excluded');
    await fs.writeFile(
      path.join(directory, '.verd.config.json'),
      JSON.stringify({ workspace: '.', exclude: ['exclude'] }),
    );
    await fs.writeFile(path.join(directory, 'notes.txt'), 'Ordinary file');
    await fs.symlink(excluded, path.join(directory, 'link'), 'junction');
    expect(await handoff('resource', 'notes.txt')).toMatchObject({
      prompt: expect.stringContaining('"path": "notes.txt"'),
    });
    await expect(handoff('resource', 'exclude/notes.txt')).rejects.toThrow(
      'TARGET_UNAVAILABLE',
    );
    await expect(handoff('folder', 'exclude')).rejects.toThrow(
      'TARGET_UNAVAILABLE',
    );
    await expect(handoff('folder', 'link')).rejects.toThrow(
      'TARGET_UNAVAILABLE',
    );
    await expect(handoff('resource', 'link/notes.txt')).rejects.toThrow(
      'TARGET_UNAVAILABLE',
    );
    await expect(handoff('resource', 'AGENTS.md')).rejects.toThrow(
      'INVALID_TARGET',
    );
    await expect(handoff('resource', '/notes.txt')).rejects.toThrow(
      'INVALID_TARGET',
    );
    await expect(handoff('folder', '../outside')).rejects.toThrow(
      'INVALID_TARGET',
    );
  } finally {
    await runner.close();
  }
});

it.each([
  ['fixture-malformed-events', 'CODEX_INVALID_EVENTS'],
  ['fixture-invalid-result', 'CODEX_INVALID_RESULT'],
  ['fixture-invalid-operations', 'CODEX_INVALID_OPERATIONS'],
  ['fixture-auth', 'CODEX_AUTH_REQUIRED'],
  ['fixture-failed', 'CODEX_FAILED'],
])('reports %s without a prepared plan', async (task, message) => {
  const { directory, runner } = await openFixture();
  const requestId = randomUUID();
  try {
    await runner.request('owner', directory, {
      type: 'start',
      requestId,
      task: { task },
    });
    await expect
      .poll(() =>
        runner.request('owner', directory, { type: 'status', requestId }),
      )
      .toMatchObject({ state: 'failed', message });
    await expect(
      runner.request('owner', directory, {
        type: 'review',
        requestId,
        fileId: 'proposal',
      }),
    ).rejects.toThrow('REVIEW_UNAVAILABLE');
  } finally {
    await runner.close();
  }
});

it('terminates the process when the quick task reaches its deadline', async () => {
  const { directory, runner } = await openFixture();
  const requestId = randomUUID();
  const schedule = globalThis.setTimeout;
  const timer = vi
    .spyOn(globalThis, 'setTimeout')
    .mockImplementation((run, delay, ...args) =>
      schedule(run, delay === 300_000 ? 200 : delay, ...args),
    );
  try {
    await runner.request('owner', directory, {
      type: 'start',
      requestId,
      task: { task: 'fixture-cancel' },
    });
    await expect
      .poll(() =>
        runner.request('owner', directory, { type: 'status', requestId }),
      )
      .toMatchObject({ state: 'failed', message: 'CODEX_TIMEOUT' });
  } finally {
    timer.mockRestore();
    await runner.close();
  }
});

it('waits for window-level process cleanup before shutting down the host', async () => {
  const { directory, runner } = await openFixture();
  const pidFile = path.join(directory, '.verdscrolls/codex-fixture.pid');
  try {
    await runner.request('window', directory, {
      type: 'start',
      requestId: randomUUID(),
      task: { task: 'fixture-cancel' },
    });
    await expect
      .poll(() => fs.readFile(pidFile, 'utf8').catch(() => ''))
      .toMatch(/^\d+$/);
    let released = false;
    const releasing = runner.release('window').then(() => {
      released = true;
    });
    await runner.close();
    const closedAfterRelease = released;
    await releasing;
    expect(closedAfterRelease).toBe(true);
  } finally {
    await runner.close();
  }
});

it('uses the exact work directory and prompt in an encoded Codex draft', () => {
  const directory = '/项目/Space & ?';
  const prompt = '解释这个文档 & 草稿 #1';
  const url = new URL(codexHandoffUrl(directory, prompt)!);
  expect(url.protocol + '//' + url.hostname + url.pathname).toBe(
    'codex://threads/new',
  );
  expect(url.searchParams.get('path')).toBe(directory);
  expect(url.searchParams.get('prompt')).toBe(prompt);
  expect(codexHandoffUrl(directory, '文'.repeat(9000))).toBeUndefined();
});

it('keeps one active task per physical workspace across directory aliases', async () => {
  const { directory, runner } = await openFixture();
  const linkDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'verd-alias-'));
  const alias = path.join(linkDirectory, 'workspace');
  const requestId = randomUUID();
  const start = {
    type: 'start' as const,
    requestId,
    task: { task: 'fixture-cancel' },
  };
  try {
    await fs.symlink(directory, alias, 'junction');
    expect(await runner.request('first', alias, start)).toEqual({
      state: 'running',
    });
    await expect(
      runner.request('second', directory, {
        ...start,
        requestId: randomUUID(),
      }),
    ).rejects.toThrow('WORKSPACE_AGENT_BUSY');
    expect(
      await runner.request('first', directory, { type: 'cancel', requestId }),
    ).toEqual({ state: 'cancelled' });
  } finally {
    await runner.close();
    await fs.rm(linkDirectory, { recursive: true, force: true });
  }
});

it('deduplicates tasks within the originating lease', async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'verd-codex-scope-'));
  const runner = createLocalCodexRunner({
    executable: () => path.join(root!, 'missing'),
  });
  const requestId = randomUUID();
  const task = { task: 'Read the project' };
  try {
    const start = { type: 'start' as const, requestId, task };
    const status = { type: 'status' as const, requestId };
    expect(await runner.request('first', root, start)).toEqual({
      state: 'running',
    });
    const releasing = runner.release('first');
    await expect(runner.request('second', root, start)).rejects.toThrow(
      'WORKSPACE_AGENT_BUSY',
    );
    await releasing;
    expect(await runner.request('first', root, start)).toEqual({
      state: 'running',
    });
    expect(
      await runner.request('second', root, { type: 'cancel', requestId }),
    ).toEqual({ state: 'missing' });
    await expect(
      runner.request('first', root, { ...start, task: { task: 'Other task' } }),
    ).rejects.toThrow('DUPLICATE_REQUEST');
    await expect
      .poll(() => runner.request('first', root!, status))
      .toMatchObject({ state: 'failed', message: 'CODEX_NOT_FOUND' });
    expect(await runner.request('first', root, start)).toMatchObject({
      state: 'failed',
      message: 'CODEX_NOT_FOUND',
    });
    await runner.release('first');
    expect(await runner.request('first', root, status)).toEqual({
      state: 'missing',
    });
  } finally {
    await runner.close();
  }
});
