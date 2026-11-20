import { expect, test } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { electron, writeDesktopLauncher } from './desktop-launcher';
import { openActiveFile, selectAppAction } from '../../web-e2e/src/app-actions';
import { styleColorWorkspaceFixture } from '../../fixtures/style-color-workspace';

// The complete theme/container matrices run once in Web production.
// This contract retains the Electron-specific renderer -> native file boundary.
test('Desktop exports the current custom color through Electron native downloads', async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), 'verd-native-color-export-'),
  );
  const workspace = path.join(directory, 'workspace');
  await mkdir(workspace);
  const file = styleColorWorkspaceFixture().files[0];
  const source = file.cells['style-source'];
  source.appearance = { fill: '#f000cc', colorSources: { fill: 'custom' } };
  await writeFile(path.join(workspace, 'Colors.verd'), JSON.stringify(file));
  const launcher = path.join(directory, 'launch.cjs');
  await writeDesktopLauncher(launcher, path.join(directory, 'user-data'));
  const desktop = await electron.launch({
    args: [launcher],
    env: { ...process.env, VERDBOARD_WORKSPACE_PATH: workspace },
  });
  try {
    const page = await desktop.firstWindow();
    await expect(page.locator('.workspace-shell')).toBeVisible();
    await openActiveFile(page);
    await expect(
      page.locator('[data-cell-id="style-source"]').first(),
    ).toHaveAttribute('fill', '#f000cc');
    const target = path.join(directory, 'native-colors.svg');
    await desktop.evaluate(({ session }, target) => {
      (globalThis as any).__nativeDownload = null;
      session.defaultSession.once('will-download', (_event, item) => {
        item.setSavePath(target);
        item.once('done', (_event, state) => {
          (globalThis as any).__nativeDownload = state;
        });
      });
    }, target);
    await selectAppAction(page, '图像导出');
    const dialog = page.getByRole('dialog', { name: '图像导出', exact: true });
    await dialog.getByLabel('Image format').selectOption('svg');
    await dialog.getByLabel('Image background').selectOption('transparent');
    await dialog.getByTestId('image-export-button').click();
    await expect
      .poll(() => desktop.evaluate(() => (globalThis as any).__nativeDownload))
      .toBe('completed');
    const svg = await readFile(target, 'utf8');
    const fills = await page.evaluate(
      (source) =>
        [
          ...new DOMParser()
            .parseFromString(source, 'image/svg+xml')
            .querySelectorAll('[fill]'),
        ].map((node) => node.getAttribute('fill')),
      svg,
    );
    expect(fills).toContain('#f000cc');
  } finally {
    await desktop.close();
    await rm(directory, { recursive: true, force: true });
  }
});
