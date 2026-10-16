import { expect, test, type Locator } from '@playwright/test';
import { activateBoardTab, backToPreviousCanvas } from './workspace-nav';
import { expandPropertyGroup } from './property-group';

const canvas = (page: import('@playwright/test').Page) =>
  page.locator('svg[aria-label="Frame canvas"][data-surface="root"]:visible');
const world = (page: import('@playwright/test').Page) =>
  canvas(page).locator('> [data-frame-world]');

test('native edge hit targets keep twelve screen pixels through camera zoom', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  const skip = page.getByRole('button', { name: '跳过', exact: true });
  if (await skip.isVisible().catch(() => false)) await skip.click();
  const file = {
    store: {
      rootId: 'hit-frame',
      cells: {
        'hit-frame': {
          id: 'hit-frame',
          kind: 'frame',
          cellType: 'frame',
          geometry: { x: 0, y: 0, width: 960, height: 640 },
          children: ['hit-edge'],
          groups: [],
        },
        'hit-edge': {
          id: 'hit-edge',
          kind: 'arrow',
          cellType: 'edge',
          source: { point: [100, 300] },
          target: { point: [700, 300] },
          route: { mode: 'straight' },
          appearance: { strokeWidth: 2 },
        },
      },
    },
  };
  await page
    .locator('input[accept="application/json,.md,.markdown,.mmd,.mermaid"]')
    .nth(1)
    .setInputFiles({
      name: 'hit-width.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(file)),
    });
  const hit = canvas(page).locator('[data-edge-hit]');
  await expect(hit).toHaveCount(1);
  const edgeId = await hit.getAttribute('data-edge-hit');
  const zoom = () =>
    world(page).evaluate(
      (element) =>
        (element as SVGGElement).transform.baseVal.consolidate()!.matrix.a,
    );
  const middle = () =>
    hit.evaluate((element) => {
      const path = element as SVGPathElement;
      const point = path
        .getPointAtLength(path.getTotalLength() / 2)
        .matrixTransform(path.getScreenCTM()!);
      return { x: point.x, y: point.y };
    });
  for (const target of [0.1, 1, 4]) {
    const anchor = await middle();
    const delta = -Math.log(target / (await zoom())) / 0.01;
    await page.mouse.move(anchor.x, anchor.y);
    await page.keyboard.down('Control');
    try {
      await page.mouse.wheel(0, delta);
    } finally {
      await page.keyboard.up('Control');
    }
    await expect.poll(zoom).toBeCloseTo(target, 3);
    const point = await middle();
    const isHit = (offset: number) =>
      page.evaluate(
        ({ x, y, offset, edgeId }) =>
          document
            .elementFromPoint(x, y + offset)
            ?.closest('[data-edge-hit]')
            ?.getAttribute('data-edge-hit') === edgeId,
        { ...point, offset, edgeId },
      );
    expect(await isHit(5)).toBe(true);
    expect(await isHit(8)).toBe(false);
    await page.mouse.click(point.x, point.y + 5);
    await expect(
      canvas(page).locator(`[data-edge-controls="${edgeId}"]`),
    ).toHaveCount(1);
  }
});

async function expectSelectionCentered(
  page: import('@playwright/test').Page,
  targets: import('@playwright/test').Locator[],
) {
  let diagnostic: unknown;
  try {
    await expect
      .poll(async () => {
        const rects = await Promise.all(
          targets.map((node) => node.boundingBox()),
        );
        diagnostic = { rects };
        if (rects.some((rect) => !rect)) return Infinity;
        const boxes = rects as NonNullable<(typeof rects)[number]>[];
        const left = Math.min(...boxes.map((box) => box.x)),
          right = Math.max(...boxes.map((box) => box.x + box.width)),
          top = Math.min(...boxes.map((box) => box.y)),
          bottom = Math.max(...boxes.map((box) => box.y + box.height));
        const svg = (await canvas(page).boundingBox())!;
        const controls = (await page
          .locator('.frame-bottom-controls')
          .boundingBox())!;
        const inspector = await page.locator('.frame-inspector').boundingBox();
        const style = await page.locator('.verd-frame').getAttribute('style');
        const toolbar = Number(
          /--frame-app-toolbar-height:\s*([\d.]+)px/.exec(style ?? '')?.[1] ??
            0,
        );
        const insets = {
          left: 64,
          right: 16,
          top: 112 + Math.max(0, toolbar - 42),
          bottom: Math.max(64, controls.height + 32),
        };
        const centerX = svg.x + (svg.width + insets.left - insets.right) / 2,
          centerY = svg.y + (svg.height + insets.top - insets.bottom) / 2;
        diagnostic = {
          boxes,
          svg,
          controls,
          inspector,
          insets,
          centerX,
          centerY,
          style,
          world: await world(page).getAttribute('transform'),
        };
        return Math.max(
          Math.abs((left + right) / 2 - centerX),
          Math.abs((top + bottom) / 2 - centerY),
        );
      })
      .toBeLessThan(2);
  } catch (error) {
    await test.info().attach('recenter-bounds', {
      body: JSON.stringify(diagnostic),
      contentType: 'application/json',
    });
    throw new Error(`Re-center bounds: ${JSON.stringify(diagnostic)}`, {
      cause: error,
    });
  }
}

for (const width of [1280, 800])
  test(`Re-center finds offscreen nodes and multi-selections without saving at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(() => {
      const state = window as unknown as { recenterWrites: number };
      state.recenterWrites = 0;
      for (const method of ['put', 'add', 'delete'] as const) {
        const original = IDBObjectStore.prototype[method];
        IDBObjectStore.prototype[method] = function (...args: any[]) {
          if (this.name === 'files' || this.name === 'trash')
            state.recenterWrites++;
          return original.apply(this, args as never);
        } as typeof original;
      }
    });
    await page.goto('/');
    const skip = page.getByRole('button', { name: '跳过', exact: true });
    if (await skip.isVisible().catch(() => false)) await skip.click();
    const recenter = page.getByTestId('canvas-recenter');
    await expect(recenter).toHaveCount(0);
    const file = {
      store: {
        rootId: 'file',
        cells: {
          file: {
            id: 'file',
            kind: 'frame',
            cellType: 'frame',
            geometry: { x: 0, y: 0, width: 960, height: 640 },
            children: ['a', 'b'],
            groups: [],
          },
          a: {
            id: 'a',
            kind: 'geometry',
            cellType: 'node',
            geometry: {
              x: 100,
              y: 100,
              width: 100,
              height: 60,
              outline: 'rectangle',
            },
            content: { label: 'Center first' },
          },
          b: {
            id: 'b',
            kind: 'geometry',
            cellType: 'node',
            geometry: {
              x: 280,
              y: 180,
              width: 140,
              height: 80,
              outline: 'rectangle',
              rotation: 0.4,
            },
            content: { label: 'Center second' },
          },
        },
      },
    };
    await page
      .locator('input[accept="application/json,.md,.markdown,.mmd,.mermaid"]')
      .nth(1)
      .setInputFiles({
        name: 'recenter.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(file)),
      });
    const nodes = canvas(page).locator('[data-cell-kind="geometry"]');
    const shapes = nodes.locator('[data-shape-renderer="rough"]');
    await expect(nodes).toHaveCount(2);
    await expect(page.getByTestId('save-status')).toHaveAttribute(
      'data-save-state',
      'saved',
    );
    await nodes.first().click();
    await expect(recenter).toHaveText('重新居中');
    const controls = (await page
        .getByTestId('canvas-status-bar')
        .boundingBox())!,
      floating = (await page.locator('.frame-recenter-control').boundingBox())!;
    expect(
      floating.x < controls.x + controls.width &&
        floating.x + floating.width > controls.x &&
        floating.y < controls.y + controls.height &&
        floating.y + floating.height > controls.y,
    ).toBe(false);
    const initialZoom = await page
      .getByTestId('canvas-zoom-label')
      .textContent();
    await page.getByTestId('canvas-zoom-in').click();
    await expect(page.getByTestId('canvas-zoom-label')).not.toHaveText(
      initialZoom!,
    );
    const zoom = await page.getByTestId('canvas-zoom-label').textContent();
    const writes = () =>
      page.evaluate(
        () => (window as unknown as { recenterWrites: number }).recenterWrites,
      );
    // Debounced view-state commits can still be flushing when save-status
    // flips to 'saved', so sample only once the write count has gone quiet.
    await expect
      .poll(async () => {
        const a = await writes();
        await page.waitForTimeout(700);
        return (await writes()) === a;
      })
      .toBe(true);
    const before = await writes();
    const box = (await canvas(page).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(2400, 1800);
    await expect
      .poll(async () => (await nodes.first().boundingBox())!.x)
      .toBeLessThan(box.x - 100);
    await expect(recenter).toBeVisible();
    await recenter.click();
    await expectSelectionCentered(page, [shapes.first()]);
    await expect(page.getByTestId('canvas-zoom-label')).toHaveText(zoom!);
    expect(await writes()).toBe(before);
    await expect(page.getByTestId('save-status')).toHaveAttribute(
      'data-save-state',
      'saved',
    );

    // Fit keeps both targets reachable before adding the second to the selection.
    await page.getByTestId('canvas-status-fit').click();
    await nodes.nth(1).click({ modifiers: ['Shift'] });
    await recenter.click();
    await expectSelectionCentered(page, [shapes.first(), shapes.nth(1)]);
    expect(await writes()).toBe(before);
    await canvas(page).press('Escape');
    await expect(recenter).toHaveCount(0);

    if (width === 390) {
      await page.getByTestId('canvas-status-fit').click();
      await nodes.first().click();
      await page.getByRole('button', { name: '属性', exact: true }).click();
      const inspector = page.locator('.frame-inspector.is-open');
      await expect(inspector).toBeVisible();
      await expect
        .poll(async () => {
          const panel = (await inspector.boundingBox())!,
            bottomControls = (await page
              .locator('.frame-bottom-controls')
              .boundingBox())!;
          return bottomControls.y - panel.y - panel.height;
        })
        .toBeGreaterThanOrEqual(10);
      await recenter.click();
      await expectSelectionCentered(page, [shapes.first()]);
      await page.screenshot({ path: '/private/tmp/verd-recenter-narrow.png' });
    } else {
      await page.getByTestId('canvas-status-fit').click();
      await nodes.first().click();
      await nodes.nth(1).click({ modifiers: ['Shift'] });
      await expandPropertyGroup(page);
      await page.getByRole('button', { name: '分组', exact: true }).click();
      await nodes.first().click();
      await expect(recenter).toBeVisible();
      await recenter.click();
      await expectSelectionCentered(page, [shapes.first(), shapes.nth(1)]);
      await page.screenshot({ path: '/private/tmp/verd-recenter-desktop.png' });
    }
  });

test('camera navigation never saves, left tooltips sit beside icons, and selection is a rectangle', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const state = window as unknown as { cameraTestWrites: number };
    state.cameraTestWrites = 0;
    for (const method of ['put', 'add', 'delete'] as const) {
      const original = IDBObjectStore.prototype[method];
      IDBObjectStore.prototype[method] = function (...args: any[]) {
        if (this.name === 'files' || this.name === 'trash')
          state.cameraTestWrites++;
        return original.apply(this, args as never);
      } as typeof original;
    }
  });
  await page.goto('/');
  const skip = page.getByRole('button', { name: '跳过', exact: true });
  if (await skip.isVisible().catch(() => false)) await skip.click();
  const undo = page.getByRole('button', { name: '撤销', exact: true });
  await expect(undo).toBeDisabled();
  await undo.hover();
  await expect(page.getByRole('tooltip')).toContainText('撤销');
  await page.keyboard.press('Escape');
  const hand = page.getByRole('button', { name: '手型', exact: true });
  await hand.hover();
  const tooltip = page.getByRole('tooltip');
  await expect(tooltip).toHaveText('手型 — H');
  const tipBox = (await tooltip.boundingBox())!,
    handBox = (await hand.boundingBox())!;
  expect(tipBox.x).toBeGreaterThanOrEqual(handBox.x + handBox.width);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '形状', exact: true }).click();
  await page.getByTestId('shape-rectangle').click();
  const box = (await canvas(page).boundingBox())!;
  await page.mouse.click(box.x + 300, box.y + 240);
  await expect(canvas(page).locator('[data-cell-kind="geometry"]')).toHaveCount(
    1,
  );
  await expect(page.getByTestId('save-status')).toHaveAttribute(
    'data-save-state',
    'saved',
  );
  const writes = () =>
    page.evaluate(
      () =>
        (window as unknown as { cameraTestWrites: number }).cameraTestWrites,
    );
  // Debounced view-state commits can still be flushing when save-status
  // flips to 'saved', so sample only once the write count has gone quiet.
  await expect
    .poll(async () => {
      const a = await writes();
      await page.waitForTimeout(700);
      return (await writes()) === a;
    })
    .toBe(true);
  const before = await writes();
  await hand.click();
  await page.mouse.move(box.x + 450, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 550, box.y + 330, { steps: 30 });
  await page.mouse.up();
  await page.getByTestId('canvas-zoom-in').click();
  await expect(page.getByTestId('canvas-zoom-label')).toHaveText('110%');
  await page.mouse.move(box.x + 400, box.y + 300);
  await page.mouse.wheel(120, 90);
  await page.waitForTimeout(550);
  expect(await writes()).toBe(before);
  await expect(page.getByTestId('save-status')).toHaveAttribute(
    'data-save-state',
    'saved',
  );
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(canvas(page).locator('[data-cell-kind="geometry"]')).toHaveCount(
    0,
  );
  await expect.poll(writes).toBeGreaterThan(before);
  await expect(page.getByTestId('save-status')).toHaveAttribute(
    'data-save-state',
    'saved',
  );
  await expect(page.getByTestId('canvas-zoom-label')).toHaveText('110%');
  await page.getByRole('button', { name: '选择', exact: true }).click();
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 420, box.y + 360, { steps: 10 });
  const marquee = canvas(page).locator('[data-selection-marquee]');
  await expect(marquee).toBeVisible();
  expect(await marquee.evaluate((node) => node.tagName)).toBe('rect');
  expect((await marquee.boundingBox())!.height).toBeGreaterThan(100);
  await page.mouse.up();
  await expect(marquee).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('canvas-zoom-label')).toHaveText('100%');
  await expect(world(page)).toHaveAttribute(
    'transform',
    'scale(1) translate(0 0)',
  );
  expect(errors).toEqual([]);
});

test('nested details return one level at a time and focus the opened shell', async ({
  page,
}) => {
  await page.goto('/');
  const skip = page.getByRole('button', { name: '跳过', exact: true });
  if (await skip.isVisible().catch(() => false)) await skip.click();
  const frame = (
    id: string,
    children: string[],
    x: number,
    y: number,
    width: number,
    height: number,
  ) => ({
    id,
    kind: 'frame',
    cellType: 'frame',
    geometry: { x, y, width, height },
    children,
    groups: [],
  });
  const file = {
    store: {
      rootId: 'file',
      cells: {
        file: frame('file', ['outer'], 0, 0, 960, 640),
        outer: frame('outer', ['inner'], 100, 100, 600, 400),
        inner: frame('inner', ['node'], 30, 30, 280, 180),
        node: {
          id: 'node',
          kind: 'geometry',
          cellType: 'node',
          geometry: { x: 20, y: 20, width: 60, height: 40 },
          content: { label: 'Nested marker' },
        },
      },
    },
  };
  await page
    .locator('input[accept="application/json,.md,.markdown,.mmd,.mermaid"]')
    .nth(1)
    .setInputFiles({
      name: 'nested.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(file)),
    });
  await expect(
    canvas(page).locator(
      '[data-cell-kind="frame"],[data-cell-kind="frame-reference"]',
    ),
  ).toHaveCount(2);
  const outer = canvas(page)
    .locator('[data-cell-kind="frame"],[data-cell-kind="frame-reference"]')
    .first();
  const inner = canvas(page)
    .locator('[data-cell-kind="frame"],[data-cell-kind="frame-reference"]')
    .nth(1);
  const outerId = await outer.getAttribute('data-cell-id'),
    innerId = await inner.getAttribute('data-cell-id');
  const outerShell = outer.locator(':scope > rect'),
    outerTitle = canvas(page).locator(`[data-frame-title-id="${outerId}"]`),
    marker = canvas(page).locator('[data-cell-kind="geometry"]');
  await outerShell.click({ position: { x: 12, y: 12 } });
  const recenter = page.getByTestId('canvas-recenter');
  await expect(recenter).toBeVisible();
  await page.getByTestId('canvas-zoom-out').click();
  await recenter.click();
  await expectSelectionCentered(page, [outerShell, outerTitle]);
  await expect(page.getByTestId('canvas-zoom-label')).toHaveText('90%');
  await marker.click();
  await recenter.click();
  await expectSelectionCentered(page, [
    marker.locator('[data-shape-renderer="rough"]'),
  ]);
  await expect(page.getByTestId('canvas-zoom-label')).toHaveText('90%');
  await page.getByTestId('canvas-status-fit').click();
  // The title strip renames on double-click, so opening a frame happens on
  // the shell's bottom margin, the only part left uncovered by content —
  // off-center, since the selected frame's resize handle sits at mid-bottom.
  const openByShell = async (frame: Locator) => {
    const box = (await frame.locator(':scope > rect').boundingBox())!;
    await page.mouse.dblclick(box.x + box.width / 4, box.y + box.height - 4);
  };
  await openByShell(outer);
  await expect(
    canvas(page).locator(
      '[data-cell-kind="frame"],[data-cell-kind="frame-reference"]',
    ),
  ).toHaveCount(1);
  await openByShell(
    canvas(page)
      .locator('[data-cell-kind="frame"],[data-cell-kind="frame-reference"]')
      .first(),
  );
  await expect(
    canvas(page).locator(
      '[data-cell-kind="frame"],[data-cell-kind="frame-reference"]',
    ),
  ).toHaveCount(0);
  await backToPreviousCanvas(page);
  await expect(
    canvas(page).locator(
      '[data-cell-kind="frame"],[data-cell-kind="frame-reference"]',
    ),
  ).toHaveCount(1);
  await expect(
    canvas(page).locator(
      '[data-cell-kind="frame"],[data-cell-kind="frame-reference"]',
    ),
  ).toHaveAttribute('data-cell-id', innerId!);
  await backToPreviousCanvas(page);
  await expect(
    canvas(page).locator(
      '[data-cell-kind="frame"],[data-cell-kind="frame-reference"]',
    ),
  ).toHaveCount(2);
  await expect(
    canvas(page)
      .locator('[data-cell-kind="frame"],[data-cell-kind="frame-reference"]')
      .first(),
  ).toHaveAttribute('data-cell-id', outerId!);
  const shell = (await canvas(page)
    .locator('[data-cell-kind="frame"],[data-cell-kind="frame-reference"]')
    .first()
    .locator(':scope > rect')
    .boundingBox())!;
  const svg = (await canvas(page).boundingBox())!;
  expect(shell.x + shell.width / 2).toBeCloseTo(
    svg.x + 64 + (svg.width - 64 - 16) / 2,
    0,
  );
  await expect(page.getByRole('tab').first()).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(
    page.getByTestId('save-status').locator('visible=true'),
  ).toHaveAttribute('data-save-state', 'saved');
  await page.setViewportSize({ width: 800, height: 844 });
  await page.reload();
  await activateBoardTab(page);
  const narrowShell = (await canvas(page)
    .locator('[data-cell-kind="frame"],[data-cell-kind="frame-reference"]')
    .first()
    .locator(':scope > rect')
    .boundingBox())!;
  const narrowCanvas = (await canvas(page).boundingBox())!;
  expect(narrowShell.x).toBeGreaterThanOrEqual(narrowCanvas.x);
  expect(narrowShell.x + narrowShell.width).toBeLessThanOrEqual(
    narrowCanvas.x + narrowCanvas.width,
  );
});

for (const modifier of ['ctrlKey', 'metaKey'] as const)
  test(`${modifier} wheel uses 0.01 exponential zoom, preserves its anchor and never saves at either limit`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const state = window as unknown as { zoomWrites: number };
      state.zoomWrites = 0;
      for (const method of ['put', 'add', 'delete'] as const) {
        const original = IDBObjectStore.prototype[method];
        IDBObjectStore.prototype[method] = function (...args: any[]) {
          if (this.name === 'files' || this.name === 'trash')
            state.zoomWrites++;
          return original.apply(this, args as never);
        } as typeof original;
      }
    });
    await page.goto('/');
    const skip = page.getByRole('button', { name: '跳过', exact: true });
    if (await skip.isVisible().catch(() => false)) await skip.click();
    await expect(canvas(page)).toBeVisible();
    await expect(page.getByTestId('save-status')).toHaveAttribute(
      'data-save-state',
      'saved',
    );
    const writes = () =>
      page.evaluate(
        () => (window as unknown as { zoomWrites: number }).zoomWrites,
      );
    const beforeWrites = await writes();
    const camera = async () => {
      const values = (await world(page).getAttribute('transform'))!
        .match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/g)!
        .map(Number);
      return { zoom: values[0], x: -values[1], y: -values[2] };
    };
    const wheel = (deltaY: number) =>
      canvas(page).evaluate(
        (svg, { modifier, deltaY }) => {
          const rect = svg.getBoundingClientRect();
          const event = new WheelEvent('wheel', {
            bubbles: true,
            cancelable: true,
            [modifier]: true,
            deltaX: 12,
            deltaY,
            clientX: rect.left + 400,
            clientY: rect.top + 300,
          });
          svg.dispatchEvent(event);
          return event.defaultPrevented;
        },
        { modifier, deltaY },
      );
    const before = await camera();
    expect(await wheel(-100)).toBe(true);
    await expect
      .poll(async () => (await camera()).zoom)
      .toBeCloseTo(before.zoom * Math.exp(1));
    const after = await camera();
    expect(after.x + 400 / after.zoom).toBeCloseTo(
      before.x + 400 / before.zoom,
    );
    expect(after.y + 300 / after.zoom).toBeCloseTo(
      before.y + 300 / before.zoom,
    );
    for (const [limit, deltaY] of [
      [8, -1000],
      [0.1, 1000],
    ]) {
      await wheel(deltaY);
      await expect.poll(async () => (await camera()).zoom).toBe(limit);
      const transform = await world(page).getAttribute('transform');
      await wheel(deltaY);
      await expect(world(page)).toHaveAttribute('transform', transform!);
    }
    await page.waitForTimeout(550);
    expect(await writes()).toBe(beforeWrites);
    await expect(
      page.getByRole('button', { name: '撤销', exact: true }),
    ).toBeDisabled();
    await expect(page.getByTestId('save-status')).toHaveAttribute(
      'data-save-state',
      'saved',
    );
  });
