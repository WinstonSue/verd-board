import { expect, type Locator } from '@playwright/test';

export function propertySelectRoot(control: Locator) {
  return control.locator(
    'xpath=ancestor-or-self::*[contains(concat(" ", normalize-space(@class), " "), " settings-select ")]',
  );
}

export async function openPropertyOptions(control: Locator) {
  const root = propertySelectRoot(control);
  const combo = root.getByRole('combobox');
  if ((await combo.getAttribute('aria-expanded')) !== 'true')
    await combo.click();
  const id = await combo.getAttribute('aria-controls');
  const listbox = control.page().locator(`[id=${JSON.stringify(id)}]`);
  await expect(listbox).toBeVisible();
  return listbox;
}

export async function selectPropertyValue(control: Locator, value: string) {
  const listbox = await openPropertyOptions(control);
  await listbox
    .locator(`[data-setting-option-value=${JSON.stringify(value)}]`)
    .click();
  await expect(
    propertySelectRoot(control).getByRole('combobox'),
  ).toHaveAttribute('aria-expanded', 'false');
  await expect(listbox).not.toBeVisible();
}

export async function expectPropertyValue(control: Locator, value: string) {
  await expect(propertySelectRoot(control)).toHaveAttribute(
    'data-setting-value',
    value,
  );
}

export async function readPropertyValue(control: Locator) {
  return (
    (await propertySelectRoot(control).getAttribute('data-setting-value')) ?? ''
  );
}

export async function propertyOptions(control: Locator) {
  const listbox = await openPropertyOptions(control);
  const options = await listbox
    .locator('[data-setting-option-value]')
    .evaluateAll((elements) =>
      elements.map((element) => ({
        value: element.getAttribute('data-setting-option-value')!,
        label: element.textContent!,
      })),
    );
  await propertySelectRoot(control).getByRole('combobox').press('Escape');
  await expect(listbox).not.toBeVisible();
  return options;
}

export async function expectPropertyPopupAnchored(control: Locator) {
  const listbox = await openPropertyOptions(control);
  // Resize/zoom and popup alignment settle asynchronously. Read both rectangles
  // and the viewport together in CSS pixels before checking the same bounds.
  await expect
    .poll(
      async () =>
        listbox.evaluate((element) => {
          const document = element.ownerDocument;
          const combo = document.querySelector(
            `[role="combobox"][aria-controls="${element.id}"]`,
          )!;
          const trigger = combo
            .closest('.settings-select')!
            .getBoundingClientRect();
          const popup = element.getBoundingClientRect();
          const viewport = document.defaultView!;
          return {
            insideViewport:
              popup.left >= 0 &&
              popup.top >= 0 &&
              popup.right <= viewport.innerWidth &&
              popup.bottom <= viewport.innerHeight,
            overlapsTrigger:
              popup.left < trigger.right && popup.right > trigger.left,
            adjacentToTrigger:
              Math.min(
                Math.abs(popup.top - trigger.bottom),
                Math.abs(trigger.top - popup.bottom),
              ) < 16,
          };
        }),
      {
        message:
          'Dropdown must stay inside its viewport and next to its trigger',
      },
    )
    .toEqual({
      insideViewport: true,
      overlapsTrigger: true,
      adjacentToTrigger: true,
    });
  return listbox;
}
