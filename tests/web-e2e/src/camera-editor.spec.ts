import { expect, test, type Page } from '@playwright/test';
import { createInlineText } from '../../../packages/engine/common/src/public-api';
import { clearWorkspaceStorage } from './workspace-nav';

const canvas = (page: Page) =>
  page.locator('svg[aria-label="Frame canvas"][data-surface="root"]:visible');
const transform = (page: Page) =>
  canvas(page).locator('> [data-frame-world]').getAttribute('transform');

async function load(page: Page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await expect(canvas(page)).toBeVisible();
  await page.evaluate(async (text) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('VerdBoard');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('verdboard_store', 'readwrite'),
        saved = transaction.objectStore('verdboard_store');
      saved.clear();
      saved.put(
        {
          format: 'verd-frame',
          version: 1,
          frame: {
            id: 'root',
            kind: 'frame',
            cellType: 'frame',
            geometry: { x: 0, y: 0, width: 960, height: 640 },
            children: ['node', 'nested'],
            groups: [],
          },
          cells: {
            node: {
              id: 'node',
              kind: 'geometry',
              cellType: 'node',
              geometry: {
                x: 100,
                y: 100,
                width: 240,
                height: 90,
                outline: 'rectangle',
              },
              content: { label: text.plainText, text },
            },
          },
        },
        'frames/root/test',
      );
      saved.put(
        {
          format: 'verd-frame',
          version: 1,
          frame: {
            id: 'nested',
            kind: 'frame',
            cellType: 'frame',
            geometry: { x: 450, y: 100, width: 200, height: 180 },
            content: { label: 'Nested' },
            children: [],
            groups: [],
          },
          cells: {},
        },
        'frames/nested/test',
      );
      saved.put(
        {
          format: 'verd-workspace',
          version: 2,
          rootId: 'root',
          frames: { root: 'frames/root/test', nested: 'frames/nested/test' },
          detachedFrameIds: [],
        },
        'main_board_content',
      );
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  }, createInlineText('Original'));
  await clearWorkspaceStorage(page);
  await page.reload();
  const skip = page.getByRole('button', { name: '跳过', exact: true });
  if (await skip.isVisible()) await skip.click();
  await expect(canvas(page).locator('[data-cell-id="node"]')).toBeVisible();
}
async function zoomAt(page: Page, target: import('@playwright/test').Locator) {
  const before = await transform(page),
    box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.down('Control');
  try {
    await page.mouse.wheel(0, -15);
  } finally {
    await page.keyboard.up('Control');
  }
  await expect.poll(() => transform(page)).not.toBe(before);
}

test('native wheel zooms inline editing and its portal without losing typing, selection or history', async ({
  page,
}) => {
  await load(page);
  await canvas(page).locator('[data-cell-id="node"]').dblclick();
  const editor = canvas(page).locator(
    '[data-frame-text-editor] [contenteditable="true"]',
  );
  await expect(editor).toBeFocused();
  await editor.fill('Start');
  await editor.press('End');
  const typing = 'abcdefghijklmnopqrstuvwxyz'.repeat(4);
  await page.keyboard.type(typing);
  await expect(editor).toHaveText('Start' + typing);
  const selection = () =>
    page.evaluate(() => {
      const selection = window.getSelection();
      return {
        offset: selection?.anchorOffset,
        text: selection?.anchorNode?.textContent,
      };
    });
  const before = await selection();
  await zoomAt(page, editor);
  await expect(editor).toBeFocused();
  expect(await selection()).toEqual(before);
  const toolbar = page.locator('[data-frame-text-toolbar]');
  await zoomAt(page, toolbar);
  await expect(editor).toBeFocused();
  expect(await selection()).toEqual(before);
  const camera = await transform(page);
  const box = (await editor.boundingBox())!;
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.wheel(20, 30);
  await expect.poll(() => transform(page)).not.toBe(camera);
  await expect(editor).toBeFocused();
  await editor.press('ControlOrMeta+z');
  await expect(
    canvas(page).locator('[data-cell-id="node"] .board-text-content'),
  ).toHaveText(('Start' + typing).slice(0, -1));
  await canvas(page).press('ControlOrMeta+Shift+z');
  await expect(
    canvas(page).locator('[data-cell-id="node"] .board-text-content'),
  ).toHaveText('Start' + typing);
  await page.waitForTimeout(650);
  await page.reload();
  await expect(
    canvas(page).locator('[data-cell-id="node"] .board-text-content'),
  ).toHaveText('Start' + typing);
});

test('native zoom reaches the title portal and preserves its active editor', async ({
  page,
}) => {
  await load(page);
  // The legacy child frame migrates to a `frame-ref:<id>` reference cell.
  await canvas(page)
    .locator('[data-frame-title-id="frame-ref:nested"]')
    .dblclick();
  const editor = page.locator(
    '[data-frame-title-editor="frame-ref:nested"] [contenteditable="true"]',
  );
  await expect(editor).toBeFocused();
  await zoomAt(page, editor);
  await expect(editor).toBeFocused();
  await editor.fill('Renamed');
  await editor.press('Escape');
  await expect(
    canvas(page).locator('[data-frame-title-id="frame-ref:nested"]'),
  ).toContainText('Renamed');
});
