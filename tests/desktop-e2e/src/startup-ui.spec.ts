import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
} from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openWorkspaceMenu } from '../../web-e2e/src/app-actions';

const root = path.resolve(__dirname, '../../..');
let server: Server;
let developmentUrl: string;
const contentTypes: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
};

// Exercise the development loadURL branch with the freshly built renderer,
// without starting a Vite watcher that would launch another Electron instance.
test.beforeAll(async () => {
  const dist = path.join(root, 'apps/desktop/dist');
  server = createServer(async (request, response) => {
    const pathname = decodeURIComponent(
      new URL(request.url ?? '/', 'http://localhost').pathname,
    );
    const file = path.resolve(
      dist,
      `.${pathname === '/' ? '/index.html' : pathname}`,
    );
    if (!file.startsWith(`${dist}${path.sep}`)) {
      response.writeHead(403).end();
      return;
    }
    try {
      const content = await readFile(file);
      const type =
        contentTypes[path.extname(file)] ?? 'application/octet-stream';
      response.writeHead(200, { 'Content-Type': type }).end(content);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing test server port');
  developmentUrl = `http://127.0.0.1:${address.port}/`;
});
test.afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

for (const mode of ['development', 'built'] as const) {
  test(`Desktop ${mode} fills the window, registers history and restores saved tabs`, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'verd-startup-ui-'));
    let desktop: ElectronApplication | undefined;
    try {
      const userData = path.join(directory, 'user-data');
      const workspace = path.join(directory, 'workspace');
      await mkdir(userData);
      await mkdir(workspace);
      const launcher = path.join(directory, 'launch.cjs');
      await writeFile(
        launcher,
        [
          "const {app} = require('electron');",
          `app.setPath('userData', ${JSON.stringify(userData)});`,
          `require(${JSON.stringify(path.join(root, 'apps/desktop/dist-electron/main.js'))});`,
        ].join('\n'),
      );
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        VERDBOARD_WORKSPACE_PATH: workspace,
      };
      delete env.ELECTRON_RUN_AS_NODE;
      if (mode === 'development') env.VITE_DEV_SERVER_URL = developmentUrl;
      else delete env.VITE_DEV_SERVER_URL;
      const launch = async () => {
        desktop = await electron.launch({ args: [launcher], env });
        const page = await desktop.firstWindow();
        await expect(page.locator('.workspace-shell')).toBeVisible();
        await expect(page.getByRole('tab', { selected: true })).toBeVisible();
        return page;
      };
      const close = async () => {
        const page = await desktop!.firstWindow();
        const closed = page.waitForEvent('close');
        await desktop!.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].close(),
        );
        await closed;
        await desktop!.close();
        desktop = undefined;
      };
      let page = await launch();
      await expect(
        page.locator(
          '.workspace-pane.is-active svg[aria-label="Frame canvas"]',
        ),
      ).toBeVisible();
      await expect(
        page.getByTestId('save-status').locator('visible=true'),
      ).toHaveAttribute('data-save-state', /^(idle|saved)$/);
      expect(
        await desktop!.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].webContents.isDevToolsOpened(),
        ),
      ).toBe(false);
      expect(
        await desktop!.evaluate(({ Menu }) =>
          Menu.getApplicationMenu()
            ?.items.flatMap((item) => item.submenu?.items ?? [])
            .some((item) => item.role?.toLowerCase() === 'toggledevtools'),
        ),
      ).toBe(true);
      const history = () =>
        page.evaluate(async () => {
          const api = (
            window as unknown as {
              electronAPI: {
                workspaceHost: {
                  listWorkspaceHistory(): Promise<{ name: string }[]>;
                };
              };
            }
          ).electronAPI;
          return api.workspaceHost.listWorkspaceHistory();
        });
      await expect
        .poll(async () => (await history()).map((entry) => entry.name))
        .toContain('workspace');
      const menu = await openWorkspaceMenu(page);
      await expect(
        menu.getByRole('menuitem', { name: /workspace.*当前/ }),
      ).toBeDisabled();
      await page.keyboard.press('Escape');
      for (const width of [1200, 1600]) {
        await desktop!.evaluate(
          ({ BrowserWindow }, width) =>
            BrowserWindow.getAllWindows()[0].setSize(width, 900),
          width,
        );
        const contentWidth = await desktop!.evaluate(
          ({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()[0].getContentBounds().width,
        );
        await expect
          .poll(() => page.evaluate(() => window.innerWidth))
          .toBe(contentWidth);
        const bounds = await page.evaluate(() => ({
          right: document
            .querySelector('.workspace-shell')!
            .getBoundingClientRect().right,
          inspector: document
            .querySelector('.workspace-pane.is-active .frame-inspector')!
            .getBoundingClientRect().width,
          viewport: window.innerWidth,
        }));
        expect(Math.abs(bounds.right - bounds.viewport)).toBeLessThanOrEqual(1);
        expect(bounds.inspector).toBe(300);
      }
      await page.getByRole('button', { name: '新建文档', exact: true }).click();
      await expect(page.getByRole('tab')).toHaveCount(2);
      const tabs = await page
        .getByRole('tab')
        .evaluateAll((items) =>
          items.map((item) => item.getAttribute('data-tab-id')),
        );
      const active = await page
        .getByRole('tab', { selected: true })
        .getAttribute('data-tab-id');
      await close();
      page = await launch();
      // Restored active tab is the document; switch back to the canvas only after
      // checking the persisted navigation state.
      await expect(page.getByRole('tab', { selected: true })).toHaveAttribute(
        'data-tab-id',
        active!,
      );
      expect(
        await page
          .getByRole('tab')
          .evaluateAll((items) =>
            items.map((item) => item.getAttribute('data-tab-id')),
          ),
      ).toEqual(tabs);
      expect(await history()).toBeInstanceOf(Array);
      await expect(page.getByText(/No handler registered/)).toHaveCount(0);
      await close();
    } finally {
      await desktop?.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
}
