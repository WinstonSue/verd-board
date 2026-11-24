import { expect, test, type ElectronApplication } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  desktopDevUrl,
  electron,
  writeDesktopLauncher,
} from './desktop-launcher';
import { checkFileShortcuts } from './file-shortcuts';

const root = path.resolve(__dirname, '../../..');

test(
  'dispatches native open and actual size shortcuts in development',
  checkFileShortcuts,
);

test('real dev isolates its persistent workspace and hot-updates modules and styles', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'verd-dev-runtime-'));
  const userData = path.join(directory, 'VerdBoard Dev');
  const workspace = path.join(userData, 'workspaces/default');
  const probe = path.join(
    root,
    'apps/desktop/dist-electron-e2e',
    `probe-${randomUUID()}`,
  );
  const oldConfig = path.join(
    directory,
    'desktop/verdboard-global-config.json',
  );
  const oldContent = JSON.stringify({
    version: 1,
    value: {
      desktopWorkspace: {
        kind: 'directory',
        path: path.join(directory, 'daily-work'),
      },
    },
  });
  await mkdir(path.dirname(oldConfig), { recursive: true });
  await writeFile(oldConfig, oldContent);
  await mkdir(userData);
  await mkdir(probe);
  const launcher = path.join(directory, 'launch.cjs');
  await writeDesktopLauncher(launcher, userData);
  const env = { ...process.env };
  delete env.VERDBOARD_WORKSPACE_PATH;
  delete env.VERDBOARD_BUILTIN_WORKSPACE_PATH;
  let desktop: ElectronApplication | undefined;
  const launch = async () => {
    desktop = await electron.launch({ args: [launcher], env });
    const page = await desktop.firstWindow();
    await expect(
      page.locator('.workspace-shell').or(page.getByTestId('product-home')),
    ).toBeVisible();
    if (await page.getByTestId('product-home').isVisible())
      await page
        .getByTestId('product-home')
        .getByRole('button', { name: /^(系统介绍|System introduction)$/ })
        .click();
    await expect(page.locator('.workspace-shell')).toBeVisible();
    await expect
      .poll(() =>
        desktop!.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].getTitle(),
        ),
      )
      .toMatch(/^\[DEV\]/);
    expect(
      await desktop.evaluate(({ app }) => ({
        name: app.getName(),
        userData: app.getPath('userData'),
        packaged: app.isPackaged,
      })),
    ).toEqual({ name: 'VerdBoard Dev', userData, packaged: false });
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
  const source = path.join(root, 'workspace/文档/产品/产品概览.verd-doc.json');
  const sourceBytes = await readFile(source, 'utf8');
  const copied = path.join(workspace, '文档/产品/产品概览.verd-doc.json');
  try {
    const page = await launch();
    expect(await readFile(copied, 'utf8')).toBe(sourceBytes);
    // The renderer actually consumes workspace package source and the Vite client.
    await expect
      .poll(() =>
        page.evaluate(() =>
          performance
            .getEntriesByType('resource')
            .some((entry) => entry.name.includes('/packages/react/board/src/')),
        ),
      )
      .toBe(true);
    expect(
      await page.evaluate(() =>
        performance
          .getEntriesByType('resource')
          .some((entry) => entry.name.includes('/@vite/client')),
      ),
    ).toBe(true);

    const moduleFile = path.join(probe, 'probe.js');
    const styleFile = path.join(probe, 'probe.css');
    const moduleSource = (value: string) =>
      `import './probe.css';\ndocument.documentElement.dataset.e2eProbe = '${value}';\nif (import.meta.hot) import.meta.hot.accept();\n`;
    await writeFile(moduleFile, moduleSource('before'));
    await writeFile(styleFile, ':root { --verd-e2e-probe: before; }');
    await page.addScriptTag({
      type: 'module',
      url: `${desktopDevUrl}/dist-electron-e2e/${path.basename(probe)}/probe.js`,
    });
    await expect(page.locator('html')).toHaveAttribute(
      'data-e2e-probe',
      'before',
    );
    await writeFile(moduleFile, moduleSource('after'));
    await expect(page.locator('html')).toHaveAttribute(
      'data-e2e-probe',
      'after',
    );
    await writeFile(styleFile, ':root { --verd-e2e-probe: after; }');
    await expect
      .poll(() =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement)
            .getPropertyValue('--verd-e2e-probe')
            .trim(),
        ),
      )
      .toBe('after');
    await close();

    const edited = JSON.parse(await readFile(copied, 'utf8'));
    edited.title = 'Persistent development edit';
    const editedBytes = JSON.stringify(edited);
    await writeFile(copied, editedBytes);
    await launch();
    expect(await readFile(copied, 'utf8')).toBe(editedBytes);
    expect(await readFile(source, 'utf8')).toBe(sourceBytes);
    expect(await readFile(oldConfig, 'utf8')).toBe(oldContent);
    const config = JSON.parse(
      await readFile(
        path.join(userData, 'verdboard-global-config.json'),
        'utf8',
      ),
    );
    expect(JSON.stringify(config)).not.toContain('daily-work');
    await close();
  } finally {
    await desktop?.close();
    await rm(probe, { recursive: true, force: true });
    await rm(directory, { recursive: true, force: true });
  }
});
