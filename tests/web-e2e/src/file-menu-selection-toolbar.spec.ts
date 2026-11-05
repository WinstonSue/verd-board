import { selectSetting } from '../../helpers/settings-controls';
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
test('file menus dismiss across canvas capture, copy stable links and selection toolbar preserves local formatting', async ({
  page,
  context,
}, info) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const file = JSON.parse(
    readFileSync(
      path.resolve(
        __dirname,
        '../../fixtures/ai-canvas/whiteboard-basic.verd.json',
      ),
      'utf8',
    ),
  );
  file.cells['shape-request'].content = { label: 'Selection sample' };
  await page.goto('/');
  await page
    .locator('input[accept=".json,.verd.json,.verd-doc.json,.md,.markdown"]')
    .setInputFiles({
      name: 'selection.verd.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(file)),
    });
  await page
    .locator('.file-tree-name')
    .filter({ hasText: file.frame.name })
    .click();
  const canvas = page.locator(
    '.workspace-pane.is-active svg[aria-label="Frame canvas"][data-surface="root"]',
  );
  const row = page
    .locator('.file-tree-name')
    .filter({ hasText: file.frame.name });
  await row.click({ button: 'right' });
  const menu = page.getByRole('menu', {
    name: `「${file.frame.name}」的操作`,
    exact: true,
  });
  await expect(menu).toBeVisible();
  const node = canvas.locator('[data-cell-id="shape-request"]');
  await node.click();
  await expect(menu).toHaveCount(0);
  await row.click({ button: 'right' });
  await menu.getByRole('menuitem', { name: '复制链接', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(`verd://file/${encodeURIComponent(file.frame.id)}`);
  await node.dblclick();
  const editor = node.locator('.ProseMirror');
  await expect(editor).toBeFocused();
  const toolbar = page.getByRole('toolbar', {
    name: 'Text formatting',
    exact: true,
  });
  await expect(toolbar).toHaveCount(0);
  await editor.press('ControlOrMeta+a');
  await expect(toolbar).toBeVisible();
  await expect(
    toolbar.getByLabel('Search workspace or enter a URL'),
  ).toHaveCount(0);
  await editor.press('ArrowLeft');
  for (let i = 0; i < 9; i++) await editor.press('Shift+ArrowRight');
  await toolbar.getByRole('button', { name: '加粗', exact: true }).click();
  await expect(editor.locator('strong')).toHaveText('Selection');
  await editor.press('ControlOrMeta+a');
  await toolbar.getByRole('button', { name: '链接', exact: true }).click();
  const linkDialog = page.getByRole('dialog', {
    name: /^(编辑链接|Edit link)$/,
  });
  const target = linkDialog.getByRole('combobox', {
    name: '搜索工作区或输入网址',
  });
  await target.click();
  await target.fill(file.frame.name);
  await expect(
    linkDialog
      .getByRole('option', { name: new RegExp(file.frame.name) })
      .first(),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(linkDialog).toBeVisible();
  await expect(linkDialog.getByRole('listbox')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(editor).toBeFocused();
  await expect
    .poll(() => page.evaluate(() => getSelection()?.toString()))
    .toBe('Selection sample');
  await editor.press('ControlOrMeta+k');
  await target.evaluate((input) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', 'https://example.com');
    input.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(linkDialog.getByLabel('搜索工作区或输入网址')).toHaveValue(
    'https://example.com',
  );
  await expect(
    linkDialog.getByRole('button', { name: '预览', exact: true }),
  ).toBeDisabled();
  await linkDialog.getByRole('button', { name: /^(保存|Save)$/ }).click();
  await expect(linkDialog).toBeHidden();
  await expect(editor.locator('a')).toHaveAttribute(
    'href',
    'https://example.com',
  );
  await editor.press('ControlOrMeta+a');
  await toolbar
    .getByRole('button', { name: '更多文字格式', exact: true })
    .click();
  await toolbar.getByLabel('Font size', { exact: true }).selectOption('24');
  await expect(editor.locator('span[style*="24px"]')).toBeVisible();
  await page.screenshot({
    path: info.outputPath('selection-toolbar-expanded.png'),
  });
  await toolbar
    .getByRole('button', { name: '更多文字格式', exact: true })
    .click();
  await page.screenshot({ path: info.outputPath('selection-toolbar.png') });
  await editor.press('ArrowRight');
  await expect(toolbar).toHaveCount(0);
  await editor.press('Escape');
  const edge = canvas.locator('[data-cell-id="arrow-1"]');
  await edge.locator('[data-edge-label]').first().dblclick();
  const edgeEditor = edge.locator('.ProseMirror');
  await edgeEditor.press('ControlOrMeta+a');
  await edgeEditor.press('ControlOrMeta+k');
  await linkDialog
    .getByLabel('搜索工作区或输入网址')
    .fill('https://example.com/edge');
  await linkDialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(edgeEditor.locator('a')).toHaveAttribute(
    'href',
    'https://example.com/edge',
  );
  await expect(edgeEditor).toBeFocused();
  await edgeEditor.press('Escape');
  await canvas.press('ControlOrMeta+z');
  await expect(edge.locator('a')).toHaveCount(0);

  const process = canvas.locator('[data-cell-id="shape-process"]');
  await node.click();
  await process.click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: '编辑链接', exact: true }).click();
  await expect(linkDialog.getByLabel('搜索工作区或输入网址')).toHaveAttribute(
    'placeholder',
    '多个链接',
  );
  await linkDialog
    .getByLabel('搜索工作区或输入网址')
    .fill('https://example.com/batch');
  await linkDialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(node.locator('a').first()).toHaveAttribute(
    'href',
    'https://example.com/batch',
  );
  await expect(process.locator('a')).toHaveAttribute(
    'href',
    'https://example.com/batch',
  );
  await canvas.press('ControlOrMeta+z');
  await expect(process.locator('a')).toHaveCount(0);
  await expect(node.locator('a').first()).toHaveAttribute(
    'href',
    'https://example.com',
  );
  await node.click();
  await node.click({ button: 'right' });
  const selectionActions = page.getByRole('dialog', {
    name: 'Selection actions',
    exact: true,
  });
  await selectionActions
    .getByRole('button', { name: '编辑链接', exact: true })
    .click();
  await linkDialog
    .getByLabel('搜索工作区或输入网址')
    .fill('https://example.com/context');
  await linkDialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(node.locator('a').first()).toHaveAttribute(
    'href',
    'https://example.com/context',
  );
  await expect(linkDialog).toBeHidden();
  await page.keyboard.press('Escape');
  await canvas.press('ControlOrMeta+z');
  await expect(node.locator('a').first()).toHaveAttribute(
    'href',
    'https://example.com',
  );
  await page.getByTestId('workspace-my').click();
  await selectSetting(page.getByTestId('settings-appearance'), 'dark');
  await selectSetting(page.getByTestId('settings-language'), 'en');
  await page.getByTestId('my-back').click();
  await node.dblclick();
  await editor.press('ControlOrMeta+a');
  await expect(
    toolbar.getByRole('button', { name: 'More text formatting', exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath('selection-toolbar-dark-en.png'),
  });
  await editor.press('ControlOrMeta+k');
  await expect(
    linkDialog.getByLabel('Search workspace or enter a URL'),
  ).toHaveValue('https://example.com');
  await page.setViewportSize({ width: 540, height: 680 });
  const bounds = (await linkDialog.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(540);
  await expect(
    linkDialog.getByRole('button', { name: 'Save', exact: true }),
  ).toBeVisible();
  const compositionEnterHandled = await linkDialog
    .getByLabel('Search workspace or enter a URL')
    .evaluate((input) => {
      const event = new KeyboardEvent('keydown', {
        key: 'Enter',
        isComposing: true,
        bubbles: true,
        cancelable: true,
      });
      input.dispatchEvent(event);
      return event.defaultPrevented;
    });
  expect(compositionEnterHandled).toBe(true);
  const narrowTarget = linkDialog.getByRole('combobox', {
    name: 'Search workspace or enter a URL',
  });
  await narrowTarget.click();
  await narrowTarget.fill(file.frame.name);
  const narrowOption = linkDialog
    .getByRole('option', { name: new RegExp(file.frame.name) })
    .first();
  await expect(narrowOption).toBeVisible();
  const dropdownBounds = (await narrowOption.boundingBox())!;
  expect(dropdownBounds.x).toBeGreaterThanOrEqual(0);
  expect(dropdownBounds.x + dropdownBounds.width).toBeLessThanOrEqual(540);
  await narrowOption.click();
  await page.keyboard.press('Escape');
  await expect(linkDialog).toBeHidden();
});

test('document file links use encoded identities, work readonly and report clipboard failures', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const id = 'document 中文';
  const file = {
    format: 'verd-document',
    version: 1,
    id,
    title: 'Copy document',
    text: {
      schemaVersion: 1,
      id,
      kind: 'block',
      plainText: 'Body',
      content: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Body' }] },
        ],
      },
    },
  };
  await page.goto('/');
  await page
    .locator('input[accept=".json,.verd.json,.verd-doc.json,.md,.markdown"]')
    .setInputFiles({
      name: 'copy.verd-doc.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(file)),
    });
  const row = page
    .locator('.file-tree-name')
    .filter({ hasText: /^Copy document$/ });
  await expect(row).toBeVisible();
  await row.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '复制链接', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(`verd://file/${encodeURIComponent(id)}`);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve) => {
          const request = indexedDB.open('verdboard-host');
          request.onsuccess = () => resolve(request.result);
        });
        const rows = await new Promise<any[]>((resolve) => {
          const request = db.transaction('files').objectStore('files').getAll();
          request.onsuccess = () => resolve(request.result);
        });
        db.close();
        return rows.some(
          (row) =>
            row.kind === 'file' &&
            new TextDecoder().decode(row.content).includes('Copy document'),
        );
      }),
    )
    .toBe(true);
  await page.goto('/?readonly=1');
  await row.click({ button: 'right' });
  await expect(
    page.getByRole('menuitem', { name: '重命名/移动', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('menuitem', { name: '复制链接', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(`verd://file/${encodeURIComponent(id)}`);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('denied')) },
    });
  });
  await row.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '复制链接', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('无法复制链接');
});
