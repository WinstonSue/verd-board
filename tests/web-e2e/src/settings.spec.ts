import { expect, test, type Page } from '@playwright/test';
import { openAppMenu, openSettings, selectAppAction } from './app-actions';
import { selectDrawingTool } from './drawing-tools';
import { backToPreviousCanvas } from './workspace-nav';

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
  await expect(canvas(page)).toBeVisible();
  const skip = page.getByRole('button', { name: /^(跳过|Skip)$/ });
  if (await skip.isVisible()) await skip.click();
};
const slider = async (page: Page, name: string, value: string) => {
  const input = page.getByTestId(`settings-${name}`);
  // Playwright fill() does not support range controls; use native value setter
  // and the browser input event, which also exercises React's change handler.
  await input.evaluate((element, next) => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(element, next);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  await expect(input).toHaveValue(value);
};

test('More is the only low-frequency entry on wide and narrow screens and supports keyboard navigation', async ({
  page,
}) => {
  await page.goto('/');
  await skipTutorial(page);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const toolbar = page.getByRole('toolbar', { name: 'App actions' });
    await expect(toolbar.getByRole('button', { name: '更多' })).toBeVisible();
    await expect(toolbar.getByRole('button', { name: '撤销' })).toBeVisible();
    await expect(toolbar.getByRole('button', { name: '重做' })).toBeVisible();
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
      menu.getByRole('menuitem', { name: '设置', exact: true }),
    ).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('settings-page')).toBeVisible();
    await page.getByTestId('settings-back').click();
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
  expect(bounds.width).toBe(page.viewportSize()!.width);
  expect(bounds.height).toBe(page.viewportSize()!.height);
  await settings.getByTestId('settings-back').focus();
  for (const key of [
    'h',
    'v',
    'ControlOrMeta+Backspace',
    'ControlOrMeta+Shift+e',
  ])
    await page.keyboard.press(key);
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await settings.getByTestId('settings-language').selectOption('en');
  await expect(
    settings.getByRole('heading', { name: 'Settings', exact: true }),
  ).toBeVisible();
  await settings.getByTestId('settings-back').click();
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
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(canvas(page).locator('[data-cell-kind="geometry"]')).toHaveCount(
    0,
  );
  await page.reload();
  await openSettings(page);
  await expect(page.getByTestId('settings-language')).toHaveValue('en');
});

test('interaction settings update gestures immediately, persist, and reset independently of language', async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).settingsWrites = 0;
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (
      this: IDBObjectStore,
      ...args: any[]
    ) {
      // Only document content writes count; `meta`/`workspaces` carry
      // per-tab camera state and session bookkeeping now.
      if (['files', 'trash'].includes(this.name))
        (window as any).settingsWrites++;
      return original.apply(this, args as never);
    } as typeof original;
  });
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
  await page.getByTestId('settings-back').click();
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
  await expect(page.getByTestId('settings-zoomSensitivity')).toHaveValue('0.5');
  await expect(page.getByTestId('settings-dragPanSpeed')).toHaveValue('2');
  await page.getByTestId('settings-language').selectOption('en');
  await page.getByRole('button', { name: 'Reset interaction speeds' }).click();
  await expect(page.getByTestId('settings-zoomSensitivity')).toHaveValue('1');
  await expect(page.getByTestId('settings-dragPanSpeed')).toHaveValue('1');
  await expect(page.getByTestId('settings-language')).toHaveValue('en');
  expect(
    await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)!),
      preferenceKey,
    ),
  ).toEqual({ zoomSensitivity: 1, dragPanSpeed: 1, smartGuides: true });
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
    await page.getByTestId('settings-back').click();
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
    await expect(page.getByTestId('settings-zoomSensitivity')).toHaveValue(
      '1.5',
    );
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
  await page.getByTestId('settings-back').click();
  const download = page.waitForEvent('download');
  await selectAppAction(page, '导出');
  expect((await download).suggestedFilename()).toBe('verd-frame.json');
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
  await expect(page.getByTestId('settings-zoomSensitivity')).toHaveValue('1');
  await expect(page.getByTestId('settings-dragPanSpeed')).toHaveValue('3');
});
