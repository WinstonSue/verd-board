import { expect, type Page } from '@playwright/test';
import {
  selectHistoryAction,
  setAppLanguage,
} from '../web-e2e/src/app-actions';
import { expandPropertyGroup } from '../web-e2e/src/property-group';

export function geometryFixture() {
  const node = (id: string, x: number, y: number) => ({
    id,
    kind: 'geometry',
    cellType: 'node',
    geometry: { x, y, width: 80, height: 40, outline: 'rectangle' },
    content: { label: id },
    ports: [
      { id: 'out', side: 'right', direction: 'both' },
      { id: 'in', side: 'left', direction: 'both' },
    ],
  });
  const nodes = [
    ...Array.from({ length: 8 }, (_, i) => node(`n${i}`, 100 + i * 10, 0)),
    node('sink', 200, 10),
  ];
  const edges = nodes.slice(0, 8).map((n) => ({
    id: `e-${n.id}`,
    kind: 'arrow',
    cellType: 'edge',
    source: { cellId: n.id, portId: 'out' },
    target: { cellId: 'sink', portId: 'in' },
    route: { mode: 'auto' },
  }));
  const cells = Object.fromEntries([...nodes, ...edges].map((c) => [c.id, c]));
  return {
    format: 'verd-frame',
    version: 2,
    frame: {
      id: 'geometry-fixture',
      kind: 'frame',
      cellType: 'frame',
      name: 'Joint geometry',
      geometry: { x: 0, y: 0, width: 1200, height: 900 },
      children: Object.keys(cells),
      groups: [],
    },
    cells,
  };
}

/** Independent painted-gap check over persisted paths, rather than the planner's validator. */
export function assertPaintedGap(cells: Record<string, any>) {
  const nodes = Object.values(cells).filter((c) => c.cellType === 'node');
  for (const edge of Object.values(cells).filter(
    (c) => c.cellType === 'edge',
  )) {
    expect(edge.route.origin).toBe('generated');
    const points: number[][] = edge.route.points;
    expect(points.length).toBeGreaterThanOrEqual(2);
    for (let at = 1; at < points.length; at++)
      for (const node of nodes) {
        if (
          (at === 1 && node.id === edge.source.cellId) ||
          (at === points.length - 1 && node.id === edge.target.cellId)
        )
          continue;
        const g = node.geometry,
          margin =
            12 +
            (node.appearance?.strokeWidth ?? 1.5) / 2 +
            (edge.appearance?.strokeWidth ?? 2) / 2;
        const left = g.x - margin,
          right = g.x + g.width + margin,
          top = g.y - margin,
          bottom = g.y + g.height + margin;
        const [a, b] = [points[at - 1], points[at]];
        const crosses =
          a[1] === b[1]
            ? a[1] > top + 1e-6 &&
              a[1] < bottom - 1e-6 &&
              Math.min(a[0], b[0]) < right - 1e-6 &&
              Math.max(a[0], b[0]) > left + 1e-6
            : a[0] > left + 1e-6 &&
              a[0] < right - 1e-6 &&
              Math.min(a[1], b[1]) < bottom - 1e-6 &&
              Math.max(a[1], b[1]) > top + 1e-6;
        expect(crosses, `${edge.id} segment ${at} near ${node.id}`).toBe(false);
      }
  }
}

export async function exerciseJointLayout(
  page: Page,
  readCells: () => Promise<Record<string, any>>,
) {
  await setAppLanguage(page, 'zh');
  const canvas = page.locator(
    'svg[aria-label="Frame canvas"][data-surface="root"]:visible',
  );
  await expect(canvas).toBeVisible();
  await expandPropertyGroup(page);
  await page.getByTestId('frame-auto-layout').locator('visible=true').click();
  await expect
    .poll(
      async () =>
        Object.values(await readCells()).filter(
          (c: any) => c.route?.origin === 'generated',
        ).length,
    )
    .toBe(8);
  const arranged = await readCells();
  assertPaintedGap(arranged);
  expect(arranged.sink.geometry).not.toEqual(
    geometryFixture().cells.sink.geometry,
  );
  await expect(page.locator('[data-geometry-diagnostics]')).toHaveCount(0);
  await selectHistoryAction(page, '撤销');
  await expect
    .poll(async () => (await readCells()).sink.geometry)
    .toEqual(geometryFixture().cells.sink.geometry);
  await selectHistoryAction(page, '重做');
  await expect.poll(readCells).toEqual(arranged);
  return arranged;
}
