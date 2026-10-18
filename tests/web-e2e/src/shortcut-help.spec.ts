import { expect, test, type Page } from '@playwright/test';
import { selectAppAction, setAppLanguage } from './app-actions';
import { selectDrawingTool } from './drawing-tools';

test.use({ actionTimeout: 6000 });

const pane = (page: Page) => page.locator('.workspace-pane.is-active');
const canvas = (page: Page) =>
  pane(page).locator('svg[aria-label="Frame canvas"][data-surface="root"]');
const help = (page: Page) => page.getByTestId('shortcut-help');
const search = (page: Page) => help(page).getByRole('searchbox');
const world = (page: Page) => canvas(page).locator('> [data-frame-world]');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(canvas(page)).toBeVisible();
  const skip = page.getByRole('button', { name: '跳过', exact: true });
  if (await skip.isVisible()) await skip.click();
});

async function createAt(page: Page, tool: string) {
  await selectDrawingTool(page, tool);
  if (tool === '形状') await page.getByTestId('shape-rectangle').click();
  const box = (await canvas(page).boundingBox())!;
  await page.mouse.click(box.x + 280, box.y + 180);
  await page.getByRole('button', { name: '选择', exact: true }).click();
}

async function prepareCanvas(page: Page, tool: string) {
  await createAt(page, tool);
  if (tool === '形状') return;
  await canvas(page)
    .locator('[data-cell-kind="frame"], [data-cell-kind="frame-reference"]')
    .locator('[data-frame-title-id]')
    .first()
    .click();
  await page.getByTestId('frame-open').locator('visible=true').click();
}

for (const [tool, category, identity] of [
  ['形状', '白板', 'verd-board'],
  ['思维导图', '脑图', 'verd-mind'],
  ['流程图', '流程图', 'verd-workflow'],
  ['架构图', '架构图', 'verd-architecture'],
] as const) {
  test(`${category} help defaults to the scene and preserves the canvas`, async ({
    page,
  }) => {
    await prepareCanvas(page, tool);
    await expect(pane(page).getByTestId(identity)).toBeVisible();
    await canvas(page).press('ControlOrMeta+a');
    const original = await canvas(page).elementHandle();
    const camera = await world(page).getAttribute('transform');
    const cellsBefore = await canvas(page).locator('[data-cell-id]').count();
    await selectAppAction(page, '快捷键');
    await expect(help(page)).toBeVisible();
    await expect(
      help(page).getByRole('button', { name: category, exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(
      help(page).getByRole('heading', { name: '通用画布操作' }),
    ).toBeVisible();
    await expect(search(page)).toBeFocused();
    await search(page).fill('导出画布文件');
    await expect(help(page).locator('.shortcut-help__row')).toHaveCount(1);
    await search(page).fill('');
    const close = help(page).getByRole('button', { name: '关闭快捷键帮助' });
    await close.focus();
    await page.keyboard.press('Shift+Tab');
    await expect(
      help(page).getByRole('button', { name: '全部', exact: true }),
    ).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    for (const key of ['Delete', 'ControlOrMeta+z', 'p', 'ControlOrMeta+s'])
      await page.keyboard.press(key);
    await expect(help(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(help(page)).toHaveCount(0);
    await expect(pane(page).getByTestId('app-menu-trigger')).toBeFocused();
    expect(await original!.evaluate((element) => element.isConnected)).toBe(
      true,
    );
    await expect(canvas(page).locator('[data-cell-id]')).toHaveCount(
      cellsBefore,
    );
    await expect(world(page)).toHaveAttribute('transform', camera!);
    await selectAppAction(page, '快捷键');
    await expect(search(page)).toHaveValue('');
    await expect(
      help(page).getByRole('button', { name: category, exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
  });
}

test('document help keeps editor selection and history, without triggering find', async ({
  page,
}) => {
  await page
    .locator('.file-tree-header')
    .getByRole('button', { name: '新建文档', exact: true })
    .click();
  const editor = pane(page).locator('.tiptap');
  await editor.click();
  await page.keyboard.type('Keep this selection');
  await page.keyboard.press('ControlOrMeta+a');
  const original = await editor.elementHandle();
  const opener = pane(page).getByRole('button', {
    name: '快捷键',
    exact: true,
  });
  await opener.click();
  await expect(
    help(page).getByRole('button', { name: '文字文档', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    help(page).getByRole('heading', { name: '通用画布操作' }),
  ).toHaveCount(0);
  await search(page).fill('查找框中');
  await expect(help(page).locator('.shortcut-help__row')).toHaveCount(2);
  await page.keyboard.press('ControlOrMeta+f');
  await page.keyboard.press('ControlOrMeta+Shift+h');
  await page.keyboard.press('Escape');
  await expect(help(page)).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect(pane(page).locator('.doc-findbar')).toHaveCount(0);
  expect(await original!.evaluate((element) => element.isConnected)).toBe(true);
  await expect(editor).toHaveText('Keep this selection');
  await pane(page).getByRole('button', { name: '加粗', exact: true }).click();
  await expect(editor.locator('strong')).toHaveText('Keep this selection');
  await expect(editor).toBeFocused();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(editor.locator('strong')).toHaveCount(0);
  await expect(editor).toHaveText('Keep this selection');
});

test('presentation help owns Escape, keeps the HUD visible and preserves laser and camera', async ({
  page,
}) => {
  await prepareCanvas(page, '思维导图');
  await pane(page).getByRole('button', { name: '子主题', exact: true }).click();
  await pane(page).getByRole('button', { name: '演示', exact: true }).click();
  const mode = page.getByTestId('presentation-mode');
  await expect(mode).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('L');
  const presentationWorld = mode.locator('[data-frame-world]');
  // Fullscreen, font readiness and camera animation settle independently.
  await presentationWorld.evaluate(async (element) => {
    await document.fonts.ready;
    let previous = element.getAttribute('transform');
    let stable = 0;
    while (stable < 3) {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      const current = element.getAttribute('transform');
      stable = current === previous ? stable + 1 : 0;
      previous = current;
    }
  });
  const camera = await presentationWorld.getAttribute('transform');
  const step = mode.getByTestId('presentation-step');
  await expect(step).toHaveText('1 / 1');
  const opener = mode.getByRole('button', { name: '快捷键', exact: true });
  await opener.click();
  await expect(
    help(page).getByRole('button', { name: '演示', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  for (const key of ['ArrowRight', 'Enter', '0', 'l', 'Tab', 'Shift+Tab'])
    await page.keyboard.press(key);
  await expect(mode).toHaveClass(/is-laser/);
  await expect(step).toHaveText('1 / 1');
  await expect(mode.locator('[data-frame-world]')).toHaveAttribute(
    'transform',
    camera!,
  );
  // Exercise the HUD's actual idle timeout while the search field owns focus.
  await expect(mode.getByTestId('presentation-hud')).not.toHaveClass(
    /is-hidden/,
    { timeout: 4000 },
  );
  // The idle timer is behavior under test, rather than a wait for UI readiness.
  // eslint-disable-next-line playwright/no-wait-for-timeout
  await page.waitForTimeout(2700);
  await expect(mode.getByTestId('presentation-hud')).not.toHaveClass(
    /is-hidden/,
  );
  await page.keyboard.press('Escape');
  await expect(help(page)).toHaveCount(0);
  await expect(mode).toBeVisible();
  await expect(opener).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(mode).toHaveCount(0);
});

test('English help remains usable in a narrow viewport', async ({ page }) => {
  await setAppLanguage(page, 'en');
  await selectAppAction(page, 'Keyboard shortcuts');
  await help(page).screenshot({ path: '/tmp/verd-shortcuts-wide.png' });
  await page.setViewportSize({ width: 540, height: 720 });
  await expect(
    help(page).getByRole('button', { name: 'Whiteboard', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await help(page).getByRole('button', { name: 'All', exact: true }).click();
  await search(page).fill('no such action');
  await expect(help(page).getByRole('status')).toHaveText(
    'No matching shortcuts',
  );
  await search(page).fill('');
  const dimensions = await help(page).evaluate((element) => ({
    width: element.getBoundingClientRect().width,
    scroll: element.scrollWidth,
    client: element.clientWidth,
  }));
  expect(dimensions.width).toBeLessThanOrEqual(540);
  expect(dimensions.scroll).toBe(dimensions.client);
  await help(page).screenshot({ path: '/tmp/verd-shortcuts-narrow.png' });
});
