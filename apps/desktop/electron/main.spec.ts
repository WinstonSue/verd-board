import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const order: string[] = [];
  const dock = { setIcon: vi.fn() };
  const createWindow = vi.fn();
  const application = { isPackaged: false, dock };
  const paths = {
    defaultRoot: () => '',
    globalConfigPath: () => '',
    legacyStorage: () => '',
  };
  const webContents = {
    mainFrame: {},
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
    setTitle: vi.fn(),
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
  return {
    handlers,
    order,
    paths,
    window,
    host,
    manager,
    application,
    createWindow,
  };
});

vi.mock('electron', () => ({
  app: {
    ...mocks.application,
    whenReady: () => Promise.resolve(),
    on: vi.fn(),
    getPath: () => '/tmp/verd-main-test',
    setName: vi.fn(),
    setPath: vi.fn(),
    get isPackaged() {
      return mocks.application.isPackaged;
    },
  },
  BrowserWindow: class {
    constructor(options: object) {
      mocks.createWindow(options);
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
  session: {
    defaultSession: {
      webRequest: { onHeadersReceived: vi.fn() },
      setPermissionCheckHandler: vi.fn(),
      setPermissionRequestHandler: vi.fn(),
    },
  },
  dialog: {},
  shell: {},
}));
vi.mock('./workspace-host-fs', () => ({
  createFsWorkspaceHost: (options: object) => {
    Object.assign(mocks.paths, options);
    return mocks.host;
  },
}));
vi.mock('./workspace-startup', () => ({
  createDesktopWorkspaceManager: (options: object) => {
    Object.assign(mocks.paths, options);
    return mocks.manager;
  },
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
  mocks.application.isPackaged = false;
  mocks.manager.listHistory.mockResolvedValue([]);
});
afterEach(() => vi.unstubAllEnvs());

describe('desktop startup and IPC registration', () => {
  it.each([false, true])(
    'uses the matching window and Dock icon (packaged: %s)',
    async (packaged) => {
      mocks.application.isPackaged = packaged;
      await import('./main');
      await vi.waitFor(() => expect(mocks.order).toContain('load'));
      const icon = path.resolve(
        __dirname,
        '../build',
        packaged ? 'icon.png' : 'icon-dev.png',
      );
      expect(mocks.createWindow).toHaveBeenCalledWith(
        expect.objectContaining({
          icon,
          title: packaged ? '青编' : '[DEV] 青编',
        }),
      );
      expect(mocks.application.dock.setIcon).toHaveBeenCalledWith(icon);
    },
  );

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
      expect(
        await history({
          sender: mocks.window.webContents,
          senderFrame: mocks.window.webContents.mainFrame,
        }),
      ).toEqual(entries);
      expect(mocks.manager.listHistory).toHaveBeenCalledOnce();
      const handle = { key: 'workspace' };
      await mocks.handlers.get('workspace-host:snapshot')!(
        {
          sender: mocks.window.webContents,
          senderFrame: mocks.window.webContents.mainFrame,
        },
        handle,
      );
      expect(mocks.host.readSnapshot).toHaveBeenCalledWith(handle);
      if (url) expect(mocks.window.loadURL).toHaveBeenCalledWith(url);
      else expect(mocks.window.loadFile).toHaveBeenCalledOnce();
      // Loading via Vite must not redirect persistence to the repository.
      expect(mocks.paths.defaultRoot()).toBe(
        path.join('/tmp/verd-main-test', 'workspaces/default'),
      );
      expect(mocks.paths.globalConfigPath()).toBe(
        path.join('/tmp/verd-main-test', 'verdboard-global-config.json'),
      );
      expect(mocks.paths.legacyStorage()).toBe(
        path.join('/tmp/verd-main-test', 'storage.json'),
      );
      const titleHandler = mocks.window.on.mock.calls.find(
        ([event]) => event === 'page-title-updated',
      )?.[1];
      const event = { preventDefault: vi.fn() };
      titleHandler(event, '青编');
      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(mocks.window.setTitle).toHaveBeenCalledWith('[DEV] 青编');
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
      mocks.handlers.get('workspace-host:history')!({
        sender: mocks.window.webContents,
        senderFrame: mocks.window.webContents.mainFrame,
      }),
    ).rejects.toThrow('History unavailable');
  });
});

it('rejects workspace IPC from an external child frame', async () => {
  await import('./main');
  await vi.waitFor(() => expect(mocks.order).toContain('load'));
  await expect(
    mocks.handlers.get('workspace-host:snapshot')!(
      { sender: mocks.window.webContents, senderFrame: {} },
      { key: 'workspace' },
    ),
  ).rejects.toThrow('Untrusted IPC frame');
  expect(mocks.host.readSnapshot).not.toHaveBeenCalled();
});
