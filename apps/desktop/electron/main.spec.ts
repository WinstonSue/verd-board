import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import {
  diagramKindOf,
  isFrameFileV2,
  quickDiagramKinds,
} from '@sue/verd-board-app/headless';
import { createQuickEditFile, quickEditDirectory } from './quick-edit';

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const order: string[] = [];
  const dock = { setIcon: vi.fn() };
  const createWindow = vi.fn();
  const setTrayMenu = vi.fn();
  const showOpenDialog =
    vi.fn<() => Promise<{ canceled: boolean; filePaths: string[] }>>();
  const application = { isPackaged: false, dock };
  const paths = {
    defaultRoot: () => '',
    globalConfigPath: () => '',
    legacyStorage: () => '',
  };
  const webContents = {
    id: 1,
    mainFrame: {},
    openDevTools: vi.fn(),
    on: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    send: vi.fn(),
    isDestroyed: () => false,
  };
  const window = {
    isDestroyed: () => false,
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
    readResource: vi.fn(),
    assertWritable: vi.fn(),
    workspaces: new Map<string, { root: string }>(),
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
    setTrayMenu,
    showOpenDialog,
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
    requestSingleInstanceLock: () => true,
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
  Menu: {
    buildFromTemplate: vi.fn((template: unknown) => template),
    setApplicationMenu: vi.fn(),
  },
  nativeImage: { createFromPath: () => ({ resize: () => ({}) }) },
  Tray: class {
    setToolTip() {}
    setContextMenu = mocks.setTrayMenu;
    destroy() {}
  },
  dialog: {
    showMessageBox: vi.fn(async () => ({ response: 1 })),
    showOpenDialog: mocks.showOpenDialog,
  },
  shell: { openPath: vi.fn(async () => '') },
}));
vi.mock('./file-associations', () => ({
  launchFiles: () => [],
  supportedDesktopFile: () => true,
  setDefaultFileApplications: vi.fn(),
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
  mocks.host.workspaces.clear();
  mocks.order.length = 0;
  mocks.application.isPackaged = false;
  mocks.showOpenDialog
    .mockReset()
    .mockResolvedValue({ canceled: true, filePaths: [] });
  mocks.manager.listHistory.mockResolvedValue([]);
});
afterEach(() => vi.unstubAllEnvs());

describe('desktop startup and IPC registration', () => {
  it('provides the system tray menu and the six diagram commands', async () => {
    await import('./main');
    await vi.waitFor(() => expect(mocks.order).toContain('load'));
    expect(mocks.setTrayMenu).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'tray-new-document' }),
      expect.objectContaining({
        id: 'tray-new-diagram',
        submenu: [
          'canvas',
          'mind',
          'workflow',
          'architecture',
          'uml-class',
          'uml-sequence',
        ].map((kind) =>
          expect.objectContaining({
            id: `tray-${kind}`,
            click: expect.any(Function),
          }),
        ),
      }),
      expect.objectContaining({ id: 'tray-new-workspace' }),
      expect.objectContaining({ type: 'separator' }),
      expect.objectContaining({ id: 'tray-open' }),
      expect.objectContaining({ id: 'tray-quit' }),
    ]);
  });
  it('registers file commands on the application menu', async () => {
    await import('./main');
    await vi.waitFor(() => expect(mocks.order).toContain('load'));
    const { Menu } = await import('electron');
    expect(Menu.setApplicationMenu).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          label: '文件',
          submenu: expect.arrayContaining([
            expect.objectContaining({
              id: 'open-file',
              accelerator: 'CommandOrControl+O',
            }),
            expect.objectContaining({ id: 'new-document' }),
            expect.objectContaining({ id: 'new-canvas' }),
            expect.objectContaining({ id: 'show-quick-edit-directory' }),
          ]),
        }),
        expect.objectContaining({ role: 'viewMenu' }),
      ]),
    );
  });

  it('shares one pending picker with the native menu and allows reopening after cancellation', async () => {
    await import('./main');
    await vi.waitFor(() => expect(mocks.order).toContain('load'));
    const { Menu } = await import('electron');
    const template = vi.mocked(Menu.buildFromTemplate).mock.calls[0][0];
    const open = (
      template.find((item) => item.label === '文件')
        ?.submenu as Electron.MenuItemConstructorOptions[]
    ).find((item) => item.id === 'open-file')?.click;
    let cancel!: () => void;
    mocks.showOpenDialog.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          cancel = () => resolve({ canceled: true, filePaths: [] });
        }),
    );
    const sender = {
      sender: mocks.window.webContents,
      senderFrame: mocks.window.webContents.mainFrame,
    };
    const pick = mocks.handlers.get('files:pick')!;
    const result = pick(sender);
    open!(null as never, mocks.window as never, null as never);
    expect(mocks.showOpenDialog).toHaveBeenCalledTimes(1);
    expect(mocks.showOpenDialog).toHaveBeenCalledWith(
      mocks.window,
      expect.objectContaining({ properties: ['openFile', 'multiSelections'] }),
    );
    cancel();
    await result;
    await pick(sender);
    expect(mocks.showOpenDialog).toHaveBeenCalledTimes(2);

    await expect(pick({ ...sender, senderFrame: {} })).rejects.toThrow(
      'Untrusted IPC frame',
    );
    await expect(
      mocks.handlers.get('files:create')!(sender, 'html'),
    ).rejects.toThrow('不支持的新建文件类型');
  });

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
      mocks.manager.open.mockResolvedValueOnce(handle);
      await mocks.handlers.get('workspace-host:open')!(
        {
          sender: mocks.window.webContents,
          senderFrame: mocks.window.webContents.mainFrame,
        },
        { default: true },
      );
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

describe('quick edit files', () => {
  it('writes the correct editable scene for every tray diagram', async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'verd-quick-diagrams-'),
    );
    try {
      for (const { kind } of quickDiagramKinds) {
        const filename = await createQuickEditFile(directory, kind);
        const file: unknown = JSON.parse(await fs.readFile(filename, 'utf8'));
        if (!isFrameFileV2(file))
          throw new Error(`Invalid quick diagram: ${kind}`);
        expect(diagramKindOf(file)).toBe(kind);
      }
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it('uses the repository for interactive development and the current profile otherwise', () => {
    const userData = path.join(os.tmpdir(), 'verd-quick-edit-profile');
    expect(quickEditDirectory(userData, true)).toBe(
      path.resolve(__dirname, '../../../tmp/verdboard/quick-edit'),
    );
    expect(quickEditDirectory(userData, false)).toBe(
      path.join(userData, 'quick-edit'),
    );
  });

  it('publishes complete and unique files when new requests race existing names', async () => {
    const userData = await fs.mkdtemp(
      path.join(os.tmpdir(), 'verd-quick-edit-'),
    );
    try {
      const directory = quickEditDirectory(userData, false);
      const existing = await createQuickEditFile(directory, 'document');
      await fs.writeFile(existing, '# Existing document\n');
      const [first, second, canvas] = await Promise.all([
        createQuickEditFile(directory, 'document'),
        createQuickEditFile(directory, 'document'),
        createQuickEditFile(directory, 'canvas'),
      ]);
      expect([first, second].map((file) => path.basename(file)).sort()).toEqual(
        ['未命名文档 2.md', '未命名文档 3.md'],
      );
      expect(await fs.readFile(existing, 'utf8')).toBe('# Existing document\n');
      expect(await fs.readFile(first, 'utf8')).toBe('\n');
      expect(await fs.readFile(second, 'utf8')).toBe('\n');
      const file: unknown = JSON.parse(await fs.readFile(canvas, 'utf8'));
      expect(isFrameFileV2(file)).toBe(true);
      expect(file).toMatchObject({
        frame: { name: '未命名画布', children: [] },
        cells: {},
      });
      expect((await fs.readdir(directory)).sort()).toEqual(
        [existing, first, second, canvas]
          .map((file) => path.basename(file))
          .sort(),
      );
    } finally {
      await fs.rm(userData, { recursive: true, force: true });
    }
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

it('opens only ordinary workspace files through the trusted resource IPC', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'verd-open-resource-'));
  const outside = await fs.mkdtemp(
    path.join(os.tmpdir(), 'verd-outside-resource-'),
  );
  try {
    await fs.writeFile(path.join(root, 'notes.md'), '# original');
    await fs.writeFile(path.join(outside, 'external.md'), 'external');
    await fs.symlink(
      path.join(outside, 'external.md'),
      path.join(root, 'escape.md'),
    );
    await fs.mkdir(path.join(root, '.verdscrolls'));
    await fs.writeFile(path.join(root, '.verdscrolls/config.json'), '{}');
    await fs.symlink(
      path.join(root, '.verdscrolls/config.json'),
      path.join(root, 'internal.json'),
    );
    await import('./main');
    await vi.waitFor(() => expect(mocks.order).toContain('load'));
    mocks.host.workspaces.set('test', { root });
    const open = mocks.handlers.get('workspace-host:open-resource')!;
    const event = {
      sender: mocks.window.webContents,
      senderFrame: mocks.window.webContents.mainFrame,
    };
    mocks.manager.open.mockResolvedValueOnce({ key: 'test' });
    await mocks.handlers.get('workspace-host:open')!(event, { default: true });
    await expect(
      open(event, { key: 'test' }, 'notes.md'),
    ).resolves.toBeUndefined();
    expect(mocks.host.assertWritable).toHaveBeenCalledWith({ key: 'test' });
    const { shell } = await import('electron');
    expect(shell.openPath).toHaveBeenCalledWith(
      await fs.realpath(path.join(root, 'notes.md')),
    );
    for (const target of [
      '../external.md',
      '.verdscrolls/config.json',
      'escape.md',
      'internal.json',
      '.verdscrolls',
    ])
      await expect(open(event, { key: 'test' }, target)).rejects.toThrow();
    await expect(open(event, { key: 'missing' }, 'notes.md')).rejects.toThrow();
    expect(shell.openPath).toHaveBeenCalledOnce();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});
