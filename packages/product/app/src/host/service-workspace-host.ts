import { VersionError } from '@sue/verd-board-workspace';
import {
  decodeServiceValue,
  encodeServiceValue,
  type ServiceHostApi,
  type ServiceMethod,
  type ServiceValue,
  type ServiceError,
} from './service-protocol';
import type {
  ChangeHint,
  OpenWorkspaceRequest,
  WorkspaceHandle,
  WorkspaceHost,
} from '@sue/verd-board-workspace';

export interface ServiceHostOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  eventSource?: (url: string) => EventSource;
  pickDirectory?: (
    purpose: 'open' | 'create' | 'backup',
  ) => Promise<string | null>;
  onConnectionChange?: (connected: boolean, message?: string) => void;
  /** A project SDK host opens only its server-configured content directory. */
  fixedWorkspace?: boolean;
}

/** The public handle remains stable when a restarted service issues new keys. */
export function createServiceWorkspaceHost(options: ServiceHostOptions = {}) {
  const base = options.baseUrl ?? '/api/v1';
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  const pageId = crypto.randomUUID();
  let session: Promise<string> | undefined;
  let token: string | undefined;
  let recovering: Promise<void> | undefined;
  let events: EventSource | undefined;
  let disposed = false;
  const opened = new Map<
    string,
    {
      remote: WorkspaceHandle;
      request: OpenWorkspaceRequest;
      listeners: Set<(hint: ChangeHint) => void>;
    }
  >();
  const notify = (connected: boolean, message?: string) => {
    if (!disposed) options.onConnectionChange?.(connected, message);
  };
  class SessionExpired extends Error {
    constructor(readonly expiredToken: string) {
      super('Service session expired');
    }
  }

  const connect = () =>
    (session ??= (async () => {
      const response = await fetcher(`${base}/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId }),
        credentials: 'same-origin',
      });
      if (!response.ok)
        throw new Error(`Local service unavailable (${response.status})`);
      const result = (await response.json()) as {
        token: string;
        capabilities?: WorkspaceHost['capabilities'];
      };
      if (result.capabilities) {
        for (const key of [
          'pickWorkspace',
          'openBuiltinWorkspace',
          'openPatternWorkspace',
        ] as const)
          if (result.capabilities[key] === false)
            host.capabilities = { ...host.capabilities!, [key]: false };
      }
      token = result.token;
      notify(true);
      return result.token;
    })().catch((error) => {
      session = undefined;
      token = undefined;
      notify(false, String(error));
      throw error;
    }));

  async function raw<M extends ServiceMethod>(
    method: M,
    args: Parameters<ServiceHostApi[M]>,
  ): Promise<Awaited<ReturnType<ServiceHostApi[M]>>> {
    const currentToken = await connect();
    let response: Response;
    try {
      response = await fetcher(`${base}/rpc`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-Verd-Session': currentToken,
        },
        body: JSON.stringify(encodeServiceValue({ method, args })),
      });
    } catch (error) {
      notify(false, String(error));
      throw error;
    }
    if (response.status === 401) throw new SessionExpired(currentToken);
    if (!response.ok) {
      notify(false, `Service request failed (${response.status})`);
      throw new Error(`Service request failed (${response.status})`);
    }
    const result = decodeServiceValue(
      (await response.json()) as ServiceValue,
    ) as {
      value?: Awaited<ReturnType<ServiceHostApi[M]>>;
      error?: ServiceError;
    };
    if (result.error) {
      if (result.error.code && result.error.diagnostic)
        throw new VersionError(
          result.error.code as VersionError['code'],
          result.error.diagnostic,
        );
      throw Object.assign(new Error(result.error.message), {
        code: result.error.code,
      });
    }
    notify(true);
    return result.value as Awaited<ReturnType<ServiceHostApi[M]>>;
  }

  async function recover(expiredToken: string) {
    if (recovering) return recovering;
    if (token && token !== expiredToken) return;
    recovering = (async () => {
      events?.close();
      events = undefined;
      session = undefined;
      token = undefined;
      await connect();
      for (const item of opened.values()) {
        const remote = await raw('openWorkspace', [item.request]);
        if (!remote)
          throw new Error('Workspace unavailable after service restart');
        item.remote = remote;
      }
      startEvents();
      for (const item of opened.values())
        item.listeners.forEach((listener) => listener({}));
    })();
    try {
      await recovering;
    } finally {
      recovering = undefined;
    }
  }

  async function send<M extends ServiceMethod>(
    method: M,
    args: Parameters<ServiceHostApi[M]> | (() => Parameters<ServiceHostApi[M]>),
  ): Promise<Awaited<ReturnType<ServiceHostApi[M]>>> {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (recovering) await recovering;
      try {
        return await raw(method, typeof args === 'function' ? args() : args);
      } catch (error) {
        if (!(error instanceof SessionExpired) || attempt > 0) throw error;
        await recover(error.expiredToken);
      }
    }
    throw new Error('Local service recovery failed');
  }

  function startEvents() {
    if (
      events ||
      disposed ||
      (!options.eventSource && typeof EventSource === 'undefined')
    )
      return;
    void connect()
      .then((currentToken) => {
        if (disposed || events) return;
        const stream = (options.eventSource ?? ((url) => new EventSource(url)))(
          `${base}/events?session=${encodeURIComponent(currentToken)}`,
        );
        events = stream;
        stream.onopen = () => {
          if (events !== stream) return;
          notify(true);
          for (const item of opened.values())
            item.listeners.forEach((listener) => listener({}));
        };
        stream.onmessage = (event) => {
          if (events !== stream) return;
          const message = JSON.parse(event.data) as {
            key?: string;
            hint?: ChangeHint;
            reconnect?: boolean;
          };
          if (message.reconnect) {
            stream.close();
            events = undefined;
            void recover(currentToken).catch((error) =>
              notify(false, String(error)),
            );
          } else
            for (const item of opened.values())
              if (!message.key || item.remote.key === message.key)
                item.listeners.forEach((listener) =>
                  listener(message.hint ?? {}),
                );
        };
        stream.onerror = () => {
          if (events === stream) notify(false, '本地服务连接中断，正在重试…');
        };
      })
      .catch(() => {});
  }

  function withHandle<M extends ServiceMethod>(
    method: M,
    handle: WorkspaceHandle,
    rest: unknown[] = [],
  ): Promise<Awaited<ReturnType<ServiceHostApi[M]>>> {
    return send(method, () => {
      const item = opened.get(handle.key);
      if (!item) throw new Error('Workspace unavailable');
      return [item.remote, ...rest] as Parameters<ServiceHostApi[M]>;
    });
  }
  async function adopt(remote: WorkspaceHandle, request: OpenWorkspaceRequest) {
    if (disposed) {
      await raw('closeWorkspace', [remote]);
      throw new Error('Workspace host disposed');
    }
    const handle = { ...remote, key: crypto.randomUUID() };
    const item = {
      remote,
      request,
      listeners: new Set<(hint: ChangeHint) => void>(),
    };
    opened.set(handle.key, item);
    try {
      item.request = {
        path: await withHandle('readWorkspaceLocation', handle),
        create: false,
      };
    } catch (error) {
      opened.delete(handle.key);
      throw error;
    }
    startEvents();
    return handle;
  }
  const pick = (purpose: 'open' | 'create' | 'backup') =>
    options.pickDirectory?.(purpose) ?? Promise.resolve(null);
  const host: WorkspaceHost = {
    storageKind: 'filesystem',
    versionProvider: { id: 'git' },
    capabilities: {
      pickWorkspace: !options.fixedWorkspace,
      openBuiltinWorkspace: !options.fixedWorkspace,
      openPatternWorkspace: !options.fixedWorkspace,
    },
    readGlobalConfig: () => send('readGlobalConfig', []),
    writeGlobalConfig: (value, version) =>
      send('writeGlobalConfig', [value, version]),
    async openWorkspace(request = {}) {
      if (request.pick) {
        const path = await pick('open');
        if (!path) return null;
        request = { ...request, pick: false, path };
      }
      const remote = await send('openWorkspace', [request]);
      if (!remote) return null;
      return adopt(remote, request);
    },
    async createWorkspace(request) {
      const parentPath = await pick('create');
      if (!parentPath) return null;
      const remote = await send('createWorkspace', [
        { ...request, parentPath },
      ]);
      if (!remote) return null;
      return adopt(remote, {
        path: parentPath.replace(/[\\/]$/, '') + '/' + request.name.trim(),
        create: false,
      });
    },
    listWorkspaceHistory: () => send('listWorkspaceHistory', []),
    updateWorkspaceHistory: (request) =>
      send('updateWorkspaceHistory', [request]),
    activateWorkspace: (h) => withHandle('activateWorkspace', h),
    readWorkspaceLocation: (h) => withHandle('readWorkspaceLocation', h),
    revealWorkspaceLocation: (h) => withHandle('revealWorkspaceLocation', h),
    readBuiltinUpdate: (h) => withHandle('readBuiltinUpdate', h),
    revealBuiltinBackups: (h) => withHandle('revealBuiltinBackups', h),
    async updateBuiltinWorkspace(h, id, updateOptions) {
      let backupParent: string | undefined;
      if (updateOptions?.backup) {
        const selected = await pick('backup');
        if (!selected) return null;
        backupParent = selected;
      }
      const remote = await withHandle('updateBuiltinWorkspace', h, [
        id,
        { backup: !!updateOptions?.backup, backupParent },
      ]);
      if (!remote) return null;
      const item = opened.get(h.key)!;
      return adopt(remote, item.request);
    },
    readSnapshot: (h) => withHandle('readSnapshot', h),
    initializeAgent: (h) => withHandle('initializeAgent', h),
    readFile: (h, path) => withHandle('readFile', h, [path]),
    readResource: (h, key) => withHandle('readResource', h, [key]),
    openResourceExternal: (h, path) =>
      withHandle('openResourceExternal', h, [path]),
    commit: (h, request) => withHandle('commit', h, [request]),
    resolveConflict: (h, request) =>
      withHandle('resolveConflict', h, [request]),
    versions: (h, request) => withHandle('versions', h, [request]),
    git: (h, request) => withHandle('git', h, [request]),
    subscribe(h, listener) {
      const item = opened.get(h.key);
      item?.listeners.add(listener);
      startEvents();
      return () => {
        item?.listeners.delete(listener);
      };
    },
    async closeWorkspace(h) {
      const item = opened.get(h.key);
      if (!item) return;
      try {
        await withHandle('closeWorkspace', h);
      } finally {
        opened.delete(h.key);
        if (!opened.size) {
          events?.close();
          events = undefined;
        }
      }
    },
  };
  return Object.assign(host, {
    serviceCall: send,
    dispose() {
      disposed = true;
      events?.close();
      events = undefined;
      opened.clear();
    },
  });
}
