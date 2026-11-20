import { selectSetting } from '../../helpers/settings-controls';
import {
  desktopMode,
  electron,
  writeDesktopLauncher,
} from './desktop-launcher';
import { test, expect, type ElectronApplication } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('Desktop unified settings keeps personal and project configuration in one dialog', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'verd-settings-'));
  let desktop: ElectronApplication | undefined;
  try {
    const launcher = path.join(directory, 'launch.cjs');
    await writeDesktopLauncher(launcher, path.join(directory, 'user-data'));
    desktop = await electron.launch({
      args: [launcher],
      env: {
        ...process.env,
        VERDBOARD_WORKSPACE_PATH: path.join(directory, 'project'),
      },
    });
    const page = await desktop.firstWindow();
    page.on('pageerror', (e) => console.log('Settings page error:', e.message));
    await expect(page.getByTestId('workspace-my')).toBeVisible({
      timeout: 60000,
    });
    await expect(page).toHaveURL(
      desktopMode === 'prod' ? /^file:\/\// : /^http:\/\/127\.0\.0\.1:7310\//,
    );
    await expect(page.getByTestId('workspace-menu-trigger')).toContainText(
      'project',
    );
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(page.getByTestId('workspace-menu-trigger')).toHaveCSS(
      'font-size',
      '14px',
    );
    const family = await page
      .getByTestId('workspace-menu-trigger')
      .evaluate((el) => getComputedStyle(el).fontFamily);
    await page.getByTestId('workspace-my').click();
    await expect(page.getByTestId('my-page')).toHaveCSS('font-family', family);
    await expect(page.getByTestId('settings-language')).toBeVisible();
    await page.getByTestId('settings-nav-workspace.project').click();
    await expect(page.getByTestId('workspace-settings-name')).toBeVisible();
    await page
      .getByTestId('workspace-settings-description')
      .fill('Desktop project context');
    await page.getByTestId('workspace-settings-description').press('Tab');
    await expect(page.getByTestId('settings-workspace-save')).toContainText(
      '已保存',
    );
    await page.getByTestId('settings-nav-workspace.data').click();
    await expect(page.getByTestId('workspace-storage-location')).toHaveText(
      path.join(directory, 'project'),
    );
    await page.getByTestId('workspace-storage-copy').click();
    await expect
      .poll(() => desktop!.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe(path.join(directory, 'project'));
    await expect(
      page.getByRole('status').filter({ hasText: '已复制' }),
    ).toBeVisible();
    const agent = page.getByTestId('workspace-agent-status');
    await expect(agent).toContainText('外部 AI 助手');
    await expect(agent).toContainText('尚未启用编写工具');
    await agent
      .getByRole('button', { name: '启用或修复编写工具', exact: true })
      .click();

    await expect(agent).toContainText('编写工具已就绪');
    await expect(agent).toContainText('让它读取 AGENTS.md');
    await desktop.evaluate(({ shell }) => {
      shell.openPath = async (target) => {
        (globalThis as any).__openedWorkspacePath = target;
        return '';
      };
    });
    await page.getByTestId('workspace-storage-location').click();
    await expect
      .poll(() =>
        desktop!.evaluate(() => (globalThis as any).__openedWorkspacePath),
      )
      .toBe(path.join(directory, 'project'));
    await page.getByTestId('settings-search').fill('外观');
    await page.locator('.settings-search-result').first().click();
    await expect(
      page.getByTestId('settings-appearance').getByRole('combobox'),
    ).toBeFocused();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await selectSetting(page.getByTestId('settings-language'), 'en');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByTestId('my-page')).toHaveCSS('font-family', family);
    await page.getByTestId('my-back').click();
    await expect(page.getByTestId('workspace-my')).toBeFocused();
  } finally {
    await desktop?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
