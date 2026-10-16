import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { selectAppAction } from './app-actions';
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
  await expect(canvas(page)).toBeVisible();
  await expect(page.getByTestId('save-status')).toHaveAttribute(
    'data-save-state',
    'saved',
  );
  // Seed immutable Frame records so regression fixtures retain their stable IDs.
  await page.evaluate(async (snapshot) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open('VerdBoard');
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('verdboard_store', 'readwrite');
      const saved = transaction.objectStore('verdboard_store');
      saved.clear();
      const frames: Record<string, string> = {};
      for (const cell of Object.values(snapshot.store.cells)) {
        if (cell.cellType !== 'frame') continue;
        const frame = cell as FrameCell;
        const key = `frames/${frame.id}/fixture`;
        frames[frame.id] = key;
        const cells = Object.fromEntries(
          [...frame.children, ...frame.groups]
            .map((id) => [id, snapshot.store.cells[id]])
            .filter(
              ([, child]) =>
                (child as { cellType: string }).cellType !== 'frame',
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
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  }, snapshot);
  await clearWorkspaceStorage(page);
  await page.reload();
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

for (const name of ['layered', 'data-flow']) {
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
    await expect(panel.locator('select')).toHaveValue('layers');
    await expandPropertyGroup(page);
    await panel.getByTestId('frame-auto-layout').click();
    await expect
      .poll(async () => moduleGeometry(await savedCells(page)))
      .not.toEqual(moduleGeometry(before));
    const after = await savedCells(page);
    const arrangedRoutes = await routes(page);
    for (const node of Object.values(before).filter(
      (cell) => cell.kind === 'architecture-layer',
    ))
      expect(after[node.id].data).toEqual(node.data);
    for (const edge of Object.values(before).filter(
      (cell) => cell.cellType === 'edge',
    ))
      expect(after[edge.id]).toEqual(edge);
    // Repeated layout must not drift, and a single undo restores all nodes.
    await panel.getByTestId('frame-auto-layout').click();
    expect(await routes(page)).toEqual(arrangedRoutes);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    await expect
      .poll(async () => moduleGeometry(await savedCells(page)))
      .toEqual(moduleGeometry(before));
    await page.getByRole('button', { name: '重做', exact: true }).click();
    await expect
      .poll(async () => moduleGeometry(await savedCells(page)))
      .toEqual(moduleGeometry(after));
    await page.reload();
    await expect.poll(() => routes(page)).toEqual(arrangedRoutes);
    expect(moduleGeometry(await savedCells(page))).toEqual(
      moduleGeometry(after),
    );
    await selectAppAction(page, '图像导出');
    const dialog = page.getByRole('dialog', { name: '图像导出', exact: true });
    await dialog.getByLabel('Image format').selectOption('svg');
    const download = page.waitForEvent('download');
    await dialog.getByTestId('image-export-button').click();
    const svg = readFileSync((await (await download).path())!, 'utf8');
    for (const d of Object.values(arrangedRoutes))
      expect(svg).toContain(`d="${d}"`);
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
  // The entire branch follows before pointerup, not just the root.
  expect((await textPosition(page, 'first-child-0'))[0]).toBeGreaterThan(
    childBefore[0],
  );
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
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect
    .poll(async () => (await savedCells(page))['frame-ref:mind'])
    .toEqual(before['frame-ref:mind']);
  await page.getByRole('button', { name: '重做', exact: true }).click();
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
  // Opening details uses the canonical root position, not the embedded offset.
  await cell(page, 'frame-ref:mind').locator('[data-frame-title-id]').click();
  await page.getByTestId('frame-open').locator('visible=true').click();
  expect((await textPosition(page, 'first'))[0]).toBe(
    (snapshot.store.cells.first as NodeCell).geometry.x + 8,
  );
});
