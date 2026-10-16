import { type Page } from '@playwright/test';

export async function openAppMenu(page: Page) {
  const trigger = page.getByTestId('app-menu-trigger').locator('visible=true');
  if ((await trigger.getAttribute('aria-expanded')) !== 'true')
    await trigger.click({ timeout: 5000 }).catch(() =>
      // Workspace pane swaps keep hidden panes mounted; the visible trigger
      // can flicker in and out of hit-test reach during the transition.
      trigger.dispatchEvent('click'),
    );
  return page.getByRole('menu', { name: /^(更多|More)$/ });
}

export async function selectAppAction(page: Page, label: string) {
  const menu = await openAppMenu(page);
  await menu.getByRole('menuitem', { name: label, exact: true }).click();
}

export async function openSettings(page: Page) {
  const menu = await openAppMenu(page);
  await menu.getByRole('menuitem', { name: /^(设置|Settings)$/ }).click();
  return page.getByTestId('settings-page');
}

export async function setAppLanguage(page: Page, language: 'zh' | 'en') {
  const settings = await openSettings(page);
  await settings.getByTestId('settings-language').selectOption(language);
  await settings.getByTestId('settings-back').click();
}
