import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const order: string[] = [];
  const webContents = {
    openDevTools: vi.fn(),
    on: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    send: vi.fn(),
    isDestroyed: () => false,
  };
  const window = {
    webContents,
    on: vi.fn(),
    isFullScreen: () => false,
    loadURL: vi.fn(() => order.push('load')),
    loadFile: vi.fn(() => order.push('load')),
  };
  const host = {
    readGlobalConfig: vi.fn(),
    writeGlobalConfig: vi.fn(),
    readSnapshot: vi.fn(),
    readFile: vi.fn(),
    commit: vi.fn(),
    resolveConflict: vi.fn(),
    closeWorkspace: vi.fn(),
    subscribe: vi.fn(),
  };
  const manager = {
    open: vi.fn(),
    activate: vi.fn(),
    listHistory: vi.fn(),
  };
  return { handlers, order, window, host, manager };
});

vi.mock('electron', () => ({
  app: {
    whenReady: () => Promise.resolve(),
    on: vi.fn(),
    getPath: () => '/tmp/verd-main-test',
  },
  BrowserWindow: class {
    constructor() {
      return mocks.window;
    }
  },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      if (mocks.handlers.has(channel))
        throw new Error(`Duplicate handler: ${channel}`);
      mocks.handlers.set(channel, handler);
      mocks.order.push(channel);
    },
    on: vi.fn(),
  },
  session: { defaultSession: { webRequest: { onHeadersReceived: vi.fn() } } },
  dialog: {},
  shell: {},
}));
vi.mock('./workspace-host-fs', () => ({
  createFsWorkspaceHost: () => mocks.host,
}));
vi.mock('./workspace-startup', () => ({
  createDesktopWorkspaceManager: () => mocks.manager,
}));
vi.mock('./migrate-storage', () => ({
  STORAGE_FILE: 'storage.json',
  resolveStoragePath: async (path: string) => path,
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.handlers.clear();
  mocks.order.length = 0;
  mocks.manager.listHistory.mockResolvedValue([]);
});
afterEach(() => vi.unstubAllEnvs());

describe('desktop startup and IPC registration', () => {
  it.each([undefined, 'http://localhost:7300/'])(
    'registers history before loading the renderer without automatically opening DevTools (%s)',
    async (url) => {
      vi.stubEnv('VITE_DEV_SERVER_URL', url);
      await import('./main');
      await vi.waitFor(() => expect(mocks.order).toContain('load'));
      expect(mocks.window.webContents.openDevTools).not.toHaveBeenCalled();
      expect(mocks.order.indexOf('workspace-host:history')).toBeLessThan(
        mocks.order.indexOf('load'),
      );
      const history = mocks.handlers.get('workspace-host:history')!;
      expect(history).toBeTypeOf('function');
      const entries = [
        { id: 'recent', name: 'Recent', available: true, lastOpenedAt: 1 },
      ];
      mocks.manager.listHistory.mockResolvedValueOnce(entries);
      expect(await history({})).toEqual(entries);
      expect(mocks.manager.listHistory).toHaveBeenCalledOnce();
      const handle = { key: 'workspace' };
      await mocks.handlers.get('workspace-host:snapshot')!({}, handle);
      expect(mocks.host.readSnapshot).toHaveBeenCalledWith(handle);
      if (url) expect(mocks.window.loadURL).toHaveBeenCalledWith(url);
      else expect(mocks.window.loadFile).toHaveBeenCalledOnce();
    },
  );

  it('propagates a history failure instead of hiding it behind an empty list', async () => {
    vi.stubEnv('VITE_DEV_SERVER_URL', undefined);
    await import('./main');
    await vi.waitFor(() => expect(mocks.order).toContain('load'));
    mocks.manager.listHistory.mockRejectedValueOnce(
      new Error('History unavailable'),
    );
    await expect(
      mocks.handlers.get('workspace-host:history')!({}),
    ).rejects.toThrow('History unavailable');
  });
});
