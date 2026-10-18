import { expect, type Page } from '@playwright/test';
const strip = (page: Page) => page.locator('ylib-tabs');
export const openGroups = async (page: Page) => {
  const toggle = strip(page).getByLabel('选择分组', { exact: true });
  if (
    !(await strip(page)
      .getByRole('button', { name: '＋ 新建分组', exact: true })
      .isVisible())
  )
    await toggle.click();
};
export const createGroup = async (page: Page, name: string) => {
  await openGroups(page);
  await strip(page)
    .getByRole('button', { name: '＋ 新建分组', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: '新建分组', exact: true });
  await expect(
    dialog.getByRole('button', { name: '确定', exact: true }),
  ).toBeDisabled();
  await dialog.getByRole('textbox').fill(name);
  await dialog.getByRole('button', { name: '确定', exact: true }).click();
};
export const switchGroup = async (page: Page, name: string) => {
  await openGroups(page);
  await strip(page).getByRole('button', { name, exact: true }).click();
};
export const deleteGroup = async (page: Page, name: string) => {
  await openGroups(page);
  await strip(page).getByRole('button', { name, exact: true }).hover();
  await strip(page)
    .getByRole('button', { name: `删除 ${name}`, exact: true })
    .click();
};
