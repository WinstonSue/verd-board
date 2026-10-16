import { setAppLanguage } from './app-actions';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { selectDrawingTool } from './drawing-tools';
import { persistedWorkspace } from './workspace-nav';

const canvas = (page: Page) =>
  page.locator('svg[aria-label="Frame canvas"][data-surface="root"]:visible');
const draft = (page: Page) =>
  canvas(page).locator('[data-drawing-preview="true"]');
const cells = (page: Page, kind: string) =>
  canvas(page).locator(`[data-cell-kind="${kind}"]`);
const contour = (element: Locator) =>
  element.locator('path').evaluateAll((paths) =>
    paths
      .filter(
        (path) =>
          !path.closest(
            '[data-selection-handles], [data-vector-controls], [data-edge-hit], [data-vector-hit], [data-port-id]',
          ),
      )
      .map((path) => ({
        d: path.getAttribute('d'),
        fill: path.getAttribute('fill'),
        stroke:
          path.getAttribute('stroke') === '#6366f1'
            ? '#64748b'
            : path.getAttribute('stroke'),
        width: path.getAttribute('stroke-width'),
        dash: path.getAttribute('stroke-dasharray'),
      })),
  );
const start = async (page: Page, first = [320, 170], last = [530, 300]) => {
  const box = (await canvas(page).boundingBox())!;
  await page.mouse.move(box.x + first[0], box.y + first[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + last[0], box.y + last[1], { steps: 8 });
};

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await setAppLanguage(page, 'zh');
  const skip = page.getByRole('button', { name: '跳过', exact: true });
  if (await skip.isVisible().catch(() => false)) await skip.click();
});

test('every shape has a real pre-release contour matching the final renderer', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await selectDrawingTool(page, '形状');
  const selector = page.locator('.frame-shape-grid button[data-shape]');
  const shapes = await selector.evaluateAll((buttons) =>
    buttons.map((button) => button.getAttribute('data-shape')!),
  );
  expect(shapes).toHaveLength(65);
  for (const [index, shape] of shapes.entries()) {
    if (!(await selector.first().isVisible()))
      await selectDrawingTool(page, '形状');
    await page.getByTestId(`shape-${shape}`).click();
    await start(
      page,
      index % 2 ? [530, 300] : [320, 170],
      index % 2 ? [320, 170] : [530, 300],
    );
    await expect(draft(page)).toBeVisible();
    const preview = draft(page).locator('[data-shape-renderer="rough"]');
    expect(await preview.locator('path').count()).toBeGreaterThan(0);
    expect(await preview.innerHTML()).not.toMatch(/NaN|Infinity/);
    const id = await draft(page)
      .locator('[data-draft-cell-id]')
      .first()
      .getAttribute('data-draft-cell-id');
    const paths = await contour(preview);
    await expect(cells(page, 'geometry')).toHaveCount(0);
    await expect(
      draft(page).locator(
        '[data-port-id], [data-selection-handles], [tabindex], a',
      ),
    ).toHaveCount(0);
    await page.mouse.up();
    await expect(draft(page)).toHaveCount(0);
    const committed = canvas(page).locator(
      `[data-cell-id="${id}"] [data-shape-renderer="rough"]`,
    );
    await expect(committed).toBeVisible();
    expect(await contour(committed)).toEqual(paths);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    await expect(cells(page, 'geometry')).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test('text grids container content and pen styles preview their final appearance', async ({
  page,
}) => {
  for (const label of [
    '文本',
    '表格',
    '泳道',
    '容器',
    '思维导图',
    '流程图',
    '架构图',
  ]) {
    await selectDrawingTool(page, label);
    await start(page);
    await expect(draft(page)).toBeVisible();
    await expect(draft(page)).toContainText(label === '文本' ? 'Text' : '');
    expect((await draft(page).locator('[data-table-entry]').count()) > 1).toBe(
      ['表格', '泳道'].includes(label),
    );
    expect(
      (await draft(page).locator('[data-draft-cell-id]').count()) > 1,
    ).toBe(['思维导图', '流程图', '架构图'].includes(label));
    const id = await draft(page)
      .locator('[data-draft-cell-id]')
      .first()
      .getAttribute('data-draft-cell-id');
    const paths = await contour(draft(page));
    await page.mouse.up();
    const frameTool = ['容器', '思维导图', '流程图', '架构图'].includes(label);
    const committed = frameTool
      ? canvas(page).locator('[data-cell-kind="frame-reference"]')
      : canvas(page).locator(`[data-cell-id="${id}"]`);
    await expect(committed).toBeVisible();
    if (label === '文本') {
      // Text commits stay selected; an active draw tool intercepts blank clicks,
      // so switch to the pointer before deselecting. The click must clear the
      // floating app toolbar at the canvas's top edge.
      await selectDrawingTool(page, '选择');
      const box = (await canvas(page).boundingBox())!;
      await page.mouse.click(box.x + 100, box.y + 120);
    }
    expect(await contour(committed)).toEqual(paths);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
  }
  await selectDrawingTool(page, '画笔');
  for (const [pen, width, opacity] of [
    ['nibPen', 3, 1],
    ['feltTipPen', 3, 1],
    ['artisticBrush', 6, 1],
    ['markerHighlight', 16, 0.35],
  ] as const) {
    if (!(await page.getByLabel('Pen', { exact: true }).isVisible()))
      await selectDrawingTool(page, '画笔');
    await page.getByLabel('Pen', { exact: true }).selectOption(pen);
    await start(page);
    const preview = draft(page).locator('[data-draft-cell-kind="freehand"]');
    await expect(preview).toHaveAttribute('stroke-width', String(width));
    await expect(preview).toHaveAttribute('opacity', String(opacity));
    const paths = await contour(preview);
    await page.mouse.up();
    expect(await contour(cells(page, 'freehand'))).toEqual(paths);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
  }
});

test('long freehand paths survive continuous zoom and remain movable without camera saves or history', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => {
    const state = window as unknown as { freehandZoomWrites: number };
    state.freehandZoomWrites = 0;
    for (const method of ['put', 'add', 'delete'] as const) {
      const original = IDBObjectStore.prototype[method];
      IDBObjectStore.prototype[method] = function (...args: any[]) {
        // Per-tab camera/session state persists under `meta` — only document
        // content writes (`files`/`trash`) indicate a drawing mutation.
        if (['files', 'trash'].includes(this.name)) state.freehandZoomWrites++;
        return original.apply(this, args as never);
      } as typeof original;
    }
  });
  await selectDrawingTool(page, '画笔');
  await page.getByLabel('Pen', { exact: true }).selectOption('feltTipPen');
  const box = (await canvas(page).boundingBox())!;
  await page.mouse.move(box.x + 320, box.y + 250);
  await page.mouse.down();
  for (let index = 1; index <= 140; index++)
    await page.mouse.move(
      box.x + 320 + index * 3,
      box.y + 250 + Math.sin(index / 8) * 25,
    );
  await page.mouse.up();
  const stroke = cells(page, 'freehand');
  await expect(stroke).toHaveCount(1);
  const path = stroke.locator('path').first();
  const id = (await stroke.getAttribute('data-cell-id'))!;
  const savedStroke = async () =>
    Object.values((await persistedWorkspace(page))?.records ?? {})
      .map((record: any) => record.cells[id])
      .find(Boolean) as
      | {
          geometry: { x: number; y: number; width: number; height: number };
          data: { points: number[][] };
        }
      | undefined;
  await expect(page.getByTestId('save-status')).toHaveAttribute(
    'data-save-state',
    'saved',
  );
  await expect
    .poll(async () => (await savedStroke())?.data.points.length)
    .toBeGreaterThan(100);
  const original = (await savedStroke())!;
  const d = (await path.getAttribute('d'))!;
  const initialBounds = (await path.boundingBox())!;
  const world = canvas(page).locator('[data-frame-world]');
  const scale = () =>
    world.evaluate(
      (element) =>
        (element as SVGGElement).transform.baseVal.consolidate()!.matrix.a,
    );
  const initialScale = await scale();
  const writes = () =>
    page.evaluate(
      () =>
        (window as unknown as { freehandZoomWrites: number })
          .freehandZoomWrites,
    );
  await page.waitForTimeout(250);
  const before = await writes();
  const point = () =>
    path.evaluate((element) => {
      const path = element as SVGPathElement;
      const point = path
        .getPointAtLength(path.getTotalLength() * 0.45)
        .matrixTransform(path.getScreenCTM()!);
      return { x: point.x, y: point.y };
    });
  const anchor = await point();
  await page.mouse.move(anchor.x, anchor.y);
  await page.keyboard.down('Control');
  try {
    for (let index = 0; index < 48; index++) await page.mouse.wheel(0, -4);
  } finally {
    await page.keyboard.up('Control');
  }
  await expect.poll(scale).toBeGreaterThan(initialScale * 1.5);
  await expect(path).toHaveAttribute('d', d);
  await expect
    .poll(async () => (await path.boundingBox())!.width)
    .toBeGreaterThan(initialBounds.width * 1.5);
  await expect(page.getByTestId('save-status')).toHaveAttribute(
    'data-save-state',
    'saved',
  );
  expect(await writes()).toBe(before);
  expect(await savedStroke()).toEqual(original);

  await selectDrawingTool(page, '选择');
  const grab = await point();
  await page.mouse.click(grab.x, grab.y);
  await expect(canvas(page).locator('[data-selection-handles]')).toHaveCount(1);
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + 60, grab.y + 45, { steps: 15 });
  await page.mouse.up();
  await expect(path).not.toHaveAttribute('d', d);
  await expect
    .poll(async () => (await savedStroke())?.geometry.x)
    .toBeGreaterThan(original.geometry.x);
  await expect(page.getByTestId('save-status')).toHaveAttribute(
    'data-save-state',
    'saved',
  );
  const moved = (await savedStroke())!;
  expect(moved.geometry.x).toBeGreaterThan(original.geometry.x);
  expect(moved.geometry.y).toBeGreaterThan(original.geometry.y);
  expect(moved.data.points).toEqual(original.data.points);
  const undo = page.getByRole('button', { name: '撤销', exact: true });
  await undo.click();
  await expect(path).toHaveAttribute('d', d);
  await expect.poll(savedStroke).toEqual(original);
  await expect(page.getByTestId('save-status')).toHaveAttribute(
    'data-save-state',
    'saved',
  );
  expect(await savedStroke()).toEqual(original);
  // Only the drawing and its move occupy history; zoom has no undo entries.
  await undo.click();
  await expect(stroke).toHaveCount(0);
  await expect(undo).toBeDisabled();
  expect(errors).toEqual([]);
});

test('line arrow and curve have appropriate geometry and markers before and after release', async ({
  page,
}) => {
  for (const [index, label] of ['直线', '箭头', '曲线'].entries()) {
    await selectDrawingTool(page, label);
    await start(page, [320, 150 + index * 140], [560, 150 + index * 140]);
    await expect(draft(page)).toHaveCount(1);
    await expect(draft(page).locator('path').first()).toHaveAttribute(
      'd',
      /^M/,
    );
    await expect(draft(page).locator('[data-arrow-marker]')).toHaveCount(
      label === '箭头' ? 1 : 0,
    );
    expect((await contour(draft(page)))[0].d?.includes(' C')).toBe(
      label === '曲线',
    );
    const paths = await contour(draft(page));
    await page.mouse.up();
    expect((await contour(cells(page, 'arrow').nth(index)))[0]).toEqual(
      paths[0],
    );
    await expect(
      cells(page, 'arrow').nth(index).locator('[data-arrow-marker]'),
    ).toHaveCount(label === '箭头' ? 1 : 0);
  }
  await expect(page.getByTestId('save-status')).toHaveAttribute(
    'data-save-state',
    'saved',
  );
  await page.reload();
  await expect(cells(page, 'arrow')).toHaveCount(3);
  expect((await contour(cells(page, 'arrow').nth(2)))[0].d).toContain(' C');
  await selectDrawingTool(page, '选择');
  const point = await cells(page, 'arrow')
    .nth(2)
    .locator('path')
    .first()
    .evaluate((element) => {
      const path = element as SVGPathElement;
      const point = path
        .getPointAtLength(path.getTotalLength() / 2)
        .matrixTransform(path.getScreenCTM()!);
      return { x: point.x, y: point.y };
    });
  await page.mouse.click(point.x, point.y);
  await expect(
    cells(page, 'arrow').nth(2).locator('[data-edge-route-point]'),
  ).toHaveCount(1);
});

test('multi-point cancellation and tool switches leave no saved draft', async ({
  page,
}) => {
  await selectDrawingTool(page, '形状');
  await page.getByTestId('shape-rectangle').click();
  await start(page);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(cells(page, 'geometry')).toHaveCount(0);
  await start(page);
  await page.keyboard.press('p');
  await page.mouse.up();
  await expect(draft(page)).toHaveCount(0);
  await expect(cells(page, 'geometry')).toHaveCount(0);
  await expect(cells(page, 'freehand')).toHaveCount(0);
  await selectDrawingTool(page, '折线');
  const box = (await canvas(page).boundingBox())!;
  for (const [x, y] of [
    [320, 150],
    [500, 150],
    [500, 280],
  ])
    await page.mouse.click(box.x + x, box.y + y);
  await expect(draft(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(draft(page)).toHaveCount(0);
  await expect(cells(page, 'vector-line')).toHaveCount(0);
  await page.reload();
  await expect(canvas(page).locator('[data-cell-id]')).toHaveCount(0);
});

test('pending port connections and eraser candidates show feedback and can be canceled', async ({
  page,
}) => {
  await selectDrawingTool(page, '形状');
  await page.getByTestId('shape-rectangle').click();
  const box = (await canvas(page).boundingBox())!;
  await page.mouse.click(box.x + 300, box.y + 200);
  await selectDrawingTool(page, '形状');
  await page.getByTestId('shape-rectangle').click();
  await page.mouse.click(box.x + 600, box.y + 200);
  await selectDrawingTool(page, '选择');
  const source = cells(page, 'geometry')
    .nth(0)
    .locator('[data-port-id="right"]');
  const target = cells(page, 'geometry')
    .nth(1)
    .locator('[data-port-id="left"]');
  await cells(page, 'geometry').first().hover();
  await source.click();
  await expect(source).toHaveAttribute('data-port-active', 'true');
  await cells(page, 'geometry').nth(1).hover();
  await target.hover();
  await expect(target).toHaveAttribute('data-port-active', 'true');
  await expect(
    canvas(page).locator('[data-drawing-preview="connection"]'),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(canvas(page).locator('[data-drawing-preview]')).toHaveCount(0);
  await expect(cells(page, 'arrow')).toHaveCount(0);
  await cells(page, 'geometry').first().hover();
  await source.click();
  await cells(page, 'geometry').nth(1).hover();
  await target.click();
  await expect(cells(page, 'arrow')).toHaveCount(1);
  await selectDrawingTool(page, '橡皮擦');
  await page.mouse.move(box.x + 330, box.y + 230);
  await expect(canvas(page).locator('[data-eraser-preview]')).toBeVisible();
  await page.mouse.down();
  await page.mouse.move(box.x + 410, box.y + 250, { steps: 5 });
  await expect(canvas(page).locator('[data-erase-candidate]')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(cells(page, 'geometry')).toHaveCount(2);
  await page.mouse.move(box.x + 330, box.y + 230);
  await page.mouse.down();
  await page.mouse.move(box.x + 410, box.y + 250);
  await page.mouse.up();
  await expect(cells(page, 'geometry')).toHaveCount(1);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(cells(page, 'geometry')).toHaveCount(2);
});
