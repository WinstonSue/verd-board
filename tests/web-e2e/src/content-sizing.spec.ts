import { expect, test, type Page, type Locator } from '@playwright/test';
import {
  createInlineText,
  createBlockText,
} from '../../../packages/engine/common/src/public-api';
import {
  createCellStore,
  createFrameCell,
  type FrameSnapshot,
  type NodeCell,
} from '../../../packages/engine/core/src/cell/types';
import { applyCellOperations } from '../../../packages/engine/core/src/cell/index';
import {
  createMindFrameSnapshot,
  createMindChildCell,
  addMindChild,
} from '../../../packages/engine/mind/src/cell-commands';
import { openSettings } from './app-actions';
import { expandPropertyGroup } from './property-group';
test.use({ actionTimeout: 6000 });
const canvas = (page: Page) =>
  page.locator('svg[aria-label="Frame canvas"][data-surface="root"]:visible');
const node = (page: Page, id: string) =>
  id === 'root'
    ? canvas(page).locator('[data-cell-kind="mind-root"]')
    : canvas(page)
        .locator('[data-cell-kind="mind-child"], [data-cell-kind="geometry"]')
        .filter({ hasText: id === 'short' ? 'Short' : '中文长内容' });
async function selectRoot(page: Page) {
  const root = node(page, 'root');
  await expect(root).toBeVisible();
  // Use a real, unobstructed hit point; SVG group bounds include hover controls.
  const point = await root.evaluate((element) => {
    const box = element.getBoundingClientRect();
    for (let y = box.top + 3; y < box.bottom - 3; y += 3)
      for (let x = box.left + 3; x < box.right - 3; x += 3) {
        const hit = document.elementFromPoint(x, y);
        if (
          hit?.closest('[data-cell-id]') === element &&
          !hit.closest(
            '[data-mind-add], [data-port-id], [data-selection-handles]',
          )
        )
          return { x, y };
      }
    throw new Error(
      `No unobstructed topic point: ${JSON.stringify({ x: box.x, y: box.y, width: box.width, height: box.height })}`,
    );
  });
  await page.mouse.click(point.x, point.y);
  await expect(page.getByTestId('mind-width-mode')).toBeVisible();
}
async function open(page: Page, snapshot: FrameSnapshot) {
  await page.goto('/');
  await page
    .locator('input[type="file"][accept^="application/json"]')
    .nth(1)
    .setInputFiles({
      name: 'sizing.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(snapshot)),
    });
  await expect(node(page, 'topic')).toBeVisible();
}
const width = (cell: Locator) =>
  cell
    .locator('foreignObject')
    .last()
    .evaluate((element) => Number(element.getAttribute('width')) + 16);
async function fits(cell: Locator) {
  await expect
    .poll(async () =>
      cell.locator('[data-frame-rich-text]').evaluateAll((elements) =>
        elements.flatMap((element) => {
          const body = element.querySelector('.board-text-body') as HTMLElement;
          return body.scrollHeight <= element.clientHeight + 1 &&
            body.scrollWidth <= element.clientWidth + 1
            ? []
            : [
                {
                  text: body.textContent?.slice(0, 20),
                  height: element.clientHeight,
                  contentHeight: body.scrollHeight,
                  width: element.clientWidth,
                  contentWidth: body.scrollWidth,
                },
              ];
        }),
      ),
    )
    .toEqual([]);
}
function mindFixture() {
  let snapshot = createMindFrameSnapshot('frame', 'root');
  const text = createInlineText(
    '中文长内容与 LongEnglishWordWithoutSpacesThatMustWrap '.repeat(5) +
      '\n最后一行',
  );
  text.content.content![0].content![0].marks = [
    { type: 'textStyle', attrs: { fontSize: '32px' } },
  ];
  const topic = {
    ...createMindChildCell('topic'),
    content: { text, label: text.plainText },
    data: {
      note: createBlockText('笔记\n'.repeat(8)),
      image: {
        url: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="800" height="400"%3E%3Crect width="800" height="400" fill="red"/%3E%3C/svg%3E',
        width: 800,
        height: 400,
      },
      emojis: [{ name: '🙂 🚀' }],
    },
  };
  snapshot = {
    store: applyCellOperations(
      snapshot.store,
      addMindChild(snapshot.store, 'root', topic, 'edge'),
    ),
  };
  return snapshot;
}

test('Mind width inherits settings, supports a saved map override and keeps long content visible', async ({
  page,
}) => {
  await open(page, mindFixture());
  const topic = node(page, 'topic');
  await expect.poll(() => width(topic)).toBe(240);
  await fits(topic);
  await expect(topic.locator('[data-resize-handle]')).toHaveCount(0);
  await openSettings(page);
  await page.getByTestId('settings-mind-max-width').fill('320');
  await page.getByTestId('settings-back').click();
  await expect.poll(() => width(topic)).toBe(320);
  await fits(topic);
  await selectRoot(page);
  await page.getByTestId('mind-width-mode').selectOption('custom');
  await page.getByTestId('mind-max-width').fill('160');
  await page.getByTestId('mind-max-width').press('Enter');
  await expect.poll(() => width(topic)).toBe(160);
  await fits(topic);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect.poll(() => width(topic)).toBe(320);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect.poll(() => width(topic)).toBe(160);
  await openSettings(page);
  await page.getByTestId('settings-mind-max-width').fill('400');
  await page.getByTestId('settings-back').click();
  await expect.poll(() => width(topic)).toBe(160);
  await expect(page.getByTestId('save-status')).toHaveAttribute(
    'data-save-state',
    'saved',
  );
  await page.reload();
  await expect(node(page, 'topic')).toBeVisible();
  await expect.poll(() => width(node(page, 'topic'))).toBe(160);
  await fits(node(page, 'topic'));
  await selectRoot(page);
  await page.getByTestId('mind-width-mode').selectOption('default');
  await expect.poll(() => width(node(page, 'topic'))).toBe(400);
  await fits(node(page, 'topic'));
});

test('selected shapes fit content with their current width as a cap and undo restores the size', async ({
  page,
}) => {
  const root = createFrameCell('frame');
  const text = createInlineText(
    '中文长内容 EnglishWordWithoutSpaces'.repeat(5) + '\n第二行',
  );
  text.content.content![0].content![0].marks = [
    { type: 'textStyle', attrs: { fontSize: '28px' } },
  ];
  const topic: NodeCell = {
    id: 'topic',
    kind: 'geometry',
    cellType: 'node',
    geometry: { x: 25, y: 35, width: 240, height: 40, outline: 'comment' },
    content: { text, label: text.plainText },
  };
  const short: NodeCell = {
    ...topic,
    id: 'short',
    geometry: { x: 340, y: 35, width: 240, height: 100, outline: 'rectangle' },
    content: { text: createInlineText('Short'), label: 'Short' },
  };
  await open(page, {
    store: applyCellOperations(
      createCellStore(root),
      [topic, short].map((cell) => ({
        type: 'insert_cell',
        parentId: 'frame',
        cell,
      })),
    ),
  });
  await node(page, 'topic').click();
  await expandPropertyGroup(page);
  const panel = page
    .getByRole('complementary')
    .getByTestId('frame-arrangement');
  await panel.getByRole('button', { name: '根据内容调整大小' }).click();
  await fits(node(page, 'topic'));
  const height = () =>
    node(page, 'topic')
      .locator('[data-frame-rich-text]')
      .evaluate((element) => element.clientHeight);
  await expect.poll(height).toBeGreaterThan(100);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect.poll(height).toBeLessThan(100);
  await node(page, 'short').click();
  await panel.getByRole('button', { name: '根据内容调整大小' }).click();
  await expect.poll(() => width(node(page, 'short'))).toBeLessThan(100);
  await fits(node(page, 'short'));
  await expect(page.getByTestId('save-status')).toHaveAttribute(
    'data-save-state',
    'saved',
  );
  await page.reload();
  await expect.poll(() => width(node(page, 'short'))).toBeLessThan(100);
});
