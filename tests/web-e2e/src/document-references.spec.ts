import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { selectAppAction, setAppLanguage } from './app-actions';

const fixtures = path.resolve(__dirname, '../../fixtures/ai-canvas');
const active = (page: Page) => page.locator('.workspace-pane.is-active');
const frameFile = async (name: string) =>
  JSON.parse(await readFile(path.join(fixtures, name + '.verd.json'), 'utf8'));
const paragraph = (text: string) => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
});
const documentFile = (id: string, frameId: string) => ({
  format: 'verd-document',
  version: 1,
  id,
  title: 'Reference reading',
  text: {
    schemaVersion: 1,
    id,
    kind: 'block',
    align: 'left',
    plainText: 'Reference reading',
    content: {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Read in canvas' }],
        },
        paragraph('Selectable first paragraph'),
        ...Array.from({ length: 45 }, (_, i) =>
          paragraph(`Scrollable document line ${i}`),
        ),
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                { type: 'tableHeader', content: [paragraph('Header')] },
              ],
            },
            {
              type: 'tableRow',
              content: [
                { type: 'tableCell', content: [paragraph('Table value')] },
              ],
            },
          ],
        },
        {
          type: 'codeBlock',
          content: [{ type: 'text', text: 'const nativePreview = true;' }],
        },
        { type: 'frameReference', attrs: { targetFrameId: frameId } },
      ],
    },
  },
});
async function importFiles(page: Page, files: object[]) {
  await page
    .locator('input[accept=".json,.verd.json,.verd-doc.json,.md,.markdown"]')
    .setInputFiles({
      name: 'reference-workspace.verd.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          format: 'verd-canvas-bundle',
          version: 1,
          rootFileId: 'document-ref-doc',
          files,
        }),
      ),
    });
}
async function openFrame(page: Page, name: string) {
  await page
    .locator('.file-tree-name')
    .filter({ hasText: new RegExp(`^${name}$`) })
    .click();
  await expect(
    active(page).getByRole('application', { name: 'Frame canvas' }).first(),
  ).toBeVisible();
}
async function downloadNative(page: Page) {
  const promise = page.waitForEvent('download');
  await selectAppAction(page, '导出');
  const stream = await (await promise).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString());
}

for (const scene of [
  'whiteboard-basic',
  'mind-map',
  'workflow-dag',
  'architecture',
]) {
  test(`document cards in ${scene} scroll, isolate edits, navigate and reopen`, async ({
    page,
  }) => {
    await page.goto('/');
    await setAppLanguage(page, 'zh');
    const frame = await frameFile(scene);
    const doc = documentFile('document-ref-doc', frame.frame.id);
    frame.frame.name = `Reference ${scene}`;
    const card = {
      id: 'document-ref-card',
      kind: 'document-reference',
      cellType: 'node',
      geometry: { x: 100, y: 700, width: 680, height: 400 },
      data: { targetDocumentId: doc.id },
    };
    frame.frame.children.push(card.id);
    frame.cells[card.id] = card;
    await importFiles(page, [frame, doc]);
    await expect(
      page
        .locator('.file-tree-name')
        .filter({ hasText: /^Reference reading$/ }),
    ).toBeVisible();
    await openFrame(page, frame.frame.name);
    const cardNode = active(page)
      .locator('[data-cell-kind="document-reference"]')
      .first();
    const reader = cardNode.locator('[data-document-preview-scroll]');
    await expect(reader.locator('.tiptap')).toHaveAttribute(
      'contenteditable',
      'false',
    );
    await expect(reader).toContainText('Selectable first paragraph');
    await reader
      .getByText('Selectable first paragraph', { exact: true })
      .click({ clickCount: 3 });
    await expect
      .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ''))
      .toContain('Selectable first paragraph');
    const before = await cardNode
      .locator(':scope > rect')
      .first()
      .getAttribute('x');
    await reader.hover();
    await page.mouse.wheel(0, 350);
    await expect
      .poll(() => reader.evaluate((node) => node.scrollTop))
      .toBeGreaterThan(0);
    await expect(cardNode.locator(':scope > rect').first()).toHaveAttribute(
      'x',
      before!,
    );
    await reader.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
      node.dispatchEvent(new Event('scroll'));
    });
    await expect(reader.locator('table')).toContainText('Table value');
    await expect(reader.locator('pre')).toContainText('nativePreview');
    await expect(reader.locator('.workspace-canvas-reference')).toContainText(
      '已在当前预览路径',
    );
    expect(await active(page).locator('svg[role="application"]').count()).toBe(
      1,
    );
    if (scene === 'whiteboard-basic') {
      const offset = await reader.evaluate((node) => node.scrollTop);
      await selectAppAction(page, '图像导出');
      const dialog = page.getByRole('dialog', {
        name: '图像导出',
        exact: true,
      });
      await dialog.getByLabel('Image format').selectOption('svg');
      await dialog.getByLabel('Image scope').selectOption('frame');
      const downloading = page.waitForEvent('download');
      await dialog.getByTestId('image-export-button').click();
      const stream = await (await downloading).createReadStream();
      const chunks: Buffer[] = [];
      for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
      const svg = Buffer.concat(chunks).toString();
      expect(svg).toContain('Scrollable document line 44');
      const frozenOffset = await page.evaluate(
        (value) =>
          new DOMParser()
            .parseFromString(value, 'image/svg+xml')
            .querySelector('[data-document-preview-scroll] > div')
            ?.getAttribute('style')
            ?.match(/transform: ([^;]+)/)?.[1],
        svg,
      );
      expect(frozenOffset).toBe(`translate(0px, -${offset}px)`);
      expect(svg).not.toContain('data-document-header-actions');
    }
    await cardNode.getByRole('button', { name: '打开引用详情' }).click();
    await expect(active(page).locator('.document-page__title')).toHaveValue(
      doc.title,
    );
    await expect(
      active(page).locator('.board-document-content').first(),
    ).toContainText('Scrollable document line 44');
    await openFrame(page, frame.frame.name);
    await expect
      .poll(() => reader.evaluate((node) => node.scrollTop))
      .toBeGreaterThan(0);
    await expect(active(page).getByTestId('save-status')).toHaveAttribute(
      'data-save-state',
      'saved',
    );
    await page.reload();
    await expect(
      active(page).locator('[data-cell-kind="document-reference"]').first(),
    ).toBeVisible();
    await expect(
      active(page).locator('[data-document-preview-scroll]').first(),
    ).toContainText('Selectable first paragraph');
  });
}

test('inserts both directions through the UI, updates source previews and preserves a native mixed bundle', async ({
  page,
}) => {
  await page.goto('/');
  await setAppLanguage(page, 'zh');
  const frame = await frameFile('whiteboard-basic');
  frame.frame.name = 'Insert reference canvas';
  const doc = documentFile('document-ref-doc', frame.frame.id);
  doc.text.content.content = [paragraph('Original shared source')];
  await importFiles(page, [frame, doc]);
  await openFrame(page, frame.frame.name);
  await selectAppAction(page, '引用文档（只读）…');
  await page
    .getByRole('dialog', { name: '引用文档', exact: true })
    .getByRole('button', { name: /Reference reading/ })
    .click();
  const canvas = active(page)
    .getByRole('application', { name: 'Frame canvas' })
    .first();
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.6);
  const card = active(page)
    .locator('[data-cell-kind="document-reference"]')
    .first();
  await expect(card).toContainText('Original shared source');
  await card.getByRole('button', { name: '打开引用详情' }).click();
  const editor = active(page).locator('.board-document-content').first();
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' Updated source');
  await active(page)
    .getByRole('button', { name: '插入图表', exact: true })
    .click();
  await page
    .getByRole('dialog', { name: '插入图表', exact: true })
    .getByRole('button', { name: /Insert reference canvas/ })
    .click();
  await expect(editor.locator('[data-frame-reference]')).toHaveCount(1);
  await openFrame(page, frame.frame.name);
  await expect(card).toContainText('Updated source');
  await expect(card).toContainText('已在当前预览路径');
  const bundle = await downloadNative(page);
  expect(bundle.format).toBe('verd-canvas-bundle');
  expect(
    bundle.files.filter(
      (file: { format: string }) => file.format === 'verd-document',
    ),
  ).toHaveLength(1);
  expect(
    bundle.files.filter(
      (file: { format: string }) => file.format === 'verd-frame',
    ),
  ).toHaveLength(1);
  const bundledDoc = bundle.files.find(
    (file: { format: string }) => file.format === 'verd-document',
  );
  expect(
    bundledDoc.text.content.content.some(
      (node: { type: string }) => node.type === 'frameReference',
    ),
  ).toBe(true);
  await expect(active(page).getByTestId('save-status')).toHaveAttribute(
    'data-save-state',
    'saved',
  );
  await page.reload();
  await expect(
    active(page).locator('[data-cell-kind="document-reference"]').first(),
  ).toContainText('Updated source');
});
