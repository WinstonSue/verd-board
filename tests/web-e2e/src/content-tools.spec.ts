import { initializeVersions, closeVersionSettings } from './version-actions';
import { selectSetting } from '../../helpers/settings-controls';
import { test, expect, type Page } from './service-fixture';
import { zipSync, strToU8 } from 'fflate';
import { openDocumentInsert, openSettings } from './app-actions';
import { exerciseDocumentBlockActions } from './document-block-actions';
import { activeTabTitle } from './tab-actions';
import { exerciseDocumentInlineReferences } from './document-inline-reference-actions';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => console.log('PAGE ERROR', error.stack));
});

const active = (page: Page) => page.locator('.workspace-pane.is-active');
const nativeDoc = (
  id: string,
  title: string,
  body: string | string[] = 'Original decision',
) => ({
  format: 'verd-document',
  version: 1,
  id,
  title,
  text: {
    schemaVersion: 1,
    id,
    kind: 'block',
    align: 'left',
    plainText: Array.isArray(body) ? body.join('\n') : body,
    content: {
      type: 'doc',
      content: (Array.isArray(body) ? body : [body]).map((paragraph) => ({
        type: 'paragraph',
        content: paragraph ? [{ type: 'text', text: paragraph }] : [],
      })),
    },
  },
});
async function openDoc(
  page: Page,
  id = 'tools-doc',
  body: string | string[] = 'Original decision',
) {
  await page.goto('/');
  await page
    .locator(
      'input[accept=".json,.verd,.verd.json,.verd-doc.json,.md,.markdown"]',
    )
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
  await expect(editor).toBeFocused();
  await page.keyboard.insertText('HeAdInG 2');
  await expect(editor).toHaveText('/HeAdInG 2');
  await expect(menu.getByRole('button')).toHaveCount(1);
  await menu.getByRole('button', { name: '二级标题', exact: true }).click();

  await expect(editor.locator('h2')).toBeVisible();
  await expect(editor).toBeFocused();
  await page.keyboard.type('Decision');
  await expect(editor.locator('h2')).toHaveText('Decision');
  await editor.locator('h2').hover();
  await active(page)
    .getByRole('button', { name: '段落操作', exact: true })
    .click();
  await page
    .getByRole('dialog', { name: '段落操作', exact: true })
    .getByRole('button', { name: '复制', exact: true })
    .click();
  await expect(editor.locator('h2')).toHaveCount(2);
});

test('inline references keep normal typing, support undo and survive tab switches', async ({
  page,
}) => {
  await page.goto('/');
  await page.setViewportSize({ width: 640, height: 600 });
  await exerciseDocumentInlineReferences(page);
});

test('slash heading submenu preserves editor focus and direct heading searches', async ({
  page,
}) => {
  await page.setViewportSize({ width: 640, height: 600 });
  await openDoc(page, 'heading-aliases', '');
  const editor = active(page).locator('.tiptap');
  await editor.focus();
  await page.keyboard.type('/');
  const menu = page.getByRole('menu', { name: '插入内容', exact: true });
  const headingEntry = menu.getByRole('button', { name: '标题', exact: true });
  const submenu = page.getByRole('menu', { name: '标题', exact: true });
  await expect(
    menu.getByRole('button', { name: /^[一二三四五六]级标题$/ }),
  ).toHaveCount(0);
  await expect(headingEntry).toHaveAttribute('aria-expanded', 'false');
  await headingEntry.click();
  await expect(headingEntry).toHaveAttribute('aria-expanded', 'true');
  await expect(submenu).toHaveAttribute('data-positioned', '');
  await expect(menu).toBeInViewport({ ratio: 1 });
  await expect(submenu).toBeInViewport({ ratio: 1 });
  await expect(editor).toBeFocused();
  const headings = submenu.getByRole('button');
  await expect(headings).toHaveCount(6);
  for (const [index, label] of [
    '一级标题',
    '二级标题',
    '三级标题',
    '四级标题',
    '五级标题',
    '六级标题',
  ].entries()) {
    await expect(headings.nth(index)).toHaveAccessibleName(label);
  }
  await page.keyboard.press('Escape');
  await expect(submenu).toHaveCount(0);
  await expect(headingEntry).toHaveAttribute('data-active', 'true');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(editor).toBeFocused();
  await page.keyboard.press('Backspace');
  await page.keyboard.type('/');
  await headingEntry.click();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowRight');
  await expect(submenu).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(headings.nth(1)).toHaveAttribute('data-active', 'true');
  await page.keyboard.press('ArrowUp');
  await expect(headings.nth(0)).toHaveAttribute('data-active', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(submenu).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(submenu).toBeVisible();
  for (const query of ['标题', 'hEaDiNg']) {
    await page.keyboard.insertText(query);
    await expect(submenu).toHaveCount(0);
    await expect(menu.getByRole('button')).toHaveCount(6);
    for (let index = 0; index < query.length; index++)
      await page.keyboard.press('Backspace');
  }
  for (const [query, label] of [
    ['h1', '一级标题'],
    ['H2', '二级标题'],
  ]) {
    await page.keyboard.insertText(query);
    await expect(submenu).toHaveCount(0);
    await expect(menu.getByRole('button')).toHaveCount(1);
    await expect(menu.getByRole('button')).toHaveAccessibleName(label);
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
  }
  await page.keyboard.insertText('h7');
  await expect(menu.getByRole('status')).toHaveText('没有匹配的结果');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('4');

  for (const [level, label] of [
    [4, '四级标题'],
    [5, '五级标题'],
    [6, '六级标题'],
  ] as const) {
    await expect(menu.getByRole('button')).toHaveCount(1);
    await expect(menu.getByRole('button')).toHaveAccessibleName(label);
    await page.keyboard.press('Enter');
    await expect(menu).toBeHidden();
    const heading = editor.locator(`h${level}`);
    await expect(heading).toBeVisible();
    await expect(editor).toBeFocused();
    if (level < 6) {
      await page.keyboard.press('Backspace');
      await expect(heading).toHaveCount(0);
      await page.keyboard.type(`/h${level + 1}`);
    }
  }
  await page.keyboard.type('Heading content');
  await expect(editor.locator('h6')).toHaveText('Heading content');
});

test('block options follow a hovered paragraph without changing the caret', async ({
  page,
}) => {
  await openDoc(page, 'blocks', ['First paragraph', 'Second paragraph']);
  const editor = active(page).locator('.tiptap');
  // Click the paragraph start, clear of the floating formatting toolbar.
  await editor
    .getByText('First paragraph', { exact: true })
    .click({ position: { x: 8, y: 8 } });
  const second = editor.getByText('Second paragraph', { exact: true });
  await second.hover();
  expect(
    await editor.evaluate(() => getSelection()?.anchorNode?.textContent),
  ).toBe('First paragraph');
  await active(page)
    .getByRole('button', { name: '段落操作', exact: true })
    .click();
  const popup = page.getByRole('dialog', { name: '段落操作', exact: true });
  await expect(popup).toBeVisible();
  await expect(second).toHaveClass(/document-block-active/);
  await page.keyboard.press('Escape');
  await expect(popup).toHaveCount(0);
  expect(
    await editor.evaluate(() => getSelection()?.anchorNode?.textContent),
  ).toBe('First paragraph');
  await second.hover();
  await active(page)
    .getByRole('button', { name: '段落操作', exact: true })
    .click();
  await popup.getByRole('button', { name: '复制', exact: true }).click();
  await expect(second).toHaveCount(2);
  await expect(
    editor.getByText('First paragraph', { exact: true }),
  ).toHaveCount(1);
});

test('document text formatting, context menu and drag reorder act on their own targets', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await exerciseDocumentBlockActions(page);
});

test.describe('touch document controls', () => {
  test.use({ hasTouch: true });

  test('the grip opens a compact dark menu and readonly keeps existing block links', async ({
    page,
  }) => {
    await openDoc(page, 'touch-block');
    const editor = active(page).locator('.tiptap');
    await editor.press('End');
    await editor.press('Space'); // An edit assigns the paragraph a stable ID.
    await expect(editor.locator('p')).toHaveAttribute('data-block-id', /.+/);
    await expect(active(page).locator('.document-page__save')).toHaveClass(
      /is-saved/,
    );
    const settings = await openSettings(page);
    await selectSetting(settings.getByTestId('settings-appearance'), 'dark');
    await page.getByTestId('my-back').click();
    await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
    await active(page)
      .getByRole('button', { name: '隐藏目录', exact: true })
      .click();
    await page.setViewportSize({ width: 580, height: 720 });
    await editor.locator('p').tap();
    const toolbar = active(page).getByRole('toolbar', { name: '文字格式' });
    await expect(toolbar).toBeHidden();
    await editor.press('ControlOrMeta+a');
    await expect(toolbar).toBeInViewport({ ratio: 1 });
    await toolbar.getByRole('button', { name: '更多格式' }).tap();
    const formatting = active(page).getByRole('group', { name: '更多格式' });
    await expect(formatting).toHaveAttribute('data-positioned', '');
    await expect(formatting).toBeInViewport({ ratio: 1 });
    await expect(formatting).toHaveCSS('background-color', 'rgb(30, 30, 30)');
    await expect(
      formatting.getByRole('combobox', { name: '字号' }),
    ).toBeEnabled();
    await page.keyboard.press('Escape');
    await expect(formatting).toHaveCount(0);
    await expect(toolbar).toBeVisible();
    const handle = active(page).getByRole('button', {
      name: '段落操作',
      exact: true,
    });
    await handle.tap();
    const menu = active(page).getByRole('dialog', {
      name: '段落操作',
      exact: true,
    });
    await expect(menu).toBeVisible();
    const box = (await menu.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(580);
    expect(box.width).toBeLessThan(200);
    await page.goto('/?readonly=1');
    const readonlyEditor = active(page).locator('.tiptap');
    await expect(readonlyEditor).toHaveAttribute('contenteditable', 'false');
    await readonlyEditor.locator('p').click({ button: 'right' });
    await expect(
      menu.getByRole('button', { name: '复制此段链接', exact: true }),
    ).toBeEnabled();
    await expect(
      menu.getByRole('button', { name: '删除', exact: true }),
    ).toHaveCount(0);
  });
});

test('toolbar and slash menus expose the same insertion choices', async ({
  page,
}) => {
  await openDoc(page, 'insertion-actions', '');
  const insertMenu = await openDocumentInsert(page);
  for (const label of [
    '图片',
    '附件',
    '网页',
    '图表',
    '表格',
    '分隔线',
    '行内公式',
    '公式块',
  ])
    await expect(
      insertMenu.getByRole('button', { name: label, exact: true }),
    ).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await active(page).locator('.tiptap').focus();
  await page.keyboard.type('/');
  const slash = page.getByRole('menu', { name: '插入内容', exact: true });
  for (const label of [
    '图片',
    '附件',
    '网页',
    '图表',
    '表格',
    '分隔线',
    '行内公式',
    '公式块',
  ])
    await expect(
      slash.getByRole('button', { name: label, exact: true }),
    ).toBeVisible();
  await slash.getByRole('button', { name: '分隔线', exact: true }).click();
  await expect(active(page).locator('.tiptap hr')).toHaveCount(1);
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
  await expect(activeTabTitle(page)).toHaveText('ADR 决策记录');
});

test('metadata, named versions and filtered views persist across reload', async ({
  page,
}) => {
  await openDoc(page);
  await initializeVersions(page);
  await closeVersionSettings(page);
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
  await dialog.getByRole('tab', { name: '版本历史', exact: true }).click();
  await dialog
    .getByRole('textbox', { name: '版本说明', exact: true })
    .fill('Baseline');
  await dialog
    .getByRole('button', { name: '为此文件创建版本', exact: true })
    .last()
    .click();
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
  await dialog.getByRole('tab', { name: '版本历史', exact: true }).click();
  await expect(dialog).toContainText('Baseline');
  await dialog
    .getByRole('textbox', { name: '版本说明', exact: true })
    .fill('Edited');
  await dialog
    .getByRole('button', { name: '为此文件创建版本', exact: true })
    .last()
    .click();
  await dialog
    .locator('.workspace-git-log article')
    .filter({ hasText: 'Baseline' })
    .getByRole('button', { name: '恢复此版本…', exact: true })
    .click();
  await dialog
    .getByRole('region', { name: '恢复预览', exact: true })
    .getByRole('button', { name: '确认恢复', exact: true })
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
      page.evaluate(async () => {
        const { meta } = await (window as any).__verdReadDisk();
        return (
          meta.config.value.savedViews?.some(
            (view: { name: string }) => view.name === 'Design docs',
          ) ?? false
        );
      }),
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
  await expect(page.locator('.sue-message-notice')).toContainText('导入 2');
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
  await openDocumentInsert(page);
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
  await dialog.getByRole('tab', { name: '附件', exact: true }).click();
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

test('a late image picker cannot insert into a document after switching tabs', async ({
  page,
}) => {
  await openDoc(page, 'image-scope');
  await openDocumentInsert(page);
  const choosing = page.waitForEvent('filechooser');
  await page
    .getByRole('dialog', { name: '插入', exact: true })
    .getByRole('button', { name: '图片', exact: true })
    .click();
  const picker = await choosing;
  await page
    .locator('.file-tree-name')
    .filter({ hasText: /^未命名画布$/ })
    .click();
  await expect(
    active(page).locator('svg[aria-label="Frame canvas"]'),
  ).toBeVisible();
  await picker.setFiles({
    name: 'late.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSWQAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await expect(
    page.getByText('编辑位置已变化，请重新插入', { exact: true }),
  ).toBeVisible();
  await page
    .locator('.file-tree-name')
    .filter({ hasText: /^Tools$/ })
    .click();
  await expect(active(page).locator('.tiptap img')).toHaveCount(0);
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
    .locator(
      'input[accept=".json,.verd,.verd.json,.verd-doc.json,.md,.markdown"]',
    )
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
  await expect(
    active(page).locator('.workspace-excerpt .board-document-preview-content'),
  ).toHaveCSS('user-select', 'text');
  await active(page)
    .locator('.workspace-excerpt')
    .getByRole('button', { name: /打开来源/ })
    .click();
  await expect(activeTabTitle(page)).toHaveText('Excerpt source');
  await active(page).locator('.tiptap').fill('Revised source');
  await page
    .locator('.file-tree-name')
    .filter({ hasText: /^Excerpt target$/ })
    .click();
  await expect(active(page).locator('.workspace-excerpt')).toContainText(
    'Revised source',
  );
});
