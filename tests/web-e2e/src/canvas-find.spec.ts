import { openActiveFile } from './app-actions';
import { expect, test, type Page } from './service-fixture';
import path from 'node:path';
import { openHistoryAction } from './app-actions';
import { persistedWorkspace } from './workspace-nav';

const pane = (page: Page) => page.locator('.workspace-pane.is-active');
const canvas = (page: Page) =>
  pane(page).locator('svg[aria-label="Frame canvas"][data-surface="root"]');

test('canvas find temporarily reveals collapsed Mind without changing saved content or history', async ({
  page,
}) => {
  await page.goto('/');
  await openActiveFile(page);
  await page
    .locator(
      'input[accept=".json,.verd,.verd.json,.verd-doc.json,.md,.markdown"]',
    )
    .setInputFiles(
      path.resolve(__dirname, '../../fixtures/ai-canvas/mind-map.verd.json'),
    );
  await page.locator('[data-file-id="canvas-mind"] .file-tree-name').click();
  await expect(canvas(page)).toBeVisible();
  const hiddenLeaf = canvas(page).locator('[data-cell-id="leaf-beta"]');
  await expect(hiddenLeaf).toHaveCount(0);
  await expect
    .poll(async () => (await persistedWorkspace(page))?.records['canvas-mind'])
    .toBeTruthy();
  const before = (await persistedWorkspace(page))!.records['canvas-mind'];
  const undoDisabled = await (
    await openHistoryAction(page, '撤销')
  ).isDisabled();
  await page.keyboard.press('Escape');
  await canvas(page).focus();
  await page.keyboard.press('ControlOrMeta+f');
  const find = pane(page).getByRole('search', { name: '查找画布' });
  const input = find.getByRole('textbox', { name: '查找', exact: true });
  await expect(input).toBeFocused();
  await input.fill('十月内测');
  await expect(find).toContainText('1/1');
  await expect(hiddenLeaf).toBeVisible();
  await expect(hiddenLeaf).toBeInViewport();
  await expect(input).toBeFocused();
  await input.press('Enter');
  await input.press('Shift+Enter');
  await input.press('Escape');
  await expect(find).toHaveCount(0);
  await expect(hiddenLeaf).toHaveCount(0);
  await expect(canvas(page)).toBeFocused();
  expect((await persistedWorkspace(page))!.records['canvas-mind']).toEqual(
    before,
  );
  await expect(await openHistoryAction(page, '撤销')).toHaveJSProperty(
    'disabled',
    undoDisabled,
  );
  await page.keyboard.press('Escape');
  await pane(page)
    .getByRole('toolbar', { name: 'App actions' })
    .getByRole('button', { name: '查找', exact: true })
    .click();
  await input.fill('不存在的文字');
  await expect(find).toContainText('0/0');
  await expect(
    find.getByRole('button', { name: '下一个', exact: true }),
  ).toBeDisabled();
});
