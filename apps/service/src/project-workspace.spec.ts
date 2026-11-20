import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import {
  createProjectWorkspaceService,
  createFsWorkspaceHost,
  discoverWorkspace,
  readWorkspaceProjectContext,
} from '@sue/verd-board-agent/node';
import {
  createDocumentFile,
  openWorkspaceSession,
} from '@sue/verd-board-app/headless';
import { createServiceWorkspaceHost } from '../../../packages/product/app/src/host/service-workspace-host';

vi.setConfig({ testTimeout: 20_000 });
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});

class TestEventSource {
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onerror?: () => void;
  controller = new AbortController();
  constructor(url: string) {
    void (async () => {
      const response = await fetch(url, { signal: this.controller.signal });
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

async function fixture() {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'verd-project-sdk-')),
  );
  cleanup.push(() => fs.rm(root, { recursive: true, force: true }));
  const projectRoot = path.join(root, 'project');
  const workspaceRoot = path.join(projectRoot, 'docs');
  await fs.mkdir(path.join(workspaceRoot, 'empty'), { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, '.verd.config.json'),
    JSON.stringify({ workspace: 'docs' }),
  );
  await fs.writeFile(
    path.join(projectRoot, 'AGENTS.md'),
    'Project rules remain unchanged.',
  );
  await fs.writeFile(
    path.join(workspaceRoot, 'AGENTS.md'),
    'Documentation rules remain unchanged.',
  );
  await fs.writeFile(
    path.join(workspaceRoot, 'note.verd-doc.json'),
    JSON.stringify(createDocumentFile('note', 'First')),
  );
  await fs.writeFile(
    path.join(workspaceRoot, 'README.md'),
    '# Existing Markdown',
  );
  await fs.writeFile(
    path.join(workspaceRoot, 'attachment.bin'),
    new Uint8Array([0, 255, 64]),
  );
  const service = await createProjectWorkspaceService({
    projectRoot,
    dataRoot: path.join(root, 'web-data'),
    apiPath: '/documentation/api/v1',
    openPath: async () => {},
  });
  const server = createServer((req, res) => {
    void service.handleRequest(req, res).then((handled) => {
      if (!handled) res.end('Project application');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  cleanup.push(async () => {
    await service.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const host = createServiceWorkspaceHost({
    baseUrl: `http://127.0.0.1:${port}/documentation/api/v1`,
    fixedWorkspace: true,
    eventSource: (url) => new TestEventSource(url) as unknown as EventSource,
  });
  cleanup.push(async () => host.dispose());
  const handle = (await host.openWorkspace())!;
  cleanup.push(() => host.closeWorkspace(handle));
  const desktop = createFsWorkspaceHost({
    defaultRoot: () => workspaceRoot,
    globalConfigPath: () => path.join(root, 'desktop-data/config.json'),
    sessionNamespace: 'desktop',
  });
  const desktopHandle = (await desktop.openWorkspace({
    path: workspaceRoot,
    create: false,
  }))!;
  cleanup.push(() => desktop.closeWorkspace(desktopHandle));
  return {
    root,
    projectRoot,
    workspaceRoot,
    service,
    server,
    port,
    host,
    handle,
    desktop,
    desktopHandle,
  };
}

describe('Project SDK on an existing Node server', () => {
  it('rejects nonlocal peers even when an enclosing server accepts a forged localhost Host header', async () => {
    const f = await fixture();
    const socket = new Socket();
    Object.defineProperties(socket, {
      remoteAddress: { value: '203.0.113.10' },
      localPort: { value: 3000 },
    });
    const request = new IncomingMessage(socket);
    request.url = '/documentation/api/v1/health';
    request.headers.host = '127.0.0.1:3000';
    const response = new ServerResponse(request);
    expect(await f.service.handleRequest(request, response)).toBe(true);
    expect(response.statusCode).toBe(403);
    expect(response.writableEnded).toBe(true);
    socket.destroy();
  });
  it('defers large ordinary files and obtains content versions when moving or trashing them', async () => {
    const f = await fixture();
    const large = new Uint8Array(9 * 1024 * 1024);
    large[large.length - 1] = 255;
    await fs.writeFile(path.join(f.workspaceRoot, 'large.bin'), large);
    const listing = (await f.host.readSnapshot(f.handle)).entries.find(
      (entry) => entry.path === 'large.bin',
    )!;
    expect(listing.version).toBeUndefined();
    expect(listing.metadataRevision).toBeTruthy();
    const session = await openWorkspaceSession(f.host, f.handle, {
      delayMs: 60_000,
    });
    cleanup.push(async () => session.dispose());
    expect(
      (
        await session.apply({
          type: 'organize-entries',
          moves: [{ from: 'large.bin', to: 'empty/large.bin' }],
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await session.apply({
          type: 'organize-entries',
          trashPaths: ['empty/large.bin'],
        })
      ).ok,
    ).toBe(true);
    const entryId = session.getState().trash[0].entryId;
    expect((await session.apply({ type: 'restore-file', entryId })).ok).toBe(
      true,
    );
    expect(
      (await f.host.readFile(f.handle, 'empty/large.bin')).content,
    ).toEqual(large);
  });
  it('opens the same directory as Desktop, retains every user file and discovers project context without changing instructions', async () => {
    const f = await fixture();
    expect(
      await (await fetch(`http://127.0.0.1:${f.port}/project`)).text(),
    ).toBe('Project application');
    const web = await f.host.readSnapshot(f.handle);
    const desktop = await f.desktop.readSnapshot(f.desktopHandle);
    expect(web.config.value.identity).toBe(desktop.config.value.identity);
    expect(web.context).toMatchObject({
      projectRoot: f.projectRoot,
      workspaceRoot: f.workspaceRoot,
      workspacePath: 'docs',
    });
    expect(web.entries.map((entry) => entry.path)).toEqual(
      expect.arrayContaining([
        'empty',
        'README.md',
        'attachment.bin',
        'note.verd-doc.json',
        'AGENTS.md',
      ]),
    );
    expect(
      await fs.readFile(path.join(f.projectRoot, 'AGENTS.md'), 'utf8'),
    ).toBe('Project rules remain unchanged.');
    expect(
      await fs.readFile(path.join(f.workspaceRoot, 'AGENTS.md'), 'utf8'),
    ).toBe('Documentation rules remain unchanged.');
    expect(web.agent?.enabled).toBe(false);
    expect(await discoverWorkspace(f.projectRoot)).toBe(f.workspaceRoot);
    expect(await readWorkspaceProjectContext(f.workspaceRoot)).toMatchObject({
      root: f.workspaceRoot,
      workspaceRoot: f.workspaceRoot,
      projectRoot: f.projectRoot,
    });
    await f.host.initializeAgent!(f.handle);
    expect(
      await fs.readFile(path.join(f.workspaceRoot, 'AGENTS.md'), 'utf8'),
    ).toContain('verdscrolls:agent:start');
    expect(
      await fs.readFile(path.join(f.projectRoot, 'AGENTS.md'), 'utf8'),
    ).toBe('Project rules remain unchanged.');
    expect(
      await fs.lstat(path.join(f.workspaceRoot, '.git')).catch(() => null),
    ).toBeNull();
  });
  it('keeps Web and Desktop UI sessions separate while sharing binary files and their lifecycle', async () => {
    const f = await fixture();
    const session = (expandedDirs: string[]) => ({
      tabs: [],
      activeTabId: null,
      expandedDirs,
    });
    await f.host.commit(f.handle, {
      transactionId: 'web-session',
      session: session(['web']),
    });
    await f.desktop.commit(f.desktopHandle, {
      transactionId: 'desktop-session',
      session: session(['desktop']),
    });
    expect((await f.host.readSnapshot(f.handle)).session?.expandedDirs).toEqual(
      ['web'],
    );
    expect(
      (await f.desktop.readSnapshot(f.desktopHandle)).session?.expandedDirs,
    ).toEqual(['desktop']);
    const raw = await f.host.readFile(f.handle, 'attachment.bin');
    const move = await f.host.commit(f.handle, {
      transactionId: 'move-attachment',
      moves: [
        {
          from: 'attachment.bin',
          to: 'empty/moved.bin',
          expectedVersion: raw.version,
        },
      ],
    });
    expect(move.outcome).toBe('applied');
    expect(
      (await f.desktop.readFile(f.desktopHandle, 'empty/moved.bin')).content,
    ).toEqual(new Uint8Array([0, 255, 64]));
    const removed = await f.desktop.commit(f.desktopHandle, {
      transactionId: 'trash-attachment',
      trash: [{ path: 'empty/moved.bin', expectedVersion: raw.version }],
    });
    const entryId = removed.trashEntries![0].entryId;
    expect(
      (await f.host.readSnapshot(f.handle)).trash.some(
        (entry) => entry.entryId === entryId,
      ),
    ).toBe(true);
    expect(
      (
        await f.host.commit(f.handle, {
          transactionId: 'restore-attachment',
          restore: [{ entryId }],
        })
      ).outcome,
    ).toBe('applied');
    expect(
      (await f.host.readFile(f.handle, 'empty/moved.bin')).content,
    ).toEqual(raw.content);
  });
  it('accepts external edits through SSE and preserves conflicting unsaved Web content', async () => {
    const f = await fixture();
    const web = await openWorkspaceSession(f.host, f.handle, {
      delayMs: 60_000,
    });
    cleanup.push(async () => web.dispose());
    const initial = web.getState().documents.get('note')!;
    await fs.writeFile(
      path.join(f.workspaceRoot, initial.path),
      JSON.stringify({ ...initial.file, title: 'External' }),
    );
    await expect
      .poll(() => web.getState().documents.get('note')?.file.title)
      .toBe('External');
    const latest = web.getState().documents.get('note')!;
    await web.apply({
      type: 'file',
      file: { ...latest.file, title: 'Local draft' },
    });
    const raw = await f.desktop.readFile(f.desktopHandle, latest.path);
    await f.desktop.commit(f.desktopHandle, {
      transactionId: 'desktop-conflict',
      writes: [
        {
          path: latest.path,
          content: JSON.stringify({ ...latest.file, title: 'Desktop' }),
          expectedVersion: raw.version,
        },
      ],
    });
    expect(await web.flush()).toBe(false);
    expect(web.getState().documents.get('note')?.conflicted).toBe(true);
    expect(web.getState().documents.get('note')?.file.title).toBe(
      'Local draft',
    );
    expect(await web.flush()).toBe(false);
    expect(
      JSON.parse(
        await fs.readFile(path.join(f.workspaceRoot, latest.path), 'utf8'),
      ).title,
    ).toBe('Desktop');
  });
  it('rejects browser directory switching, traversal and links outside the configured content directory', async () => {
    const f = await fixture();
    await fs.writeFile(path.join(f.projectRoot, 'code.txt'), 'Project source');
    expect(f.host.capabilities?.pickWorkspace).toBe(false);
    await expect(f.host.openWorkspace({ path: f.projectRoot })).rejects.toThrow(
      'fixed',
    );
    await expect(f.host.openWorkspace({ patterns: true })).rejects.toThrow(
      'fixed',
    );
    const rejected = await f.host.commit(f.handle, {
      transactionId: 'escape',
      writes: [
        { path: '../code.txt', content: 'Wrong', expectedVersion: null },
      ],
    });
    expect(rejected.outcome).toBe('rejected');
    await fs.symlink(
      path.join(f.projectRoot, 'code.txt'),
      path.join(f.workspaceRoot, 'linked.txt'),
    );
    await expect(f.host.readFile(f.handle, 'linked.txt')).rejects.toThrow(
      'Missing file',
    );
    expect(
      await fs.readFile(path.join(f.projectRoot, 'code.txt'), 'utf8'),
    ).toBe('Project source');
    await expect(
      createProjectWorkspaceService({
        projectRoot: f.projectRoot,
        workspacePath: '../',
      }),
    ).rejects.toThrow('relative directory');
  });
});
