import { openActiveFile } from './app-actions';
import { expect, test, type Page } from './service-fixture';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { selectAppAction, setAppLanguage } from './app-actions';
import { selectDrawingTool } from './drawing-tools';
import { persistedWorkspace } from './workspace-nav';
import { cellBodyPoint } from '../../helpers/port-controls';

const active = (page: Page) => page.locator('.workspace-pane.is-active');
const canvas = (page: Page) =>
  active(page).locator('svg[data-surface="root"]').first();
const previewImageUrl =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAApklEQVR4nNWWWwqAMAwEc/+jegmVgqCljzTd7OJHwVd2BptazczOMs6DOx7u60ABv0d9gQkv570bDPhHIFuil+1+MAPeFEBLzLLChQj4UGBXwlsLC4rW4AMXhbHzGXlbqHmN9gukubaadbWgBu4u11BRSyKc80sB6RRIm1C6DKUfIumnWLoZSbdj6Q8JAu7NSoV7MtPhs2wKfMSgwXsSVHhLgg6vJC5Y3UEfcsKFbgAAAABJRU5ErkJggg==';
async function seed(page: Page, plain = false, includeImage = false) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await openActiveFile(page);
  const skip = page.getByRole('button', { name: '跳过', exact: true });
  if (await skip.isVisible()) await skip.click();
  await setAppLanguage(page, 'zh');
  let target = JSON.parse(
    readFileSync(
      path.resolve(
        __dirname,
        '../../fixtures/ai-canvas/workflow-dag.verd.json',
      ),
      'utf8',
    ),
  );
  if (plain)
    target = {
      format: 'verd-frame',
      version: 2,
      frame: {
        id: 'plain-target',
        name: 'Reusable whiteboard',
        kind: 'frame',
        cellType: 'frame',
        geometry: { x: 0, y: 0, width: 500, height: 350 },
        children: ['plain-leaf'],
        groups: [],
      },
      cells: {
        'plain-leaf': {
          id: 'plain-leaf',
          kind: 'geometry',
          cellType: 'node',
          geometry: { x: 20, y: 20, width: 160, height: 60 },
          content: { label: 'Source shape' },
        },
      },
    };
  else target.frame.name = 'Reusable workflow';
  const innerDoc = {
    id: 'inner-doc-link',
    kind: 'document-reference',
    cellType: 'node',
    geometry: { x: 20, y: 500, width: 500, height: 280 },
    data: { targetDocumentId: 'reading-source' },
  };
  if (!plain || includeImage) {
    target.frame.children.push(innerDoc.id);
    target.cells[innerDoc.id] = innerDoc;
  }
  if (includeImage) {
    const image = {
      id: 'preview-source-image',
      kind: 'image',
      cellType: 'node',
      geometry: { x: 540, y: 520, width: 80, height: 80 },
      data: { url: previewImageUrl },
    };
    target.frame.children.push(image.id);
    target.cells[image.id] = image;
  }
  const refs = ['ref-a', 'ref-b'].map((id, index) => ({
    id,
    kind: 'frame-reference',
    cellType: 'node',
    geometry: { x: index * 580, y: 0, width: 540, height: 400 },
    data: { targetFrameId: target.frame.id },
  }));
  const doc = {
    id: 'doc',
    kind: 'document-frame',
    cellType: 'node',
    geometry: { x: 0, y: 440, width: 540, height: 400 },
    data: { targetDocumentId: 'reading-source' },
  };
  const paragraphs = Array.from(
    { length: 40 },
    (_, i) =>
      `Paragraph ${i}: live reading and editing keep their original scroll position.`,
  );
  const files = [
    target,
    {
      format: 'verd-frame',
      version: 2,
      frame: {
        id: 'realtime-owner',
        name: 'Realtime embedding',
        kind: 'frame',
        cellType: 'frame',
        geometry: { x: 0, y: 0, width: 1200, height: 900 },
        children: [...refs.map((r) => r.id), doc.id],
        groups: [],
      },
      cells: Object.fromEntries([...refs, doc].map((cell) => [cell.id, cell])),
    },
    {
      format: 'verd-document',
      version: 1,
      id: 'reading-source',
      title: 'Live document',
      text: {
        schemaVersion: 1,
        id: 'reading-source',
        kind: 'block',
        plainText: paragraphs.join('\n'),
        content: {
          type: 'doc',
          content: paragraphs.map((text) => ({
            type: 'paragraph',
            content: [{ type: 'text', text }],
          })),
        },
      },
    },
  ];
  await page
    .locator('input[accept=".json,.verd.json,.verd-doc.json,.md,.markdown"]')
    .setInputFiles({
      name: 'realtime.verd.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          format: 'verd-canvas-bundle',
          version: 1,
          rootFileId: 'realtime-owner',
          files,
        }),
      ),
    });
  await page
    .locator('.file-tree-name')
    .filter({ hasText: /^Realtime embedding$/ })
    .click();
  await expect(canvas(page).locator('[data-reference-preview]')).toHaveCount(2);
  await expect(canvas(page).locator('svg[data-surface="nested"]')).toHaveCount(
    0,
  );
  await expect(
    canvas(page).getByText(paragraphs[0], { exact: true }),
  ).toBeVisible();
}

test('offscreen embeds retain live DOM and scroll, resume painting, and export their full contents', async ({
  page,
}) => {
  await seed(page);
  const reference = canvas(page).locator('[data-cell-id="ref-a"]');
  const nested = reference.locator('[data-reference-preview]');
  const retained = await nested.elementHandle();
  const reader = canvas(page)
    .locator('[data-cell-id="doc"] [data-document-preview-scroll]')
    .first();
  await reader.evaluate((element) => {
    element.scrollTop = 120;
  });
  const scroll = await reader.evaluate((element) => element.scrollTop);
  expect(scroll).toBeGreaterThan(0);
  await canvas(page).dispatchEvent('wheel', { deltaX: 6000, deltaY: 0 });
  await expect(
    reference.locator('[data-frame-paint-paused]').first(),
  ).toHaveCount(1);
  await expect(reader.locator('p').first()).toHaveCount(1);
  expect(
    await nested.evaluate(
      (element, original) => element === original,
      retained,
    ),
  ).toBe(true);
  await selectAppAction(page, '图像导出');
  const dialog = page.getByRole('dialog', { name: '图像导出', exact: true });
  await dialog.getByLabel('Image format').selectOption('svg');
  const download = page.waitForEvent('download');
  await dialog.getByTestId('image-export-button').click();
  const svg = readFileSync((await (await download).path())!, 'utf8');
  expect(svg).toContain('Paragraph 0:');
  expect(svg).toContain('data-frame-content-id');
  expect(svg).not.toContain('data-preview-paint-boundary');
  expect(svg).not.toContain('data-preview-viewport');
  expect(svg).not.toContain('data-frame-paint-paused');
  await page.getByTestId('canvas-status-fit').locator('visible=true').click();
  await expect(reference.locator('[data-frame-paint-paused]')).toHaveCount(0);
  await expect(nested).toBeInViewport();
  expect(
    await nested.evaluate(
      (element, original) => element === original,
      retained,
    ),
  ).toBe(true);
  expect(await reader.evaluate((element) => element.scrollTop)).toBe(scroll);
  await retained?.dispose();
});

test('moving a reference shell preserves nested scenes and editing a document pins its offscreen content', async ({
  page,
}) => {
  await seed(page);
  const reference = canvas(page).locator('[data-cell-id="ref-a"]');
  const nested = reference.locator('[data-reference-preview]');
  const content = nested.locator('[data-frame-content-id]').first();
  const transform = await content.getAttribute('transform');
  const retained = await nested.elementHandle();
  const header = reference
    .locator(':scope > [data-frame-header] > rect')
    .first();
  const box = (await header.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 50,
    box.y + box.height / 2 + 30,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect(content).toHaveAttribute('transform', transform!);
  expect(
    await nested.evaluate(
      (element, original) => element === original,
      retained,
    ),
  ).toBe(true);
  const doc = canvas(page).locator('[data-cell-id="doc"]');
  await doc.getByText('Paragraph 0:', { exact: false }).dblclick();
  const editor = doc.locator('[data-document-editing] .ProseMirror');
  await editor.locator('p').first().click();
  await expect(editor).toBeFocused();
  await canvas(page).dispatchEvent('wheel', { deltaX: 6000, deltaY: 0 });
  await expect(
    reference.locator('[data-frame-paint-paused]').first(),
  ).toHaveCount(1);
  await expect(doc.locator('[data-frame-paint-paused]')).toHaveCount(0);
  await expect(editor).toBeFocused();
  await editor.press('Escape');
  await page.getByTestId('canvas-status-fit').locator('visible=true').click();
  await expect(doc.locator('[data-document-editing]')).toHaveCount(0);
  await expect(doc.getByText('Paragraph 0:', { exact: false })).toBeVisible();
  await retained?.dispose();
});

test('graph Frames activate one editor on double click and keep inner references as detail cards', async ({
  page,
}) => {
  await seed(page);
  const a = canvas(page).locator('[data-cell-id="ref-a"]');
  const b = canvas(page).locator('[data-cell-id="ref-b"]');
  await expect(a.locator('[data-reference-card="reading-source"]')).toHaveCount(
    1,
  );
  await expect(a.getByText('Paragraph 0:', { exact: false })).toHaveCount(0);
  await a
    .locator(':scope > [data-frame-contents] > [data-frame-content-plate]')
    .dblclick({ position: { x: 25, y: 90 } });
  await expect(a.locator('svg[data-surface="nested"]')).toHaveCount(1);
  await expect(canvas(page).locator('svg[data-surface="nested"]')).toHaveCount(
    1,
  );
  await expect(a.locator('[data-reference-card="reading-source"]')).toHaveCount(
    1,
  );
  await b
    .locator(':scope > [data-frame-contents] > [data-frame-content-plate]')
    .dblclick({ position: { x: 25, y: 90 } });
  await expect(b.locator('svg[data-surface="nested"]')).toHaveCount(1);
  await expect(a.locator('svg[data-surface="nested"]')).toHaveCount(0);
  await page.getByRole('button', { name: '选择', exact: true }).click();
  await canvas(page).dispatchEvent('wheel', { deltaX: 6000, deltaY: 0 });
  await expect(b.locator('[data-frame-paint-paused]')).toHaveCount(0);
  await expect(b.locator('svg[data-surface="nested"]')).toHaveCount(1);
  await page.getByTestId('canvas-status-fit').locator('visible=true').click();
  await b.locator('svg[data-surface="nested"]').press('Escape');
  await expect(canvas(page).locator('svg[data-surface="nested"]')).toHaveCount(
    0,
  );
  await b
    .locator(':scope > [data-frame-header]')
    .getByRole('button', { name: '打开详情', exact: true })
    .click();
  await expect(
    active(page).locator('.workspace-file-navigation-title'),
  ).toHaveText('Reusable workflow');
  await active(page).getByTestId('navigation-return').click();
  await expect(
    active(page).locator('.workspace-file-navigation-title'),
  ).toHaveText('Realtime embedding');
  await expect(canvas(page).locator('svg[data-surface="nested"]')).toHaveCount(
    0,
  );
});

test('an activated ordinary whiteboard creates and undoes cells in its source file', async ({
  page,
}) => {
  await seed(page, true);
  await expect
    .poll(
      async () => (await persistedWorkspace(page))?.records['realtime-owner'],
    )
    .toBeTruthy();
  const ownerBefore = (await persistedWorkspace(page))!.records[
    'realtime-owner'
  ];
  const ref = canvas(page).locator('[data-cell-id="ref-a"]');
  await ref
    .locator(':scope > [data-frame-contents] > [data-frame-content-plate]')
    .dblclick({ position: { x: 25, y: 90 } });
  const nested = ref.locator('svg[data-surface="nested"]');
  await expect(nested).toHaveCount(1);
  await selectDrawingTool(page, '形状');
  await page.getByTestId('shape-rectangle').click();
  const box = (await nested.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.85, {
    steps: 5,
  });
  await page.mouse.up();
  await expect
    .poll(
      async () =>
        Object.keys(
          (await persistedWorkspace(page))!.records['plain-target'].cells,
        ).length,
    )
    .toBe(2);
  expect((await persistedWorkspace(page))!.records['realtime-owner']).toEqual(
    ownerBefore,
  );
  await page.keyboard.press('ControlOrMeta+z');
  await expect
    .poll(
      async () =>
        Object.keys(
          (await persistedWorkspace(page))!.records['plain-target'].cells,
        ).length,
    )
    .toBe(1);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect
    .poll(
      async () =>
        Object.keys(
          (await persistedWorkspace(page))!.records['plain-target'].cells,
        ).length,
    )
    .toBe(2);
  await selectDrawingTool(page, '选择');
  const contextPoint = await cellBodyPoint(
    nested.locator('[data-cell-kind="geometry"]').last(),
  );
  await page.mouse.click(contextPoint.x, contextPoint.y, { button: 'right' });
  const contextMenu = page.getByRole('menu', { name: '画布编辑', exact: true });
  await contextMenu
    .getByRole('menuitem', { name: '复制副本', exact: true })
    .click();
  await expect
    .poll(
      async () =>
        Object.keys(
          (await persistedWorkspace(page))!.records['plain-target'].cells,
        ).length,
    )
    .toBe(3);
  expect((await persistedWorkspace(page))!.records['realtime-owner']).toEqual(
    ownerBefore,
  );
  await page.keyboard.press('ControlOrMeta+z');
  await expect
    .poll(
      async () =>
        Object.keys(
          (await persistedWorkspace(page))!.records['plain-target'].cells,
        ).length,
    )
    .toBe(2);
  await nested.press('Escape');
  await expect(canvas(page).locator('svg[data-surface="nested"]')).toHaveCount(
    0,
  );
  await expect(
    canvas(page).locator(
      '[data-reference-preview="plain-target"] [data-cell-kind="geometry"]',
    ),
  ).toHaveCount(4);
});

test('general canvas image export keeps the same subjects and reference cards while a Frame is active', async ({
  page,
}) => {
  await seed(page, true, true);
  const exportScene = async () => {
    await selectAppAction(page, '图像导出');
    const dialog = page.getByRole('dialog', { name: '图像导出', exact: true });
    await dialog.getByLabel('Image format').selectOption('svg');
    await dialog.getByLabel('Image scope').selectOption('frame');
    const downloading = page.waitForEvent('download');
    await dialog.getByTestId('image-export-button').click();
    const value = readFileSync((await (await downloading).path())!, 'utf8');
    expect(value).not.toContain('data-surface="nested"');
    expect(value).not.toContain('data-document-header-actions');
    expect(value).toContain(previewImageUrl);
    return page.evaluate((svg) => {
      const root = new DOMParser().parseFromString(svg, 'image/svg+xml');
      return {
        cards: [...root.querySelectorAll('[data-reference-card]')].map(
          (element) => element.getAttribute('data-reference-card'),
        ),
        subjects: [
          ...root.querySelectorAll('[data-reference-preview] [data-cell-kind]'),
        ].map((element) => [
          element.getAttribute('data-cell-id'),
          element.textContent,
        ]),
      };
    }, value);
  };
  const exportPng = async () => {
    await selectAppAction(page, '图像导出');
    const dialog = page.getByRole('dialog', { name: '图像导出', exact: true });
    await dialog.getByLabel('Image format').selectOption('png');
    await dialog.getByLabel('Image scope').selectOption('frame');
    await dialog.getByLabel('Image scale').selectOption('1');
    const downloading = page.waitForEvent('download');
    await dialog.getByTestId('image-export-button').click();
    const bytes = readFileSync((await (await downloading).path())!);
    expect(bytes.readUInt32BE(16)).toBeGreaterThan(100);
    expect(bytes.readUInt32BE(20)).toBeGreaterThan(100);
    const imagePixels = await page.evaluate(async (data) => {
      const image = new Image();
      image.src = 'data:image/png;base64,' + data;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      ).data;
      let cyan = 0;
      for (let i = 0; i < pixels.length; i += 4)
        if (
          pixels[i] === 0 &&
          pixels[i + 1] === 255 &&
          pixels[i + 2] === 234 &&
          pixels[i + 3] === 255
        )
          cyan++;
      return cyan;
    }, bytes.toString('base64'));
    expect(imagePixels).toBeGreaterThan(100);
    return bytes;
  };
  const before = await exportScene();
  const beforePng = await exportPng();
  await canvas(page)
    .locator(
      '[data-cell-id="ref-a"] > [data-frame-contents] > [data-frame-content-plate]',
    )
    .dblclick({ position: { x: 25, y: 90 } });
  await expect(canvas(page).locator('svg[data-surface="nested"]')).toHaveCount(
    1,
  );
  expect(await exportScene()).toEqual(before);
  expect((await exportPng()).equals(beforePng)).toBe(true);
});
