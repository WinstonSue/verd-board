import { test, expect } from '@playwright/test';
import path from 'node:path';
const doc = (id: string, title: string, content: object[]) => ({
  format: 'verd-document',
  version: 1,
  id,
  title,
  text: {
    schemaVersion: 1,
    id,
    kind: 'block',
    align: 'left',
    plainText: title,
    content: { type: 'doc', content },
  },
});
const paragraph = (text: string, href?: string) => ({
  type: 'paragraph',
  content: [
    {
      type: 'text',
      text,
      ...(href ? { marks: [{ type: 'link', attrs: { href } }] } : {}),
    },
  ],
});

test('internal link search, backlinks and static preview preserve the editing page', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  page.on('pageerror', (error) => console.log('Page error:', error.stack));
  page.on('console', (message) => {
    if (message.type() === 'error')
      console.log('Browser error:', message.text());
  });
  await page.goto('/');
  await expect(
    page.locator(
      'input[accept=".json,.verd.json,.verd-doc.json,.md,.markdown"]',
    ),
  ).toBeAttached({ timeout: 15000 });
  const destination = doc('knowledge-destination', 'Destination', [
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Decision' }],
    },
    paragraph('The architectural decision.'),
  ]);
  const source = doc('knowledge-source', 'Source', [
    paragraph(
      'Read the decision',
      'verd://file/knowledge-destination#decision',
    ),
    paragraph('Insert here'),
  ]);
  for (const file of [destination, source])
    await page
      .locator('input[accept=".json,.verd.json,.verd-doc.json,.md,.markdown"]')
      .setInputFiles({
        name: file.title + '.verd-doc.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(file)),
      });
  await page
    .locator('.file-tree-name')
    .filter({ hasText: /^Source$/ })
    .click();
  const pane = page.locator('.workspace-pane.is-active');
  await expect(pane.locator('.document-page__title')).toHaveValue('Source');
  await pane.locator('.tiptap a').click({ modifiers: ['Alt'] });
  const dialog = page.getByRole('dialog', { name: '关联内容', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.workspace-knowledge-preview')).toContainText(
    'The architectural decision.',
  );
  await expect(dialog.locator('[contenteditable="true"]')).toHaveCount(0);
  await expect(pane.locator('.document-page__title')).toHaveValue('Source');
  await page.screenshot({ path: info.outputPath('knowledge-preview.png') });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await pane.getByTitle('链接', { exact: true }).click();
  const query = pane.getByRole('textbox', { name: '搜索内部链接' });
  await query.pressSequentially('Destination Decision');
  await expect(query).toBeFocused();
  const choices = pane.locator('.doc-link-choices');
  await expect(
    choices.getByRole('button', {
      name: 'Decision · Destination',
      exact: true,
    }),
  ).toBeVisible();
  await choices
    .getByRole('button', { name: '预览 Decision', exact: true })
    .click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await choices
    .getByRole('button', { name: 'Decision · Destination', exact: true })
    .click();
  await expect(pane.locator('.doc-linkbar')).toHaveCount(0);
  await page
    .locator('.file-tree-name')
    .filter({ hasText: /^Destination$/ })
    .click();
  await expect(
    page.locator('.workspace-pane.is-active .document-page__title'),
  ).toHaveValue('Destination');
  await page
    .locator('.workspace-pane.is-active')
    .getByRole('button', { name: '关联内容', exact: true })
    .click();
  await expect(dialog).toContainText('← Source');
  await dialog
    .getByRole('button', { name: '定位来源', exact: true })
    .first()
    .click();
  await expect(
    page.locator('.workspace-pane.is-active .document-page__title'),
  ).toHaveValue('Source');
});

test('Cell links preview a real canvas without mounting an editable occurrence', async ({
  page,
}) => {
  const { readFile } = await import('node:fs/promises');
  const board = JSON.parse(
    await readFile(
      path.resolve(
        __dirname,
        '../../fixtures/ai-canvas/whiteboard-basic.verd.json',
      ),
      'utf8',
    ),
  );
  board.frame.name = 'Knowledge canvas';
  const cellId = Object.keys(board.cells)[0];
  const href = `verd://file/${encodeURIComponent(board.frame.id)}#${encodeURIComponent('cell:' + cellId)}`;
  const source = doc('canvas-source', 'Canvas source', [
    paragraph('Inspect the cell', href),
  ]);
  await page.goto('/');
  for (const file of [board, source])
    await page
      .locator('input[accept=".json,.verd.json,.verd-doc.json,.md,.markdown"]')
      .setInputFiles({
        name: (file.title ?? 'Knowledge canvas') + '.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(file)),
      });
  await page
    .locator('.file-tree-name')
    .filter({ hasText: /^Canvas source$/ })
    .click();
  const pane = page.locator('.workspace-pane.is-active');
  await pane.locator('.tiptap a').click({ modifiers: ['Alt'] });
  const dialog = page.getByRole('dialog', { name: '关联内容', exact: true });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.locator('.workspace-canvas-reference svg').first(),
  ).toBeVisible();
  await expect(dialog.locator('[contenteditable="true"]')).toHaveCount(0);
  await expect(dialog).toContainText('图元链接 · 1');
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(pane.locator('.document-page__title')).toHaveValue(
    'Canvas source',
  );
});
