import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  decodeServiceValue,
  encodeServiceValue,
  type WorkspaceHost,
  type WorkspaceHandle,
  type ServiceHostApi,
  type ServiceError,
  type ServiceValue,
  type LocalAgentRequest,
  type LocalAgentResponse,
} from '@sue/verd-board-workspace';

export interface WorkspaceServiceTransportOptions {
  host: WorkspaceHost;
  methods: Partial<ServiceHostApi>;
  apiPath?: string;
  allowedOrigins?: string[];
  webRoot?: string;
  leaseMs?: number;
  waitIdle?: () => Promise<void>;
  restoreWorkspace?: boolean;
  localAgent?: {
    request(
      scope: string,
      handle: WorkspaceHandle,
      input: LocalAgentRequest,
    ): Promise<LocalAgentResponse>;
    release(scope: string): Promise<void>;
  };
}

type Lease = {
  actual: WorkspaceHandle;
  agentScope: string;
  unsubscribe: () => void;
};
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

/** Shared local HTTP/SSE transport, usable on its own or mounted on an existing Node server. */
export function createWorkspaceServiceTransport(
  options: WorkspaceServiceTransportOptions,
) {
  const host = options.host;
  const methods = options.methods;
  const apiPath = (options.apiPath ?? '/api/v1').replace(/\/$/, '');
  let stopping = false;
  const clients = new Map<string, Client>();
  const refs = new Map<string, number>();
  const pending = new Set<Promise<unknown>>();
  const emit = (client: Client, message: unknown) => {
    for (const stream of client.streams)
      stream.write(`data: ${JSON.stringify(message)}\n\n`);
  };
  const touch = (client: Client) => {
    clearTimeout(client.expiry);
    if (stopping) return;
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
    await options.localAgent?.release(lease.agentScope);
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
      agentScope: key,
      unsubscribe: host.subscribe(actual, (hint) =>
        emit(client, { key, hint }),
      ),
    });
    return { ...actual, key };
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
    origin: string | undefined,
  ) {
    if (!Array.isArray(request.args))
      throw new Error('Invalid service arguments');
    if (request.method === 'localAgent') {
      if (!options.localAgent || !origin || !Array.isArray(request.args))
        throw new Error('Unknown service method');
      const [handle, input] = request.args as [
        WorkspaceHandle,
        LocalAgentRequest,
      ];
      const lease = client.handles.get(handle?.key);
      if (!lease) throw new Error('Unknown workspace handle');
      return options.localAgent.request(lease.agentScope, lease.actual, input);
    }
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
      const releases: Promise<void>[] = [];
      for (const peer of clients.values())
        for (const [key, lease] of peer.handles)
          if (lease.actual.key === original!.key) {
            if (options.localAgent) {
              const previousScope = lease.agentScope;
              lease.agentScope = randomUUID();
              releases.push(options.localAgent.release(previousScope));
            }
            lease.unsubscribe();
            lease.actual = next;
            lease.unsubscribe = host.subscribe(next, (hint) =>
              emit(peer, { key, hint }),
            );
            emit(peer, { key, hint: {} });
          }
      await Promise.all(releases);
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
    const peer = req.socket.remoteAddress;
    if (
      peer !== '::1' &&
      !/^127\.\d+\.\d+\.\d+$/.test(peer ?? '') &&
      !/^::ffff:127\.\d+\.\d+\.\d+$/.test(peer ?? '')
    )
      return false;
    const authority = new URL(`http://${req.headers.host}`);
    if (
      !['localhost', '127.0.0.1', '[::1]'].includes(authority.hostname) ||
      Number(authority.port || 80) !== req.socket.localPort
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
    if (url.pathname === `${apiPath}/health`) {
      res.writeHead(stopping ? 503 : 200);
      res.end('ready');
      return;
    }
    if (url.pathname.startsWith(apiPath + '/')) {
      res.setHeader('Cache-Control', 'no-store');
      if (stopping) {
        res.writeHead(503);
        res.end();
        return;
      }
      if (url.pathname === `${apiPath}/session` && req.method === 'POST') {
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
        res.end(
          JSON.stringify({
            token: client.token,
            capabilities: host.capabilities,
            localAgent: !!options.localAgent,
            restoreWorkspace: options.restoreWorkspace === true,
          }),
        );
        return;
      }
      const token =
        url.pathname === `${apiPath}/events`
          ? url.searchParams.get('session')
          : req.headers['x-verd-session'];
      const client = typeof token === 'string' ? clients.get(token) : undefined;
      if (!client) {
        if (url.pathname === `${apiPath}/events`) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          res.end('data: {"reconnect":true}\n\n');
        } else {
          res.writeHead(401);
          res.end();
        }
        return;
      }
      touch(client);
      if (url.pathname === `${apiPath}/events` && req.method === 'GET') {
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
      if (url.pathname !== `${apiPath}/rpc` || req.method !== 'POST') {
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
            req.headers.origin,
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
  const handleRequest = async (
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<boolean> => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (!pathname.startsWith(apiPath + '/') && !options.webRoot) return false;
    const task = handle(req, res).catch((error) => {
      if (!res.headersSent)
        res.writeHead(400, { 'Content-Type': 'application/json' });
      if (!res.writableEnded)
        res.end(JSON.stringify({ error: errorValue(error) }));
    });
    pending.add(task);
    try {
      await task;
    } finally {
      pending.delete(task);
    }
    return true;
  };
  const server = createServer((req, res) => {
    void handleRequest(req, res).then((handled) => {
      if (!handled) {
        res.writeHead(404);
        res.end();
      }
    });
  });
  return {
    server,
    handleRequest,
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
      await options.waitIdle?.();
      for (const client of [...clients.values()]) await releaseClient(client);
      server.closeIdleConnections();
      await closed;
    },
  };
}
