import { test, expect, type Page } from '@playwright/test';
import { selectAppAction, setAppLanguage } from './app-actions';
const active = (page: Page) => page.locator('.workspace-pane.is-active');
const canvas = (page: Page) =>
  active(page).locator('svg[data-surface="root"]').first();
const shell = (page: Page, id: string) =>
  active(page).locator(`[data-cell-id="${id}"]`).first();
async function seed(page: Page, longDocument = false) {
  await page.goto('/');
  await setAppLanguage(page, 'zh');
  const cards = [
    { id: 'editor-a', kind: 'document-frame', x: 0, y: 0 },
    { id: 'editor-b', kind: 'document-frame', x: 580, y: 0 },
    { id: 'reader', kind: 'document-reference', x: 0, y: 500 },
    { id: 'locked', kind: 'document-frame', x: 580, y: 500, locked: true },
  ].map(({ x, y, ...cell }) => ({
    ...cell,
    cellType: 'node',
    geometry: { x, y, width: 540, height: 440 },
    data: { targetDocumentId: 'shared-document' },
  }));
  await page
    .locator('input[accept=".json,.verd.json,.verd-doc.json,.md,.markdown"]')
    .setInputFiles({
      name: 'editable.verd.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          format: 'verd-canvas-bundle',
          version: 1,
          rootFileId: 'editable-board',
          files: [
            {
              format: 'verd-frame',
              version: 2,
              frame: {
                id: 'editable-board',
                kind: 'frame',
                cellType: 'frame',
                name: 'Editable board',
                geometry: { x: 0, y: 0, width: 1200, height: 1000 },
                children: cards.map((c) => c.id),
                groups: [],
              },
              cells: Object.fromEntries(cards.map((c) => [c.id, c])),
            },
            {
              format: 'verd-document',
              version: 1,
              id: 'shared-document',
              title: 'Shared source',
              text: {
                schemaVersion: 1,
                id: 'shared-document',
                kind: 'block',
                align: 'left',
                plainText: 'Initial body',
                content: {
                  type: 'doc',
                  content: [
                    {
                      type: 'paragraph',
                      content: [{ type: 'text', text: 'Initial body' }],
                    },
                    ...(longDocument
                      ? [
                          {
                            type: 'heading',
                            attrs: { level: 2 },
                            content: [{ type: 'text', text: 'Shared layout' }],
                          },
                          ...Array.from({ length: 36 }, (_, index) => ({
                            type: 'paragraph',
                            content: [
                              {
                                type: 'text',
                                text: `Layout paragraph ${index}: reading and editing use the same typography, content width, and spacing.`,
                              },
                            ],
                          })),
                        ]
                      : []),
                  ],
                },
              },
            },
          ],
        }),
      ),
    });
  await page
    .locator('.file-tree-name')
    .filter({ hasText: /^Editable board$/ })
    .click();
  await expect(
    shell(page, 'editor-a').getByText('Initial body', { exact: true }),
  ).toBeVisible();
}
async function edit(page: Page, id: string) {
  await shell(page, id)
    .getByText('Initial body', { exact: false })
    .first()
    .dblclick();
  const editor = shell(page, id).locator(
    '[data-document-editing] .ProseMirror[contenteditable="true"]',
  );
  await expect(editor).toBeVisible();
  return editor;
}

test('document Frames edit one source, restore the originating occurrence and leave read-only references and locked Frames passive', async ({
  page,
}) => {
  await seed(page);
  await expect(
    active(page).getByRole('button', { name: '打开全文', exact: true }),
  ).toHaveCount(0);
  await shell(page, 'editor-a')
    .getByText('Initial body', { exact: true })
    .click();
  await expect(active(page).locator('[data-document-editing]')).toHaveCount(0);
  const editor = await edit(page, 'editor-a');
  await expect(
    shell(page, 'editor-a')
      .locator('[data-document-header-actions]')
      .getByRole('button', { name: '结束编辑', exact: true }),
  ).toBeVisible();
  await expect(
    shell(page, 'editor-a')
      .locator('[data-document-editing]')
      .getByRole('button', { name: /打开全文|结束编辑/ }),
  ).toHaveCount(0);
  await editor.locator('p').first().click();
  await editor.pressSequentially(' first edit');
  await expect(shell(page, 'reader')).toContainText('Initial body first edit');
  await expect(shell(page, 'editor-b')).toContainText(
    'Initial body first edit',
  );
  await editor.dispatchEvent('compositionstart');
  await editor.dispatchEvent('keydown', { key: 'Escape', isComposing: true });
  await expect(
    shell(page, 'editor-a').locator('[data-document-editing]'),
  ).toBeVisible();
  await editor.dispatchEvent('compositionend');
  await editor.press('ControlOrMeta+f');
  await expect(shell(page, 'editor-a').locator('.doc-findbar')).toBeVisible();
  await shell(page, 'editor-a')
    .locator('.doc-findbar input:not([type="checkbox"])')
    .first()
    .press('Escape');
  await expect(shell(page, 'editor-a').locator('.doc-findbar')).toHaveCount(0);
  await expect(
    shell(page, 'editor-a').locator('[data-document-editing]'),
  ).toBeVisible();
  await editor.press('Escape');
  await expect(active(page).locator('[data-document-editing]')).toHaveCount(0);
  await shell(page, 'locked')
    .getByText('Initial body', { exact: false })
    .first()
    .dblclick();
  await expect(active(page).locator('[data-document-editing]')).toHaveCount(0);
  const second = await edit(page, 'editor-b');
  await second.locator('p').first().click();
  await second.pressSequentially(' second edit');
  await second.press('ControlOrMeta+z');
  await expect(shell(page, 'reader')).toContainText('Initial body first edit');
  await expect(shell(page, 'reader')).not.toContainText('second edit');
  await expect(
    shell(page, 'editor-b').locator('[data-document-editing]'),
  ).toBeVisible();
  await second.press('ControlOrMeta+Shift+z');
  await expect(shell(page, 'reader')).toContainText('second edit');
  await shell(page, 'editor-b')
    .getByRole('button', { name: '打开引用详情', exact: true })
    .click();
  await expect(active(page).locator('.document-page__title')).toHaveValue(
    'Shared source',
  );
  await active(page).getByRole('button', { name: '撤销', exact: true }).click();
  await expect(canvas(page)).toBeVisible();
  await expect(
    shell(page, 'editor-b').locator('[data-document-editing]'),
  ).toBeVisible();
  await expect(shell(page, 'reader')).not.toContainText('second edit');
  await shell(page, 'editor-b')
    .locator('.ProseMirror[contenteditable="true"]')
    .press('Escape');
  await expect(active(page).locator('.frame-save-status')).toContainText(
    '已保存',
  );
  await page.reload();
  await expect(shell(page, 'reader')).toContainText('first edit');
  await expect(
    shell(page, 'reader').locator('[contenteditable="true"]'),
  ).toHaveCount(0);
});

test('document header actions support keyboard navigation on locked and read-only shells and finish inline editing', async ({
  page,
}) => {
  await seed(page);
  const editor = await edit(page, 'editor-a');
  await expect(editor).toBeVisible();
  await shell(page, 'editor-a')
    .getByRole('button', { name: '结束编辑', exact: true })
    .click();
  await expect(active(page).locator('[data-document-editing]')).toHaveCount(0);
  for (const id of ['reader', 'locked']) {
    const action = shell(page, id)
      .locator('[data-document-header-actions]')
      .getByRole('button', { name: '打开引用详情', exact: true });
    await action.focus();
    await action.press('Enter');
    await expect(active(page).locator('.document-page__title')).toHaveValue(
      'Shared source',
    );
    await page
      .locator('.file-tree-name')
      .getByText('Editable board', { exact: true })
      .click();
  }
  await page.screenshot({
    path: test.info().outputPath('document-frame-header.png'),
  });
  await setAppLanguage(page, 'en');
  await expect(
    shell(page, 'reader').getByRole('button', {
      name: 'Open reference details',
      exact: true,
    }),
  ).toBeVisible();
});

test('inline document reading and editing retain typography, content width and scroll without an embedded toolbar', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await seed(page, true);
  const card = shell(page, 'editor-a');
  const reader = card.locator('[data-document-preview-scroll]');
  const metrics = () =>
    card
      .locator('.board-document-content')
      .first()
      .evaluate((content) => {
        const viewport = content.closest('[data-document-preview-scroll]')!;
        const body = getComputedStyle(content);
        const scroll = getComputedStyle(viewport);
        const paragraph = getComputedStyle(content.querySelector('p')!);
        const heading = getComputedStyle(content.querySelector('h2')!);
        return {
          body: {
            fontFamily: body.fontFamily,
            fontSize: body.fontSize,
            lineHeight: body.lineHeight,
            padding: body.padding,
            width: body.width,
            boxSizing: body.boxSizing,
            outlineStyle: body.outlineStyle,
            outlineWidth: body.outlineWidth,
          },
          viewport: { padding: scroll.padding, font: scroll.font },
          paragraph: {
            fontSize: paragraph.fontSize,
            lineHeight: paragraph.lineHeight,
            margin: paragraph.margin,
          },
          heading: {
            fontSize: heading.fontSize,
            lineHeight: heading.lineHeight,
            margin: heading.margin,
          },
        };
      });
  const before = await metrics();
  const paragraph = reader.getByText(/^Layout paragraph 12:/);
  await paragraph.scrollIntoViewIfNeeded();
  const offset = await reader.evaluate((node) => node.scrollTop);
  expect(offset).toBeGreaterThan(0);
  await card.screenshot({ path: test.info().outputPath('inline-reading.png') });
  await paragraph.dblclick();
  const editing = card.locator('[data-document-editing]');
  await expect(
    editing.locator('.ProseMirror[contenteditable="true"]'),
  ).toBeVisible();
  await expect(
    editing.locator('.doc-toolbar, .document-page__toolbar'),
  ).toHaveCount(0);
  await expect.poll(metrics).toEqual(before);
  await expect
    .poll(() => reader.evaluate((node) => node.scrollTop))
    .toBeCloseTo(offset, 0);
  await card.screenshot({ path: test.info().outputPath('inline-editing.png') });
  await card.getByRole('button', { name: '结束编辑', exact: true }).click();
  await expect(editing).toHaveCount(0);
  await expect.poll(metrics).toEqual(before);
  await expect
    .poll(() => reader.evaluate((node) => node.scrollTop))
    .toBeCloseTo(offset, 0);
});

test('new document Frame placement creates its source atomically and cancellation creates neither file nor shell', async ({
  page,
}) => {
  await page.goto('/');
  await setAppLanguage(page, 'zh');
  const initial = await page.locator('.file-tree-name').count();
  await selectAppAction(page, '文档 Frame…');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '新建文档', exact: true })
    .click();
  await canvas(page).press('Escape');
  await expect(page.locator('.file-tree-name')).toHaveCount(initial);
  await expect(
    active(page).locator('[data-cell-kind="document-frame"]'),
  ).toHaveCount(0);
  await selectAppAction(page, '文档 Frame…');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '新建文档', exact: true })
    .click();
  await canvas(page).click({ position: { x: 300, y: 200 } });
  await expect(
    active(page).locator('[data-cell-kind="document-frame"]'),
  ).toHaveCount(1);
  await expect(page.locator('.file-tree-name')).toHaveCount(initial + 1);
  await active(page).getByRole('button', { name: '撤销', exact: true }).click();
  await expect(
    active(page).locator('[data-cell-kind="document-frame"]'),
  ).toHaveCount(0);
  await expect(page.locator('.file-tree-name')).toHaveCount(initial);
  await active(page).getByRole('button', { name: '重做', exact: true }).click();
  await expect(
    active(page).locator('[data-cell-kind="document-frame"]'),
  ).toHaveCount(1);
  await expect(page.locator('.file-tree-name')).toHaveCount(initial + 1);
});
