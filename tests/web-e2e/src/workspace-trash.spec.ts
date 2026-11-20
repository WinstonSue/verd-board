import { openHistoryAction } from './app-actions';
import { selectHistoryAction } from './app-actions';
import { openTrash, setAppLanguage } from './app-actions';
import { test, expect } from './service-fixture';
import {
  createFolder,
  directoryRow,
  folderAction,
  trashFolder,
} from './workspace-file-actions';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  if (
    !(await page
      .locator('.workspace-pane.is-active svg[aria-label="Frame canvas"]')
      .isVisible())
  )
    await page
      .locator('.file-tree-row[data-entry-kind="file"]')
      .first()
      .click();
  await expect(
    page.locator('.workspace-pane.is-active svg[aria-label="Frame canvas"]'),
  ).toBeVisible();
  const skip = page.getByRole('button', { name: '跳过', exact: true });
  if (await skip.isVisible()) await skip.click();
});

test('folders with nested documents, canvases and empty directories trash and restore together', async ({
  page,
}) => {
  await createFolder(page, '归档');
  await createFolder(page, '子项', '归档');
  await createFolder(page, '空目录', '子项');
  await folderAction(page, '归档', '在此新建画布');
  await folderAction(page, '子项', '在此新建文档');
  await expect(
    directoryRow(page, '归档').locator('..').locator('.file-tree-name'),
  ).toHaveCount(2);
  const paths = await directoryRow(page, '归档')
    .locator('..')
    .locator('.file-tree-name')
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('title')),
    );
  expect(paths).toHaveLength(2);
  await folderAction(page, '归档', '移入回收站');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '取消', exact: true })
    .click();
  await expect(directoryRow(page, '归档')).toBeVisible();
  await trashFolder(page, '归档');
  await openTrash(page);
  await expect(page.getByTestId('workspace-trash-count')).toHaveText('1');
  await page.getByTestId('workspace-settings-back').click();
  await selectHistoryAction(page, '撤销');
  await expect(directoryRow(page, '归档')).toBeVisible();
  await selectHistoryAction(page, '重做');
  await expect(directoryRow(page, '归档')).toHaveCount(0);
  await openTrash(page);
  await page.getByRole('button', { name: '还原 归档', exact: true }).click();
  await expect(page.getByTestId('workspace-trash')).toContainText('回收站为空');
  await page.getByTestId('workspace-settings-back').click();
  await expect(directoryRow(page, '空目录')).toBeVisible();
  await page.reload();
  await expect(directoryRow(page, '空目录')).toBeVisible();
  await expect(
    directoryRow(page, '归档').locator('..').locator('.file-tree-name'),
  ).toHaveCount(2);
  expect(
    await directoryRow(page, '归档')
      .locator('..')
      .locator('.file-tree-name')
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute('title')),
      ),
  ).toEqual(paths);
});

test('permanent deletion and empty trash require confirmation and persist after reload', async ({
  page,
}) => {
  await createFolder(page, '删除甲');
  await createFolder(page, '删除乙');
  await trashFolder(page, '删除甲');
  await trashFolder(page, '删除乙');
  await openTrash(page);
  await page
    .getByRole('button', { name: '永久删除 删除甲', exact: true })
    .click();
  await expect(page.getByTestId('workspace-action-confirmation')).toContainText(
    '无法从回收站还原',
  );
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('workspace-action-confirmation')).toHaveCount(
    0,
  );
  await expect(page.getByTestId('workspace-settings-page')).toBeVisible();
  await expect(page.getByTestId('workspace-trash-count')).toHaveText('2');
  await page
    .getByRole('button', { name: '永久删除 删除甲', exact: true })
    .click();
  await page
    .getByTestId('workspace-action-confirmation')
    .getByRole('button', { name: '确定', exact: true })
    .click();
  await expect(page.getByTestId('workspace-trash-count')).toHaveText('1');
  await page.getByRole('button', { name: '清空回收站', exact: true }).click();
  await expect(page.getByTestId('workspace-action-confirmation')).toContainText(
    '无法从回收站还原',
  );
  await page
    .getByTestId('workspace-action-confirmation')
    .getByRole('button', { name: '取消', exact: true })
    .click();
  await expect(page.getByTestId('workspace-trash-count')).toHaveText('1');
  await page.getByRole('button', { name: '清空回收站', exact: true }).click();
  await page
    .getByTestId('workspace-action-confirmation')
    .getByRole('button', { name: '确定', exact: true })
    .click();
  await expect(page.getByTestId('workspace-trash')).toContainText('回收站为空');
  await page.getByTestId('workspace-settings-back').click();
  await expect(await openHistoryAction(page, '撤销')).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.reload();
  await openTrash(page);
  await expect(page.getByTestId('workspace-trash')).toContainText('回收站为空');
  await page.getByTestId('workspace-settings-back').click();
  await expect(directoryRow(page, '删除甲')).toHaveCount(0);
  await expect(directoryRow(page, '删除乙')).toHaveCount(0);
});

test('readonly workspace trash remains visible and its menu works in narrow English layouts', async ({
  page,
}) => {
  await createFolder(page, '只读回收资料');
  await trashFolder(page, '只读回收资料');
  await page.goto('/?readonly=1');
  await openTrash(page);
  await expect(page.getByTestId('workspace-trash')).toContainText(
    '只读回收资料',
  );
  await expect(
    page.getByTestId('workspace-trash').getByRole('button'),
  ).toHaveCount(0);
  await page.getByTestId('workspace-settings-back').click();
  await setAppLanguage(page, 'en');
  await openTrash(page);
  await expect(page.getByTestId('workspace-trash')).toContainText(
    'Current workspace',
  );
  for (const width of [1280, 800, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const settings = page.getByTestId('workspace-settings-page');
    if (width < 760) await settings.locator('.settings-mobile-back').click();
    const navigation = settings.getByRole('navigation', {
      name: 'Settings sections',
      exact: true,
    });
    await expect(navigation).toBeVisible();
    const main = settings.locator('.settings-sections-main');
    if (width >= 760)
      expect((await navigation.boundingBox())!.x).toBeLessThan(
        (await main.boundingBox())!.x,
      );
    expect(
      await main.evaluate(
        (element) => element.scrollWidth > element.clientWidth,
      ),
    ).toBe(false);
    await navigation
      .getByRole('menuitem', { name: 'General', exact: true })
      .click();
    await expect(page.getByTestId('workspace-settings-name')).toBeVisible();
    expect(
      await main.evaluate(
        (element) => element.scrollWidth > element.clientWidth,
      ),
    ).toBe(false);
    await page.screenshot({
      path: test.info().outputPath(`settings-general-${width}.png`),
    });
    if (width < 760) await settings.locator('.settings-mobile-back').click();
    await navigation
      .getByRole('menuitem', { name: 'Trash', exact: true })
      .click();
    await page.screenshot({
      path: test.info().outputPath(`settings-trash-${width}.png`),
    });
  }
  await page.getByTestId('workspace-settings-back').click();
  await expect(page.getByTestId('workspace-menu-trigger')).toBeFocused();
});
