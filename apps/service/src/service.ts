import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  createFsWorkspaceHost,
  createLocalWorkspaceManager,
  createBuiltinWorkspaceUpdater,
  initializePatternWorkspace,
} from '@sue/verd-board-agent/node';
import {
  normalizeWorkspacePath,
  type WorkspaceHandle,
} from '@sue/verd-board-app/headless';
import {
  decodeServiceValue,
  encodeServiceValue,
  type ServiceHostApi,
  type ServiceError,
  type ServiceValue,
} from '../../../packages/product/app/src/host/service-protocol';
import { importBrowserBackup } from './migration';

export interface LocalServiceOptions {
  dataRoot: string;
  defaultRoot?: string;
  seedDefault?: boolean;
  builtinSource: string;
  patternSource: string;
  productVersion: string;
  sharedResources?: () => string | Promise<string>;
  webRoot?: string;
  allowedOrigins?: string[];
  leaseMs?: number;
  /** Optional filesystem boundary, used by isolated test and embedded hosts. */
  workspaceBoundary?: string;
  openPath?: (location: string) => Promise<void>;
}

type Lease = { actual: WorkspaceHandle; unsubscribe: () => void };
type Client = {
  token: string;
  pageId: string;
  handles: Map<string, Lease>;
  streams: Set<ServerResponse>;
  expiry?: ReturnType<typeof setTimeout>;
};
const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.pdf': 'application/pdf',
  '.bcmap': 'application/octet-stream',
  '.ttf': 'font/ttf',
};
const errorValue = (error: unknown): ServiceError => ({
  message: error instanceof Error ? error.message : String(error),
  ...(error && typeof error === 'object' && 'code' in error
    ? { code: String(error.code) }
    : {}),
  ...(error && typeof error === 'object' && 'diagnostic' in error
    ? { diagnostic: String(error.diagnostic) }
    : {}),
});
const systemOpen = (location: string) =>
  new Promise<void>((resolve, reject) => {
    const command =
      process.platform === 'darwin'
        ? 'open'
        : process.platform === 'win32'
          ? 'explorer.exe'
          : 'xdg-open';
    execFile(command, [location], (error) =>
      error ? reject(error) : resolve(),
    );
  });

export async function createLocalService(options: LocalServiceOptions) {
  await fs.mkdir(options.dataRoot, { recursive: true });
  const lock = path.join(options.dataRoot, '.service-lock');
  try {
    await fs.writeFile(lock, String(process.pid), { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const pid = Number(await fs.readFile(lock, 'utf8'));
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ESRCH') alive = false;
    }
    if (alive) throw new Error('该 Web 数据目录已有运行中的 service');
    await fs.unlink(lock);
    await fs.writeFile(lock, String(process.pid), { flag: 'wx' });
  }
  const defaultRoot = () =>
    path.join(options.dataRoot, 'workspaces', 'default');
  const host = createFsWorkspaceHost({
    defaultRoot,
    globalConfigPath: () =>
      path.join(options.dataRoot, 'verdboard-global-config.json'),
    sharedResources: options.sharedResources,
  });
  const manager = createLocalWorkspaceManager({
    host,
    defaultRoot,
    builtinSource: () => options.builtinSource,
    appVersion: () => options.productVersion,
    explicitRoot: options.defaultRoot,
    seedDefault: options.seedDefault,
    pickDirectory: async () => null,
  });
  const updater = createBuiltinWorkspaceUpdater({
    host,
    userData: () => options.dataRoot,
    source: (kind) =>
      kind === 'project' ? options.builtinSource : options.patternSource,
    appVersion: () => options.productVersion,
    registerBackup: (root) => manager.rememberBackup(root),
  });
  const clients = new Map<string, Client>();
  const refs = new Map<string, number>();
  const pending = new Set<Promise<unknown>>();
  const openPath = options.openPath ?? systemOpen;
  let stopping = false;
  const emit = (client: Client, message: unknown) => {
    for (const stream of client.streams)
      stream.write(`data: ${JSON.stringify(message)}\n\n`);
  };
  const touch = (client: Client) => {
    clearTimeout(client.expiry);
    if (!client.streams.size)
      client.expiry = setTimeout(() => {
        const task = releaseClient(client);
        pending.add(task);
        void task.finally(() => pending.delete(task));
      }, options.leaseMs ?? 120000).unref();
  };
  async function release(client: Client, key: string) {
    const lease = client.handles.get(key);
    if (!lease) return;
    client.handles.delete(key);
    lease.unsubscribe();
    const count = (refs.get(lease.actual.key) ?? 1) - 1;
    if (count > 0) refs.set(lease.actual.key, count);
    else {
      refs.delete(lease.actual.key);
      await host.closeWorkspace(lease.actual);
    }
  }
  async function releaseClient(client: Client) {
    clearTimeout(client.expiry);
    clients.delete(client.token);
    for (const key of [...client.handles.keys()]) await release(client, key);
    for (const stream of client.streams) stream.end();
  }
  const attach = (client: Client, actual: WorkspaceHandle) => {
    const key = randomUUID();
    refs.set(actual.key, (refs.get(actual.key) ?? 0) + 1);
    client.handles.set(key, {
      actual,
      unsubscribe: host.subscribe(actual, (hint) =>
        emit(client, { key, hint }),
      ),
    });
    return { ...actual, key };
  };
  const rootFor = (handle: WorkspaceHandle) => {
    const workspace = host.workspaces.get(handle.key);
    if (!workspace) throw new Error('Workspace unavailable');
    return workspace.root;
  };
  async function checkedLocation(input: string) {
    const location = await fs.realpath(input);
    if (options.workspaceBoundary) {
      const boundary = await fs.realpath(options.workspaceBoundary);
      const relative = path.relative(boundary, location);
      if (
        relative === '..' ||
        relative.startsWith('..' + path.sep) ||
        path.isAbsolute(relative)
      )
        throw new Error('Location is outside this service workspace boundary');
    }
    return location;
  }
  async function browseDirectories(
    input = options.workspaceBoundary ?? os.homedir(),
  ) {
    const location = await checkedLocation(input);
    const entries = await fs.readdir(location, { withFileTypes: true });
    const directories = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
    const parent =
      options.workspaceBoundary &&
      location === (await fs.realpath(options.workspaceBoundary))
        ? location
        : path.dirname(location);
    return {
      path: location,
      parent: parent === location ? null : parent,
      directories,
    };
  }
  const methods: ServiceHostApi = {
    readGlobalConfig: () => host.readGlobalConfig(),
    writeGlobalConfig: (value, version) =>
      host.writeGlobalConfig(value, version),
    async openWorkspace(request) {
      await updater.recover();
      if (request?.pick) throw new Error('Choose a directory before opening');
      if (options.workspaceBoundary && request?.path)
        await checkedLocation(request.path);
      if (request?.patterns) {
        const result = await initializePatternWorkspace(
          path.join(options.dataRoot, 'workspaces', 'agent-patterns'),
          {
            preserveExisting: true,
            appVersion: options.productVersion,
            source: options.patternSource,
          },
        );
        return manager.open({ path: result.path, name: '文档编写推荐库' });
      }
      return manager.open(request);
    },
    activateWorkspace: (h) => manager.activate(h),
    listWorkspaceHistory: () => manager.listHistory(),
    updateWorkspaceHistory: (request) => manager.updateHistory(request),
    createWorkspace: async (request) => {
      await checkedLocation(request.parentPath);
      return manager.create(request);
    },
    readWorkspaceLocation: async (h) => rootFor(h),
    revealWorkspaceLocation: (h) => openPath(rootFor(h)),
    readBuiltinUpdate: (h) => updater.info(h),
    revealBuiltinBackups: async (h) => openPath(await updater.backups(h)),
    async updateBuiltinWorkspace(h, id, updateOptions) {
      if (updateOptions?.backup && !updateOptions.backupParent)
        throw new Error('Backup directory is required');
      if (updateOptions?.backupParent)
        await checkedLocation(updateOptions.backupParent);
      const next = await updater.update(h, id, {
        backupParent: updateOptions?.backup
          ? updateOptions.backupParent
          : undefined,
      });
      return manager.open({ path: rootFor(next) });
    },
    readSnapshot: (h) => host.readSnapshot(h),
    readFile: (h, relative) => host.readFile(h, relative),
    readResource: (h, key) => host.readResource(h, key),
    async openResourceExternal(h, relative) {
      const root = await fs.realpath(rootFor(h));
      const target = await fs.realpath(
        path.join(root, normalizeWorkspacePath(relative)),
      );
      const location = path.relative(root, target);
      if (
        !location ||
        location.startsWith('..' + path.sep) ||
        location === '..' ||
        path.isAbsolute(location) ||
        !(await fs.stat(target)).isFile()
      )
        throw new Error('Invalid resource path');
      normalizeWorkspacePath(location.split(path.sep).join('/'));
      await openPath(target);
    },
    commit: (h, request) => host.commit(h, request),
    resolveConflict: (h, request) => host.resolveConflict(h, request),
    closeWorkspace: (h) => host.closeWorkspace(h),
    versions: (h, request) => host.versions!(h, request),
    git: (h, request) => host.git!(h, request),
    browseDirectories,
    async makeDirectory(parent, name) {
      if (!name.trim() || name === '.' || name === '..' || /[/\\\0]/.test(name))
        throw new Error('Invalid directory name');
      const root = await checkedLocation(parent);
      await fs.mkdir(path.join(root, name));
      return browseDirectories(path.join(root, name));
    },
    importBrowserBackup: async (backup, parent) =>
      importBrowserBackup(
        backup,
        await checkedLocation(parent),
        options.dataRoot,
        manager,
        host,
      ),
  };
  const noHandle = new Set([
    'readGlobalConfig',
    'writeGlobalConfig',
    'openWorkspace',
    'createWorkspace',
    'listWorkspaceHistory',
    'updateWorkspaceHistory',
    'browseDirectories',
    'makeDirectory',
    'importBrowserBackup',
  ]);
  async function dispatch(
    client: Client,
    request: { method: string; args: unknown[] },
  ) {
    if (!Object.hasOwn(methods, request.method) || !Array.isArray(request.args))
      throw new Error('Unknown service method');
    const args = [...request.args];
    let wireKey: string | undefined;
    let original: WorkspaceHandle | undefined;
    if (!noHandle.has(request.method)) {
      wireKey = (args[0] as WorkspaceHandle)?.key;
      const lease = client.handles.get(wireKey!);
      if (!lease) throw new Error('Unknown workspace handle');
      original = lease.actual;
      args[0] = original;
      if (request.method === 'closeWorkspace') {
        await release(client, wireKey!);
        return;
      }
    }
    const method = methods[request.method as keyof ServiceHostApi] as (
      ...args: unknown[]
    ) => Promise<unknown>;
    const result = await method(...args);
    if (
      (request.method === 'openWorkspace' ||
        request.method === 'createWorkspace') &&
      result
    )
      return attach(client, result as WorkspaceHandle);
    if (request.method === 'updateBuiltinWorkspace' && result) {
      const next = result as WorkspaceHandle;
      // Replacement invalidates the previous fs key. Rebind every tab's lease.
      const count = refs.get(original!.key) ?? 0;
      refs.delete(original!.key);
      refs.set(next.key, (refs.get(next.key) ?? 0) + count);
      for (const peer of clients.values())
        for (const [key, lease] of peer.handles)
          if (lease.actual.key === original!.key) {
            lease.unsubscribe();
            lease.actual = next;
            lease.unsubscribe = host.subscribe(next, (hint) =>
              emit(peer, { key, hint }),
            );
            emit(peer, { key, hint: {} });
          }
      // The initiating page creates a new WorkspaceSession after replacement.
      // Give it a separate lease so closing its previous session cannot close
      // the replacement or another page's unchanged handle.
      return attach(client, next);
    }
    return result;
  }
  async function readBody(req: IncomingMessage) {
    if (!req.headers['content-type']?.startsWith('application/json'))
      throw new Error('JSON content type required');
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of req) {
      length += chunk.length;
      if (length > 512 * 1024 * 1024)
        throw new Error('Request exceeds 512 MiB');
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  function trusted(req: IncomingMessage) {
    const authority = new URL(`http://${req.headers.host}`);
    const address = server.address();
    if (
      !['localhost', '127.0.0.1', '[::1]'].includes(authority.hostname) ||
      !address ||
      typeof address === 'string' ||
      authority.port !== String(address.port)
    )
      return false;
    const origin = req.headers.origin;
    const allowed = [authority.origin, ...(options.allowedOrigins ?? [])];
    return (
      (!origin || allowed.includes(origin)) &&
      !['cross-site'].includes(String(req.headers['sec-fetch-site']))
    );
  }
  async function handle(req: IncomingMessage, res: ServerResponse) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!trusted(req)) {
      res.writeHead(403);
      res.end('Untrusted local request');
      return;
    }
    if (url.pathname === '/api/v1/health') {
      res.writeHead(stopping ? 503 : 200);
      res.end('ready');
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      res.setHeader('Cache-Control', 'no-store');
      if (stopping) {
        res.writeHead(503);
        res.end();
        return;
      }
      if (url.pathname === '/api/v1/session' && req.method === 'POST') {
        const { pageId } = (await readBody(req)) as { pageId?: string };
        if (typeof pageId !== 'string' || !/^[a-f0-9-]{36}$/.test(pageId))
          throw new Error('Invalid page identity');
        let client = [...clients.values()].find(
          (item) => item.pageId === pageId,
        );
        if (!client) {
          client = {
            token: randomUUID(),
            pageId,
            handles: new Map(),
            streams: new Set(),
          };
          clients.set(client.token, client);
        }
        touch(client);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ token: client.token }));
        return;
      }
      const token =
        url.pathname === '/api/v1/events'
          ? url.searchParams.get('session')
          : req.headers['x-verd-session'];
      const client = typeof token === 'string' ? clients.get(token) : undefined;
      if (!client) {
        if (url.pathname === '/api/v1/events') {
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          res.end('data: {"reconnect":true}\n\n');
        } else {
          res.writeHead(401);
          res.end();
        }
        return;
      }
      touch(client);
      if (url.pathname === '/api/v1/events' && req.method === 'GET') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        client.streams.add(res);
        clearTimeout(client.expiry);
        res.write('data: {"hint":{}}\n\n');
        const heartbeat = setInterval(
          () => res.write(': heartbeat\n\n'),
          15000,
        ).unref();
        res.on('close', () => {
          clearInterval(heartbeat);
          client.streams.delete(res);
          touch(client);
        });
        return;
      }
      if (url.pathname !== '/api/v1/rpc' || req.method !== 'POST') {
        res.writeHead(404);
        res.end();
        return;
      }
      let result: unknown;
      try {
        result = {
          value: await dispatch(
            client,
            decodeServiceValue((await readBody(req)) as ServiceValue) as {
              method: string;
              args: unknown[];
            },
          ),
        };
      } catch (error) {
        result = { error: errorValue(error) };
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(encodeServiceValue(result)));
      return;
    }
    if (!options.webRoot || !['GET', 'HEAD'].includes(req.method ?? '')) {
      res.writeHead(404);
      res.end();
      return;
    }
    const root = await fs.realpath(options.webRoot);
    const relative =
      decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const candidate = path.resolve(root, relative);
    if (
      path.relative(root, candidate).startsWith('..') ||
      relative.includes('\0')
    ) {
      res.writeHead(403);
      res.end();
      return;
    }
    let target = candidate;
    try {
      if (!(await fs.stat(target)).isFile()) throw new Error('not a file');
    } catch {
      if (path.extname(relative)) {
        res.writeHead(404);
        res.end();
        return;
      }
      target = path.join(root, 'index.html');
    }
    const real = await fs.realpath(target);
    if (path.relative(root, real).startsWith('..')) {
      res.writeHead(403);
      res.end();
      return;
    }
    res.setHeader(
      'Content-Type',
      mime[path.extname(real)] ?? 'application/octet-stream',
    );
    res.setHeader(
      'Cache-Control',
      relative.startsWith('assets/')
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
    );
    res.end(req.method === 'HEAD' ? undefined : await fs.readFile(real));
  }
  const server = createServer((req, res) => {
    const task = handle(req, res).catch((error) => {
      if (!res.headersSent)
        res.writeHead(400, { 'Content-Type': 'application/json' });
      if (!res.writableEnded)
        res.end(JSON.stringify({ error: errorValue(error) }));
    });
    pending.add(task);
    void task.finally(() => pending.delete(task));
  });
  return {
    server,
    host,
    async listen(port = 7201) {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
          server.off('error', reject);
          resolve();
        });
      });
      return (server.address() as { port: number }).port;
    },
    async close() {
      stopping = true;
      for (const client of clients.values())
        for (const stream of client.streams) stream.end();
      const closed = new Promise<void>((resolve) =>
        server.close(() => resolve()),
      );
      await Promise.allSettled([...pending]);
      await host.waitIdle();
      for (const client of [...clients.values()]) await releaseClient(client);
      server.closeIdleConnections();
      await closed;
      await fs.unlink(lock);
    },
  };
}
