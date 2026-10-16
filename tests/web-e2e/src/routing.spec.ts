import { selectAppAction } from './app-actions';
import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import {
  createCellStore,
  createFrameCell,
  type FrameSnapshot,
  type NodeCell,
  type FrameCell,
} from '../../../packages/engine/core/src/cell/types';
import { applyCellOperations } from '../../../packages/engine/core/src/cell/index';
import {
  createMindFrameSnapshot,
  createMindChildCell,
  addMindChild,
} from '../../../packages/engine/mind/src/cell-commands';
import { createInlineText } from '../../../packages/engine/common/src/public-api';
import {
  clearWorkspaceStorage,
  persistedWorkspace,
  waitForWorkspacePersisted,
} from './workspace-nav';

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
  expect(await exportedSvg(page)).toContain(`d="${original}"`);
  await canvas(page)
    .locator('[data-cell-id="frame-ref:diagram"] [data-frame-title-id]')
    .click();
  await page.getByTestId('frame-open').locator('visible=true').click();
  await expect(path).toHaveAttribute('d', original);
  expect(await exportedSvg(page)).toContain(`d="${original}"`);
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
