import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createLocalService } from './service';
import {
  createServiceWorkspaceHost,
  type ServiceHostOptions,
} from '../../../packages/product/app/src/host/service-workspace-host';
import { describeWorkspaceHostContract } from '../../../packages/product/app/src/host/workspace-host.contract';
import { encodeServiceValue } from '../../../packages/product/app/src/host/service-protocol';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});
class TestEventSource {
  ready: Promise<void>;
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onerror?: () => void;
  controller = new AbortController();
  constructor(url: string) {
    let opened!: () => void;
    this.ready = new Promise((resolve) => {
      opened = resolve;
    });
    void (async () => {
      const response = await fetch(url, { signal: this.controller.signal });
      opened();
      this.onopen?.();
      let pending = '';
      const decoder = new TextDecoder();
      for await (const chunk of response.body!) {
        pending += decoder.decode(chunk, { stream: true });
        let at: number;
        while ((at = pending.indexOf('\n\n')) >= 0) {
          const message = pending.slice(0, at);
          pending = pending.slice(at + 2);
          if (message.startsWith('data: '))
            this.onmessage?.({ data: message.slice(6) });
        }
      }
    })().catch(() => this.onerror?.());
  }
  close() {
    this.controller.abort();
  }
}
async function context() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'verd-service-test-'));
  const options = {
    dataRoot: path.join(root, 'data'),
    workspaceBoundary: root,
    defaultRoot: path.join(root, 'workspace'),
    builtinSource: path.resolve('../../workspace'),
    patternSource: path.resolve('../../packages/agent/patterns/workspace'),
    productVersion: '2.0.1',
    openPath: async () => {},
  };
  await fs.mkdir(options.defaultRoot, { recursive: true });
  let service = await createLocalService(options);
  let closing: Promise<void> | undefined;
  const close = () => (closing ??= service.close());
  const port = await service.listen(0);
  const streams: TestEventSource[] = [];
  const makeHost = (pickDirectory?: ServiceHostOptions['pickDirectory']) => {
    const host = createServiceWorkspaceHost({
      baseUrl: `http://127.0.0.1:${port}/api/v1`,
      pickDirectory,
      eventSource: (url) => {
        const stream = new TestEventSource(url);
        streams.push(stream);
        return stream as unknown as EventSource;
      },
    });
    cleanup.push(async () => host.dispose());
    return host;
  };
  cleanup.push(async () => {
    await close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const host = makeHost();
  return {
    root,
    service,
    host,
    makeHost,
    port,
    options,
    streams,
    close,
    open: async () =>
      (await host.openWorkspace({ path: options.defaultRoot }))!,
    restart: async () => {
      await close();
      service = await createLocalService(options);
      closing = undefined;
      await service.listen(port);
    },
  };
}

describeWorkspaceHostContract('HTTP filesystem host', context);

describe('local service lifecycle and security', () => {
  it('drains accepted writes before exit and releases the exclusive data-directory lock', async () => {
    const ctx = await context();
    const handle = await ctx.open();
    await expect(createLocalService(ctx.options)).rejects.toThrow(
      '已有运行中的 service',
    );
    let entered!: () => void;
    let release!: () => void;
    const accepted = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const commit = ctx.service.host.commit.bind(ctx.service.host);
    vi.spyOn(ctx.service.host, 'commit').mockImplementation(
      async (h, request) => {
        entered();
        await gate;
        return commit(h, request);
      },
    );
    const write = ctx.host.commit(handle, {
      transactionId: 'shutdown-write',
      writes: [
        {
          path: 'drained.txt',
          content: 'accepted before shutdown',
          expectedVersion: null,
        },
      ],
    });
    await accepted;
    let exited = false;
    const shutdown = ctx.close().then(() => {
      exited = true;
    });
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(exited).toBe(false);
      release();
      expect((await write).outcome).toBe('applied');
      await shutdown;
      expect(
        await fs.readFile(
          path.join(ctx.options.defaultRoot, 'drained.txt'),
          'utf8',
        ),
      ).toBe('accepted before shutdown');
      await expect(
        fs.access(path.join(ctx.options.dataRoot, '.service-lock')),
      ).rejects.toThrow();
    } finally {
      release();
      await shutdown;
    }
  });
  it('updates managed workspaces, keeps peer handles alive and uses each chosen backup directory', async () => {
    const ctx = await context();
    let selection: string | null = null;
    const purposes: string[] = [];
    const updatingHost = ctx.makeHost(async (purpose) => {
      purposes.push(purpose);
      return selection;
    });
    const managed = (await updatingHost.openWorkspace({ default: true }))!;
    const location = await updatingHost.readWorkspaceLocation!(managed);
    const peer = (await ctx.host.openWorkspace({ path: location }))!;
    const identity = (await ctx.host.readSnapshot(peer)).config.value.identity;
    await updatingHost.commit(managed, {
      transactionId: 'added-before-update',
      writes: [
        {
          path: 'added.verd.json',
          content: 'invalid native file retained in backup',
          expectedVersion: null,
        },
      ],
    });
    const release = (await updatingHost.readBuiltinUpdate!(managed))!;
    expect(
      await updatingHost.updateBuiltinWorkspace!(managed, release.releaseId, {
        backup: true,
      }),
    ).toBeNull();
    expect(
      (await ctx.host.readSnapshot(peer)).entries.some(
        (entry) => entry.path === 'added.verd.json',
      ),
    ).toBe(true);
    selection = path.join(ctx.root, 'chosen-backups');
    await fs.mkdir(selection);
    const replacement = await updatingHost.updateBuiltinWorkspace!(
      managed,
      release.releaseId,
      { backup: true },
    );
    expect(replacement).not.toBeNull();
    expect(replacement!.key).not.toBe(managed.key);
    const snapshot = await ctx.host.readSnapshot(peer);
    expect(snapshot.config.value.identity).toBe(identity);
    expect(
      snapshot.entries.some((entry) => entry.path === 'added.verd.json'),
    ).toBe(false);
    const backup = path.join(selection, (await fs.readdir(selection))[0]);
    expect(
      await fs.readFile(path.join(backup, 'added.verd.json'), 'utf8'),
    ).toBe('invalid native file retained in backup');
    expect(await ctx.host.listWorkspaceHistory!()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: expect.any(String) }),
      ]),
    );
    await updatingHost.closeWorkspace(managed);
    expect(
      (await updatingHost.readSnapshot(replacement!)).config.value.identity,
    ).toBe(identity);
    expect((await ctx.host.readSnapshot(peer)).entries.length).toBeGreaterThan(
      0,
    );
    const patterns = (await ctx.host.openWorkspace({ patterns: true }))!;
    expect((await ctx.host.readBuiltinUpdate!(patterns))?.kind).toBe(
      'agent-patterns',
    );
    expect(
      (await ctx.host.readSnapshot(patterns)).entries.length,
    ).toBeGreaterThan(0);
    expect(purposes).toEqual(['backup', 'backup']);
  });
  it('keeps another tab subscribed when one tab closes and reconnects after restart', async () => {
    const ctx = await context();
    const first = await ctx.open();
    const secondHost = ctx.makeHost();
    const second = (await secondHost.openWorkspace({
      path: ctx.options.defaultRoot,
    }))!;
    const hints: unknown[] = [];
    secondHost.subscribe(second, (hint) => hints.push(hint));
    await ctx.host.closeWorkspace(first);
    const request = {
      transactionId: 'survives-restart',
      writes: [
        {
          path: 'note.txt',
          content: new Uint8Array([0, 255, 64]),
          expectedVersion: null,
        },
      ],
    };
    expect((await secondHost.commit(second, request)).outcome).toBe('applied');
    await expect.poll(() => hints.length).toBeGreaterThan(0);
    await ctx.restart();
    const [replayed, config, snapshot] = await Promise.all([
      secondHost.commit(second, request),
      secondHost.readGlobalConfig(),
      secondHost.readSnapshot(second),
    ]);
    expect(replayed.outcome).toBe('applied');
    expect(config.version).toBeGreaterThanOrEqual(0);
    expect(snapshot.entries.some((entry) => entry.path === 'note.txt')).toBe(
      true,
    );
    expect((await secondHost.readFile(second, 'note.txt')).content).toEqual(
      new Uint8Array([0, 255, 64]),
    );
    await secondHost.closeWorkspace(second);
  });
  it('rejects cross-origin requests, foreign handles, and non-whitelisted methods', async () => {
    const ctx = await context();
    const handle = await ctx.open();
    const origin = `http://127.0.0.1:${ctx.port}`;
    const untrusted = await fetch(`${origin}/api/v1/session`, {
      method: 'POST',
      headers: {
        Origin: 'https://attacker.invalid',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ pageId: crypto.randomUUID() }),
    });
    expect(untrusted.status).toBe(403);
    const other = ctx.makeHost();
    await expect(other.readSnapshot(handle)).rejects.toThrow(
      'Workspace unavailable',
    );
    const response = await fetch(`${origin}/api/v1/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageId: crypto.randomUUID() }),
    });
    const { token } = (await response.json()) as { token: string };
    const foreign = await ctx.host.serviceCall('openWorkspace', [
      { path: ctx.options.defaultRoot },
    ]);
    const unauthorized = await fetch(`${origin}/api/v1/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Verd-Session': token },
      body: JSON.stringify(
        encodeServiceValue({ method: 'readSnapshot', args: [foreign] }),
      ),
    });
    expect(await unauthorized.text()).toContain('Unknown workspace handle');
    const rpc = await fetch(`${origin}/api/v1/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Verd-Session': token },
      body: JSON.stringify(
        encodeServiceValue({ method: 'constructor', args: [] }),
      ),
    });
    expect(await rpc.text()).toContain('Unknown service method');
  });
  it('delivers external filesystem changes over SSE and rejects stale writes', async () => {
    const ctx = await context();
    const handle = await ctx.open();
    await ctx.host.commit(handle, {
      transactionId: 'before-external',
      writes: [
        { path: 'external.txt', content: 'before', expectedVersion: null },
      ],
    });
    const before = await ctx.host.readFile(handle, 'external.txt');
    const hints: { paths?: string[] }[] = [];
    ctx.host.subscribe(handle, (hint) => hints.push(hint));
    await ctx.streams[0].ready;
    hints.length = 0;
    await fs.writeFile(
      path.join(ctx.options.defaultRoot, 'external.txt'),
      'external',
    );
    await expect
      .poll(() => hints.some((hint) => hint.paths?.includes('external.txt')))
      .toBe(true);
    const stale = await ctx.host.commit(handle, {
      transactionId: 'stale-external',
      writes: [
        {
          path: 'external.txt',
          content: 'local',
          expectedVersion: before.version,
        },
      ],
    });
    expect(stale).toMatchObject({
      outcome: 'rejected',
      reason: 'version-conflict',
    });
    expect(
      new TextDecoder().decode(
        (await ctx.host.readFile(handle, 'external.txt')).content,
      ),
    ).toBe('external');
  });
  it('synchronizes with a real local Git remote through HTTP', async () => {
    const ctx = await context();
    const handle = await ctx.open();
    const command = promisify(execFile);
    const remote = path.join(ctx.root, 'remote.git');
    await command('git', ['init', '--bare', '--initial-branch=main', remote]);
    await ctx.host.commit(handle, {
      transactionId: 'remote-content',
      writes: [{ path: 'note.txt', content: 'local', expectedVersion: null }],
    });
    await ctx.host.git!(handle, {
      type: 'init',
      author: { name: 'Service test', email: 'service@example.invalid' },
    });
    await ctx.host.git!(handle, {
      type: 'commit',
      message: 'Local',
      expectedToken: (await ctx.host.git!(handle, { type: 'status' })).status
        .token,
    });
    await ctx.host.git!(handle, { type: 'configure', remoteUrl: remote });
    await ctx.host.git!(handle, {
      type: 'sync',
      expectedToken: (await ctx.host.git!(handle, { type: 'status' })).status
        .token,
    });
    const clone = path.join(ctx.root, 'clone');
    await command('git', ['clone', remote, clone]);
    await command('git', ['-C', clone, 'config', 'user.name', 'Peer']);
    await command('git', [
      '-C',
      clone,
      'config',
      'user.email',
      'peer@example.invalid',
    ]);
    await fs.writeFile(path.join(clone, 'note.txt'), 'from remote');
    await command('git', ['-C', clone, 'add', 'note.txt']);
    await command('git', ['-C', clone, 'commit', '-m', 'Peer']);
    await command('git', ['-C', clone, 'push']);
    const synced = await ctx.host.git!(handle, {
      type: 'sync',
      expectedToken: (await ctx.host.git!(handle, { type: 'status' })).status
        .token,
    });
    expect(synced.status.changes).toEqual([]);
    expect(
      new TextDecoder().decode(
        (await ctx.host.readFile(handle, 'note.txt')).content,
      ),
    ).toBe('from remote');
  });
  it('rejects opening or importing outside an explicitly scoped workspace boundary', async () => {
    const ctx = await context();
    await expect(
      ctx.host.openWorkspace({ path: os.homedir() }),
    ).rejects.toThrow('workspace boundary');
    await expect(
      ctx.host.serviceCall('browseDirectories', [os.homedir()]),
    ).rejects.toThrow('workspace boundary');
    expect((await ctx.host.serviceCall('browseDirectories', [])).path).toBe(
      await fs.realpath(ctx.root),
    );
  });
  it('browses and creates local directories without permitting path injection', async () => {
    const ctx = await context();
    const listed = await ctx.host.serviceCall('makeDirectory', [
      ctx.root,
      '中文目录',
    ]);
    expect(listed.path).toBe(
      await fs.realpath(path.join(ctx.root, '中文目录')),
    );
    await expect(
      ctx.host.serviceCall('makeDirectory', [ctx.root, '../escape']),
    ).rejects.toThrow();
    expect(
      (await ctx.host.serviceCall('browseDirectories', [ctx.root])).directories,
    ).toContain('中文目录');
  });
});
