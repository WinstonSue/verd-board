import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createInlineText } from '../../../packages/engine/common/src/public-api';
import { applyCellOperations } from '../../../packages/engine/core/src/cell/index';
import {
  createCellStore,
  createFrameCell,
  type EdgeCell,
  type FrameCell,
  type FrameSnapshot,
  type NodeCell,
} from '../../../packages/engine/core/src/cell/types';
import {
  addMindChild,
  createMindChildCell,
  createMindFrameSnapshot,
} from '../../../packages/engine/mind/src/cell-commands';
import { createTestCellRegistry as createFixtureRegistry } from '../../fixtures/plugins/registry';
import { selectAppAction } from './app-actions';
import { interactionShadowPixels, setCanvasZoom } from './shadow-pixels';
import { ThemeColorMode } from '../../../packages/engine/core/src/interfaces/theme';
import {
  clearWorkspaceStorage,
  persistedWorkspace,
  waitForWorkspacePersisted,
} from './workspace-nav';
const testCellRegistry = createFixtureRegistry();

const canvas = (page: Page) =>
  page.locator('svg[aria-label="Frame canvas"][data-surface="root"]:visible');
const edgePath = (page: Page) => canvas(page).locator('[data-edge-hit="edge"]');
const node = (id: string, y: number): NodeCell => ({
  id,
  kind: 'geometry',
  cellType: 'node',
  geometry: { x: 0, y, width: 100, height: 50, outline: 'rectangle' },
  content: { label: id },
});
const diagramFixture = (embedded = false): FrameSnapshot => {
  const frame = createFrameCell(embedded ? 'diagram' : 'root', {
    x: 80,
    y: 80,
    width: 260,
    height: 240,
  });
  const store = createCellStore(frame);
  for (const cell of [
    node('source', 0),
    node('obstacle', 150),
    node('target', 300),
    {
      id: 'edge',
      kind: 'arrow',
      cellType: 'edge' as const,
      source: { cellId: 'source' },
      target: { cellId: 'target' },
      route: { mode: 'auto' as const },
    },
  ]) {
    frame.children.push(cell.id);
    store.cells[cell.id] = cell;
  }
  if (embedded) {
    const outer = createFrameCell('root');
    outer.children.push(frame.id);
    store.cells.root = outer;
    store.rootId = 'root';
  }
  return { store };
};
const loadFixture = async (page: Page, snapshot: FrameSnapshot) => {
  await page.goto('/');
  await expect(canvas(page)).toBeVisible();
  await waitForWorkspacePersisted(page);
  await page.evaluate(async (snapshot) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('VerdBoard');
      r.onsuccess = () => resolve(r.result);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('verdboard_store', 'readwrite'),
        saved = transaction.objectStore('verdboard_store');
      saved.clear();
      const frames: Record<string, string> = {};
      for (const cell of Object.values(snapshot.store.cells))
        if (cell.cellType === 'frame') {
          const frame = cell as FrameCell,
            key = `frames/${frame.id}/fixture`;
          frames[frame.id] = key;
          const cells = Object.fromEntries(
            [...frame.children, ...frame.groups]
              .map((id) => [id, snapshot.store.cells[id]])
              .filter(([, cell]) => (cell as any).cellType !== 'frame'),
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
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  }, snapshot);
  await clearWorkspaceStorage(page);
  await page.reload();
  await expect(canvas(page)).toBeVisible();
};
const exportedSvg = async (page: Page) => {
  await selectAppAction(page, '图像导出');
  const dialog = page.getByRole('dialog', { name: '图像导出', exact: true });
  await dialog.getByLabel('Image format').selectOption('svg');
  await dialog.getByLabel('Image scope').selectOption('frame');
  const download = page.waitForEvent('download');
  await dialog.getByTestId('image-export-button').click();
  return readFileSync((await (await download).path())!, 'utf8');
};

const savedCells = async (page: Page) => {
  const ws = (await persistedWorkspace(page)) as any;
  return ws?.records?.[ws.manifest?.rootId]?.cells ?? {};
};

test('an unrelated obstacle reroutes during drag preview, undo/redo, refresh and export', async ({
  page,
}) => {
  await loadFixture(page, diagramFixture());
  const path = edgePath(page);
  await expect(path).toHaveAttribute('d', /L/);
  const original = (await path.getAttribute('d'))!;
  expect(original).not.toBe('M50 50 L50 300');
  const position = await canvas(page)
    .locator('[data-cell-id="obstacle"] path')
    .first()
    .evaluate((element) => {
      const path = element as SVGPathElement,
        matrix = path.getScreenCTM()!,
        box = path.getBBox();
      const center = new DOMPoint(
        box.x + box.width / 2,
        box.y + box.height / 2,
      ).matrixTransform(matrix);
      return {
        x: center.x,
        y: center.y,
        scale: Math.hypot(matrix.a, matrix.b),
      };
    });
  await page.mouse.move(position.x, position.y);
  await page.mouse.down();
  await page.mouse.move(position.x + 180 * position.scale, position.y, {
    steps: 5,
  });
  // Both terminals remain unchanged; the route must update before pointerup.
  await expect(path).toHaveAttribute('d', 'M50 50 L50 300');
  await page.mouse.up();
  await expect(path).toHaveAttribute('d', 'M50 50 L50 300');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(path).toHaveAttribute('d', original);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect(path).toHaveAttribute('d', 'M50 50 L50 300');
  await expect
    .poll(async () => (await savedCells(page)).obstacle?.geometry?.x)
    .toBeGreaterThan(150);
  const saved = await savedCells(page);
  expect(saved.edge.route).toEqual({ mode: 'auto' });
  expect(saved.source.geometry).toEqual(
    (diagramFixture().store.cells.source as NodeCell).geometry,
  );
  expect(saved.target.geometry).toEqual(
    (diagramFixture().store.cells.target as NodeCell).geometry,
  );
  await page.reload();
  await expect(path).toHaveAttribute('d', 'M50 50 L50 300');
  const svg = await exportedSvg(page);
  expect(svg).toContain('d="M50 50 L50 300"');
  expect(svg).not.toContain('data-edge-hit');
});

test('embedded routing fits the full detour, matches detail and exports the same path', async ({
  page,
}) => {
  await loadFixture(page, diagramFixture(true));
  const path = edgePath(page);
  await expect(path).toHaveAttribute('d', /L/);
  const original = (await path.getAttribute('d'))!;
  expect(original).not.toBe('M50 50 L50 300');
  const insideShell = await path.evaluate((element) => {
    const path = element as SVGPathElement,
      shell = document.querySelector(
        '[data-cell-id="frame-ref:diagram"] > rect',
      ) as SVGRectElement;
    const matrix = path.getScreenCTM()!,
      inverse = shell.getScreenCTM()!.inverse(),
      r = shell.getBBox();
    for (let at = 0; at <= 100; at++) {
      const point = path.getPointAtLength((path.getTotalLength() * at) / 100);
      const local = new DOMPoint(point.x, point.y)
        .matrixTransform(matrix)
        .matrixTransform(inverse);
      if (
        local.x < r.x + 8 ||
        local.x > r.x + r.width - 8 ||
        local.y < r.y + 8 ||
        local.y > r.y + r.height - 8
      )
        return false;
    }
    return true;
  });
  expect(insideShell).toBe(true);
  const display = canvas(page).locator('[data-edge-display="edge"]');
  const displayPath = await display.getAttribute('d');
  expect(await exportedSvg(page)).toContain(`d="${displayPath}"`);
  await canvas(page)
    .locator('[data-cell-id="frame-ref:diagram"] [data-frame-title-id]')
    .click();
  await page.getByTestId('frame-open').locator('visible=true').click();
  await expect(path).toHaveAttribute('d', original);
  await expect(display).toHaveAttribute('d', displayPath!);
  expect(await exportedSvg(page)).toContain(`d="${displayPath}"`);
});

const mindFixture = (): FrameSnapshot => {
  let snapshot = createMindFrameSnapshot('root', 'center');
  for (let i = 0; i < 9; i++) {
    const child = createMindChildCell(`child-${i}`);
    if (i === 4 || i === 5)
      child.data = {
        note: createInlineText(i === 4 ? '22222' : '3333'),
        noteCollapsed: false,
      };
    snapshot = {
      store: applyCellOperations(
        snapshot.store,
        addMindChild(snapshot.store, 'center', child, `branch-${i}`),
        testCellRegistry,
      ),
    };
  }
  return snapshot;
};

test('dense mind curves keep common origins and sibling order with expanded notes', async ({
  page,
}) => {
  await loadFixture(page, mindFixture());
  const branches = canvas(page).locator('[data-cell-kind="mind-branch"]');
  await expect(branches).toHaveCount(9);
  const paths = await branches
    .locator('[data-edge-hit]')
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('d')!),
    );
  expect(paths.every((d) => d.includes(' C'))).toBe(true);
  const samples = paths
    .map((d) => {
      const p = d.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)!.map(Number);
      expect(p[2]).toBeGreaterThan(p[0]);
      expect(p[4]).toBeLessThan(p[6]);
      expect(p[2]).toBe(p[4]);
      return {
        origin: p.slice(0, 2),
        endY: p[7],
        points: Array.from({ length: 100 }, (_, at) => {
          const t = (at + 1) / 100,
            u = 1 - t;
          return (
            u ** 3 * p[1] +
            3 * u ** 2 * t * p[3] +
            3 * u * t ** 2 * p[5] +
            t ** 3 * p[7]
          );
        }),
      };
    })
    .sort((a, b) => a.endY - b.endY);
  for (let i = 1; i < samples.length; i++) {
    expect(samples[i].origin).toEqual(samples[0].origin);
    samples[i].points.forEach((y, at) =>
      expect(y).toBeGreaterThan(samples[i - 1].points[at]),
    );
  }
  const svg = await exportedSvg(page);
  for (const d of paths) expect(svg).toContain(`d="${d}"`);
});

for (const { background, opacity, color } of ['#000000', '#6366f1'].flatMap(
  (color) => [
    { background: '#ffffff', opacity: 1, color },
    { background: '#0f172a', opacity: 1, color },
    { background: '#ffffff', opacity: 0.2, color },
    { background: '#0f172a', opacity: 0.2, color },
  ],
)) {
  test(`interaction strokes stay readable and export authored appearance on ${background} at opacity ${opacity}, stroke ${color}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const root = createFrameCell('root');
    root.view = {
      theme: {
        themeColorMode: ThemeColorMode.default,
        boardBackground: background,
        gridEnabled: false,
      },
    };
    const store = createCellStore(root);
    const cases = [
      { width: 1, mode: 'straight' as const, y: 0, dy: 0 },
      { width: 1.5, mode: 'straight' as const, y: 150, dy: 0 },
      { width: 2, mode: 'orthogonal' as const, y: 300, dy: 50 },
      { width: 8, mode: 'curve' as const, y: 450, dy: 70 },
    ];
    for (const { width, mode, y, dy } of cases) {
      const appearance = {
        strokeColor: color,
        strokeWidth: width,
        opacity,
        shadow: 'md',
      };
      const source = {
        ...node(`source-${width}`, y),
        appearance,
        content: { label: `${width}px / ${opacity * 100}%` },
      };
      const target = {
        ...node(`target-${width}`, y),
        geometry: { ...source.geometry, x: 520, y: y + dy },
        appearance,
        content: { label: `Target ${width}` },
      };
      const edge: EdgeCell = {
        id: `edge-${width}`,
        kind: 'arrow',
        cellType: 'edge',
        source: { cellId: source.id },
        target: { cellId: target.id },
        route: {
          mode,
        },
        appearance,
        data: { targetMarker: 'solid-triangle' },
        labels: [{ text: `${width}px line` }],
      };
      for (const cell of [source, target, edge]) {
        root.children.push(cell.id);
        store.cells[cell.id] = cell;
      }
    }
    await loadFixture(page, { store });
    const surface = canvas(page);
    const paths = await surface
      .locator('[data-edge-display]')
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute('d')),
      );
    await expect
      .poll(async () => (await savedCells(page))['edge-1'])
      .toBeDefined();
    const saved = await savedCells(page);
    const first = surface.locator('[data-cell-id="edge-1"]');
    const hoverPoint = await first
      .locator('[data-edge-hit]')
      .evaluate((element) => {
        const path = element as SVGPathElement;
        const point = path
          .getPointAtLength(path.getTotalLength() / 4)
          .matrixTransform(path.getScreenCTM()!);
        return { x: point.x, y: point.y };
      });
    await page.mouse.move(hoverPoint.x, hoverPoint.y);
    await expect(
      surface.locator('[data-relation-highlight="edge"]'),
    ).toHaveAttribute('stroke-width', '1');
    await expect(
      surface.locator('[data-relation-highlight="node"]'),
    ).toHaveCount(2);
    await page.screenshot({ path: info.outputPath('related-fit.png') });
    await page.mouse.move(0, 0);
    for (const [at, id] of [
      'source-1',
      'edge-1',
      'edge-2',
      'edge-8',
    ].entries()) {
      await surface
        .locator(`[data-cell-id="${id}"]`)
        .dispatchEvent('pointerdown', {
          button: 0,
          pointerId: 1,
          shiftKey: at > 0,
        });
      await surface.dispatchEvent('pointerup', { button: 0, pointerId: 1 });
    }
    await expect(
      surface.locator('[data-interaction-stroke="selected"]'),
    ).toHaveCount(4);
    await expect(
      surface.locator('[data-relation-highlight="edge"]'),
    ).toHaveCount(0);
    const checkPaint = async (name: string) => {
      const paint = await surface
        .locator('[data-interaction-stroke]')
        .evaluateAll((elements) =>
          elements.map((element) => {
            const shape = element as SVGGraphicsElement;
            const matrix = shape.getScreenCTM()!;
            const scale = Math.hypot(matrix.a, matrix.b);
            const filter = document.getElementById(
              shape.getAttribute('filter')!.slice(5, -1),
            )!;
            const id =
              shape.getAttribute('data-node-highlight') ??
              shape.closest('[data-cell-id]')!.getAttribute('data-cell-id')!;
            const base = Number(id.split('-').at(-1));
            const expected =
              base +
              (shape.getAttribute('data-interaction-stroke') === 'selected'
                ? 1
                : 0);
            return {
              expected,
              width: parseFloat(getComputedStyle(shape).strokeWidth),
              scaledWidth:
                parseFloat(getComputedStyle(shape).strokeWidth) * scale,
              expectedScaledWidth: expected * scale,
              vectorEffect: getComputedStyle(shape).vectorEffect,
              color: getComputedStyle(shape).stroke,
              blurred: Array.from(
                filter.querySelectorAll('feGaussianBlur'),
              ).map(
                (blur) => Number(blur.getAttribute('stdDeviation')) * scale,
              ),
              spread:
                Number(
                  filter.querySelector('feMorphology')!.getAttribute('radius'),
                ) * scale,
              region: [
                Number(filter.getAttribute('width')),
                Number(filter.getAttribute('height')),
              ],
              hasOpacityAncestor: !!shape.closest('[opacity]'),
            };
          }),
        );
      for (const hint of paint) {
        expect(hint.color).toBe('rgb(99, 102, 241)');
        expect(hint.width).toBe(hint.expected);
        expect(hint.scaledWidth).toBeCloseTo(hint.expectedScaledWidth, 5);
        expect(hint.vectorEffect).not.toBe('non-scaling-stroke');
        expect(hint.blurred[0]).toBeCloseTo(2.25, 5);
        expect(hint.blurred[1]).toBeCloseTo(1.25, 5);
        expect(hint.spread).toBeCloseTo(0.75, 5);
        expect(hint.region.every((size) => size > 0)).toBe(true);
        expect(hint.hasOpacityAncestor).toBe(false);
      }
      const hiddenPaint = await surface
        .locator(
          '[data-frame-original-stroke-opacity],[data-frame-original-opacity]',
        )
        .evaluateAll((elements) =>
          elements.map((element) => {
            const style = getComputedStyle(element);
            return element.hasAttribute('data-frame-original-opacity')
              ? style.opacity
              : style.strokeOpacity;
          }),
        );
      expect(hiddenPaint.length).toBeGreaterThan(0);
      expect(hiddenPaint.every((opacity) => Number(opacity) === 0)).toBe(true);
      const pixels = await interactionShadowPixels(
        surface.locator('[data-node-highlight="source-1"]'),
        background,
        opacity,
      );
      for (const sample of pixels)
        expect(
          sample.difference,
          JSON.stringify(sample),
        ).toBeGreaterThanOrEqual(8);
      await info.attach(`${name}-shadow-pixels`, {
        body: JSON.stringify(pixels, null, 2),
        contentType: 'application/json',
      });
      await page.screenshot({ path: info.outputPath(name) });
    };
    for (const percentage of [50, 100, 200]) {
      await setCanvasZoom(page, percentage);
      await checkPaint(`selected-${percentage}.png`);
    }
    expect(
      await surface
        .locator('[data-edge-display]')
        .evaluateAll((elements) =>
          elements.map((element) => element.getAttribute('d')),
        ),
    ).toEqual(paths);
    const svg = await exportedSvg(page);
    expect(svg).not.toContain('data-interaction-stroke');
    expect(svg).not.toContain('frame-interaction-');
    expect(svg).not.toContain('data-frame-original-');
    for (const width of [1, 1.5, 2, 8]) {
      expect(svg).toContain(`stroke-width="${width}"`);
    }
    expect(await savedCells(page)).toEqual(saved);
  });
}
