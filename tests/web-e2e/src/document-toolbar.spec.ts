import {
  expectSettingValue,
  selectSetting,
} from '../../helpers/settings-controls';
import { test, expect, type Page, type Locator } from './service-fixture';
import { activeTabTitle } from './tab-actions';
import { openDocumentInsert } from './app-actions';

const file = {
  format: 'verd-document',
  version: 1,
  id: 'toolbar-doc',
  title: 'Toolbar document',
  text: {
    schemaVersion: 1,
    id: 'toolbar-doc',
    kind: 'block',
    align: 'left',
    plainText: 'Open target\nTarget\nCell',
    content: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Open target',
              marks: [{ type: 'link', attrs: { href: '#target' } }],
            },
          ],
        },
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Target' }],
        },
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  content: [
                    {
                      type: 'paragraph',
                      content: [{ type: 'text', text: 'Cell' }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  },
};

async function openToolbarDocument(page: Page) {
  await page.goto('/');
  await page
    .locator(
      'input[accept=".json,.verd,.verd.json,.verd-doc.json,.md,.markdown"]',
    )
    .setInputFiles({
      name: 'Toolbar document.verd-doc.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(file)),
    });
  await page
    .locator('.file-tree-name')
    .filter({ hasText: /^Toolbar document$/ })
    .click();
  const pane = page.locator('.workspace-pane.is-active');
  await expect(activeTabTitle(page)).toHaveText(file.title);
  return pane;
}

test('document has a direct presentation entry and saved status in the title header', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Element.prototype.requestFullscreen = () =>
      Promise.reject(new Error('Fullscreen refused'));
  });
  const pane = await openToolbarDocument(page);
  const editor = pane.locator('.ProseMirror');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' preserved draft');
  await pane
    .getByRole('toolbar', { name: 'document', exact: true })
    .getByRole('button', { name: '演示', exact: true })
    .click();
  const mode = page.getByTestId('presentation-mode');
  await expect(mode).toBeVisible();
  await expect(mode.locator('.ProseMirror')).toHaveAttribute(
    'contenteditable',
    'false',
  );
  await expect(mode).toContainText('preserved draft');
  await page.keyboard.press('Escape');
  await expect(mode).toHaveCount(0);
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await expect(editor).toContainText('preserved draft');
  await expect(
    pane.locator('.workspace-file-navigation').getByTestId('save-status'),
  ).toHaveCount(1);
  await expect(
    pane.locator('.document-page').getByTestId('save-status'),
  ).toHaveCount(0);
});

test('document toolbar, link preference and body focus work across container widths', async ({
  page,
}, info) => {
  const pane = await openToolbarDocument(page);
  const toolbar = pane.getByRole('toolbar', {
    name: 'document',
    exact: true,
  });
  const outline = pane.getByRole('complementary', {
    name: '目录',
    exact: true,
  });
  const outlineHeading = outline.getByRole('button', {
    name: 'Target',
    exact: true,
  });
  await expect(outlineHeading).toBeVisible();
  const collapse = outline.getByRole('button', { name: '隐藏目录' });
  await expect(collapse).toHaveAttribute('aria-expanded', 'true');
  await collapse.click();
  await expect(outlineHeading).toBeHidden();
  const expand = outline.getByRole('button', { name: '显示目录' });
  await expect(expand).toHaveAttribute('aria-expanded', 'false');
  await expect(expand).toBeFocused();
  const body = pane.locator('.document-page__body');
  const content = pane.locator('.document-page__content');
  await expect
    .poll(async () => (await content.boundingBox())?.width)
    .toBe((await body.boundingBox())?.width);
  await expand.click();
  await expect(outlineHeading).toBeVisible();
  for (const width of [1440, 900, 640]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() =>
        toolbar.evaluate((node) => node.getBoundingClientRect().height),
      )
      .toBeLessThanOrEqual(36);
    const trigger = toolbar.getByRole('button', { name: '文档', exact: true });
    const menu = await openDocumentInsert(page);
    const primary = page.getByRole('dialog', { name: '文档', exact: true });
    const insert = primary.getByRole('button', { name: '插入', exact: true });
    await expect(primary).toBeInViewport({ ratio: 1 });
    await expect(menu).toBeInViewport({ ratio: 1 });
    await expect(
      primary.getByRole('button', { name: '命令面板' }),
    ).toBeVisible();
    await expect(insert).toHaveAttribute('aria-expanded', 'true');
    await expect(
      menu.getByRole('button', { name: '图片', exact: true }),
    ).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(insert).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(
      menu.getByRole('button', { name: '图片', exact: true }),
    ).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(menu).toHaveCount(0);
    await expect(insert).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await toolbar.getByRole('button', { name: '查找', exact: true }).click();
    const find = pane.getByPlaceholder('查找…', { exact: true });
    await expect(find).toBeInViewport({ ratio: 1 });
    await find.fill('Target');
    await expect(pane.locator('.doc-findbar__count')).toHaveText('1/2');
    await pane
      .locator('.doc-findbar')
      .getByRole('button', { name: '替换', exact: true })
      .click();
    await expect(
      pane.getByPlaceholder('替换为…', { exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await find.press('Escape');
    await expect(find).toBeHidden();
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await toolbar.getByRole('button', { name: '查找', exact: true }).click();
  const find = pane.getByPlaceholder('查找…', { exact: true });
  await expect
    .poll(async () => {
      const toolbarBounds = (await toolbar.boundingBox())!;
      const findBounds = (await find.boundingBox())!;
      return (
        findBounds.y >= toolbarBounds.y &&
        findBounds.y + findBounds.height <=
          toolbarBounds.y + toolbarBounds.height
      );
    })
    .toBe(true);
  await find.press('Escape');
  const table = pane.locator('.tiptap table');
  await table.getByText('Cell', { exact: true }).click();
  await expect(
    toolbar.getByRole('button', { name: '表格', exact: true }),
  ).toHaveCount(0);
  await pane.locator('.tiptap').focus();
  await expect
    .poll(() =>
      pane
        .locator('.tiptap')
        .evaluate((node) => getComputedStyle(node).outlineStyle),
    )
    .toBe('none');
  await page.screenshot({ path: info.outputPath('document-toolbar.png') });
  await page.getByTestId('workspace-my').click();
  await page.getByTestId('settings-nav-personal.editor').click();
  const preference = page.getByTestId('settings-link-activation');
  await expectSettingValue(preference, 'modifier');
  await selectSetting(preference, 'click');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('verdboard.interaction-settings')!)
            .linkActivation,
      ),
    )
    .toBe('click');
  await page.getByTestId('settings-nav-personal.general').click();
  await selectSetting(page.getByTestId('settings-appearance'), 'dark');
  await selectSetting(page.getByTestId('settings-language'), 'en');
  await page.getByTestId('my-back').click();
  await pane.getByRole('link', { name: 'Open target' }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.getSelection()?.anchorNode?.parentElement?.closest('h2')
            ?.textContent,
      ),
    )
    .toBe('Target');
  await expect(await openDocumentInsert(page, 'en')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.screenshot({
    path: info.outputPath('document-toolbar-dark-en.png'),
  });
  await page.reload();
  await page.getByTestId('workspace-my').click();
  await page.getByTestId('settings-nav-personal.editor').click();
  await expectSettingValue(
    page.getByTestId('settings-link-activation'),
    'click',
  );
});

test('outline toggles keep the block grip aligned and workspace chrome out of text selections', async ({
  page,
}) => {
  const pane = await openToolbarDocument(page);
  const outline = pane.getByRole('complementary', { name: '目录' });
  const toggle = outline.locator('.document-page__toc-toggle');
  const paragraph = pane.locator('.tiptap > p').first();
  const grip = pane.getByRole('button', { name: '段落操作', exact: true });
  const status = pane.locator('.document-page__status');
  const settings = page.getByTestId('workspace-my');
  const settingsRow = settings.locator('..');
  const expectGripAligned = async () => {
    await expect
      .poll(async () => {
        const [block, handle] = await Promise.all([
          paragraph.boundingBox(),
          grip.boundingBox(),
        ]);
        return (
          !!block &&
          !!handle &&
          Math.abs(handle.x + handle.width - (block.x - 4)) < 2 &&
          Math.abs(
            handle.y + handle.height / 2 - (block.y + block.height / 2),
          ) < 2
        );
      })
      .toBe(true);
  };
  const expectFooterAligned = async () => {
    const [left, right, contents] = await Promise.all([
      settingsRow.boundingBox(),
      status.boundingBox(),
      outline.boundingBox(),
    ]);
    expect(left).toBeTruthy();
    expect(right).toBeTruthy();
    expect(contents).toBeTruthy();
    expect(right!.height).toBeCloseTo(left!.height, 0);
    expect(right!.y).toBeCloseTo(left!.y, 0);
    expect(contents!.y + contents!.height).toBeCloseTo(
      right!.y + right!.height,
      0,
    );
  };

  for (const width of [1440, 640]) {
    await page.setViewportSize({ width, height: 900 });
    await paragraph.hover();
    await expectGripAligned();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toHaveCSS('outline-style', 'none');
    await expectGripAligned();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(toggle).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle).toBeFocused();
    await expect(toggle).toHaveCSS('outline-style', 'none');
    await expect(toggle).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expectGripAligned();
    await expectFooterAligned();
  }

  await page.setViewportSize({ width: 1440, height: 350 });
  await paragraph.hover();
  await expectGripAligned();
  const viewport = pane.locator('.document-page__content');
  await viewport.evaluate((node) => {
    node.scrollTop = 24;
  });
  await expect.poll(() => viewport.evaluate((node) => node.scrollTop)).toBe(24);
  await expectGripAligned();

  const dragText = async (locator: Locator) => {
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    const box = await locator.evaluate((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      const { left, right, top, height } = range.getBoundingClientRect();
      return { left, right, y: top + height / 2 };
    });
    await page.mouse.move(box.left + 1, box.y);
    await page.mouse.down();
    await page.mouse.move(box.right - 1, box.y, { steps: 8 });
    await page.mouse.up();
    return page.evaluate(() => window.getSelection()?.toString());
  };
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const label of [
    outline.getByText('目录', { exact: true }),
    outline.getByRole('button', { name: 'Target', exact: true }),
    pane.locator('.workspace-file-navigation-title'),
    status.locator('span').last(),
  ])
    expect(await dragText(label)).toBe('');
  await expect(pane.locator('.tiptap h2')).toBeVisible();
  expect(await dragText(pane.locator('.tiptap h2'))).toBe('Target');

  await settings.click();
  await selectSetting(page.getByTestId('settings-appearance'), 'dark');
  await page.getByTestId('my-back').click();
  await expectFooterAligned();
  await page.getByTestId('workspace-menu-trigger').click();
  const search = page.getByRole('searchbox', { name: '查找工作区' });
  await search.fill('Toolbar');
  await search.press('ControlOrMeta+a');
  expect(
    await search.evaluate(
      (input: HTMLInputElement) => input.selectionEnd! - input.selectionStart!,
    ),
  ).toBe(7);
});
