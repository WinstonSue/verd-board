import { activeTabTitle } from './tab-actions';
import { observeContentWrites } from './service-routes';
import {
  expectSettingValue,
  selectSetting,
  setSettingSlider,
} from '../../helpers/settings-controls';
import { selectHistoryAction } from './app-actions';
import { expect, test, type Page } from './service-fixture';
import { openAppMenu, openSettings, selectAppAction } from './app-actions';
import { selectDrawingTool } from './drawing-tools';
import { backToPreviousCanvas } from './workspace-nav';

test.beforeEach(async ({ page }) => {
  // Local settings checks must not wait for third-party analytics.
  await page.route('https://cloud.umami.is/script.js', (route) =>
    route.abort(),
  );
});

const preferenceKey = 'verdboard.interaction-settings';
const canvas = (page: Page) =>
  page.locator('svg[aria-label="Frame canvas"][data-surface="root"]:visible');
const world = (page: Page) => canvas(page).locator('> [data-frame-world]');
const camera = async (page: Page) => {
  const values = (await world(page).getAttribute('transform'))!
    .match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/g)!
    .map(Number);
  return { zoom: values[0], x: -values[1], y: -values[2] };
};
const skipTutorial = async (page: Page) => {
  await expect(page.locator('.workspace-shell')).toBeVisible();
  if (!(await canvas(page).isVisible()))
    await page.locator('.file-tree-row[data-entry-kind=file]').first().click();
  await expect(canvas(page)).toBeVisible();
  const skip = page.getByRole('button', { name: /^(跳过|Skip)$/ });
  if (await skip.isVisible()) await skip.click();
};
const slider = async (page: Page, name: string, value: string) => {
  await page.getByTestId('settings-nav-personal.editor').click();
  await setSettingSlider(page.getByTestId(`settings-${name}`), Number(value));
};

test('storage paths can be copied and external AI tools explain their use on wide and narrow screens', async ({
  page,
  context,
  localService,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  const settings = await openSettings(page);
  await settings.getByTestId('settings-nav-workspace.data').click();
  await expect(settings.getByTestId('workspace-agent-status')).toContainText(
    '尚未启用编写工具',
  );
  await settings
    .getByRole('button', { name: '启用或修复编写工具', exact: true })
    .click();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(settings.getByTestId('workspace-storage-location')).toHaveText(
      localService.workspace,
    );
    await settings.getByTestId('workspace-storage-copy').click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe(localService.workspace);
    await expect(settings.locator('.settings-storage-copy-status')).toHaveText(
      '已复制',
    );
    const agent = settings.getByTestId('workspace-agent-status');
    await expect(agent).toContainText('外部 AI 助手');
    await expect(agent).toContainText('编写工具已就绪');
    await expect(agent).toContainText('让它读取 AGENTS.md');
    expect(
      await settings.evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    expect(
      await settings
        .locator('.settings-sections-main')
        .evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
  }
});

test('settings sections are grouped menu items with keyboard navigation', async ({
  page,
}) => {
  await page.goto('/');
  const settings = await openSettings(page);
  const menu = settings.getByRole('menu', { name: '设置栏目' });
  await expect(menu.getByRole('menuitem')).toHaveCount(8);
  await expect(
    menu.getByRole('menuitem', { name: '自定义 Skills', exact: true }),
  ).toBeVisible();
  await expect(menu.getByRole('button')).toHaveCount(0);
  await expect(menu.getByText('个人偏好', { exact: true })).toBeVisible();
  const appearance = menu.getByRole('menuitem', { name: '外观', exact: true });
  const editor = menu.getByRole('menuitem', { name: '编辑', exact: true });
  await expect(appearance).toHaveAttribute('aria-current', 'page');
  await appearance.focus();
  await appearance.press('ArrowDown');
  await expect(editor).toBeFocused();
  await editor.press('Enter');
  await expect(editor).toHaveAttribute('aria-current', 'page');
  await expect(settings.getByTestId('settings-mind-max-width')).toBeVisible();
});

test('Design controls keep the existing layout and dismiss only the open select on Escape', async ({
  page,
}, info) => {
  await page.goto('/');
  await openSettings(page);
  const settings = page.getByTestId('my-page');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    if (width === 390) {
      await settings.locator('.settings-mobile-back').click();
      await settings.getByTestId('settings-nav-personal.general').click();
    }
    await selectSetting(settings.getByTestId('settings-appearance'), 'light');
    await page.screenshot({
      path: info.outputPath(`settings-light-${width}.png`),
      animations: 'disabled',
    });
    const bounds = (await settings.boundingBox())!;
    expect(bounds.width).toBe(width === 390 ? 390 : 1040);
    expect(bounds.height).toBe(width === 390 ? 844 : 760);
    await selectSetting(settings.getByTestId('settings-appearance'), 'dark');
    await page.screenshot({
      path: info.outputPath(`settings-dark-${width}.png`),
      animations: 'disabled',
    });
    const appearance = settings
      .getByTestId('settings-appearance')
      .getByRole('combobox');
    await appearance.click();
    await expect(appearance).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(appearance).toHaveAttribute('aria-expanded', 'false');
    await expect(settings).toBeVisible();
    expect(
      await settings.evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    if (width === 1440)
      await settings.getByTestId('settings-nav-personal.general').click();
  }
  await page.keyboard.press('Escape');
  await expect(settings).toHaveCount(0);
  await expect(page.getByTestId('workspace-my')).toBeFocused();
});

test('More is the only low-frequency entry on wide and narrow screens and supports keyboard navigation', async ({
  page,
}) => {
  await page.goto('/');
  await skipTutorial(page);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const toolbar = page.getByRole('toolbar', { name: 'App actions' });
    await expect(toolbar.getByRole('button', { name: '更多' })).toBeVisible();
    await expect(toolbar.getByRole('button', { name: '撤销' })).toHaveCount(0);
    await expect(toolbar.getByRole('button', { name: '重做' })).toHaveCount(0);
    await expect(toolbar.getByRole('combobox')).toHaveCount(0);
    for (const label of [
      '打开',
      '导入',
      '导出',
      '图像导出',
      '文本导入',
      '清空',
      '设置',
    ])
      await expect(
        toolbar.getByRole('button', { name: label, exact: true }),
      ).toHaveCount(0);
    await page.getByTestId('app-menu-trigger').press('ArrowDown');
    const menu = page.getByRole('menu', { name: '更多' });
    await expect(menu).toBeVisible();
    await expect(menu).toBeInViewport({ ratio: 1 });
    await expect(
      menu.getByRole('menuitem', { name: '打开', exact: true }),
    ).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(
      menu.getByRole('menuitem', { name: '导入', exact: true }),
    ).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(page.getByTestId('app-menu-trigger')).toBeFocused();
    await openAppMenu(page);
    await page.mouse.click(300, 700);
    await expect(menu).toHaveCount(0);
    await openAppMenu(page);
    await expect(
      menu.getByRole('menuitem', { name: '打开', exact: true }),
    ).toBeFocused();
    await page.keyboard.press('End');
    await expect(
      menu.getByRole('menuitem', { name: '命令面板', exact: true }),
    ).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(
      menu.getByRole('menuitem', { name: '设置', exact: true }),
    ).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('my-page')).toBeVisible();

    await page.getByTestId('my-back').click();
    await expect(page.getByTestId('app-menu-trigger')).toBeFocused();
  }
});

test('settings preserve the mounted canvas, selection, viewport, tool, and undo history', async ({
  page,
}) => {
  await page.goto('/');
  await skipTutorial(page);
  await selectDrawingTool(page, '形状');
  await page.getByTestId('shape-rectangle').click();
  await page.mouse.move(420, 280);
  await page.mouse.down();
  await page.mouse.move(550, 360);
  await page.mouse.up();
  await expect(canvas(page).locator('[data-cell-kind="geometry"]')).toHaveCount(
    1,
  );
  await page.getByRole('button', { name: '选择', exact: true }).click();
  await page.mouse.click(480, 320);
  await page.getByTestId('canvas-zoom-in').click();
  await expect(page.getByTestId('save-status')).toHaveAttribute(
    'data-save-state',
    'saved',
  );
  const before = await world(page).getAttribute('transform');
  const selected = await canvas(page)
    .locator('[data-selection-handles]')
    .count();
  expect(selected).toBeGreaterThan(0);
  await canvas(page).evaluate((element) =>
    element.setAttribute('data-settings-instance', 'original'),
  );
  const settings = await openSettings(page);
  const bounds = (await settings.boundingBox())!;
  expect(bounds.width).toBeLessThanOrEqual(1040);
  expect(bounds.height).toBeLessThanOrEqual(760);
  await settings.getByTestId('my-back').focus();
  for (const key of [
    'h',
    'v',
    'ControlOrMeta+Backspace',
    'ControlOrMeta+Shift+e',
  ])
    await page.keyboard.press(key);
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await selectSetting(settings.getByTestId('settings-language'), 'en');
  await selectSetting(settings.getByTestId('settings-appearance'), 'dark');
  await expect(
    settings.getByRole('heading', { name: 'Settings', exact: true }),
  ).toBeVisible();

  await page.getByTestId('my-back').click();
  await expect(canvas(page)).toHaveAttribute(
    'data-settings-instance',
    'original',
  );
  await expect(world(page)).toHaveAttribute('transform', before!);
  await expect(canvas(page).locator('[data-selection-handles]')).toHaveCount(
    selected,
  );
  await expect(
    page.getByRole('button', { name: 'Select', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await selectHistoryAction(page, 'Undo');
  await expect(canvas(page).locator('[data-cell-kind="geometry"]')).toHaveCount(
    0,
  );
  await page.reload();
  await openSettings(page);
  await page.getByTestId('settings-nav-personal.general').click();
  await expectSettingValue(page.getByTestId('settings-language'), 'en');
});

test('interaction settings update gestures immediately, persist, and reset independently of language', async ({
  page,
}) => {
  await observeContentWrites(page, 'settingsWrites');
  await page.goto('/');
  await skipTutorial(page);
  // Boot commits (default board seed, session state) are debounced; sample
  // the baseline only once persistence has gone quiet.
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const count = () => (window as any).settingsWrites;
          const first = count();
          await new Promise((resolve) => setTimeout(resolve, 400));
          return count() - first;
        }),
      { timeout: 15000 },
    )
    .toBe(0);
  const writesBefore = await page.evaluate(
    () => (window as any).settingsWrites,
  );
  await openSettings(page);
  await slider(page, 'zoomSensitivity', '0.5');
  await slider(page, 'dragPanSpeed', '2');

  await page.getByTestId('my-back').click();
  const before = await camera(page);
  await canvas(page).evaluate((svg) => {
    const rect = svg.getBoundingClientRect();
    svg.dispatchEvent(
      new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        deltaY: -20,
        clientX: rect.left + 400,
        clientY: rect.top + 300,
      }),
    );
  });
  await expect
    .poll(async () => (await camera(page)).zoom)
    .toBeCloseTo(before.zoom * Math.exp(0.1));
  const zoomed = await camera(page);
  expect(zoomed.x + 400 / zoomed.zoom).toBeCloseTo(
    before.x + 400 / before.zoom,
  );
  await page.getByRole('button', { name: '手型', exact: true }).click();
  await page.mouse.move(400, 300);
  await page.mouse.down();
  await page.mouse.move(460, 330, { steps: 3 });
  await page.mouse.up();
  const dragged = await camera(page);
  expect(dragged.x - zoomed.x).toBeCloseTo(-120 / zoomed.zoom);
  expect(dragged.y - zoomed.y).toBeCloseTo(-60 / zoomed.zoom);
  expect(await page.evaluate(() => (window as any).settingsWrites)).toBe(
    writesBefore,
  );
  await expect(page.getByTestId('save-status')).toHaveAttribute(
    'data-save-state',
    'saved',
  );
  await page.reload();
  await openSettings(page);
  await page.getByTestId('settings-nav-personal.editor').click();
  await expect(
    page.getByTestId('settings-zoomSensitivity').getByRole('slider'),
  ).toHaveAttribute('aria-valuenow', '0.5');
  await expect(
    page.getByTestId('settings-dragPanSpeed').getByRole('slider'),
  ).toHaveAttribute('aria-valuenow', '2');
  await page.getByTestId('settings-nav-personal.general').click();
  await selectSetting(page.getByTestId('settings-language'), 'en');
  await page.getByTestId('settings-nav-personal.editor').click();
  await page.getByRole('button', { name: 'Reset interaction speeds' }).click();
  await page.getByTestId('settings-nav-personal.editor').click();
  await expect(
    page.getByTestId('settings-zoomSensitivity').getByRole('slider'),
  ).toHaveAttribute('aria-valuenow', '1');
  await expect(
    page.getByTestId('settings-dragPanSpeed').getByRole('slider'),
  ).toHaveAttribute('aria-valuenow', '1');
  await page.getByTestId('settings-nav-personal.general').click();
  await expectSettingValue(page.getByTestId('settings-language'), 'en');
  expect(
    await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)!),
      preferenceKey,
    ),
  ).toEqual({
    zoomSensitivity: 1,
    dragPanSpeed: 1,
    smartGuides: true,
    linkActivation: 'modifier',
  });
});

for (const [tool, workspace, exportLabel] of [
  ['思维导图', 'mind', '导出为 Markdown'],
  ['流程图', 'workflow', '导出为 Mermaid'],
  ['架构图', 'architecture', '导出为 Mermaid'],
] as const) {
  test(`settings and preferences work in the ${workspace} editor`, async ({
    page,
  }) => {
    await page.goto('/');
    await skipTutorial(page);
    await selectDrawingTool(page, tool);
    await page.mouse.click(480, 300);
    await page.getByRole('button', { name: '选择', exact: true }).click();
    await canvas(page)
      .locator('[data-frame-title-id]')
      .first()
      .click({ position: { x: 24, y: 12 }, force: true });
    await page.getByTestId('frame-open').locator('visible=true').click();
    await expect(page.getByTestId(`verd-${workspace}`)).toBeVisible();
    const before = await world(page).getAttribute('transform');
    const menu = await openAppMenu(page);
    await expect(
      menu.getByRole('menuitem', { name: exportLabel, exact: true }),
    ).toBeVisible();
    await menu.getByRole('menuitem', { name: '设置', exact: true }).click();

    await slider(page, 'zoomSensitivity', '1.5');

    await page.getByTestId('my-back').click();
    await expect(world(page)).toHaveAttribute('transform', before!);
    const original = await camera(page);
    await canvas(page).evaluate((svg) =>
      svg.dispatchEvent(
        new WheelEvent('wheel', { bubbles: true, ctrlKey: true, deltaY: -10 }),
      ),
    );
    await expect
      .poll(async () => (await camera(page)).zoom)
      .toBeCloseTo(Math.min(8, original.zoom * Math.exp(0.15)));
    await backToPreviousCanvas(page);
    await openSettings(page);
    await page.getByTestId('settings-nav-personal.editor').click();
    await expect(
      page.getByTestId('settings-zoomSensitivity').getByRole('slider'),
    ).toHaveAttribute('aria-valuenow', '1.5');
  });
}

test('readonly allows settings and export while disabling destructive menu actions', async ({
  page,
}) => {
  // Readonly workspaces never seed a board, so create one on a normal load
  // first; the readonly session then restores the persisted tab.
  await page.goto('/');
  await skipTutorial(page);
  await expect(page.getByTestId('save-status')).toHaveAttribute(
    'data-save-state',
    'saved',
    { timeout: 15000 },
  );
  await page.goto('/?readonly=1');
  await skipTutorial(page);
  const menu = await openAppMenu(page);
  for (const label of ['打开', '导入', '文本导入', '清空'])
    await expect(
      menu.getByRole('menuitem', { name: label, exact: true }),
    ).toBeDisabled();
  for (const label of ['导出', '图像导出', '设置'])
    await expect(
      menu.getByRole('menuitem', { name: label, exact: true }),
    ).toBeEnabled();
  await menu.getByRole('menuitem', { name: '设置', exact: true }).click();

  await slider(page, 'dragPanSpeed', '0.5');

  await page.getByTestId('my-back').click();
  const download = page.waitForEvent('download');
  await selectAppAction(page, '导出');
  expect((await download).suggestedFilename()).toBe(
    `${await activeTabTitle(page).textContent()}.verd`,
  );
});

test('invalid stored preferences fall back and numeric outliers are clamped', async ({
  page,
}) => {
  await page.addInitScript(
    (key) =>
      localStorage.setItem(
        key,
        JSON.stringify({ zoomSensitivity: 'bad', dragPanSpeed: 100 }),
      ),
    preferenceKey,
  );
  await page.goto('/');
  await skipTutorial(page);
  await openSettings(page);
  await page.getByTestId('settings-nav-personal.editor').click();
  await expect(
    page.getByTestId('settings-zoomSensitivity').getByRole('slider'),
  ).toHaveAttribute('aria-valuenow', '1');
  await expect(
    page.getByTestId('settings-dragPanSpeed').getByRole('slider'),
  ).toHaveAttribute('aria-valuenow', '3');
});

test('unified settings search navigates between personal and project fields in one dialog', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.workspace-shell')).toBeVisible();
  await page.getByTestId('workspace-my').click();
  const settings = page.getByTestId('my-page');
  await expect(settings.getByTestId('settings-language')).toBeVisible();
  await settings.getByTestId('settings-search').fill('工作区简介');
  await settings.locator('.settings-search-result').click();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(
    page.getByTestId('workspace-settings-description'),
  ).toBeFocused();
  await settings.getByTestId('settings-nav-workspace.project').click();
  await expect(
    settings.getByRole('combobox', { name: '宽度来源' }),
  ).toBeVisible();
  await settings.getByTestId('settings-nav-personal.general').click();
  await expect(settings.getByTestId('settings-language')).toBeVisible();
  await page.getByTestId('my-back').click();
  await expect(page.getByTestId('workspace-my')).toBeFocused();
});
