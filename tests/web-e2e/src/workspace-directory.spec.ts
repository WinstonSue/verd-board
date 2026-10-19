import { expect, test, type Page } from '@playwright/test';
import { selectDrawingTool } from './drawing-tools';
import { openTrash } from './app-actions';
import { directoryRow, trashFolder } from './workspace-file-actions';
import { persistedWorkspace } from './workspace-nav';

const canvas = (page: Page) =>
  page.locator(
    '.workspace-pane.is-active svg[aria-label="Frame canvas"][data-surface="root"]',
  );
const source = (page: Page, id: string) =>
  page.locator(`[data-entry-kind="file"][data-file-id="${id}"]`);
const shortcut = (page: Page, id: string) =>
  page.locator(`[data-entry-kind="shortcut"][data-file-id="${id}"]`);
const action = async (
  page: Page,
  row: ReturnType<typeof source>,
  name: string,
) => {
  await row.locator('.file-tree-more').click();
  await page.getByRole('menuitem', { name, exact: true }).click();
};
const saved = (page: Page) =>
  expect(
    page.getByTestId('save-status').locator('visible=true'),
  ).toHaveAttribute('data-save-state', /^(saved|idle)$/);

const createChart = async (page: Page) => {
  await page.goto('/');
  await expect(canvas(page)).toBeVisible();
  const skip = page.getByRole('button', { name: '跳过', exact: true });
  if (await skip.isVisible()) await skip.click();
  await selectDrawingTool(page, '流程图');
  const bounds = (await canvas(page).boundingBox())!;
  await page.mouse.click(
    bounds.x + bounds.width * 0.3,
    bounds.y + bounds.height * 0.35,
  );
  await page.getByRole('button', { name: '选择', exact: true }).click();
  await canvas(page)
    .locator('[data-cell-kind="frame-reference"] > [data-frame-header] > rect')
    .first()
    .click({ position: { x: 12, y: 12 } });
  await page.getByTestId('frame-open').click();
  await expect(
    page.locator('[data-entry-kind="shortcut"].is-active'),
  ).toBeVisible();
  return (await page
    .locator('[data-entry-kind="shortcut"].is-active')
    .getAttribute('data-file-id'))!;
};

test('owned charts stay in real directories and shortcuts locate, open and track trash and restore', async ({
  page,
}) => {
  const id = await createChart(page);
  await saved(page);
  await canvas(page).evaluate((node) =>
    node.setAttribute('data-directory-instance', 'original'),
  );
  await expect(source(page, id)).toBeVisible();
  await expect(shortcut(page, id)).toBeVisible();
  await source(page, id).locator('.file-tree-name').click();
  await shortcut(page, id).locator('.file-tree-name').click();
  await expect(page.getByRole('tab')).toHaveCount(2);
  await expect(page.locator('.workspace-pane')).toHaveCount(2);
  await expect(canvas(page)).toHaveAttribute(
    'data-directory-instance',
    'original',
  );
  await action(page, source(page, id), '重命名/移动');
  const rename = page.getByRole('dialog');
  await rename.getByRole('textbox').fill('架构图/深入/流程.verd.json');
  await rename.getByRole('button', { name: '确定', exact: true }).click();
  await expect(shortcut(page, id).locator('.file-tree-name')).toHaveAttribute(
    'title',
    '快捷入口: 架构图/深入/流程.verd.json',
  );
  await action(page, shortcut(page, id), '在文件夹中显示');
  await expect(
    directoryRow(page, '架构图').locator('.file-tree-dir-toggle'),
  ).toHaveAttribute('aria-expanded', 'true');
  await expect(
    directoryRow(page, '深入').locator('.file-tree-dir-toggle'),
  ).toHaveAttribute('aria-expanded', 'true');
  await expect(source(page, id).locator('.file-tree-name')).toBeFocused();
  await expect(canvas(page)).toHaveAttribute(
    'data-directory-instance',
    'original',
  );
  await saved(page);
  await expect
    .poll(async () => (await persistedWorkspace(page))?.paths[id])
    .toBe('架构图/深入/流程.verd.json');
  await page.reload();
  await expect(source(page, id)).toBeVisible();
  await action(page, source(page, id), '移入回收站');
  await expect(source(page, id)).toHaveCount(0);
  await expect(shortcut(page, id)).toHaveCount(0);
  await openTrash(page);
  await page
    .getByRole('button', { name: '还原 流程.verd.json', exact: true })
    .click();
  await page.getByTestId('workspace-settings-back').click();
  await expect(source(page, id)).toBeVisible();
  await expect(shortcut(page, id)).toBeVisible();
  await trashFolder(page, '架构图');
  await expect(source(page, id)).toHaveCount(0);
  await expect(shortcut(page, id)).toHaveCount(0);
  await openTrash(page);
  await page.getByRole('button', { name: '还原 架构图', exact: true }).click();
  await page.getByTestId('workspace-settings-back').click();
  await expect(source(page, id)).toBeVisible();
  await expect(shortcut(page, id)).toBeVisible();
});

test('library ownership changes move shortcuts, preserve file paths and undo without duplicating editors', async ({
  page,
}) => {
  const id = await createChart(page);
  const path = await source(page, id)
    .locator('.file-tree-name')
    .getAttribute('title');
  await page
    .locator('.file-tree-header')
    .getByRole('button', { name: '新建画布', exact: true })
    .click();
  const ownerId = (await page
    .locator('[data-entry-kind="file"].is-active')
    .getAttribute('data-file-id'))!;
  const change = async (value: string) => {
    await page.locator('.file-tree-nav').click();
    const row = page
      .locator('.chart-library tbody tr')
      .filter({ hasText: path! });
    await row.getByRole('button', { name: /^调整归属 / }).click();
    const dialog = page.getByRole('dialog', { name: '调整归属', exact: true });
    await dialog
      .getByRole('combobox', { name: '归属', exact: true })
      .selectOption(value);
    await dialog.getByRole('button', { name: '确定', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await source(page, id).locator('.file-tree-name').click();
    await saved(page);
    await expect(source(page, id).locator('.file-tree-name')).toHaveAttribute(
      'title',
      path!,
    );
  };
  await change(`owner:${ownerId}`);
  const newOwner = source(page, ownerId).locator('..');
  await expect(newOwner.locator('[data-entry-kind="shortcut"]')).toHaveCount(1);
  await expect(page.getByRole('tab')).toHaveCount(3);
  await change('standalone');
  await expect(shortcut(page, id)).toHaveCount(0);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(shortcut(page, id)).toBeVisible();
  await expect(newOwner.locator('[data-entry-kind="shortcut"]')).toHaveCount(1);
  await change('unorganized');
  await expect(shortcut(page, id)).toHaveCount(0);
  await expect(source(page, id)).toBeVisible();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(shortcut(page, id)).toBeVisible();
  await action(page, source(page, ownerId), '移入回收站');
  await expect(shortcut(page, id)).toHaveCount(0);
  await expect(source(page, id)).toBeVisible();
  await openTrash(page);
  await page
    .getByTestId('workspace-trash')
    .getByRole('button', { name: /^还原 / })
    .click();
  await page.getByTestId('workspace-settings-back').click();
  await expect(shortcut(page, id)).toBeVisible();
  await expect(source(page, id).locator('.file-tree-name')).toHaveAttribute(
    'title',
    path!,
  );
});
