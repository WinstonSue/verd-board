import { expect, test } from '@playwright/test';
test('home, content, favorites, search and restoration share the workspace', async ({
  page,
}) => {
  await page.goto('/');
  const home = page.getByTestId('workspace-management-page');
  await expect(home.getByRole('heading', { level: 1 })).toBeVisible();
  await page.getByTestId('management-new').click();
  await page.getByRole('menuitem', { name: '新建文档', exact: true }).click();
  await expect(home).toHaveCount(0);
  const row = page.locator('.file-tree-row[data-entry-kind=file]').last();
  await expect(row).toBeVisible();
  await page
    .locator('.management-navigation nav')
    .getByRole('button', { name: '所有内容', exact: true })
    .click();
  await expect(
    home.getByRole('heading', { name: '所有内容', exact: true }),
  ).toBeVisible();
  const item = home.locator('.management-result').last();
  await item.getByRole('button', { name: '收藏', exact: true }).click();
  await page
    .locator('.management-navigation nav')
    .getByRole('button', { name: '首页', exact: true })
    .click();
  await expect(
    home.getByRole('heading', { name: '收藏', exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(home.getByRole('heading', { level: 1 })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+Shift+f');
  await expect(
    home.getByRole('heading', { name: '搜索', exact: true }),
  ).toBeVisible();
  await home.getByRole('searchbox').fill('未命名');
  await expect(home.locator('.management-result').first()).toBeVisible();
  await home.locator('.management-result').first().click();
  await expect(home).toHaveCount(0);
});
test('creates a separate web workspace and switches back without deleting data', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByTestId('workspace-menu-trigger').click();
  const dialog = page.locator('dialog[open]').last();
  await dialog.getByRole('button', { name: '新建工作区', exact: true }).click();
  await dialog.getByRole('textbox').fill('测试资料库');
  await dialog.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page.getByTestId('workspace-menu-trigger')).toContainText(
    '测试资料库',
  );
  await page.reload();
  await expect(page.getByTestId('workspace-menu-trigger')).toContainText(
    '测试资料库',
  );
  await page.getByTestId('workspace-menu-trigger').click();
  await dialog.getByRole('button', { name: 'default', exact: true }).click();
  await expect(page.getByTestId('workspace-menu-trigger')).not.toContainText(
    '测试资料库',
  );
});

test('searches unsaved document text and selects the matching characters', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByTestId('management-new').click();
  await page.getByRole('menuitem', { name: '新建文档', exact: true }).click();
  const editor = page
    .locator('.workspace-pane.is-active .ProseMirror[contenteditable=true]')
    .last();
  await editor.fill('Alpha 知识管理 Beta');
  await page.keyboard.press('ControlOrMeta+Shift+f');
  const search = page.getByTestId('workspace-management-page');
  await expect(
    search.getByRole('heading', { name: '搜索', exact: true }),
  ).toBeVisible();
  await search.getByRole('searchbox').fill('知识管理');
  await search.locator('.management-result').first().click();
  await expect(search).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString()))
    .toBe('知识管理');
});

test('drags native files into folders and renames folders through the organizer', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByTestId('management-new').click();
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
  await page.getByTestId('management-new').click();
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
