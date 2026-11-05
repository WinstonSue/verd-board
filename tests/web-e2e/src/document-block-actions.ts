import { exerciseDocumentFormatLayout } from './document-format-layout-actions';
import { expect, type Locator, type Page } from '@playwright/test';

export async function exerciseDocumentBlockActions(page: Page) {
  const id = 'block-actions';
  const labels = ['First paragraph', 'Second paragraph', 'Third paragraph'];
  const heading = 'Large heading';
  const contents = [
    {
      type: 'heading',
      attrs: { level: 1, blockId: 'block-heading' },
      content: [{ type: 'text', text: heading }],
    },
    ...labels.map((label, i) => ({
      type: 'paragraph',
      attrs: { blockId: 'block-' + i },
      content: [{ type: 'text', text: label }],
    })),
  ];
  await page
    .locator('input[accept=".json,.verd.json,.verd-doc.json,.md,.markdown"]')
    .setInputFiles({
      name: 'Block actions.verd-doc.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          format: 'verd-document',
          version: 1,
          id,
          title: 'Block actions',
          text: {
            schemaVersion: 1,
            id,
            kind: 'block',
            plainText: [heading, ...labels].join('\n'),
            content: { type: 'doc', content: contents },
          },
        }),
      ),
    });
  await page
    .locator('.file-tree-name')
    .filter({ hasText: /^Block actions$/ })
    .click();
  const pane = page.locator('.workspace-pane.is-active');
  const editor = pane.locator('.tiptap');
  const paragraphs = editor.locator('p');
  const first = editor.getByText(labels[0], { exact: true });
  const second = editor.getByText(labels[1], { exact: true });
  const third = editor.getByText(labels[2], { exact: true });
  const toolbar = pane.getByRole('toolbar', { name: '文字格式' });
  const menu = pane.getByRole('dialog', { name: '段落操作' });
  const handle = pane.getByRole('button', { name: '段落操作', exact: true });
  const expectGripAtFirstLine = async (block: Locator) => {
    await block.hover();
    await expect
      .poll(async () => {
        const grip = await handle.boundingBox();
        const line = await block.evaluate((node) => {
          const { left, top } = node.getBoundingClientRect();
          return {
            left,
            centerY: top + parseFloat(getComputedStyle(node).lineHeight) / 2,
          };
        });
        return (
          !!grip &&
          Math.abs(grip.y + grip.height / 2 - line.centerY) < 2 &&
          Math.abs(grip.x + grip.width - (line.left - 4)) < 2
        );
      })
      .toBe(true);
  };
  await expect(paragraphs).toHaveText(labels);
  await third.click();
  await editor.press('End');
  await expect(toolbar).toBeVisible();
  await expect(toolbar).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => getSelection()?.isCollapsed)).toBe(true);
  await toolbar.getByRole('button', { name: '下划线' }).click();
  await expect(editor).toBeFocused();
  await page.keyboard.type('!');
  await expect(paragraphs.last().locator('u')).toHaveText('!');
  await editor.press('Backspace');
  await expect(paragraphs).toHaveText(labels);
  await page.getByRole('button', { name: '查找', exact: true }).focus();
  await expect(toolbar).toBeHidden();
  await editor.focus();
  await expect(toolbar).toBeVisible();
  await first.dblclick({ position: { x: 12, y: 10 } });
  await expect
    .poll(() => page.evaluate(() => getSelection()?.toString()))
    .toBe('First');
  await expect(toolbar).toBeVisible();
  await expect(toolbar).toBeInViewport({ ratio: 1 });
  await toolbar.getByRole('button', { name: '加粗' }).click();
  await expect(first.locator('strong')).toHaveText('First');
  await expect
    .poll(() => page.evaluate(() => getSelection()?.toString()))
    .toBe('First');
  const typeButton = toolbar.getByRole('button', {
    name: '块类型',
    exact: true,
  });
  const types = pane.getByRole('menu', { name: '块类型', exact: true });
  await typeButton.focus();
  await typeButton.press('ArrowDown');
  await expect(types.getByRole('menuitemradio')).toHaveCount(11);
  await expect(types.locator('button:not(:disabled)').first()).toBeFocused();
  await types
    .getByRole('menuitemradio', { name: '二级标题', exact: true })
    .click();
  await expect(editor.locator('h2')).toHaveText(labels[0]);
  await typeButton.click();
  await types
    .getByRole('menuitemradio', { name: '二级标题', exact: true })
    .click();
  await expect(editor.locator('h2')).toHaveText(labels[0]);
  await typeButton.click();
  await types.getByRole('menuitemradio', { name: '正文', exact: true }).click();
  await expect(paragraphs).toHaveText(labels);
  await toolbar.getByRole('button', { name: '对齐', exact: true }).click();
  await pane
    .getByRole('menu', { name: '对齐', exact: true })
    .getByRole('menuitemradio', { name: '居中', exact: true })
    .click();
  await expect(first).toHaveCSS('text-align', 'center');
  await toolbar.getByRole('button', { name: '对齐', exact: true }).click();
  await pane
    .getByRole('menu', { name: '对齐', exact: true })
    .getByRole('menuitemradio', { name: '左对齐', exact: true })
    .click();
  const colorButton = toolbar.getByRole('button', { name: '颜色与背景' });
  const colors = pane.getByRole('menu', { name: '颜色与背景' });
  const beforeColors = await toolbar.boundingBox();
  await colorButton.click();
  await expect(colors).toBeInViewport({ ratio: 1 });
  expect(await toolbar.boundingBox()).toEqual(beforeColors);
  await colors
    .getByRole('menuitemradio', { name: '红色文字', exact: true })
    .click();
  await expect(first.locator('span[style*="color"]')).toHaveText('First');
  await expect(second.locator('span[style*="color"]')).toHaveCount(0);
  await colorButton.click();
  await expect(
    colors.getByRole('menuitemradio', { name: '红色文字', exact: true }),
  ).toHaveAttribute('aria-checked', 'true');
  await colors
    .getByRole('menuitemradio', { name: '默认颜色', exact: true })
    .click();
  await colorButton.click();
  await colors
    .getByRole('menuitemradio', { name: '黄色背景', exact: true })
    .click();
  await expect(first.locator('mark')).toHaveText('First');
  await colorButton.click();
  await colors
    .getByRole('menuitemradio', { name: '默认背景', exact: true })
    .click();
  await expect(first.locator('mark')).toHaveCount(0);
  await expect(editor).toBeFocused();
  const more = toolbar.getByRole('button', { name: '更多格式' });
  const formatting = pane.getByRole('group', { name: '更多格式' });
  const fontSize = formatting.getByRole('combobox', { name: '字号' });
  const toolbarBox = await toolbar.boundingBox();
  await more.focus();
  await page.keyboard.press('Enter');
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  await expect(formatting).toBeInViewport({ ratio: 1 });
  expect(await toolbar.boundingBox()).toEqual(toolbarBox);
  await page.keyboard.press('Tab');
  await expect(fontSize).toBeFocused();
  await fontSize.selectOption('24px');
  await expect(first.locator('span[style*="font-size"]')).toHaveText('First');
  await expect(first.locator('span[style*="font-size"]')).toHaveCSS(
    'font-size',
    '24px',
  );
  await fontSize.selectOption('');
  await fontSize.focus();
  await page.keyboard.press('Escape');
  await expect(formatting).toHaveCount(0);
  await expect(more).toBeFocused();
  await expect(toolbar).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(toolbar).toHaveCount(0);
  await expect(editor).toBeFocused();
  await expect
    .poll(() => page.evaluate(() => getSelection()?.toString()))
    .toBe('First');
  const linkDialog = page.getByRole('dialog', {
    name: '编辑链接',
    exact: true,
  });
  await editor.press('ControlOrMeta+k');
  await expect(
    linkDialog.getByRole('combobox', { name: '搜索工作区或输入网址' }),
  ).toBeFocused();
  await expect(linkDialog.getByLabel('显示文字')).toHaveCount(0);
  await linkDialog
    .getByLabel('搜索工作区或输入网址')
    .fill('javascript:alert(1)');
  await expect(
    linkDialog.getByRole('button', { name: '保存', exact: true }),
  ).toBeDisabled();
  await expect(linkDialog.getByText('没有匹配的目标')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(linkDialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(linkDialog).toBeHidden();
  await expect(editor).toBeFocused();
  await expect
    .poll(() => page.evaluate(() => getSelection()?.toString()))
    .toBe('First');
  await editor.press('ControlOrMeta+k');
  await linkDialog
    .getByLabel('搜索工作区或输入网址')
    .fill('https://example.com');
  await linkDialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(first.locator('a')).toHaveText('First');
  await expect(editor).toBeFocused();
  await editor.press('ControlOrMeta+k');
  await expect(linkDialog.getByLabel('搜索工作区或输入网址')).toHaveValue(
    'https://example.com',
  );
  await linkDialog.getByLabel('搜索工作区或输入网址').fill('');
  await expect(linkDialog.getByText('保存后将移除链接')).toBeVisible();
  await expect(first.locator('a')).toHaveCount(1);
  await linkDialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(first.locator('a')).toHaveCount(0);
  await expect(first.locator('strong')).toHaveText('First');
  await expectGripAtFirstLine(editor.getByRole('heading', { name: heading }));
  await expectGripAtFirstLine(second);
  const typography = await page.addStyleTag({
    content: '.tiptap [data-block-id="block-1"] { line-height: 56px; }',
  });
  await expectGripAtFirstLine(second);
  const wrapping = await page.addStyleTag({
    content: '.tiptap [data-block-id="block-1"] { width: 110px; }',
  });
  await expect
    .poll(async () => (await second.boundingBox())?.height)
    .toBeGreaterThan(56);
  await expectGripAtFirstLine(second);
  await wrapping.evaluate((node) => node.remove());
  await typography.evaluate((node) => node.remove());
  await expect
    .poll(() =>
      first.evaluate((node) =>
        node.contains(getSelection()?.anchorNode ?? null),
      ),
    )
    .toBe(true);
  await second.click({ button: 'right' });
  await expect(toolbar).toHaveCount(0);
  await expect(menu).toBeVisible();
  await expect(second).toHaveClass(/document-block-active/);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => getSelection()?.toString()))
    .toBe('First');
  await expect(toolbar).toBeVisible();
  await editor.press('ArrowRight');
  await expect(toolbar).toBeVisible();
  await editor.press('Alt+F10');
  await expect(menu).toBeVisible();
  await expect(first).toHaveClass(/document-block-active/);
  await page.keyboard.press('Escape');
  await first.hover();
  await handle.click();
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await first.hover();
  const cancelled = (await handle.boundingBox())!;
  await page.mouse.move(
    cancelled.x + cancelled.width / 2,
    cancelled.y + cancelled.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(cancelled.x + 45, cancelled.y + 60, { steps: 4 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(paragraphs).toHaveText(labels);
  await expect(menu).toHaveCount(0);
  await expect(pane.locator('.document-block-drop-line')).toHaveCount(0);
  await first.hover();
  const grip = (await handle.boundingBox())!;
  const dest = (await third.boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(dest.x + 30, dest.y + dest.height - 2, { steps: 6 });
  await expect(pane.locator('.document-block-drop-line')).toBeVisible();
  await page.mouse.up();
  await expect(paragraphs).toHaveText([labels[1], labels[2], labels[0]]);
  await expect(menu).toHaveCount(0);
  await expect(paragraphs.last()).toHaveAttribute('data-block-id', 'block-0');
  await editor.press('ControlOrMeta+z');
  await expect(paragraphs).toHaveText(labels);
  await editor.press('ControlOrMeta+Shift+z');
  await expect(paragraphs).toHaveText([labels[1], labels[2], labels[0]]);
  await expect(pane.locator('.document-page__save')).toHaveClass(/is-saved/);
  await page.reload();
  await expect(paragraphs).toHaveText([labels[1], labels[2], labels[0]]);
  await expect(paragraphs.last()).toHaveAttribute('data-block-id', 'block-0');
  await paragraphs.last().locator('strong').dblclick();
  await expect(toolbar).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => getSelection()?.toString()))
    .toBe('First');
  await exerciseDocumentFormatLayout(page);
}
