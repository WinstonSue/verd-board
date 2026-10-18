import { expect, type Page } from '@playwright/test';

/** Body assertions keep exercising the native canvas editor after names split. */
export async function bodyEditor(page: Page) {
  const editor = page.locator(
    '[data-frame-text-editor] [contenteditable="true"]',
  );
  if (!(await editor.isVisible().catch(() => false))) {
    const id = await page
      .locator('.frame-inspector:visible')
      .getAttribute('data-selected-cell-id');
    if (!id) throw new Error('Select a node before editing its body');
    const surface = page.locator(
      'svg[aria-label="Frame canvas"][data-surface="root"]:visible',
    );
    const title = surface.locator(`[data-frame-title-id="${id}"]`);
    if (await title.count()) await title.dblclick();
    else {
      const node = surface.locator(`[data-cell-id="${id}"]`);
      const point = await node.evaluate((node) => {
        const box = node.getBoundingClientRect();
        for (let y = box.top + 10; y < box.bottom - 8; y += 12)
          for (let x = box.left + 10; x < box.right - 8; x += 12) {
            const hit = document.elementFromPoint(x, y);
            if (
              hit &&
              node.contains(hit) &&
              hit.closest('[data-cell-id]') === node &&
              !hit.closest(
                'a, [data-port-id], [data-selection-handles], [data-mind-fold]',
              )
            )
              return { x, y };
          }
        return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      });
      await page.mouse.dblclick(point.x, point.y);
    }
  }
  await expect(editor).toBeVisible();
  await editor.focus();
  return editor;
}
export async function editBody(page: Page, text: string) {
  const editor = await bodyEditor(page);
  await editor.fill(text);
  await editor.press('Escape');
}
