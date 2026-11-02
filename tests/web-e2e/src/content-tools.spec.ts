import { test, expect, type Page } from '@playwright/test';
import { zipSync, strToU8 } from 'fflate';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => console.log('PAGE ERROR', error.stack));
});

const active = (page: Page) => page.locator('.workspace-pane.is-active');
const nativeDoc = (id: string, title: string, body = 'Original decision') => ({
  format: 'verd-document',
  version: 1,
  id,
  title,
  text: {
    schemaVersion: 1,
    id,
    kind: 'block',
    align: 'left',
    plainText: body,
    content: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: body ? [{ type: 'text', text: body }] : [],
        },
      ],
    },
  },
});
async function openDoc(
  page: Page,
  id = 'tools-doc',
  body = 'Original decision',
) {
  await page.goto('/');
  await page
    .locator('input[accept=".json,.verd.json,.verd-doc.json,.md,.markdown"]')
    .setInputFiles({
      name: 'Tools.verd-doc.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(nativeDoc(id, 'Tools', body))),
    });
  await page
    .locator('.file-tree-name')
    .filter({ hasText: /^Tools$/ })
    .click();
  await expect(active(page).locator('.tiptap')).toBeVisible();
}

test('slash menu, block operations and native writing templates work', async ({
  page,
}) => {
  await openDoc(page, 'slash', '');
  const editor = active(page).locator('.tiptap');
  await editor.focus();
  await page.keyboard.type('/');
  const menu = page.getByRole('menu', { name: '插入内容', exact: true });
  await expect(menu).toBeVisible();
  await menu.getByRole('textbox', { name: '搜索内容块' }).fill('二级标题');
  await menu.getByRole('button', { name: '二级标题', exact: true }).click();

  await expect(editor.locator('h2')).toBeVisible();
  await page.keyboard.type('Decision');
  await expect(editor.locator('h2')).toHaveText('Decision');
  await active(page).locator('.document-block-menu summary').click();
  await active(page)
    .locator('.document-block-menu')
    .getByRole('button', { name: '复制', exact: true })
    .click();
  await expect(editor.locator('h2')).toHaveCount(2);
});

test('native writing templates can be previewed and created', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '首页', exact: true }).click();
  await page.getByTestId('management-new').click();
  await page.getByRole('menuitem', { name: '从模板创建', exact: true }).click();
  const templates = page.getByRole('dialog', {
    name: '从模板创建',
    exact: true,
  });
  await templates.getByRole('textbox', { name: '搜索模板' }).fill('ADR');
  await templates
    .getByRole('button', { name: '预览模板', exact: true })
    .click();
  await expect(
    templates.getByRole('region', { name: '模板预览' }),
  ).toContainText('决策背景');
  await templates.getByRole('button', { name: '创建', exact: true }).click();
  await expect(active(page).locator('.document-page__title')).toHaveValue(
    'ADR 决策记录',
  );
});

test('metadata, named versions and filtered views persist across reload', async ({
  page,
}) => {
  await openDoc(page);
  await active(page)
    .getByRole('button', { name: '内容管理', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: '内容管理', exact: true });
  await dialog
    .getByRole('textbox', { name: '内容标签' })
    .fill('design, backend');
  await dialog.getByRole('textbox', { name: '内容标签' }).blur();
  await expect(dialog.getByRole('textbox', { name: '内容状态' })).toBeEnabled();
  await dialog.getByRole('textbox', { name: '内容状态' }).fill('review');
  await dialog.getByRole('textbox', { name: '内容状态' }).blur();
  await dialog.getByRole('button', { name: '版本历史', exact: true }).click();
  await dialog.getByRole('textbox', { name: '版本名称' }).fill('Baseline');
  await dialog.getByRole('button', { name: '保存版本', exact: true }).click();
  await expect(dialog).toContainText('Baseline');
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await active(page).locator('.tiptap').fill('New decision');
  await expect(active(page).locator('.document-page__save')).toHaveClass(
    /is-saved/,
  );
  await page.reload();
  await expect(active(page).locator('.tiptap')).toContainText('New decision');
  await active(page)
    .getByRole('button', { name: '内容管理', exact: true })
    .click();
  await dialog.getByRole('button', { name: '版本历史', exact: true }).click();
  await expect(dialog).toContainText('Baseline');
  await dialog
    .getByRole('button', { name: '恢复此版本', exact: true })
    .first()
    .click();
  await expect(
    dialog.getByRole('button', { name: '关闭', exact: true }),
  ).toBeEnabled();
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(active(page).locator('.tiptap')).toContainText(
    'Original decision',
  );
  await page.getByRole('button', { name: '所有内容', exact: true }).click();
  await page.getByRole('textbox', { name: '标签筛选' }).fill('design');
  await page.getByRole('textbox', { name: '视图名称' }).fill('Design docs');
  await page.getByRole('button', { name: '保存筛选视图', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<boolean>((resolve) => {
            const request = indexedDB.open('verdboard-host');
            request.onerror = () => resolve(false);
            request.onsuccess = () => {
              const db = request.result;
              const read = db.transaction('meta').objectStore('meta').getAll();
              read.onsuccess = () => {
                const rows = read.result as {
                  config: { value: { savedViews?: { name: string }[] } };
                }[];
                db.close();
                resolve(
                  rows.some((row) =>
                    row.config.value.savedViews?.some(
                      (view) => view.name === 'Design docs',
                    ),
                  ),
                );
              };
              read.onerror = () => {
                db.close();
                resolve(false);
              };
            };
          }),
      ),
    )
    .toBe(true);
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Design docs', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Design docs', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '标签筛选' })).toHaveValue(
    'design',
  );
});

test('ZIP imports keep folders, links and images with an explicit result', async ({
  page,
}) => {
  await page.goto('/');
  const bytes = zipSync({
    'research/A.md': strToU8('# A\n[[B]]\n![asset](pic.png)'),
    'research/B.md': strToU8('# B\nSecond note'),
    'research/pic.png': Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSWQAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await page.locator('#workspace-zip-import').setInputFiles({
    name: 'research.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(bytes),
  });
  await expect(page.locator('.workspace-notice-banner')).toContainText(
    '导入 2',
  );
  await page.getByRole('button', { name: '所有内容', exact: true }).click();
  await page
    .locator('.management-result')
    .filter({ hasText: 'research/A.verd-doc.json' })
    .getByRole('button')
    .first()
    .click();
  await expect(active(page).locator('.tiptap a')).toHaveAttribute(
    'href',
    /^verd:\/\/file\//,
  );
  await expect(active(page).locator('.tiptap img')).toBeVisible();
});

test('managed image resources survive reload and expose size/caption controls', async ({
  page,
}) => {
  await openDoc(page, 'image-doc');
  await active(page).getByRole('button', { name: '插入', exact: true }).click();
  await page
    .getByRole('dialog', { name: '插入', exact: true })
    .getByRole('button', { name: '图片', exact: true })
    .click();
  await active(page)
    .locator('input[accept="image/png,image/jpeg,image/webp,image/gif"]')
    .setInputFiles({
      name: 'pixel.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSWQAAAAASUVORK5CYII=',
        'base64',
      ),
    });
  await expect(active(page).locator('.tiptap img')).toHaveAttribute(
    'src',
    /^blob:/,
  );
  await expect(active(page).locator('.document-page__save')).toHaveClass(
    /is-saved/,
  );
  await page.reload();
  await expect(active(page).locator('.tiptap img')).toHaveAttribute(
    'src',
    /^blob:/,
  );
  await active(page)
    .getByRole('button', { name: '内容管理', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: '内容管理', exact: true });
  await dialog.getByRole('button', { name: '附件', exact: true }).click();
  await dialog.getByRole('spinbutton', { name: '图片宽度 0' }).fill('240');
  await dialog.getByRole('spinbutton', { name: '图片宽度 0' }).blur();
  await expect(
    dialog.getByRole('textbox', { name: '图片说明 0' }),
  ).toBeEnabled();
  await dialog
    .getByRole('textbox', { name: '图片说明 0' })
    .fill('Pixel caption');
  await dialog.getByRole('textbox', { name: '图片说明 0' }).blur();
  await expect(
    dialog.getByRole('button', { name: '关闭', exact: true }),
  ).toBeEnabled();
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(active(page).locator('figcaption')).toContainText(
    'Pixel caption',
  );
});

test('readonly paragraph excerpts follow source edits and retain a stable address', async ({
  page,
}) => {
  await page.goto('/');
  const source = nativeDoc(
    'excerpt-source',
    'Excerpt source',
    'Initial source',
  );
  source.text.content.content[0] = {
    ...source.text.content.content[0],
    attrs: { blockId: 'stable-decision' },
  } as (typeof source.text.content.content)[0];
  const target = nativeDoc('excerpt-target', 'Excerpt target', '');
  target.text.content.content = [
    {
      type: 'documentExcerpt',
      attrs: {
        targetDocumentId: 'excerpt-source',
        targetBlockId: 'stable-decision',
      },
    },
  ] as unknown as typeof target.text.content.content;
  await page
    .locator('input[accept=".json,.verd.json,.verd-doc.json,.md,.markdown"]')
    .setInputFiles({
      name: 'excerpts.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          format: 'verd-canvas-bundle',
          version: 1,
          rootFileId: 'excerpt-target',
          files: [source, target],
        }),
      ),
    });
  await page
    .locator('.file-tree-name')
    .filter({ hasText: /^Excerpt target$/ })
    .click();
  await expect(active(page).locator('.workspace-excerpt')).toContainText(
    'Initial source',
  );
  await expect(
    active(page).locator('.workspace-excerpt [contenteditable="true"]'),
  ).toHaveCount(0);
  await active(page)
    .locator('.workspace-excerpt')
    .getByRole('button', { name: /打开来源/ })
    .click();
  await expect(active(page).locator('.document-page__title')).toHaveValue(
    'Excerpt source',
  );
  await active(page).locator('.tiptap').fill('Revised source');
  await page
    .locator('.file-tree-name')
    .filter({ hasText: /^Excerpt target$/ })
    .click();
  await expect(active(page).locator('.workspace-excerpt')).toContainText(
    'Revised source',
  );
});
