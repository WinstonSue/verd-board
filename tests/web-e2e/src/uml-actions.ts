import { expect, type Page } from '@playwright/test';
import { selectDrawingTool } from './drawing-tools';
import { selectAppAction } from './app-actions';
export const umlCanvas = (page: Page) =>
  page.locator('svg[aria-label="Frame canvas"][data-surface="root"]:visible');
export async function createUmlDiagram(page: Page, type: 'class' | 'sequence') {
  const skip = page.getByRole('button', { name: '跳过', exact: true });
  if (await skip.isVisible()) await skip.click();
  await selectDrawingTool(page, type === 'class' ? 'UML 类图' : 'UML 时序图');
  const bounds = (await umlCanvas(page).boundingBox())!;
  await page.mouse.click(bounds.x + 280, bounds.y + 180);
  await page.getByRole('button', { name: '选择', exact: true }).click();
  await umlCanvas(page).locator('[data-frame-title-id]').last().click();
  await page.getByTestId('frame-open').locator('visible=true').click();
  await expect(
    page.getByTestId(`verd-uml-${type}`).locator('visible=true'),
  ).toBeVisible();
}
export async function importUmlText(page: Page, text: string) {
  await selectAppAction(page, '文本导入');
  const dialog = page.getByRole('dialog', { name: '文本导入', exact: true });
  await dialog.getByLabel('源文本').fill(text);
  await expect(
    dialog.getByRole('button', { name: '插入', exact: true }),
  ).toBeEnabled();
  await dialog.getByRole('button', { name: '插入', exact: true }).click();
  await expect(dialog).toBeHidden();
}
