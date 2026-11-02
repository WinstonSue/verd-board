import { test, expect } from '@playwright/test';
import { electron, writeDesktopLauncher } from './desktop-launcher';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { openWorkspaceMenu } from '../../web-e2e/src/app-actions';
test('npm content updates independently, with confirmation and a complete backup', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'verd-npm-e2e-'));
  const userData = path.join(dir, 'data');
  const pkg = path.join(dir, 'package');
  await fs.mkdir(pkg);
  await fs.cp(
    path.resolve(__dirname, '../../../packages/product/docs/dist'),
    path.join(pkg, 'dist'),
    { recursive: true },
  );
  const manifestPath = path.join(pkg, 'dist/builtin-release.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  manifest.packageVersion = '9.0.0';
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
  await fs.writeFile(
    path.join(pkg, 'package.json'),
    JSON.stringify({ name: '@sue/verd-board-docs', version: '9.0.0' }),
  );
  const archive = path.join(dir, 'content.tgz');
  const { c } = createRequire(
    path.resolve(__dirname, '../../../apps/desktop/package.json'),
  )('tar');
  await c({ cwd: dir, file: archive, gzip: true }, ['package']);
  const bytes = await fs.readFile(archive);
  let downloads = 0;
  const server = createServer((req, res) => {
    if (req.url === '/content.tgz') {
      downloads++;
      res.end(bytes);
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        versions: {
          '9.0.0': {
            name: '@sue/verd-board-docs',
            version: '9.0.0',
            verdBuiltin: { kind: 'project', minimumAppVersion: '0.0.1' },
            dist: {
              integrity:
                'sha512-' + createHash('sha512').update(bytes).digest('base64'),
              tarball: `http://127.0.0.1:${(server.address() as { port: number }).port}/content.tgz`,
            },
          },
        },
      }),
    );
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const launcher = path.join(dir, 'launch.cjs');
  await writeDesktopLauncher(launcher, userData);
  const env = {
    ...process.env,
    VERDBOARD_CONTENT_REGISTRY: `http://127.0.0.1:${(server.address() as { port: number }).port}/`,
  };
  delete env.VERDBOARD_WORKSPACE_PATH;
  const desktop = await electron.launch({ args: [launcher], env });
  try {
    const page = await desktop.firstWindow();
    await expect(
      page.locator('.workspace-pane.is-active .document-page__title'),
    ).toHaveValue('文档导航', { timeout: 60000 });
    await expect(page.getByText('项目文档有可用更新 9.0.0')).toBeVisible();
    expect(downloads).toBe(0);
    const root = path.join(userData, 'workspaces/default');
    const before = JSON.parse(
      await fs.readFile(path.join(root, '.verdscrolls/config.json'), 'utf8'),
    );
    await fs.writeFile(path.join(root, 'my-note.txt'), 'retained in backup');
    await openWorkspaceMenu(page);
    await page.getByTestId('workspace-open-settings').click();
    await page.getByTestId('settings-nav-workspace.data').click();
    await page.getByRole('button', { name: '更新至最新内容…' }).click();
    await page.getByRole('button', { name: '取消', exact: true }).click();
    expect(downloads).toBe(0);
    await page.getByRole('button', { name: '更新至最新内容…' }).click();
    await page.getByRole('button', { name: '备份并全部更新' }).click();
    await page.waitForFunction(
      () =>
        document.querySelector('[role=alert]') ||
        !document.querySelector('[data-testid=workspace-settings-page]'),
      { timeout: 20000 },
    );
    expect(await page.getByRole('alert').allTextContents()).toEqual([]);
    await expect(page.getByTestId('workspace-settings-page')).not.toBeVisible({
      timeout: 60000,
    });
    expect(downloads).toBe(1);
    await expect(
      page.locator('.workspace-pane.is-active .document-page__title'),
    ).toHaveValue('文档导航');
    expect(
      JSON.parse(
        await fs.readFile(
          path.join(root, '.verdscrolls/instance.json'),
          'utf8',
        ),
      ).packageVersion,
    ).toBe('9.0.0');
    expect(
      JSON.parse(
        await fs.readFile(path.join(root, '.verdscrolls/config.json'), 'utf8'),
      ).value.identity,
    ).toBe(before.value.identity);
    const backups = path.join(userData, 'workspace-backups/project');
    const copies = await fs.readdir(backups);
    expect(
      await fs.readFile(path.join(backups, copies[0], 'my-note.txt'), 'utf8'),
    ).toBe('retained in backup');
  } finally {
    server.closeAllConnections();
    await desktop.close();
    await new Promise<void>((r) => server.close(() => r()));
    await fs.rm(dir, { recursive: true, force: true });
  }
});
