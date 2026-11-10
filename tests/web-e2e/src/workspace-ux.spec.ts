import { createLocalWorkspace } from './service-actions';
import { serviceFixture } from './service-fixture';
import { selectSetting } from '../../helpers/settings-controls';
import { test, expect } from './service-fixture';
test('workspace navigation, drafts, quick open and bounded settings', async ({
  page,
}, info) => {
  await page.goto('/');
  await expect(page.locator('.workspace-shell')).toBeVisible();
  await createLocalWorkspace(page, 'UX source', serviceFixture(page).root);
  await page.screenshot({ path: info.outputPath('home.png') });
  await page.getByTestId('workspace-my').click();
  const dialog = page.getByTestId('my-page');
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole('menu', { name: '设置栏目' }).getByRole('menuitem'),
  ).toHaveCount(8);
  await dialog.getByTestId('settings-nav-workspace.project').click();
  const name = page.getByTestId('workspace-settings-name');
  await name.fill('界面测试工作区');
  await expect(page.getByTestId('workspace-menu-trigger')).not.toContainText(
    '界面测试工作区',
  );
  await name.press('Enter');
  await expect(page.getByTestId('workspace-menu-trigger')).toContainText(
    '界面测试工作区',
  );
  await page.screenshot({ path: info.outputPath('settings.png') });
  await page.getByTestId('my-back').click();
  await page.keyboard.press('ControlOrMeta+p');
  await expect(
    page.getByRole('dialog', { name: '快速打开', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath('quick-open.png') });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page
    .locator('.management-navigation nav')
    .getByRole('button', { name: '所有内容', exact: true })
    .click();
  await expect(page.getByTestId('workspace-management-page')).toBeVisible();
  await page.screenshot({ path: info.outputPath('content.png') });
  await page
    .locator('.management-navigation nav')
    .getByRole('button', { name: '搜索', exact: true })
    .click();
  await page
    .getByRole('searchbox', { name: '搜索工作区', exact: true })
    .fill('未命名');
  await expect(
    page.locator('.management-page .management-result').first(),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath('search.png') });
  for (const [width, height] of [
    [1440, 900],
    [1024, 768],
    [800, 600],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await page.getByTestId('workspace-my').click();
    await page.screenshot({ path: info.outputPath(`settings-${width}.png`) });
    if (width === 390) {
      await page.getByTestId('settings-nav-workspace.project').click();
      await page.screenshot({
        path: info.outputPath('settings-mobile-content.png'),
      });
    }
    await page.getByTestId('my-back').click();
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByTestId('workspace-my').click();
  await selectSetting(page.getByTestId('settings-appearance'), 'dark');
  await page.getByTestId('my-back').click();
  for (const [width, height] of [
    [1440, 900],
    [1024, 768],
    [800, 600],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await page.getByTestId('workspace-my').click();
    await page.screenshot({
      path: info.outputPath(`settings-dark-${width}.png`),
    });
    await page.getByTestId('my-back').click();
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByTestId('workspace-menu-trigger').click();
  await page.screenshot({ path: info.outputPath('switcher-dark.png') });
  await page.keyboard.press('Escape');
});
