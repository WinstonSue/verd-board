import { selectSetting } from '../../helpers/settings-controls';
import { expect, type Page } from '@playwright/test';
import { openSettings } from './app-actions';

/** Shared by Web and Electron so narrow palettes exercise the real editor. */
export async function exerciseDocumentFormatLayout(page: Page) {
  const original =
    page.viewportSize() ??
    (await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    })));
  const settingsWithSidebar = async () => {
    const expand = page.getByRole('button', {
      name: /^(展开侧栏|Expand sidebar)$/,
    });
    if (await expand.isVisible()) {
      await expand.focus();
      await expand.press('Enter');
    }
    return openSettings(page);
  };
  for (const [theme, language, width] of [
    ['light', 'zh', 1280],
    ['dark', 'en', 320],
  ] as const) {
    await page.setViewportSize({ width: 1280, height: 800 });
    const settings = await settingsWithSidebar();
    await selectSetting(settings.getByTestId('settings-appearance'), theme);
    await selectSetting(settings.getByTestId('settings-language'), language);
    await page.getByTestId('my-back').click();
    const collapse = page.getByRole('button', {
      name: /^(收起侧栏|Collapse sidebar)$/,
    });
    if (await collapse.isVisible()) await collapse.click();
    const pane = page.locator('.workspace-pane.is-active');
    const outline = pane.getByRole('button', {
      name: /^(隐藏目录|Hide contents)$/,
    });
    if (await outline.isVisible()) await outline.click();
    await page.setViewportSize({ width, height: 640 });
    const editor = pane.locator('.tiptap');
    await editor
      .locator('strong')
      .filter({ hasText: /^First$/ })
      .dblclick();
    const en = language === 'en';
    const toolbar = pane.getByRole('toolbar', {
      name: en ? 'Text formatting' : '文字格式',
    });
    await expect(toolbar).toBeInViewport({ ratio: 1 });
    const more = toolbar.getByRole('button', {
      name: en ? 'More formatting' : '更多格式',
    });
    await more.click();
    const extra = pane.getByRole('group', {
      name: en ? 'More formatting' : '更多格式',
    });
    await expect(extra).toBeInViewport({ ratio: 1 });
    if (width === 320) {
      await expect(
        toolbar.getByRole('button', { name: 'Inline code', exact: true }),
      ).toHaveCount(0);
      await expect(
        extra.getByRole('button', { name: 'Inline code', exact: true }),
      ).toBeVisible();
      await extra
        .getByRole('button', { name: 'Block type', exact: true })
        .click();
      const blocks = pane.getByRole('menu', {
        name: 'Block type',
        exact: true,
      });
      await expect(blocks).toBeInViewport({ ratio: 1 });
      await expect(blocks.getByRole('menuitemradio')).toHaveCount(11);
    }
    await page.keyboard.press('Escape');
    await expect(toolbar).toBeVisible();
    const color = toolbar.getByRole('button', {
      name: en ? 'Color and background' : '颜色与背景',
    });
    await color.focus();
    const before = await toolbar.boundingBox();
    await color.press('ArrowDown');
    const palette = pane.getByRole('menu', {
      name: en ? 'Color and background' : '颜色与背景',
    });
    await expect(palette).toBeInViewport({ ratio: 1 });
    expect(await toolbar.boundingBox()).toEqual(before);
    await expect(palette.getByRole('menuitemradio').first()).toBeFocused();
    await palette.getByRole('menuitemradio').first().press('End');
    await expect(
      palette.getByLabel(en ? 'Custom highlight' : '自定义高亮'),
    ).toBeFocused();
    expect(await palette.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    await page.screenshot({
      path: `/private/tmp/verd-format-${theme}-${width}.png`,
    });
    await page.keyboard.press('Escape');
    await expect(color).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(editor).toBeFocused();
    await expect
      .poll(() => page.evaluate(() => getSelection()?.toString()))
      .toBe('First');
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  const settings = await settingsWithSidebar();
  await selectSetting(settings.getByTestId('settings-language'), 'zh');
  await selectSetting(settings.getByTestId('settings-appearance'), 'light');
  await page.getByTestId('my-back').click();
  await page.setViewportSize(original);
}
