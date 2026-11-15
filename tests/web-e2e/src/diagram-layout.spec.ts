import { selectHistoryAction } from './app-actions';
import { expect, test, type Page, type Locator } from './service-fixture';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { selectAppAction, setAppLanguage, openActiveFile } from './app-actions';
import { expandPropertyGroup } from './property-group';
import {
  type FrameCell,
  type FrameSnapshot,
  type NodeCell,
} from '../../../packages/engine/core/src/cell/types';
import { clearWorkspaceStorage, persistedWorkspace } from './workspace-nav';

const canvas = (page: Page) =>
  page.locator('svg[aria-label="Frame canvas"][data-surface="root"]:visible');
const cell = (page: Page, id: string) =>
  canvas(page).locator(`[data-cell-id="${id}"]`);
const fixture = (name: string): FrameSnapshot =>
  JSON.parse(
    readFileSync(
      path.resolve(__dirname, `../../fixtures/diagrams/${name}.json`),
      'utf8',
    ),
  );

async function openSnapshot(page: Page, snapshot: FrameSnapshot) {
  await page.goto('/');
  await openActiveFile(page);
  await expect(canvas(page)).toBeVisible();
  await expect(page.getByTestId('save-status')).toHaveAttribute(
    'data-save-state',
    'saved',
  );
  // Seed immutable Frame records so regression fixtures retain their stable IDs.
  await page.evaluate(async (snapshot) => {
    const records: [string, unknown][] = [];
    const saved = {
      put(value: unknown, key: string) {
        records.push([key, value]);
      },
    };
    const frames: Record<string, string> = {};
    for (const cell of Object.values(snapshot.store.cells)) {
      if (cell.cellType !== 'frame') continue;
      const frame = cell as FrameCell;
      const key = `frames/fixture-${Object.keys(frames).length}/fixture`;
      frames[frame.id] = key;
      const cells = Object.fromEntries(
        [...frame.children, ...frame.groups]
          .map((id) => [id, snapshot.store.cells[id]])
          .filter(
            ([, child]) => (child as { cellType: string }).cellType !== 'frame',
          ),
      );
      saved.put({ format: 'verd-frame', version: 1, frame, cells }, key);
    }
    saved.put(
      {
        format: 'verd-workspace',
        version: 2,
        rootId: snapshot.store.rootId,
        frames,
        detachedFrameIds: [],
      },
      'main_board_content',
    );
    await (window as any).__verdSeedLegacy(records);
  }, snapshot);
  await clearWorkspaceStorage(page);
  await page.reload();
  await openActiveFile(page);
  await expect(canvas(page)).toBeVisible();
}

async function savedCells(page: Page): Promise<Record<string, any>> {
  const data = await persistedWorkspace(page);
  return Object.assign(
    {},
    ...Object.values(data?.records ?? {}).map((record: any) => ({
      ...record.cells,
      [record.frame.id]: record.frame,
    })),
  );
}

async function routes(page: Page) {
  return canvas(page)
    .locator('[data-edge-hit]')
    .evaluateAll((elements) =>
      Object.fromEntries(
        elements.map((element) => [
          element.getAttribute('data-edge-hit'),
          element.getAttribute('d'),
        ]),
      ),
    );
}

async function expectJoinedRoutingButton(scope: Locator) {
  const box = await scope.locator('.frame-routing-button').evaluate((group) => {
    const main = group.querySelector('[data-testid="frame-reroute-edges"]')!;
    const arrow = group.querySelector('.frame-routing-toggle')!;
    const outer = group.getBoundingClientRect(),
      a = main.getBoundingClientRect(),
      b = arrow.getBoundingClientRect();
    const style = getComputedStyle(group),
      left = getComputedStyle(main),
      right = getComputedStyle(arrow);
    return {
      gap: b.left - a.right,
      y: a.top - b.top,
      height: a.height - b.height,
      outerHeight: outer.height - a.height,
      border: [
        style.borderTopWidth,
        style.borderRightWidth,
        style.borderBottomWidth,
        style.borderLeftWidth,
      ],
      radii: [
        style.borderTopLeftRadius,
        style.borderTopRightRadius,
        style.borderBottomLeftRadius,
        style.borderBottomRightRadius,
      ],
      mainBorder: [
        left.borderTopWidth,
        left.borderRightWidth,
        left.borderBottomWidth,
        left.borderLeftWidth,
      ],
      arrowBorder: [
        right.borderTopWidth,
        right.borderRightWidth,
        right.borderBottomWidth,
        right.borderLeftWidth,
      ],
      overflow: style.overflow,
    };
  });
  expect(Math.abs(box.gap)).toBeLessThan(0.5);
  expect(Math.abs(box.y)).toBeLessThan(0.5);
  expect(Math.abs(box.height)).toBeLessThan(0.5);
  expect(box.outerHeight).toBeCloseTo(2);
  expect(box.border).toEqual(['1px', '1px', '1px', '1px']);
  expect(box.radii).toEqual(['6px', '6px', '6px', '6px']);
  expect(box.mainBorder).toEqual(['0px', '0px', '0px', '0px']);
  expect(box.arrowBorder).toEqual(['0px', '0px', '0px', '1px']);
  expect(box.overflow).toBe('visible');
}

test('one-shot edge optimization saves editable paths and shares the routing choice', async ({
  page,
}) => {
  const snapshot = fixture('architecture-layered');
  await openSnapshot(page, snapshot);
  await expandPropertyGroup(page);
  const panel = page
    .getByRole('complementary')
    .getByTestId('frame-arrangement');
  const main = panel.getByTestId('frame-reroute-edges');
  await expect(main).toHaveText('优化全部连线');
  await expect(main).toBeEnabled();
  await expectJoinedRoutingButton(panel);
  await main.hover();
  await expectJoinedRoutingButton(panel);
  await expect
    .poll(async () => Object.keys(await savedCells(page)).length)
    .toBe(Object.keys(snapshot.store.cells).length);
  const before = await savedCells(page);
  await main.click();
  await expect(main).toBeEnabled();
  await expect(panel.getByTestId('frame-auto-layout-toggle')).not.toBeChecked();
  await expect(panel.getByTestId('frame-auto-edges-toggle')).not.toBeChecked();
  await expect
    .poll(
      async () =>
        Object.values(await savedCells(page)).filter(
          (cell: any) =>
            cell.route?.mode === 'orthogonal' && cell.route.points?.length,
        ).length,
    )
    .toBeGreaterThan(0);
  const optimized = await savedCells(page);
  for (const node of Object.values(before).filter(
    (cell) => cell.cellType === 'node',
  ))
    expect(optimized[node.id]).toEqual(node);
  await panel.getByRole('button', { name: '选择连线整理方式' }).click();
  await page.getByRole('menuitemradio', { name: /^重置手工走线/ }).click();
  await expect(main).toHaveText('重置手工走线');
  await expect(main).toBeDisabled();
  await expectJoinedRoutingButton(panel);
  await expect
    .poll(
      async () =>
        Object.values(await savedCells(page)).filter(
          (cell: any) => cell.route?.points?.length,
        ).length,
    )
    .toBe(0);
  const reset = await savedCells(page);
  for (const node of Object.values(before).filter(
    (cell) => cell.cellType === 'node',
  ))
    expect(reset[node.id]).toEqual(node);
  await main.locator('..').focus();
  await expect(page.getByRole('tooltip')).toContainText('手工折点');
  await page.keyboard.press('Escape');
  await panel.locator('.frame-routing-button').screenshot({
    path: test.info().outputPath('routing-disabled-joined.png'),
  });
  await selectHistoryAction(page, '撤销');
  await expect.poll(() => savedCells(page)).toEqual(optimized);
  await selectHistoryAction(page, '重做');
  await expect.poll(() => savedCells(page)).toEqual(reset);
  const firstNode = Object.values(snapshot.store.cells).find(
    (cell) => cell.kind === 'architecture-module',
  )!;
  {
    const b = await cell(page, firstNode.id).boundingBox();
    await page.mouse.click(b!.x + b!.width / 2, b!.y + b!.height / 2, {
      button: 'right',
    });
  }
  const menu = page.getByRole('menu', { name: /^(画布编辑|Canvas editing)$/ });
  await expect(menu.getByTestId('frame-reroute-edges')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(panel.getByTestId('frame-reroute-edges')).toHaveText(
    '重置手工走线',
  );
  await expectJoinedRoutingButton(panel);
  await panel.getByRole('button', { name: '选择连线整理方式' }).focus();
  await page.keyboard.press('ArrowDown');
  const resetItem = page.getByRole('menuitemradio', { name: /^重置手工走线/ });
  const optimizeItem = page.getByRole('menuitemradio', {
    name: /^优化全部连线/,
  });
  await expect(resetItem).toBeFocused();
  await expect(resetItem).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Space');
  await expect(resetItem).toBeVisible();
  expect(await savedCells(page)).toEqual(reset);
  await page.keyboard.press('Home');
  await expect(optimizeItem).toBeFocused();
  await page.keyboard.press('End');
  await expect(resetItem).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(optimizeItem).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(panel.getByTestId('frame-reroute-edges')).toHaveText(
    '优化全部连线',
  );
  await expect
    .poll(
      async () =>
        Object.values(await savedCells(page)).filter(
          (cell: any) => cell.route?.points?.length,
        ).length,
    )
    .toBeGreaterThan(0);
  const optimizedSelection = await savedCells(page);
  await expectJoinedRoutingButton(panel);
  await panel
    .locator('.frame-routing-button')
    .screenshot({ path: test.info().outputPath('routing-panel-joined.png') });
  // Choosing the current mode runs again, but equal paths add no undo entry.
  await panel.getByRole('button', { name: '选择连线整理方式' }).click();
  await expect(optimizeItem).toBeFocused();
  await page.keyboard.press('Space');
  await expect(optimizeItem).toHaveCount(0);
  expect(await savedCells(page)).toEqual(optimizedSelection);
  await page.keyboard.press('Escape');
  await expect(main).toHaveText('优化全部连线');
  await selectHistoryAction(page, '撤销');
  await expect.poll(() => savedCells(page)).toEqual(reset);
  await selectHistoryAction(page, '重做');
  await expect.poll(() => savedCells(page)).toEqual(optimizedSelection);
  const paths = await routes(page);
  await page.reload();
  await expect.poll(() => routes(page)).toEqual(paths);
  await setAppLanguage(page, 'en');
  await expandPropertyGroup(page);
  await expect(main).toHaveText('Optimize all edges');
  await expect(main).toBeEnabled();
  await expectJoinedRoutingButton(panel);
  await panel.getByRole('button', { name: 'Choose routing method' }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(
    page.getByRole('menuitemradio', { name: /^Optimize all edges/ }),
  ).toBeFocused();
  await expect(
    page.getByRole('menuitemradio', { name: /^Reset manual paths/ }),
  ).toContainText('restore automatic routing');
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('menu', { name: 'Routing method', exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: test.info().outputPath('one-shot-routing.png'),
  });
});

test('group node layout and edge rerouting are independent, undoable and survive reload', async ({
  page,
}) => {
  const node = (id: string, x: number, y: number): NodeCell => ({
    id,
    cellType: 'node',
    kind: 'geometry',
    geometry: { x, y, width: 60, height: 40 },
    content: { label: id },
  });
  const snapshot: FrameSnapshot = {
    store: {
      rootId: 'root',
      cells: {
        root: {
          id: 'root',
          kind: 'frame',
          cellType: 'frame',
          geometry: { x: 0, y: 0, width: 960, height: 640 },
          children: ['a', 'b', 'outside', 'inside', 'boundary'],
          groups: ['g'],
        },
        a: node('a', 80, 100),
        b: node('b', 400, 300),
        outside: node('outside', 700, 100),
        g: { id: 'g', cellType: 'group', kind: 'group', members: ['a', 'b'] },
        inside: {
          id: 'inside',
          cellType: 'edge',
          kind: 'arrow',
          source: { cellId: 'a', anchor: [1, 0.5] },
          target: { cellId: 'b', anchor: [0, 0.5] },
          route: {
            mode: 'orthogonal',
            points: [
              [140, 120],
              [220, 120],
              [220, 320],
              [400, 320],
            ],
          },
        },
        boundary: {
          id: 'boundary',
          cellType: 'edge',
          kind: 'arrow',
          source: { cellId: 'b' },
          target: { cellId: 'outside' },
          route: {
            mode: 'fixed',
            points: [
              [460, 320],
              [600, 320],
              [600, 120],
              [700, 120],
            ],
          },
        },
      },
    },
  };
  await openSnapshot(page, snapshot);
  await expect
    .poll(async () => (await savedCells(page)).b?.geometry)
    .toEqual((snapshot.store.cells.b as NodeCell).geometry);
  await cell(page, 'a').click();
  await expandPropertyGroup(page);
  const panel = page
    .getByRole('complementary')
    .getByTestId('frame-arrangement');
  await expect(panel.getByTestId('frame-auto-layout')).toHaveText(
    '布局组内节点',
  );
  await cell(page, 'a').click({ button: 'right' });
  const menu = page.getByRole('menu', { name: /^(画布编辑|Canvas editing)$/ });
  await expect(menu.getByTestId('frame-auto-layout')).toHaveCount(0);
  await expect(menu.getByTestId('frame-reroute-edges')).toHaveCount(0);
  await expect(
    panel.getByRole('button', { name: '布局组内节点', exact: true }),
  ).toBeEnabled();
  await expect(
    panel.getByRole('button', { name: '优化全部连线', exact: true }),
  ).toBeEnabled();
  await expect(panel.getByTestId('frame-arrangement-scope')).toContainText(
    'Group 内部',
  );
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await selectAppAction(page, '命令面板');
  const palette = page.getByRole('dialog', { name: '命令面板', exact: true });
  await palette
    .getByRole('combobox', { name: '搜索命令' })
    .fill('重置手工走线');
  await expect(
    palette.locator('[data-action-id="canvas.edges.reroute"]'),
  ).toHaveAttribute('aria-disabled', 'false');
  await expect(
    palette.locator('[data-action-id="canvas.edges.reroute"]'),
  ).toContainText('组内');
  await page.keyboard.press('Escape');
  await panel.locator('select').selectOption('horizontal');
  await panel.getByTestId('frame-auto-layout').click();
  await expect
    .poll(async () => (await savedCells(page)).b?.geometry)
    .toMatchObject({ x: 236, y: 100 });
  const arranged = await savedCells(page);
  expect(arranged.outside).toEqual(snapshot.store.cells.outside);
  expect(arranged.inside.route.origin).toBe('generated');
  expect(arranged.boundary.route.origin).toBe('generated');
  await page.screenshot({
    path: test.info().outputPath('group-local-layout.png'),
  });
  await panel.getByRole('button', { name: '选择连线整理方式' }).click();
  await page.getByRole('menuitemradio', { name: /^重置手工走线/ }).click();
  await expect
    .poll(async () => (await savedCells(page)).inside?.route)
    .toEqual({ mode: 'orthogonal' });
  const rerouted = await savedCells(page);
  expect(rerouted.boundary.route).toEqual({ mode: 'orthogonal' });
  for (const id of ['a', 'b', 'outside'])
    expect(rerouted[id]).toEqual(arranged[id]);
  expect(rerouted.inside.source).toEqual(arranged.inside.source);
  expect(rerouted.inside.target).toEqual(arranged.inside.target);
  await selectHistoryAction(page, '撤销');
  await expect
    .poll(async () => (await savedCells(page)).inside?.route)
    .toEqual(arranged.inside.route);
  await selectHistoryAction(page, '重做');
  await expect
    .poll(async () => (await savedCells(page)).inside?.route)
    .toEqual({ mode: 'orthogonal' });
  await page.reload();
  await expect
    .poll(async () => (await savedCells(page)).boundary?.route)
    .toEqual({ mode: 'orthogonal' });
  expect((await savedCells(page)).b?.geometry).toEqual(rerouted.b.geometry);
});

for (const name of ['layered', 'data-flow', 'packages']) {
  test(`real ${name} diagram arranges explicitly, saves once and restores stable routes`, async ({
    page,
  }) => {
    const snapshot = fixture(`architecture-${name}`);
    await openSnapshot(page, snapshot);
    const moduleGeometry = (cells: Record<string, any>) =>
      Object.fromEntries(
        Object.values(cells)
          .filter((node) => node.kind === 'architecture-module')
          .map((node) => [node.id, node.geometry]),
      );
    await expect
      .poll(async () => moduleGeometry(await savedCells(page)))
      .toEqual(moduleGeometry(snapshot.store.cells));
    const before = await savedCells(page);
    const panel = page
      .getByRole('complementary')
      .getByTestId('frame-arrangement');
    await expandPropertyGroup(page);
    await expect(panel.locator('select')).toHaveValue('layers');
    await panel.getByTestId('frame-auto-layout').click();
    await expect
      .poll(async () => moduleGeometry(await savedCells(page)))
      .not.toEqual(moduleGeometry(before));
    const after = await savedCells(page);
    const arrangedRoutes = await routes(page);
    const displayedRoutes = await canvas(page)
      .locator('[data-edge-display]')
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute('d')!),
      );
    for (const node of Object.values(before).filter(
      (cell) => cell.kind === 'architecture-layer',
    ))
      expect(after[node.id].data).toEqual({
        ...node.data,
        layoutPaddingTop: 96,
      });
    for (const edge of Object.values(before).filter(
      (cell) => cell.cellType === 'edge',
    ))
      expect(after[edge.id]).toMatchObject({
        source: edge.source,
        target: edge.target,
        ...(edge.labels ? { labels: edge.labels } : {}),
        ...(edge.data ? { data: edge.data } : {}),
        route: { origin: 'generated' },
      });
    // Repeated layout must not drift, and a single undo restores all nodes.
    await panel.getByTestId('frame-auto-layout').click();
    expect(await routes(page)).toEqual(arrangedRoutes);
    await selectHistoryAction(page, '撤销');
    await expect
      .poll(async () => moduleGeometry(await savedCells(page)))
      .toEqual(moduleGeometry(before));
    await selectHistoryAction(page, '重做');
    await expect
      .poll(async () => moduleGeometry(await savedCells(page)))
      .toEqual(moduleGeometry(after));
    await page.reload();
    await expect.poll(() => routes(page)).toEqual(arrangedRoutes);
    expect(moduleGeometry(await savedCells(page))).toEqual(
      moduleGeometry(after),
    );
    if (name === 'packages') {
      await page.setViewportSize({ width: 1600, height: 1000 });
      await page
        .getByTestId('canvas-status-fit')
        .locator('visible=true')
        .click();
      expect(displayedRoutes.some((path) => path.includes(' A'))).toBe(true);
      await page.screenshot({
        path: test.info().outputPath('package-layout-fit.png'),
      });
      const connector = cell(page, 'demo:packages/edge/23');
      expect(
        (await connector.locator('[data-edge-hit]').getAttribute('d'))!.match(
          /L/g,
        ),
      ).toHaveLength(3);
      await connector.dispatchEvent('pointerover');
      await expect(
        canvas(page).locator('[data-relation-highlight="node"]'),
      ).toHaveCount(2);
      await expect(
        canvas(page).locator('[data-relation-highlight="node"]').first(),
      ).toHaveAttribute('stroke-width', '1.5');
      await expect(
        canvas(page).locator('[data-relation-highlight="node"]').first(),
      ).not.toHaveAttribute('vector-effect', 'non-scaling-stroke');
      expect(
        await canvas(page)
          .locator('[data-relation-highlight="node"]')
          .first()
          .getAttribute('opacity'),
      ).toBeNull();
      await expect(
        canvas(page).locator('[data-relation-highlight="edge"]'),
      ).not.toHaveAttribute('opacity', '0.45');
      await connector.dispatchEvent('pointerdown', { button: 0, pointerId: 1 });
      await canvas(page).dispatchEvent('pointerup', {
        button: 0,
        pointerId: 1,
      });
      await expect(
        connector.locator('[data-relation-highlight="edge"]'),
      ).toHaveCount(0);
      await page.screenshot({
        path: test.info().outputPath('package-layout-relationship.png'),
      });
      await connector.dispatchEvent('pointerout');
      await canvas(page).press('Escape');
      await expect(
        canvas(page).locator('[data-relation-highlight="node"]'),
      ).toHaveCount(0);
    }
    await selectAppAction(page, '图像导出');
    const dialog = page.getByRole('dialog', { name: '图像导出', exact: true });
    await dialog.getByLabel('Image format').selectOption('svg');
    const download = page.waitForEvent('download');
    await dialog.getByTestId('image-export-button').click();
    const svg = readFileSync((await (await download).path())!, 'utf8');
    for (const d of displayedRoutes) expect(svg).toContain(`d="${d}"`);
  });
}

const embeddedMind = () => fixture('embedded-mind');

const textPosition = (page: Page, id: string) =>
  cell(page, id)
    .locator('foreignObject')
    .first()
    .evaluate((element) => [
      Number(element.getAttribute('x')),
      Number(element.getAttribute('y')),
    ]);

test('embedded root moves only its own visible tree, stays in bounds and survives undo/reload/export', async ({
  page,
}) => {
  const snapshot = embeddedMind();
  await openSnapshot(page, snapshot);
  await expect(cell(page, 'first')).toBeVisible();
  await expect
    .poll(async () => (await savedCells(page)).first?.kind)
    .toBe('mind-root');
  const before = await savedCells(page);
  const peerBefore = await textPosition(page, 'second');
  const childBefore = await textPosition(page, 'first-child-0');
  const shape = cell(page, 'first').locator('path').first();
  const bounds = (await shape.boundingBox())!;
  // Double-click activates the embedded editing occurrence.
  await page.mouse.dblclick(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width / 2 + 45,
    bounds.y + bounds.height / 2 + 25,
    { steps: 6 },
  );
  // Settle the animation-frame preview before measuring derived descendants.
  await expect
    .poll(async () => (await textPosition(page, 'first-child-0'))[0])
    .toBeGreaterThan(childBefore[0]);
  expect(await textPosition(page, 'second')).toEqual(peerBefore);
  const previewRoutes = await routes(page);
  await page.mouse.up();
  // Pan offsets persist per occurrence on the frame-reference, not on the
  // shared target cells.
  await expect
    .poll(
      async () =>
        (await savedCells(page))['frame-ref:mind']?.data?.mindOffsets?.first,
    )
    .toBeTruthy();
  const after = await savedCells(page);
  const position = await textPosition(page, 'first');
  expect(after.mind).toEqual(before.mind);
  expect(after.first).toEqual(before.first);
  for (const [id, node] of Object.entries(before).filter(
    ([id]) => id !== 'frame-ref:mind',
  ))
    expect(after[id]).toEqual(node);
  expect(await routes(page)).toEqual(previewRoutes);
  await selectHistoryAction(page, '撤销');
  await expect
    .poll(async () => (await savedCells(page))['frame-ref:mind'])
    .toEqual(before['frame-ref:mind']);
  await selectHistoryAction(page, '重做');
  await expect
    .poll(async () => (await savedCells(page))['frame-ref:mind'])
    .toEqual(after['frame-ref:mind']);
  await page.reload();
  await expect.poll(() => textPosition(page, 'first')).toEqual(position);
  expect(await textPosition(page, 'second')).toEqual(peerBefore);
  // A far drag is clamped against the whole tree, keeping all node outlines visible.
  const current = (await shape.boundingBox())!;
  await page.mouse.move(
    current.x + current.width / 2,
    current.y + current.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(1200, 700, { steps: 8 });
  await page.mouse.up();
  await expect(cell(page, 'first')).toBeVisible();
  await expect(cell(page, 'second')).toBeVisible();
  await expect(
    cell(page, 'frame-ref:mind').locator('[data-node-shape]'),
  ).toHaveCount(6);
  const inside = await cell(page, 'frame-ref:mind').evaluate((element) => {
    const viewport = element.querySelector(
      '[data-frame-content-plate]',
    ) as SVGRectElement;
    const box = viewport.getBoundingClientRect();
    return Array.from(element.querySelectorAll('[data-node-shape]')).every(
      (node) => {
        const shape = node.querySelector('path')!;
        const r = shape.getBoundingClientRect();
        return (
          r.left >= box.left - 1 &&
          r.right <= box.right + 1 &&
          r.top >= box.top - 1 &&
          r.bottom <= box.bottom + 1
        );
      },
    );
  });
  expect(inside).toBe(true);
  expect((await savedCells(page)).mind).toEqual(before.mind);
  await selectAppAction(page, '图像导出');
  const dialog = page.getByRole('dialog', { name: '图像导出', exact: true });
  await dialog.getByLabel('Image format').selectOption('svg');
  await dialog.getByLabel('Image scope').selectOption('frame');
  const visibleRoutes = await routes(page);
  const download = page.waitForEvent('download');
  await dialog.getByTestId('image-export-button').click();
  const svg = readFileSync((await (await download).path())!, 'utf8');
  for (const d of Object.values(visibleRoutes))
    expect(svg).toContain(`d="${d}"`);
  await expect(dialog).toBeHidden();
  // Fit the parent after export so the shell header is clear of the inspector.
  await page.getByTestId('canvas-status-fit').click();
  // Opening details uses the canonical root position, not the embedded offset.
  await cell(page, 'frame-ref:mind').locator('[data-frame-title-id]').click();
  await page.getByTestId('frame-open').locator('visible=true').click();
  await expect(canvas(page)).toHaveAttribute('data-instance-id', 'mind');
  expect((await textPosition(page, 'first'))[0]).toBe(
    (snapshot.store.cells.first as NodeCell).geometry.x + 8,
  );
});

test('automatic calculation switches are independent, survive tab switches and reset when a tab closes', async ({
  page,
}) => {
  const snapshot = fixture('architecture-layered');
  await openSnapshot(page, snapshot);
  await setAppLanguage(page, 'zh');
  await expandPropertyGroup(page);
  const panel = page
    .getByRole('complementary')
    .getByTestId('frame-arrangement');
  const nodes = panel.getByTestId('frame-auto-layout-toggle');
  const edges = panel.getByTestId('frame-auto-edges-toggle');
  await expect(nodes).not.toBeChecked();
  await expect(edges).not.toBeChecked();
  const before = await savedCells(page);
  await nodes.check();
  await expect(nodes).toBeChecked();
  await expect(edges).not.toBeChecked();
  await edges.check();
  expect(await savedCells(page)).toEqual(before);
  await page
    .locator('ylib-tabs')
    .getByRole('button', { name: '新建画布', exact: true })
    .click();
  await expect(page.getByRole('tab')).toHaveCount(2);
  await expandPropertyGroup(page);
  await expect(nodes).not.toBeChecked();
  await expect(edges).not.toBeChecked();
  const original = page.locator(
    `[role="tab"][data-tab-id="${snapshot.store.rootId}"]`,
  );
  await original.click();
  await expect(nodes).toBeChecked();
  await expect(edges).toBeChecked();
  const firstNode = Object.values(snapshot.store.cells).find(
    (cell) => cell.kind === 'architecture-module',
  )!;
  {
    const b = await cell(page, firstNode.id).boundingBox();
    await page.mouse.click(b!.x + b!.width / 2, b!.y + b!.height / 2, {
      button: 'right',
    });
  }
  const menu = page.getByRole('menu', { name: /^(画布编辑|Canvas editing)$/ });
  await expect(menu.getByRole('checkbox')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await edges.uncheck();
  await expect(edges).not.toBeChecked();
  await expect(nodes).toBeChecked();
  await original.getByRole('button', { name: /^关闭/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tab')).toHaveCount(1);
  await page
    .locator(`[data-file-id="${snapshot.store.rootId}"] .file-tree-name`)
    .click();
  await expect(original).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await expandPropertyGroup(page);
  await expect(nodes).not.toBeChecked();
  await expect(edges).not.toBeChecked();
  await nodes.check();
  await page.reload();
  await openActiveFile(page);
  await expect(canvas(page)).toBeVisible();
  await expandPropertyGroup(page);
  await expect(nodes).not.toBeChecked();
  await expect(edges).not.toBeChecked();
});
