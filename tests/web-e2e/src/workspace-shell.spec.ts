import { test, expect, type Page } from '@playwright/test';
import { selectDrawingTool } from './drawing-tools';
import { openSettings } from './app-actions';

const activePane = (page: Page) => page.locator('.workspace-pane.is-active');
const canvas = (page: Page) =>
  activePane(page).locator('svg[aria-label="Frame canvas"]');
const rows = (page: Page) => page.locator('.file-tree-file');
const menu = (page: Page) => page.getByRole('menu', { name: /的操作$/ });
const settings = (page: Page) =>
  page.getByRole('button', { name: '工作区设置', exact: true });

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(canvas(page)).toBeVisible();
  const skip = page.getByRole('button', { name: '跳过', exact: true });
  if (await skip.isVisible()) await skip.click();
});

test('file rows switch tabs and remain compact', async ({ page }) => {
  await page
    .locator('.file-tree-header')
    .getByRole('button', { name: '新建画布', exact: true })
    .click();
  await expect(rows(page)).toHaveCount(2);
  await rows(page).first().locator('.file-tree-name').click();
  await expect(rows(page).first()).toHaveClass(/is-active/);
  await expect(activePane(page).locator('.verd-frame')).toBeVisible();
  expect((await rows(page).first().boundingBox())!.height).toBeLessThanOrEqual(
    30,
  );
  await expect(
    page.locator('.file-tree details, .file-tree summary'),
  ).toHaveCount(0);
});

test('row menus trash and restore files, support keyboard dismissal and pointer anchors', async ({
  page,
}) => {
  await expect(activePane(page).getByTestId('save-status')).toContainText(
    '已保存',
  );
  const row = rows(page).first();
  await row.hover();
  const trigger = row.locator('.file-tree-more');
  await expect(trigger).toHaveCSS('opacity', '1');
  await trigger.click();
  await menu(page)
    .getByRole('menuitem', { name: '移入回收区', exact: true })
    .click();
  await expect(rows(page)).toHaveCount(0);
  await expect(page.locator('.file-tree-count')).toHaveText('1');
  await page.locator('.file-tree-trash-toggle').click();
  await page.getByRole('button', { name: /^还原 / }).click();
  await expect(rows(page)).toHaveCount(1);
  const box = (await row.boundingBox())!;
  const point = { x: box.x + 80, y: box.y + box.height / 2 };
  await page.mouse.click(point.x, point.y, { button: 'right' });
  await expect(menu(page)).toBeVisible();
  const menuBox = (await menu(page).boundingBox())!;
  expect(Math.abs(menuBox.x - point.x)).toBeLessThan(20);
  expect(Math.abs(menuBox.y - point.y)).toBeLessThan(20);
  await page.keyboard.press('Escape');
  await expect(menu(page)).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.keyboard.press('ArrowDown');
  await expect(menu(page).getByRole('menuitem').nth(1)).toBeFocused();
  await page.keyboard.press('Escape');
  await trigger.click();
  await expect(menu(page).getByRole('menuitem').first()).toBeFocused();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('textbox')).toBeFocused();
  await dialog.getByRole('textbox').fill('');
  await expect(
    dialog.getByRole('button', { name: '确定', exact: true }),
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await trigger.click();
  await page.locator('.workspace-sidebar-header').click();
  await expect(menu(page)).toHaveCount(0);
});

test('library highlights navigation and clicking the active tab returns to editing', async ({
  page,
}) => {
  await page.locator('.file-tree-nav').click();
  await expect(page.locator('.file-tree-nav')).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.locator('.chart-library')).toBeVisible();
  await expect(
    page.locator('ylib-tabs').getByRole('tab', { selected: true }),
  ).toHaveCount(0);
  await page.locator('ylib-tabs').getByRole('tab').first().click();
  await expect(page.locator('.chart-library')).toHaveCount(0);
  await expect(canvas(page)).toBeVisible();
});

test('owned subgraphs indent and the breadcrumb stays above the canvas', async ({
  page,
}) => {
  await selectDrawingTool(page, '流程图');
  const bounds = (await canvas(page).boundingBox())!;
  await page.mouse.click(
    bounds.x + bounds.width * 0.28,
    bounds.y + bounds.height * 0.32,
  );
  await page.getByRole('button', { name: '选择', exact: true }).click();
  await canvas(page)
    .locator('[data-cell-kind="frame-reference"]')
    .locator(':scope > rect')
    .first()
    .click({ position: { x: 12, y: 12 } });
  await page.getByTestId('frame-open').click();
  await expect(activePane(page).getByTestId('verd-workflow')).toBeVisible();
  const breadcrumb = activePane(page).locator('.workspace-breadcrumb');
  await expect(breadcrumb).toBeVisible();
  const owned = page.locator('.file-tree-subgraph.is-active');
  await expect(owned).toBeVisible();
  const owner = rows(page)
    .filter({ has: page.locator('.file-tree-twisty[aria-expanded]') })
    .first();
  expect(
    await owned.evaluate((element) =>
      Number((element as HTMLElement).style.getPropertyValue('--depth')),
    ),
  ).toBeGreaterThan(
    await owner.evaluate((element) =>
      Number((element as HTMLElement).style.getPropertyValue('--depth')),
    ),
  );
  expect(
    await breadcrumb.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return element.contains(
        document.elementFromPoint(
          box.x + box.width / 2,
          box.y + box.height / 2,
        ),
      );
    }),
  ).toBe(true);
  const crumbBox = (await breadcrumb.boundingBox())!;
  expect(
    (await activePane(page).locator('.verd-frame').boundingBox())!.y,
  ).toBeGreaterThanOrEqual(crumbBox.y + crumbBox.height);
});

test('workspace settings fill the viewport, retain names, restore focus and persist after reload', async ({
  page,
}) => {
  await settings(page).click();
  const dialog = page.getByTestId('workspace-settings-page');
  await expect(dialog).toBeVisible();
  expect((await dialog.boundingBox())!.width).toBe(page.viewportSize()!.width);
  const width = page.getByTestId('workspace-settings-mind-width');
  await width.fill('320');
  await expect(width).toHaveValue('320');
  await expect(
    page.getByTestId('workspace-settings-mind-width-reset'),
  ).toBeEnabled();
  await width.fill('');
  await expect(width).toHaveValue('');
  await expect(
    page.getByTestId('workspace-settings-mind-width-reset'),
  ).toBeDisabled();
  const input = page.getByTestId('workspace-settings-name');
  await input.fill('团队规划');
  await expect(page.locator('.workspace-sidebar-header')).toHaveText(
    '团队规划',
  );
  await expect(input).toHaveValue('团队规划');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(settings(page)).toBeFocused();
  await expect(activePane(page).getByTestId('save-status')).toContainText(
    '已保存',
  );
  await page.reload();
  await expect(page.locator('.workspace-sidebar-header')).toHaveText(
    '团队规划',
  );
});

test('workspace and canvas settings have their own return destinations', async ({
  page,
}) => {
  await settings(page).click();
  await page.getByTestId('workspace-settings-open-global').click();
  await expect(page.getByTestId('settings-page')).toBeVisible();
  await expect(page.getByTestId('settings-back')).toHaveText('返回工作区设置');
  await page.getByTestId('settings-back').click();
  await expect(page.getByTestId('workspace-settings-page')).toBeVisible();
  await page.getByTestId('workspace-settings-back').click();
  await openSettings(page);
  await expect(page.getByTestId('settings-page')).toBeVisible();
  await expect(page.getByTestId('workspace-settings-page')).toHaveCount(0);
  await expect(page.getByTestId('settings-back')).toHaveText('返回画布');
});
