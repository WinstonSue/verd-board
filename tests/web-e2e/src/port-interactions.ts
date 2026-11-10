import { expect, type Page, type Locator } from '@playwright/test';
import { selectHistoryAction } from './app-actions';

export type PortCursorCheck = (point: {
  x: number;
  y: number;
}) => Promise<void>;

async function expectMoveCursor(
  page: Page,
  point: { x: number; y: number },
  native?: PortCursorCheck,
) {
  await page.mouse.move(point.x, point.y);
  const canvas = portCanvas(page);
  await expect(canvas).toHaveAttribute('data-frame-cursor', 'move');
  // Sample consecutive rendered frames, including hover's local React update.
  // Computed CSS alone cannot prove the native cursor; Desktop adds that check.
  const samples = await canvas.evaluate(async (svg, point) => {
    const samples: { logical: string | null; cursor: string }[] = [];
    for (let index = 0; index < 6; index++) {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      const hit = document.elementFromPoint(point.x, point.y);
      samples.push({
        logical: svg.getAttribute('data-frame-cursor'),
        cursor: hit ? getComputedStyle(hit).cursor : '',
      });
    }
    return samples;
  }, point);
  for (const sample of samples) {
    expect(sample.logical).toBe('move');
    expect(sample.cursor).toMatch(/^url\(.* 12 12, move$/);
  }
  await native?.(point);
}

export function portFixture(reverse = false) {
  const node = (id: string, x: number, y: number, input = false) => ({
    id,
    cellType: 'node',
    kind: 'geometry',
    geometry: { x, y, width: 140, height: 70, outline: 'rectangle' },
    content: { label: id.toUpperCase() },
    ports: [
      { id: 'left', side: 'left', direction: input ? 'input' : 'both' },
      { id: 'right', side: 'right', direction: input ? 'input' : 'both' },
      { id: 'bottom', side: 'bottom', direction: input ? 'input' : 'both' },
    ],
  });
  const edge = (id: string, source: string, portId = 'right') => ({
    id,
    cellType: 'edge',
    kind: 'arrow',
    source: { cellId: source, portId },
    target: { cellId: 'c', portId: 'left' },
    route: { mode: 'straight' },
  });
  const cells = Object.fromEntries(
    [
      node('a', 100, 100),
      node('b', 100, 300),
      node('c', 420, 180, true),
      node('d', 420, 400, true),
      edge('e1', 'a'),
      edge('e2', 'b'),
      {
        ...edge('e3', 'a', 'bottom'),
        source: { cellId: 'a', anchor: [0.55, 1] },
        route: {
          mode: 'fixed',
          points: [
            [177, 170],
            [170, 260],
            [330, 260],
            [330, 215],
            [420, 215],
          ],
        },
      },
    ].map((cell) => [cell.id, cell]),
  );
  return {
    format: 'verd-frame',
    version: 2,
    frame: {
      id: 'port-fixture',
      cellType: 'frame',
      kind: 'frame',
      name: 'Port interactions',
      geometry: { x: 0, y: 0, width: 900, height: 650 },
      children: reverse ? Object.keys(cells).reverse() : Object.keys(cells),
      groups: [],
    },
    cells,
  };
}

export const portCanvas = (page: Page) =>
  page.locator(
    '.workspace-pane.is-active svg[aria-label="Frame canvas"][data-surface="root"]',
  );

export function waypointFixture() {
  const fixture = portFixture();
  fixture.cells = {
    a: {
      ...fixture.cells.a,
      geometry: { x: 50, y: 400, width: 100, height: 80, outline: 'rectangle' },
    },
    c: {
      ...fixture.cells.c,
      geometry: {
        x: 650,
        y: 400,
        width: 100,
        height: 80,
        outline: 'rectangle',
      },
    },
    bend: {
      id: 'bend',
      cellType: 'edge',
      kind: 'arrow',
      source: { cellId: 'a', portId: 'right' },
      target: { cellId: 'c', anchor: [0, 0.5] },
      route: {
        mode: 'orthogonal',
        strategy: 'optimized',
        points: [
          [150, 440],
          [150, 140],
          [650, 140],
          [650, 440],
        ],
      },
      labels: [{ text: 'Keep label' }],
    },
  };
  fixture.frame.children = Object.keys(fixture.cells);
  return fixture;
}

export async function exerciseWaypointRemoval(
  page: Page,
  saved: () => Promise<Record<string, any>>,
) {
  const canvas = portCanvas(page);
  const before = structuredClone(await saved());
  const hit = canvas.locator('[data-edge-hit="bend"]');
  const point = await hit.evaluate((element) => {
    const path = element as SVGPathElement;
    const point = path
      .getPointAtLength(path.getTotalLength() * 0.35)
      .matrixTransform(path.getScreenCTM()!);
    return { x: point.x, y: point.y };
  });
  await page.mouse.click(point.x, point.y);
  await expect(canvas.locator('[data-edge-route-point]')).toHaveCount(2);
  await canvas
    .locator('[data-edge-route-point="1"]')
    .click({ button: 'right' });
  const remove = page.getByRole('menuitem', { name: '删除锚点', exact: true });
  await expect(remove).toBeEnabled();
  await remove.click();
  const expected = {
    ...before,
    bend: {
      ...before.bend,
      route: {
        mode: 'orthogonal',
        origin: 'manual',
        strategy: 'optimized',
        points: [
          [150, 440],
          [650, 440],
        ],
      },
    },
  };
  await expect.poll(saved).toEqual(expected);
  await expect(canvas.locator('[data-edge-route-point]')).toHaveCount(0);
  await expect(hit).toHaveAttribute('d', 'M150 440 L650 440');
  await selectHistoryAction(page, '撤销');
  await expect.poll(saved).toEqual(before);
  await expect(canvas.locator('[data-edge-route-point]')).toHaveCount(2);
  await selectHistoryAction(page, '重做');
  await expect.poll(saved).toEqual(expected);
  await expect(canvas.locator('[data-edge-route-point]')).toHaveCount(0);
}

/** Geometry and conflicting authored endpoints from the reported Workflow diagram. */
export async function exerciseWorkflowEndpoints(
  page: Page,
  saved: () => Promise<Record<string, any>>,
  nativeCursor?: PortCursorCheck,
) {
  const canvas = portCanvas(page);
  const edgeId = 'rg-release-e-merge-block';
  const original = structuredClone(await saved());
  const world = (point: { x: number; y: number }) =>
    canvas
      .locator('[data-frame-content-id="workflow-selected-endpoints"]')
      .evaluate((element, point) => {
        const result = new DOMPoint(point.x, point.y).matrixTransform(
          (element as SVGGraphicsElement).getScreenCTM()!,
        );
        return { x: result.x, y: result.y };
      }, point);
  const geometry = () =>
    canvas
      .locator('[data-edge-display], [data-arrow-marker]')
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute('d')),
      );
  await expect(canvas.locator(`[data-edge-hit="${edgeId}"]`)).toHaveCount(1);
  const before = await geometry();
  const middle = await world({ x: 602, y: 1100 });
  await page.mouse.click(middle.x, middle.y);
  const source = canvas.locator(
    `[data-selected-edge-endpoints] [data-port-edge-id="${edgeId}"][data-edge-endpoint="source"]`,
  );
  const target = canvas.locator(
    `[data-selected-edge-endpoints] [data-port-edge-id="${edgeId}"][data-edge-endpoint="target"]`,
  );
  await expect(source).toHaveCount(1);
  await expect(target).toHaveCount(1);
  await expect(source).toHaveAttribute('cx', '1310');
  await expect(source).toHaveAttribute('cy', '1185');
  await expect(target).toHaveAttribute('cx', '90');
  await expect(target).toHaveAttribute('cy', '1015');
  expect(await geometry()).toEqual(before);
  // Electron 28 can report zero IntersectionObserver ratio for transformed SVG.
  // Check the actual canvas clip rectangle, then prove reachability with real input.
  const inCanvas = (endpoint: Locator) =>
    endpoint.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const canvas = element
        .closest('svg[data-surface="root"]')!
        .getBoundingClientRect();
      return (
        Math.min(rect.right, canvas.right, window.innerWidth) >
          Math.max(rect.left, canvas.left, 0) &&
        Math.min(rect.bottom, canvas.bottom, window.innerHeight) >
          Math.max(rect.top, canvas.top, 0)
      );
    });
  // Keep the normal clipping behavior: zooming must not relocate either PORT.
  await canvas.press('ControlOrMeta+0');
  for (let index = 0; index < 10; index++)
    await canvas.press('ControlOrMeta+=');
  await expect.poll(() => inCanvas(source)).toBe(false);
  await expect.poll(() => inCanvas(target)).toBe(false);
  await page.getByRole('button', { name: '适配画布', exact: true }).click();
  await expect.poll(() => inCanvas(source)).toBe(true);
  await expect.poll(() => inCanvas(target)).toBe(true);
  for (const endpoint of [source, target]) {
    await expect(
      endpoint.locator('..').locator('[data-control-mark]'),
    ).toBeVisible();
    await expect(
      endpoint.locator('..').locator('[data-control-mark]'),
    ).toHaveAttribute('fill', '#fff');
    expect((await endpoint.boundingBox())!.width).toBeCloseTo(36, 1);
  }
  expect(await geometry()).toEqual(before);
  expect(await saved()).toEqual(original);
  // Reproduce top -> right on a real Workflow edge: the pointer must pass
  // through a border/interior preview, and only pointerup chooses the closest port.
  const top = await world({ x: 990, y: 1100 });
  const right = await world({ x: 1310, y: 1185 });
  await page.mouse.move(right.x, right.y);
  await page.mouse.down();
  await page.mouse.move(top.x, top.y, { steps: 12 });
  await page.mouse.up();
  await expect
    .poll(async () => (await saved())[edgeId].source)
    .toEqual({
      cellId: 'rg-release-final-gate',
      portId: 'top',
    });
  await page.mouse.move(top.x, top.y);
  await page.mouse.down();
  const quarter = await world({ x: 1070, y: 1121.25 });
  await page.mouse.move(quarter.x, quarter.y, { steps: 8 });
  await expect
    .poll(async () => Number(await source.getAttribute('cx')))
    .toBeGreaterThan(1069.99);
  await expect
    .poll(async () => Number(await source.getAttribute('cx')))
    .toBeLessThan(1096.68);
  for (const point of [
    { x: 990, y: 1185 },
    { x: 990, y: 1220 },
  ]) {
    const screen = await world(point);
    await page.mouse.move(screen.x, screen.y, { steps: 8 });
    await expect
      .poll(async () => Number(await source.getAttribute('cx')))
      .toBeCloseTo(point.x, 2);
    await expect
      .poll(async () => Number(await source.getAttribute('cy')))
      .toBeCloseTo(point.y, 2);
  }
  expect((await saved())[edgeId].source.portId).toBe('top');
  const release = await world({ x: 1230, y: 1163.75 });
  await page.mouse.move(release.x, release.y, { steps: 12 });
  await expect
    .poll(async () => Number(await source.getAttribute('cx')))
    .toBeGreaterThan(1229.99);
  await expect
    .poll(async () => Number(await source.getAttribute('cy')))
    .toBeLessThan(1163.77);
  await page.mouse.up();
  await expect
    .poll(async () => (await saved())[edgeId].source)
    .toEqual({
      cellId: 'rg-release-final-gate',
      portId: 'right',
    });
  await selectHistoryAction(page, '撤销');
  await expect
    .poll(async () => (await saved())[edgeId].source.portId)
    .toBe('top');
  await selectHistoryAction(page, '撤销');
  await expect.poll(saved).toEqual(original);
  const start = await world({ x: 1310, y: 1185 });
  const drop = await world({ x: 670, y: 1185 });
  await expectMoveCursor(page, { x: start.x + 16, y: start.y }, nativeCursor);
  await expect(source.locator('..')).toHaveAttribute(
    'data-control-hovered',
    'true',
  );
  await page.mouse.down();
  await page.mouse.move(drop.x + 16, drop.y, { steps: 12 });
  await page.mouse.up();
  await expect
    .poll(async () => (await saved())[edgeId].source)
    .toEqual({ cellId: 'rg-release-final-gate', portId: 'left' });
  expect((await saved())[edgeId].target).toEqual(original[edgeId].target);
  expect(
    Object.values(await saved()).filter((cell) => cell.cellType === 'edge'),
  ).toHaveLength(1);
  await selectHistoryAction(page, '撤销');
  await expect.poll(saved).toEqual(original);
}

export async function exercisePortInteractions(
  page: Page,
  saved: () => Promise<Record<string, any>>,
  nativeCursor?: PortCursorCheck,
) {
  const canvas = portCanvas(page);
  await expect(canvas.locator('[data-edge-hit]')).toHaveCount(3);
  const body = (id: string) => canvas.locator(`[data-cell-id="${id}"]`);
  const port = (node: string, id: string) =>
    canvas.locator(`[data-port-node-id="${node}"] [data-port-id="${id}"]`);
  const center = async (locator: Locator) => {
    const box = (await locator.boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const onEdge = (id: string) =>
    canvas.locator(`[data-edge-hit="${id}"]`).evaluate((element) => {
      const path = element as SVGPathElement;
      const point = path
        .getPointAtLength(path.getTotalLength() * 0.35)
        .matrixTransform(path.getScreenCTM()!);
      return { x: point.x, y: point.y };
    });
  const world = (x: number, y: number) =>
    canvas.locator('[data-frame-content-id="port-fixture"]').evaluate(
      (element, point) => {
        const p = new DOMPoint(point.x, point.y).matrixTransform(
          (element as SVGGraphicsElement).getScreenCTM()!,
        );
        return { x: p.x, y: p.y };
      },
      { x, y },
    );
  const geometry = () =>
    canvas
      .locator('[data-edge-display], [data-arrow-marker]')
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute('d')),
      );
  const original = await geometry();
  const move = async (point: { x: number; y: number }) =>
    page.mouse.move(point.x, point.y);
  const checkMoveCursor = (point: { x: number; y: number }) =>
    expectMoveCursor(page, point, nativeCursor);
  const clickEdge = async (id: string) => {
    const p = await onEdge(id);
    await page.mouse.click(p.x, p.y);
  };
  const drag = async (
    from: { x: number; y: number },
    to: { x: number; y: number },
    revealNode?: string,
  ) => {
    await move(from);
    await page.mouse.down();
    await expect(canvas).toHaveAttribute('data-frame-cursor-mode', 'gesture');
    const owner = await canvas.getAttribute('data-frame-cursor-owner');
    if (revealNode) {
      const destination = await center(body(revealNode));
      await page.mouse.move(destination.x, destination.y, { steps: 12 });
      for (const id of ['left', 'right', 'bottom'])
        await expect(
          port(revealNode, id).locator('..').locator('[data-control-mark]'),
        ).toBeVisible();
    }
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await expect(canvas).toHaveAttribute('data-frame-cursor-mode', 'gesture');
    await expect(canvas).toHaveAttribute('data-frame-cursor-owner', owner!);
    await nativeCursor?.(to);
    await page.mouse.up();
  };
  const initial = await center(port('a', 'right'));
  const mark = (node: string, id: string) =>
    port(node, id).locator('..').locator('[data-control-mark]');
  await move(await world(650, 500));
  await expect(mark('a', 'right')).toHaveAttribute('visibility', 'hidden');
  // Approach directly from outside the node without first hovering its body.
  await move({ x: initial.x + 16, y: initial.y });
  await expect(port('a', 'right').locator('..')).toHaveAttribute(
    'data-control-hovered',
    'true',
  );
  await expect(mark('a', 'right')).toBeVisible();
  await checkMoveCursor({ x: initial.x + 16, y: initial.y });
  await checkMoveCursor(initial);
  await expect(mark('a', 'right')).toHaveAttribute('fill', '#fff');
  const hoverSize = await mark('a', 'right')
    .locator('circle')
    .evaluate((element) => {
      const matrix = (element as SVGGraphicsElement).getScreenCTM()!;
      return (
        2 * Number(element.getAttribute('r')) * Math.hypot(matrix.a, matrix.b)
      );
    });
  expect(hoverSize).toBeCloseTo(15, 1);
  await move(await world(650, 500));
  await expect(mark('a', 'right')).toHaveAttribute('visibility', 'hidden');
  await expect(canvas).toHaveAttribute('data-frame-cursor', 'default');
  await checkMoveCursor({ x: initial.x + 16, y: initial.y });
  await move(await world(650, 500));
  await expect(canvas).toHaveAttribute('data-frame-cursor', 'default');
  await body('a').click();
  await expect(mark('a', 'right')).toHaveAttribute('fill', '#fff');
  await move(await onEdge('e1'));
  await expect(port('a', 'right')).toHaveAttribute('data-port-owner', 'node');
  expect(await geometry()).toEqual(original);

  // A click-to-connect draft must not steal ports after selecting an existing edge.
  const pendingStart = await center(port('a', 'right'));
  await page.mouse.click(pendingStart.x, pendingStart.y);
  await clickEdge('e1');
  await expect(port('a', 'right')).toHaveAttribute('data-port-edge-id', 'e1');
  await expect(mark('a', 'right')).toHaveAttribute('fill', '#fff');
  await body('c').hover();
  await expect(port('c', 'left')).toHaveAttribute('data-port-edge-id', 'e1');
  await expect(port('a', 'right')).toHaveAttribute('data-port-edge-id', 'e1');
  expect(await geometry()).toEqual(original);
  const hot = (await port('c', 'left').boundingBox())!;
  expect(hot.width).toBeCloseTo(36, 1);
  const target = await center(port('c', 'left'));
  await checkMoveCursor({ x: target.x + 16, y: target.y });
  await checkMoveCursor(target);
  await page.mouse.click(target.x, target.y);
  expect((await saved()).e1.target).toEqual({ cellId: 'c', portId: 'left' });
  expect(
    Object.values(await saved()).filter((cell) => cell.cellType === 'edge'),
  ).toHaveLength(3);

  // Both drag start and release are outside the visible circles, inside 36px targets.
  const drop = await world(420, 435);
  await drag(
    { x: target.x + 16, y: target.y },
    { x: drop.x - 16, y: drop.y },
    'd',
  );
  await expect
    .poll(async () => (await saved()).e1.target)
    .toEqual({ cellId: 'd', portId: 'left' });
  expect((await saved()).e2.target).toEqual({ cellId: 'c', portId: 'left' });
  expect((await saved()).e3.target).toEqual({ cellId: 'c', portId: 'left' });
  await selectHistoryAction(page, '撤销');
  await expect.poll(async () => (await saved()).e1.target.cellId).toBe('c');

  await body('a').click();
  await move(await onEdge('e1'));
  await expect(port('a', 'right')).toHaveAttribute('data-port-owner', 'node');
  const startNew = await center(port('a', 'right'));
  await drag({ x: startNew.x + 16, y: startNew.y }, await world(420, 435), 'd');
  await expect
    .poll(
      async () =>
        Object.values(await saved()).filter((cell) => cell.cellType === 'edge')
          .length,
    )
    .toBe(4);
  expect((await saved()).e1.target.cellId).toBe('c');

  const blank = await world(650, 500);
  await page.mouse.click(blank.x, blank.y);
  await move(await onEdge('e2'));
  await expect(port('c', 'left')).toHaveAttribute('data-port-edge-id', 'e2');
  await drag(await center(port('c', 'left')), await world(420, 435));
  await expect.poll(async () => (await saved()).e2.target.cellId).toBe('d');
  expect((await saved()).e3.target.cellId).toBe('c');
  await page.mouse.click(blank.x, blank.y);
  await body('a').hover();
  await expect(port('a', 'right')).toHaveAttribute('data-port-owner', 'node');
  await drag(await center(port('a', 'right')), await world(420, 435));
  await expect
    .poll(
      async () =>
        Object.values(await saved()).filter((cell) => cell.cellType === 'edge')
          .length,
    )
    .toBe(5);

  // Route handles share the same outer hit target and keep their own drag mode.
  await clickEdge('e3');
  const originalRoute = (await saved()).e3.route;
  const bend = canvas.locator(
    '[data-edge-controls="e3"] [data-edge-route-point="1"]',
  );
  const bendStart = await center(bend);
  await checkMoveCursor({ x: bendStart.x + 16, y: bendStart.y });
  await checkMoveCursor(bendStart);
  const bendEnd = await world(210, 285);
  await drag(
    { x: bendStart.x + 16, y: bendStart.y },
    { x: bendEnd.x + 16, y: bendEnd.y },
  );
  await expect
    .poll(async () =>
      (await saved()).e3.route.points[1].map(
        (coordinate: number) => Math.round(coordinate * 1e6) / 1e6,
      ),
    )
    .toEqual([210, 285]);
  expect((await saved()).e3.target).toEqual({ cellId: 'c', portId: 'left' });
  await selectHistoryAction(page, '撤销');
  await expect
    .poll(async () => (await saved()).e3.route)
    .toEqual(originalRoute);
  const segment = canvas.locator(
    '[data-edge-controls="e3"] [data-edge-segment="1"]',
  );
  expect((await segment.boundingBox())!.width).toBeCloseTo(36, 1);
  const segmentStart = await center(segment);
  await move({ x: segmentStart.x, y: segmentStart.y + 16 });
  await expect(segment.locator('..')).toHaveAttribute(
    'data-control-hovered',
    'true',
  );
  await expect(
    segment.locator('..').locator('[data-control-mark]'),
  ).toHaveAttribute('fill', '#fff');
  await drag(
    { x: segmentStart.x, y: segmentStart.y + 16 },
    { x: segmentStart.x, y: segmentStart.y + 56 },
  );
  await expect
    .poll(async () => (await saved()).e3.route)
    .not.toEqual(originalRoute);
  await selectHistoryAction(page, '撤销');
  await expect
    .poll(async () => (await saved()).e3.route)
    .toEqual(originalRoute);

  // The selected anchored endpoint must win even at the nearby node PORT's center.
  const sourceBeforeFree = (await saved()).e3.source;
  const anchoredPort = await center(port('a', 'bottom'));
  await checkMoveCursor(anchoredPort);
  await expect(
    canvas
      .locator('[data-edge-controls="e3"] [data-edge-endpoint="source"]')
      .locator('..'),
  ).toHaveAttribute('data-control-hovered', 'true');
  await drag(await center(port('a', 'bottom')), await world(650, 500));
  await expect.poll(async () => (await saved()).e3.source.point).toBeTruthy();
  const free = (await saved()).e3.source.point;
  await page.mouse.click(blank.x, blank.y);
  const freeEndpoint = canvas.locator(
    '[data-edge-controls="e3"] [data-edge-endpoint="source"]',
  );
  const freePoint = await world(free[0], free[1]);
  await checkMoveCursor({ x: freePoint.x + 16, y: freePoint.y });
  await expect(freeEndpoint.locator('..')).toHaveAttribute(
    'data-control-hovered',
    'true',
  );
  await expect(
    freeEndpoint.locator('..').locator('[data-control-mark]'),
  ).toHaveAttribute('fill', '#fff');
  await selectHistoryAction(page, '撤销');
  await expect
    .poll(async () => (await saved()).e3.source)
    .toEqual(sourceBeforeFree);
  await clickEdge('e3');
  const beforeDelete = structuredClone((await saved()).e3);
  await bend.click({ button: 'right' });
  const remove = page.getByRole('menuitem', { name: '删除锚点', exact: true });
  await expect(remove).toBeEnabled();
  await remove.click();
  const simplified = beforeDelete.route.points.filter(
    (_: unknown, index: number) => index !== 1,
  );
  await expect
    .poll(async () => (await saved()).e3.route.points)
    .toEqual(simplified);
  expect((await saved()).e3.source).toEqual(beforeDelete.source);
  expect((await saved()).e3.target).toEqual(beforeDelete.target);
  await selectHistoryAction(page, '撤销');
  await expect.poll(async () => (await saved()).e3).toEqual(beforeDelete);
  await selectHistoryAction(page, '重做');
  await expect
    .poll(async () => (await saved()).e3.route.points)
    .toEqual(simplified);
}
