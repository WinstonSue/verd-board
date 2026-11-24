import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  expectWorkspaceSearchFocus,
  openProductHome,
  openWorkspaceMenu,
} from './app-actions';
import { chooseLocalDirectory } from './service-actions';
import { serviceFixture } from './service-fixture';
import { expect, test } from './service-fixture';

for (const appearance of ['light', 'dark'] as const) {
  test(`workspace hover, selection and focus stay distinct in ${appearance} mode`, async ({
    page,
    localService,
  }) => {
    await Promise.all([
      writeFile(path.join(localService.workspace, 'notes.txt'), 'notes'),
      writeFile(path.join(localService.workspace, 'Broken.verd'), '{'),
    ]);
    await page.addInitScript((mode) => {
      localStorage.setItem('verdboard.appearance', mode);
    }, appearance);
    await page.setViewportSize({
      width: appearance === 'light' ? 1280 : 800,
      height: 800,
    });
    await page.goto('/');
    await page.getByTestId('file-tree-new').click();
    await page.getByRole('menuitem', { name: '新建文档', exact: true }).click();
    const nav = page.getByRole('navigation', { name: '当前工作区' });
    const workspace = nav.getByRole('button', { name: '工作区', exact: true });
    const search = nav.getByRole('button', { name: '搜索', exact: true });
    await workspace.click();
    await expectWorkspaceSearchFocus(page);
    const activeFill = await workspace.evaluate(
      (node) => getComputedStyle(node).backgroundColor,
    );
    await search.hover();
    const hoverFill = await search.evaluate(
      (node) => getComputedStyle(node).backgroundColor,
    );
    expect(hoverFill).not.toBe(activeFill);
    expect(hoverFill).not.toBe('rgba(0, 0, 0, 0)');

    const content = page.getByTestId('workspace-management-page');
    for (const title of ['未命名文档', 'notes.txt', 'Broken.verd']) {
      const row = content.locator('.management-result').filter({
        has: page.getByRole('checkbox', { name: '选择 ' + title, exact: true }),
      });
      const open = row.locator('.management-result-open');
      const select = row.getByRole('checkbox');
      await open.hover();
      await expect(row).toHaveCSS('background-color', hoverFill);
      await expect(open).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await expect(open).toHaveCSS('border-top-width', '0px');
      await expect(open).toHaveCSS('outline-style', 'none');
      await select.check();
      await open.hover();
      await expect(row).toHaveCSS('background-color', activeFill);
      await select.uncheck();
      await select.focus();
      await page.keyboard.press('Tab');
      await expect(open).toBeFocused();
      await expect(open).toHaveCSS('outline-width', '1px');
      await expect(open).toHaveCSS('outline-style', 'solid');
    }

    const tabs = page.locator('.content-tabs');
    const all = tabs.getByRole('button', { name: '全部内容', exact: true });
    const charts = tabs.getByRole('button', { name: '图表', exact: true });
    await all.hover();
    await expect(all).toHaveCSS('background-color', activeFill);
    await expect(all).toHaveCSS('box-shadow', 'none');
    await charts.hover();
    await expect(charts).toHaveCSS('background-color', hoverFill);
    await expect(charts).toHaveCSS('border-top-width', '0px');
    await charts.click();
    await expect(charts).toHaveAttribute('aria-current', 'page');
    await expect(charts).toHaveCSS('background-color', activeFill);
    await expect(charts).toHaveCSS('box-shadow', 'none');
    await expect(all).not.toHaveAttribute('aria-current', 'page');

    await search.click();
    const dialog = page.getByTestId('workspace-search-dialog');
    const searchAll = dialog.getByRole('button', { name: '全部', exact: true });
    await searchAll.hover();
    await expect(searchAll).toHaveCSS('background-color', activeFill);
    await expect(searchAll).toHaveCSS('border-top-width', '0px');
    await dialog.getByRole('combobox').fill('notes.txt');
    const hit = dialog.getByRole('option', { name: /notes\.txt/ });
    await hit.hover();
    await expect(hit).toHaveAttribute('aria-selected', 'true');
    await expect(hit).toHaveCSS('background-color', activeFill);
    await expect(hit).toHaveCSS('border-top-width', '0px');
    await page.keyboard.press('Escape');
    await expect(charts).toHaveAttribute('aria-current', 'page');

    await page.emulateMedia({ forcedColors: 'active' });
    await workspace.focus();
    await page.keyboard.press('Tab');
    await expect(search).toBeFocused();
    await expect(search).toHaveCSS('outline-style', 'solid');
    await expect(search).toHaveCSS('outline-width', '1px');
  });
}

test('workspace content, pinned files, search and restoration share the workspace', async ({
  page,
}) => {
  await page.goto('/');
  const workspace = page.getByTestId('workspace-management-page');
  await expect(workspace.getByRole('heading', { level: 1 })).toHaveText(
    '工作区',
  );
  await page.getByTestId('file-tree-new').click();
  await page.getByRole('menuitem', { name: '新建文档', exact: true }).click();
  await expect(workspace).toHaveCount(0);
  const row = page.locator('.file-tree-row[data-entry-kind=file]').last();
  await expect(row).toBeVisible();
  const sidebar = page.getByRole('navigation', { name: '当前工作区' });
  await sidebar.getByRole('button', { name: '工作区', exact: true }).click();
  await expect(
    workspace.getByRole('heading', { name: '工作区', exact: true }),
  ).toBeVisible();
  const item = workspace.locator('.management-result').last();
  await item.getByRole('button', { name: '置顶', exact: true }).click();
  const pinned = page
    .locator('.management-sidebar-body .vm-sidebar-section')
    .first();
  await expect(pinned.getByText('未命名文档', { exact: true })).toBeVisible();

  const home = await openProductHome(page);
  await expect(
    home.getByRole('heading', { name: '我的工作区', exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(home).toBeVisible();
  await expect(pinned.getByText('未命名文档', { exact: true })).toBeVisible();

  await page.keyboard.press('ControlOrMeta+p');
  const search = page.getByTestId('workspace-search-dialog');
  await expect(
    search.getByRole('button', { name: '标题与路径' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(home).toBeVisible();
  await search.getByRole('combobox').fill('未命名文档.verd-doc.json');
  await expect(search.getByRole('option')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(search).toHaveCount(0);
  await expect(home).toHaveCount(0);
  await expect(
    page.locator('.workspace-pane.is-active .document-page'),
  ).toBeVisible();

  const trigger = sidebar.getByRole('button', { name: '搜索', exact: true });
  await trigger.click();
  await expect(
    search.getByRole('button', { name: '全部', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(
    page.locator('.workspace-pane.is-active .document-page'),
  ).toBeVisible();
});

test('finds user workspaces by directory, even when named like the bundled recommendations', async ({
  page,
}) => {
  await page.goto('/');
  const menu = await openWorkspaceMenu(page);
  const name = '文档编写推荐库';
  await menu.getByRole('button', { name: '新建工作区', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建工作区' });
  await dialog.getByLabel('名称', { exact: true }).fill(name);
  await dialog
    .getByRole('button', { name: '选择父目录…', exact: true })
    .click();
  await chooseLocalDirectory(page, serviceFixture(page).root);
  await dialog.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page.getByTestId('workspace-menu-trigger')).toContainText(name);
  const home = await openProductHome(page);
  await home.getByTestId('workspace-open-patterns').click();
  await expect(page.getByRole('tab', { selected: true })).toContainText(name);
  await expect(page.getByTestId('workspace-readonly')).toHaveText('只读');
  const editor = page.locator('.workspace-pane.is-active .ProseMirror');
  await expect(editor).toHaveAttribute('contenteditable', 'false');
  await editor.click();
  await page.keyboard.press('End');
  await page.keyboard.type('Read only edit attempt');
  await expect(editor).not.toContainText('Read only edit attempt');
  await openWorkspaceMenu(page);
  await expect(
    menu.locator('.workspace-switcher-text[title="文档编写推荐库"]'),
  ).toHaveCount(1);
  await expect(
    menu.locator('.workspace-switcher-row[aria-current]'),
  ).toHaveCount(0);
  await openProductHome(page);
  const search = home.getByRole('searchbox');
  const list = home.getByRole('list');
  await search.fill('missing-workspace');
  await expect(list.getByRole('listitem')).toHaveCount(0);
  await search.fill(serviceFixture(page).root.split('/').pop()!);
  const row = list.getByRole('button', { name: /文档编写推荐库/ });
  await expect(row).toHaveCount(1);
  await search.hover();
  const restingFill = await row.evaluate(
    (el) => getComputedStyle(el).backgroundColor,
  );
  const bounds = (await row.boundingBox())!;
  const edge = { x: bounds.width - 12, y: bounds.height / 2 };
  await row.hover({ position: edge });
  await expect(row).not.toHaveCSS('background-color', restingFill);
  await row.click({ position: edge });
  await expect(page.getByTestId('workspace-management-page')).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(0);

  await (
    await openProductHome(page)
  )
    .getByTestId('workspace-open-builtin')
    .click();
  await expect(page.getByTestId('workspace-menu-trigger')).toHaveText(
    '系统介绍',
  );
  await expect(page.getByTestId('workspace-readonly')).toBeVisible();
  await expect(editor).toHaveAttribute('contenteditable', 'false');
  const homes = await openProductHome(page);
  await homes.getByRole('button', { name, exact: true }).click();
  await expect(page.getByTestId('workspace-readonly')).toHaveCount(0);
  await page.getByTestId('file-tree-new').click();
  await page.getByRole('menuitem', { name: '新建文档', exact: true }).click();
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await editor.fill('Writable workspace after switching');
  await expect(editor).toContainText('Writable workspace after switching');
});

test('searches unsaved document text and selects the matching characters', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByTestId('file-tree-new').click();
  await page.getByRole('menuitem', { name: '新建文档', exact: true }).click();
  const editor = page
    .locator('.workspace-pane.is-active .ProseMirror[contenteditable=true]')
    .last();
  await editor.fill('Alpha 知识管理 Beta');
  await page.keyboard.press('ControlOrMeta+Shift+f');
  const search = page.getByTestId('workspace-search-dialog');
  await expect(
    search.getByRole('button', { name: '全部', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await search.getByRole('button', { name: '正文', exact: true }).click();
  const input = search.getByRole('combobox');
  await input.fill('知识管理');
  const hit = search.getByRole('option', { name: /知识管理/ });
  await expect(hit.locator('mark')).toHaveText('知识管理');
  await expect(hit.locator('mark')).not.toHaveCSS(
    'background-color',
    'rgb(255, 255, 0)',
  );
  await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
  await expect(search).toBeVisible();
  await input.press('Enter');
  await expect(search).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString()))
    .toBe('知识管理');
});

test('drags native files into folders and renames folders through the organizer', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByTestId('file-tree-new').click();
  await page.getByRole('menuitem', { name: '新建文档', exact: true }).click();
  await page.getByTestId('file-tree-new').click();
  await page.getByRole('menuitem', { name: '新建文件夹', exact: true }).click();
  const prompt = page.getByRole('dialog');
  await prompt.getByRole('textbox').fill('Projects');
  await prompt.getByRole('button', { name: '确定', exact: true }).click();
  const folder = page.locator('[data-entry-path="Projects"]');
  await expect(folder).toBeVisible();
  const file = page
    .locator('[data-entry-kind=file]')
    .filter({ hasText: '未命名文档' });
  await file.dragTo(folder);
  await folder.locator('.file-tree-dir-toggle').click();
  await expect(
    page.locator('[data-entry-path="Projects/未命名文档.verd-doc.json"]'),
  ).toBeVisible();
  await folder.locator('.file-tree-more').click();
  await page.getByRole('menuitem', { name: '重命名', exact: true }).click();
  const rename = page.getByRole('dialog', { name: '重命名', exact: true });
  await rename.getByRole('textbox').fill('Archive');
  await rename.getByRole('button', { name: '确定', exact: true }).click();
  await expect(
    page.locator('[data-entry-path="Archive/未命名文档.verd-doc.json"]'),
  ).toBeVisible();
});

test('manual sorting mixes files and folders without changing their paths', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByTestId('file-tree-new').click();
  await page.getByRole('menuitem', { name: '新建文档', exact: true }).click();
  await page.getByTestId('file-tree-new').click();
  await page.getByRole('menuitem', { name: '新建文件夹', exact: true }).click();
  const prompt = page.getByRole('dialog');
  await prompt.getByRole('textbox').fill('Projects');
  await prompt.getByRole('button', { name: '确定', exact: true }).click();
  await page.getByTestId('file-tree-options').click();
  await page
    .getByRole('menuitemradio', { name: '手动排序', exact: true })
    .click();
  const file = page.locator('[data-entry-path="未命名文档.verd-doc.json"]');
  const folder = page.locator('[data-entry-path="Projects"]');
  await file.dragTo(folder, { targetPosition: { x: 70, y: 2 } });
  await expect(
    page.locator('.management-tree [data-entry-path]').first(),
  ).toHaveAttribute('data-entry-path', '未命名文档.verd-doc.json');
  await expect(folder).toBeVisible();
});

test('chart tabs remain siblings and title results show the path once', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByTestId('file-tree-new').click();
  await page.getByRole('menuitem', { name: '新建画布', exact: true }).click();
  await page
    .locator('.management-navigation nav')
    .getByRole('button', { name: '工作区', exact: true })
    .click();
  const tabs = page.locator('.content-tabs');
  await tabs.getByRole('button', { name: '图表', exact: true }).click();
  await expect(
    tabs.getByRole('button', { name: '全部内容', exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator('.chart-library')
      .getByRole('button', { name: '返回编辑', exact: true }),
  ).toHaveCount(0);
  const chart = page.locator('.chart-library tbody tr').first();
  const idleFill = await chart.evaluate(
    (row) => getComputedStyle(row).backgroundColor,
  );
  await chart.hover();
  await expect(chart).not.toHaveCSS('background-color', idleFill);
  await chart.getByRole('button').first().click();
  await expect(page.getByTestId('content-list-return')).toBeVisible({
    timeout: 10000,
  });
  await page.getByTestId('content-list-return').click();
  await expect(
    tabs.getByRole('button', { name: '图表', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await tabs.getByRole('button', { name: '全部内容', exact: true }).click();
  await expect(page.getByTestId('workspace-management-page')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+Shift+f');
  const search = page.getByTestId('workspace-search-dialog');
  await search.getByRole('combobox').fill('未命名画布');
  const result = search.getByRole('option').first();
  await expect(result).toBeVisible();
  const filePath = await result.locator('small').textContent();
  expect((await result.textContent())?.split(filePath!).length).toBe(2);
});
