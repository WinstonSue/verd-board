import { electron, writeDesktopLauncher } from './desktop-launcher';
import { expect, test, type ElectronApplication } from '@playwright/test';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(__dirname, '../../..');

test('native project navigation includes both the canvas and document embeds without changing source files', async ({
  playwright,
}, info) => {
  const directory = await mkdtemp(
    path.join(tmpdir(), 'verd-reference-navigation-'),
  );
  const workspace = path.join(directory, 'workspace');
  let desktop: ElectronApplication | undefined;
  try {
    await cp(path.join(root, 'workspace'), workspace, {
      recursive: true,
      filter: (file) =>
        !path
          .relative(path.join(root, 'workspace'), file)
          .split(path.sep)
          .includes('.verdboard'),
    });
    const chartPath = path.join(
      workspace,
      '架构图/01-项目分层与依赖.verd.json',
    );
    const documentPath = path.join(workspace, '文档/包/包索引.verd-doc.json');
    const originals = await Promise.all([
      readFile(chartPath, 'utf8'),
      readFile(documentPath, 'utf8'),
    ]);
    const launcher = path.join(directory, 'launch.cjs');
    await writeDesktopLauncher(launcher, path.join(directory, 'user-data'));
    const env = { ...process.env, VERDBOARD_WORKSPACE_PATH: workspace };

    desktop = await electron.launch({ args: [launcher], env });
    const page = await desktop.firstWindow();
    await desktop.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1280, 800),
    );
    await expect(page.locator('.workspace-shell')).toBeVisible();
    const file = page.locator(
      '.file-tree-name[title="架构图/01-项目分层与依赖.verd.json"]',
    );
    if (!(await file.isVisible()))
      await page.getByRole('button', { name: '架构图', exact: true }).click();
    await file.click();
    const pane = page.locator('.workspace-pane.is-active');
    const navigation = pane.locator('.workspace-file-navigation');
    await expect(
      navigation.locator('.workspace-file-navigation-title'),
    ).toHaveText('① 项目分层与依赖');
    await expect(navigation.getByTestId('navigation-return')).toHaveCount(0);
    const trigger = navigation.getByTestId('reference-locations-trigger');
    await expect(trigger).toHaveText('被引用 2 处');
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await trigger.click();
      const locations = page.getByRole('menu', {
        name: '引用位置',
        exact: true,
      });
      await expect(locations.getByRole('menuitem')).toHaveCount(2);
      await expect(locations).toContainText('包索引 · 文档 · 1 处');
      await expect(locations).toContainText(
        '青编 VerdBoard · 项目导览 · 画布 · 1 处',
      );
      await expect(locations).toBeInViewport();
      await page.screenshot({
        path: info.outputPath(`reference-locations-${colorScheme}.png`),
      });
      await page.keyboard.press('Escape');
      await expect(trigger).toBeFocused();
    }
    await trigger.click();
    const locations = page.getByRole('menu', { name: '引用位置', exact: true });
    await expect(
      locations.locator('.workspace-menu-group-label').first(),
    ).toContainText('包索引');
    await locations.getByRole('menuitem').first().click();
    await expect(pane.locator('.document-page__title')).toHaveValue('包索引');
    const embed = pane
      .locator('.document-frame-reference')
      .filter({ has: page.getByText('① 项目分层与依赖', { exact: true }) });
    await expect(embed).toBeInViewport();
    await embed.getByRole('button', { name: '打开原图', exact: true }).click();
    await expect(navigation.getByTestId('navigation-return')).toHaveText(
      '返回 包索引',
    );
    await navigation.getByTestId('navigation-return').click();
    await expect(embed).toBeInViewport();
    await desktop.close();
    desktop = undefined;
    expect(
      await Promise.all([
        readFile(chartPath, 'utf8'),
        readFile(documentPath, 'utf8'),
      ]),
    ).toEqual(originals);
  } finally {
    await desktop?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
