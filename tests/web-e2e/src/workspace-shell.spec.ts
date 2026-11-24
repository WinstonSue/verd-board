import { createLocalWorkspace } from './service-actions';
import { serviceFixture } from './service-fixture';
import { selectSetting } from '../../helpers/settings-controls';
import { test, expect, type Page } from './service-fixture';
import { selectDrawingTool } from './drawing-tools';
import {
  openSettings,
  openActiveFile,
  openTrash,
  selectWorkspaceAction,
  openWorkspaceMenu,
} from './app-actions';

const activePane = (page: Page) => page.locator('.workspace-pane.is-active');
const canvas = (page: Page) =>
  activePane(page).locator('svg[aria-label="Frame canvas"]');
const rows = (page: Page) => page.locator('.file-tree-file');
const menu = (page: Page) => page.getByRole('menu', { name: /的操作$/ });
const settings = (page: Page) => page.getByTestId('workspace-menu-trigger');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await openActiveFile(page);
  await expect(canvas(page)).toBeVisible();
  const skip = page.getByRole('button', { name: '跳过', exact: true });
  if (await skip.isVisible()) await skip.click();
});

test('file rows switch tabs and remain compact', async ({ page }) => {
  await page.getByTestId('file-tree-new').click();
  await page.getByRole('menuitem', { name: '新建画布', exact: true }).click();
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
    .getByRole('menuitem', { name: '移入回收站', exact: true })
    .click();
  await expect(rows(page)).toHaveCount(0);
  await openTrash(page);
  await expect(page.getByTestId('workspace-trash-count')).toHaveText('1');
  await page.getByRole('button', { name: /^还原 / }).click();
  await page.getByTestId('workspace-settings-back').click();
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
  await expect(menu(page).getByRole('menuitem').first()).toBeFocused();
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
  await page.getByRole('button', { name: '工作区', exact: true }).click();
  await page.getByRole('button', { name: '图表', exact: true }).click();
  await expect(page.locator('.chart-library')).toBeVisible();
  await expect(
    page.locator('ylib-tabs').getByRole('tab', { selected: true }),
  ).toHaveCount(0);
  await page.locator('ylib-tabs').getByRole('tab').first().click();
  await expect(page.locator('.chart-library')).toHaveCount(0);
  await expect(canvas(page)).toBeVisible();
});

test('independent diagrams have one directory entry and file navigation stays above the canvas', async ({
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
    .locator(':scope > [data-frame-header] > rect')
    .first()
    .click({ position: { x: 12, y: 12 } });
  await page.getByTestId('frame-open').click();
  await expect(activePane(page).getByTestId('verd-workflow')).toBeVisible();
  const breadcrumb = activePane(page).locator('.workspace-file-navigation');
  await expect(breadcrumb).toBeVisible();
  const row = page.locator('[data-entry-kind="file"].is-active');
  await expect(row).toBeVisible();
  const id = await row.getAttribute('data-file-id');
  await expect(page.locator(`[data-file-id="${id}"]`)).toHaveCount(1);
  await expect(page.locator('[data-entry-kind="shortcut"]')).toHaveCount(0);
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

test('workspace settings use a centered dialog, retain names, restore focus and persist after reload', async ({
  page,
}) => {
  await createLocalWorkspace(
    page,
    'Settings source',
    serviceFixture(page).root,
  );
  await openActiveFile(page);
  await selectWorkspaceAction(page, '工作区设置');
  const dialog = page.getByTestId('workspace-settings-page');
  await expect(dialog).toBeVisible();
  expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(1040);
  await page.getByTestId('settings-nav-workspace.project').click();
  await selectSetting(
    dialog.getByRole('combobox', { name: '宽度来源' }),
    'custom',
  );
  const width = page.getByTestId('workspace-settings-mind-width');
  await width.fill('320');
  await expect(width).toHaveValue('320');
  await width.press('Tab');
  await selectSetting(
    dialog.getByRole('combobox', { name: '宽度来源' }),
    'inherit',
  );
  await expect(width).toHaveCount(0);
  await page.getByTestId('settings-nav-workspace.project').click();
  const input = page.getByTestId('workspace-settings-name');
  await input.fill('团队规划');
  await input.press('Tab');
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

test('workspace settings and My have independent single-step return destinations', async ({
  page,
}) => {
  await selectWorkspaceAction(page, '工作区设置');
  await expect(page.getByTestId('workspace-settings-page')).toBeVisible();
  await expect(page.getByTestId('workspace-settings-open-global')).toHaveCount(
    0,
  );
  await page.getByTestId('workspace-settings-back').click();
  await expect(settings(page)).toBeFocused();
  const my = await openSettings(page);
  await expect(my).toBeVisible();
  await expect(
    my.getByRole('heading', { name: '通用', exact: true }),
  ).toBeVisible();
  await my.getByTestId('settings-nav-personal.editor').click();
  await expect(
    my.getByRole('heading', { name: '思维导图', exact: true }),
  ).toBeVisible();
  await my.getByTestId('settings-nav-personal.editor').click();
  await expect(
    my.getByRole('heading', { name: '画布交互', exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId('my-open-settings')).toHaveCount(0);
  await page.getByTestId('my-back').click();
  await expect(page.getByTestId('workspace-my')).toBeFocused();
});

test('sidebar My opens global preferences and returns without remounting the canvas', async ({
  page,
}) => {
  await canvas(page).evaluate((element) =>
    element.setAttribute('data-my-instance', 'original'),
  );
  await page.getByTestId('workspace-my').click();
  await expect(
    page.getByRole('heading', { name: '设置', exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId('settings-language')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('workspace-my')).toBeFocused();
  await expect(canvas(page)).toHaveAttribute('data-my-instance', 'original');
});

test('the sidebar toggle sits to the right of Settings and retains keyboard focus', async ({
  page,
}) => {
  const footer = page.locator('.workspace-sidebar-footer');
  const settings = footer.getByRole('button', { name: '设置', exact: true });
  const collapse = footer.getByRole('button', {
    name: '收起侧栏',
    exact: true,
  });
  const settingsBounds = (await settings.boundingBox())!;
  const collapseBounds = (await collapse.boundingBox())!;
  expect(collapseBounds.x).toBeGreaterThanOrEqual(
    settingsBounds.x + settingsBounds.width,
  );
  expect(collapseBounds.y + collapseBounds.height / 2).toBeCloseTo(
    settingsBounds.y + settingsBounds.height / 2,
    0,
  );
  await settings.focus();
  await page.keyboard.press('Tab');
  await expect(collapse).toBeFocused();
  await collapse.press('Enter');
  const expand = footer.getByRole('button', { name: '展开侧栏', exact: true });
  await expect(expand).toBeFocused();
  await expect(settings).toBeHidden();
  await expect(
    page
      .getByRole('navigation', { name: '应用导航' })
      .getByRole('button', { name: '首页' }),
  ).toBeVisible();
  await expand.press('Enter');
  await expect(collapse).toBeFocused();
  await expect(settings).toBeVisible();

  await page.getByTestId('workspace-menu-trigger').press('ArrowDown');
  const menu = page.getByTestId('workspace-switcher');
  await expect(
    menu
      .locator(
        '.workspace-switcher-name:enabled, .workspace-switcher-operation:enabled',
      )
      .first(),
  ).toBeFocused();
  await expect(menu.getByTestId('workspace-open-settings')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('workspace-menu-trigger')).toBeFocused();
  await expect(menu).toBeHidden();
});

test('long workspace names truncate in narrow layouts and retain their full title', async ({
  page,
}) => {
  await createLocalWorkspace(
    page,
    'Long name source',
    serviceFixture(page).root,
  );
  await openActiveFile(page);
  const name = '用于验证侧栏长名称布局的项目工作区'.repeat(3);
  await selectWorkspaceAction(page, '工作区设置');
  await page.getByTestId('workspace-settings-name').fill(name);
  await page.getByTestId('workspace-settings-back').click();
  for (const width of [1280, 800, 390]) {
    await page.setViewportSize({ width, height: 800 });
    const trigger = page.getByTestId('workspace-menu-trigger');
    await expect(trigger).toHaveAttribute('title', name);
    await expect(page.locator('.workspace-menu-name')).toHaveCSS(
      'text-overflow',
      'ellipsis',
    );
    expect((await trigger.boundingBox())!.width).toBeLessThanOrEqual(240);
    const nav = page.getByRole('navigation', { name: '当前工作区' });
    const bounds = (await nav.boundingBox())!;
    const menu = await openWorkspaceMenu(page);
    await expect(menu).toBeInViewport();
    expect(await nav.boundingBox()).toEqual(bounds);
    expect(
      await menu.evaluate(
        (panel, { x, y, width, height }) =>
          panel.contains(
            document.elementFromPoint(x + width / 2, y + height / 2),
          ),
        bounds,
      ),
    ).toBe(true);
    await page.keyboard.press('Escape');
  }
});

test('workspace settings own trash while My contains personal preferences', async ({
  page,
}) => {
  await selectWorkspaceAction(page, '工作区设置');
  const navigation = page.getByRole('navigation', {
    name: '设置栏目',
    exact: true,
  });
  await expect(
    navigation.getByRole('menuitem', { name: '常规', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await navigation
    .getByRole('menuitem', { name: '回收站', exact: true })
    .click();
  await expect(page.getByTestId('workspace-trash')).toContainText('回收站为空');
  await expect(page.getByTestId('workspace-trash')).toContainText('当前工作区');
  await navigation.getByRole('menuitem', { name: '常规', exact: true }).click();
  await expect(page.getByTestId('workspace-settings-name')).toBeVisible();
  expect((await navigation.boundingBox())!.x).toBeLessThan(
    (await page.locator('.settings-sections-main').boundingBox())!.x,
  );
  await page.getByTestId('workspace-settings-back').click();
  await expect(page.getByTestId('workspace-menu-trigger')).toBeFocused();
  await page.getByTestId('workspace-my').click();
  await expect(page.getByTestId('settings-language')).toBeVisible();
  await expect(page.getByTestId('settings-nav-workspace.trash')).toHaveCount(1);
  await page.getByTestId('my-back').click();
  await expect(page.getByTestId('workspace-my')).toBeFocused();
});

test('pinning, ordering and collapsing files stay in sync across the workspace and reload', async ({
  page,
}) => {
  const sidebar = page.locator('.management-sidebar-body');
  await expect(sidebar.getByText('置顶 · 暂无', { exact: true })).toBeVisible();
  await page.getByTestId('file-tree-new').click();
  await page.getByRole('menuitem', { name: '新建文档', exact: true }).click();
  await expect(rows(page)).toHaveCount(2);
  const first = rows(page).first();
  const second = rows(page).last();
  const title = (item: typeof first) =>
    item.locator('.file-tree-label').innerText();
  const firstId = await first.getAttribute('data-file-id');
  const secondId = await second.getAttribute('data-file-id');
  const firstTitle = await title(first);
  const secondTitle = await title(second);
  for (const item of [first, second]) {
    await item.hover();
    await item.locator('.file-tree-more').click();
    await menu(page)
      .getByRole('menuitem', { name: '置顶', exact: true })
      .click();
  }
  const shortcuts = sidebar.locator('.management-shortcut');
  const labels = shortcuts.locator('.management-shortcut-main');
  await expect(labels).toHaveText([firstTitle, secondTitle]);
  await shortcuts.last().hover();
  await shortcuts.last().getByRole('button', { name: '上移置顶文件' }).click();
  await expect(labels).toHaveText([secondTitle, firstTitle]);
  await page.getByRole('button', { name: '工作区', exact: true }).click();
  await expect(
    page
      .getByTestId('workspace-management-page')
      .getByRole('button', { name: '取消置顶', exact: true }),
  ).toHaveCount(2);
  const pinned = sidebar.getByRole('button', { name: '置顶', exact: true });
  await pinned.click();
  await expect(pinned).toHaveAttribute('aria-expanded', 'false');
  await expect
    .poll(async () => {
      const { meta } = await serviceFixture(page).readDisk();
      return (
        meta.config.value['navigation'] as { favorites: string[] } | undefined
      )?.favorites;
    })
    .toEqual([secondId, firstId]);
  await page.reload();
  await expect(pinned).toHaveAttribute('aria-expanded', 'false');
  await pinned.click();
  await expect(labels).toHaveText([secondTitle, firstTitle]);
  await shortcuts
    .first()
    .getByRole('button', { name: secondTitle, exact: true })
    .click();
  await expect(page.locator('.workspace-pane.is-active')).toBeVisible();
  for (const item of [first, second]) {
    await item.hover();
    await item.locator('.file-tree-more').click();
    await menu(page)
      .getByRole('menuitem', { name: '取消置顶', exact: true })
      .click();
  }
  await expect(sidebar.getByText('置顶 · 暂无', { exact: true })).toBeVisible();
});
