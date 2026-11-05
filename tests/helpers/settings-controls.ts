import { expect, type Locator } from '@playwright/test';

const labels: Record<string, RegExp> = {
  zh: /^中文$/,
  en: /^English$/,
  system: /^(跟随系统|System)$/,
  light: /^(浅色|Light)$/,
  dark: /^(深色|Dark)$/,
  modifier: /^⌘\/Ctrl \+ (点击|click)$/,
  click: /^(单击|Click)$/,
  custom: /^(自定义|Custom)$/,
  inherit: /^(跟随个人默认值（\d+）|Use personal default)$/,
};

export async function selectSetting(control: Locator, value: string) {
  const combobox =
    (await control.getAttribute('role')) === 'combobox'
      ? control
      : control.getByRole('combobox');
  await combobox.click();
  const listboxId = await combobox.getAttribute('aria-controls');
  const listbox = control.page().locator(`[id="${listboxId}"]`);
  await listbox
    .getByRole('option', { name: labels[value], exact: true })
    .click();
  await expect(combobox).toHaveAttribute('aria-expanded', 'false');
  await expect(listbox).not.toBeVisible();
}

export async function expectSettingValue(control: Locator, value: string) {
  await expect(control).toContainText(labels[value]!);
}

export async function setSettingSlider(control: Locator, value: number) {
  const slider = control.getByRole('slider');
  await slider.press('Home');
  const min = Number(await slider.getAttribute('aria-valuemin'));
  for (let step = 0; step < Math.round((value - min) / 0.05); step++)
    await slider.press('ArrowRight');
  await expect(slider).toHaveAttribute('aria-valuenow', String(value));
}
