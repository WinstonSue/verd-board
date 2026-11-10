import { expect, test, type Locator, type Page } from './service-fixture';
import {
  createCellStore,
  createFrameCell,
  type FrameSnapshot,
} from '../../../packages/engine/core/src/cell/types';
import { cellBodyPoint } from '../../helpers/port-controls';
import { selectSetting } from '../../helpers/settings-controls';
import {
  openActiveFile,
  openSettings,
  selectHistoryAction,
  setAppLanguage,
} from './app-actions';

test.use({ actionTimeout: 6000 });

const canvas = (page: Page) =>
  page.locator('.workspace-pane.is-active svg[data-surface="root"]');
const menu = (page: Page) =>
  page.getByRole('menu', { name: /^(画布编辑|Canvas editing)$/ });
const nodes = (page: Page) =>
  canvas(page).locator('[data-cell-kind="geometry"]');
const node = (page: Page, name: string) =>
  nodes(page).filter({ hasText: name });
async function click(
  target: Locator,
  options: { right?: boolean; shift?: boolean } = {},
) {
  const point = await cellBodyPoint(target);
  const page = target.page();
  if (options.shift) await page.keyboard.down('Shift');
  await page.mouse.click(point.x, point.y, {
    button: options.right ? 'right' : 'left',
  });
  if (options.shift) await page.keyboard.up('Shift');
}
async function open(page: Page, locked = false) {
  const root = createFrameCell('context-root');
  root.children = ['a', 'b', 'c'];
  const snapshot: FrameSnapshot = { store: createCellStore(root) };
  for (const [i, id] of ['a', 'b', 'c'].entries())
    snapshot.store.cells[id] = {
      id,
      kind: 'geometry',
      cellType: 'node',
      geometry: {
        x: 100 + i * 240,
        y: 100 + i * 80,
        width: 120,
        height: 60,
        outline: 'rectangle',
      },
      content: { label: ['Alpha', 'Beta', 'Gamma'][i] },
      ...(locked && id === 'b' ? { locked: true } : {}),
    };
  await page.goto('/');
  await openActiveFile(page);
  await page
    .locator(
      '.workspace-pane.is-active input[type="file"][accept^="application/json"]',
    )
    .nth(1)
    .setInputFiles({
      name: 'context.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(snapshot)),
    });
  await expect(nodes(page)).toHaveCount(3);
}

test('context commands edit selections while property forms stay in the inspector', async ({
  page,
}) => {
  await open(page);
  const bounds = (await canvas(page).boundingBox())!;
  await canvas(page).click({
    button: 'right',
    position: { x: bounds.width - 60, y: bounds.height - 100 },
  });
  await expect(menu(page).getByRole('menuitem')).toHaveCount(3);
  await expect(
    menu(page).getByRole('menuitem', { name: '全选当前容器', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await click(node(page, 'Alpha'));
  await click(node(page, 'Alpha'), { right: true });
  await expect(
    menu(page).locator('input, select, textarea, [role="checkbox"]'),
  ).toHaveCount(0);
  await expect(
    menu(page).getByRole('menuitem', { name: '对齐与分布', exact: true }),
  ).toHaveCount(0);
  await expect(
    menu(page).getByRole('menuitem', { name: '组合', exact: true }),
  ).toHaveCount(0);
  await expect(
    menu(page)
      .getByRole('menuitem', { name: '复制', exact: true })
      .locator('kbd'),
  ).toContainText(/C/i);
  await menu(page)
    .getByRole('menuitem', { name: '复制副本', exact: true })
    .click();
  await expect(nodes(page)).toHaveCount(4);
  await expect(menu(page)).toHaveCount(0);
  await selectHistoryAction(page, '撤销');
  await expect(nodes(page)).toHaveCount(3);
  await click(node(page, 'Alpha'));
  await click(node(page, 'Beta'), { shift: true });
  await click(node(page, 'Alpha'), { right: true });
  await menu(page)
    .getByRole('menuitem', { name: '对齐与分布', exact: true })
    .hover();
  const align = page.getByRole('menu', { name: '对齐与分布', exact: true });
  await expect(
    align.getByRole('menuitem', { name: '水平等距分布', exact: true }),
  ).toHaveCount(0);
  await align.getByRole('menuitem', { name: '左对齐', exact: true }).click();
  await expect
    .poll(async () =>
      Math.abs(
        (await node(page, 'Alpha').boundingBox())!.x -
          (await node(page, 'Beta').boundingBox())!.x,
      ),
    )
    .toBeLessThan(1);
  await selectHistoryAction(page, '撤销');
  await click(node(page, 'Gamma'), { shift: true });
  await click(node(page, 'Alpha'), { right: true });
  await menu(page)
    .getByRole('menuitem', { name: '对齐与分布', exact: true })
    .hover();
  await expect(
    align.getByRole('menuitem', { name: '水平等距分布', exact: true }),
  ).toBeEnabled();
  await page.keyboard.press('Escape');
  await menu(page).getByRole('menuitem', { name: '组合', exact: true }).click();
  await expect(
    page
      .locator('.frame-inspector:visible')
      .getByRole('heading', { name: '组合', exact: true }),
  ).toBeVisible();
  await node(page, 'Alpha').click({ button: 'right' });
  await menu(page)
    .getByRole('menuitem', { name: '取消组合', exact: true })
    .click();
  await expect(
    page.locator('.frame-inspector:visible .frame-inspector__header'),
  ).toContainText('3');
  await click(node(page, 'Alpha'));
  await click(node(page, 'Alpha'), { right: true });
  await menu(page).getByRole('menuitem', { name: '删除', exact: true }).click();
  await expect(nodes(page)).toHaveCount(2);
  await selectHistoryAction(page, '撤销');
  await expect(nodes(page)).toHaveCount(3);
  await click(node(page, 'Alpha'));
  await expect(
    page
      .locator('.frame-inspector:visible')
      .getByLabel('Shadow', { exact: true }),
  ).toBeVisible();
});

test('mixed locked selections offer applicable lock commands without unsafe arrangement', async ({
  page,
}) => {
  await open(page, true);
  await click(node(page, 'Alpha'));
  await click(node(page, 'Beta'), { shift: true });
  await click(node(page, 'Alpha'), { right: true });
  await expect(
    menu(page).getByRole('menuitem', { name: '锁定', exact: true }),
  ).toBeEnabled();
  await expect(
    menu(page).getByRole('menuitem', { name: '解锁', exact: true }),
  ).toBeEnabled();
  await expect(
    menu(page).getByRole('menuitem', { name: '对齐与分布', exact: true }),
  ).toHaveCount(0);
  await expect(
    menu(page).getByRole('menuitem', { name: '删除', exact: true }),
  ).toBeDisabled();
  await menu(page).getByRole('menuitem', { name: '解锁', exact: true }).click();
  await click(node(page, 'Alpha'), { right: true });
  await expect(
    menu(page).getByRole('menuitem', { name: '解锁', exact: true }),
  ).toHaveCount(0);
  await expect(
    menu(page).getByRole('menuitem', { name: '对齐与分布', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await selectHistoryAction(page, '撤销');
  await click(node(page, 'Alpha'), { right: true });
  await expect(
    menu(page).getByRole('menuitem', { name: '解锁', exact: true }),
  ).toBeVisible();
});

for (const { language, appearance, alignLabel } of [
  { language: 'zh', appearance: 'light', alignLabel: '对齐与分布' },
  { language: 'en', appearance: 'dark', alignLabel: 'Align and distribute' },
] as const)
  test(`keyboard menus stay in the viewport in ${language}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await open(page);
    await setAppLanguage(page, language);
    const settings = await openSettings(page);
    await selectSetting(
      settings.getByTestId('settings-appearance'),
      appearance,
    );
    await page.getByTestId('my-back').click();
    await click(node(page, 'Alpha'));
    await click(node(page, 'Beta'), { shift: true });
    await expect(
      page.locator('.frame-inspector:visible .frame-inspector__header'),
    ).toContainText('2');
    const canvasBox = (await canvas(page).boundingBox())!;
    await canvas(page).focus();
    // Keyboard context-menu invocation supplies a point without another selection gesture.
    await canvas(page).evaluate(
      (element, point) =>
        element.dispatchEvent(
          new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            button: 0,
            clientX: point.x,
            clientY: point.y,
          }),
        ),
      {
        x: canvasBox.x + canvasBox.width - 12,
        y: canvasBox.y + canvasBox.height - 12,
      },
    );
    const trigger = menu(page).getByRole('menuitem', {
      name: alignLabel,
      exact: true,
    });
    await trigger.focus();
    await expect
      .poll(async () => (await menu(page).boundingBox())!.x)
      .toBeGreaterThan(500);
    await page.keyboard.press('ArrowRight');
    const align = page.getByRole('menu', { name: alignLabel, exact: true });
    await expect(align.getByRole('menuitem').first()).toBeFocused();
    await page.keyboard.press('End');
    await expect(align.getByRole('menuitem').last()).toBeFocused();
    for (const surface of [menu(page), align]) {
      const box = (await surface.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(7);
      expect(box.y).toBeGreaterThanOrEqual(7);
      expect(box.x + box.width).toBeLessThanOrEqual(1273);
      expect(box.y + box.height).toBeLessThanOrEqual(713);
    }
    await page.screenshot({
      path: info.outputPath(`context-menu-${language}.png`),
    });
    await page.keyboard.press('ArrowLeft');
    await expect(trigger).toBeFocused();
    await expect(align).toHaveCount(0);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await expect(menu(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu(page)).toHaveCount(0);
    await expect(canvas(page)).toBeFocused();
  });
