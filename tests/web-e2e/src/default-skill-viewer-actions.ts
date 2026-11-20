import { expect, test, type Page } from '@playwright/test';
import { selectSetting } from '../../helpers/settings-controls';
import { openSettings } from './app-actions';

export async function exerciseDefaultSkillViewer(
  page: Page,
  readClipboard: () => Promise<string>,
) {
  await openSettings(page);
  for (const appearance of ['light', 'dark']) {
    await page.getByTestId('settings-nav-personal.general').click();
    await selectSetting(page.getByTestId('settings-appearance'), appearance);
    await page.getByTestId('settings-nav-workspace.skills').click();
    await page.getByTestId('workspace-skill-default').click();
    const viewer = page.getByTestId('workspace-default-skill-viewer');
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await expect(page.getByTestId('my-page')).toContainText(
      '默认 Skill 与规则',
    );
    await expect(
      viewer.getByTestId('workspace-default-skill-back'),
    ).toBeFocused();
    await expect(page.getByTestId('workspace-skill-body')).toBeHidden();
    const editor = viewer.locator('.tiptap');
    await expect(editor).toHaveAttribute('contenteditable', 'false');
    const paragraph = editor.locator('p').first();
    await expect(paragraph).toHaveCSS('font-size', '16px');
    await expect(paragraph).toHaveCSS('line-height', '28px');
    const code = editor.locator('p code').first();
    await expect(code).toBeVisible();
    const paint = await code.evaluate((element) => {
      const style = getComputedStyle(element);
      const probe = document.createElement('span');
      probe.style.background = 'var(--vm-background-subtle)';
      element.append(probe);
      const expected = getComputedStyle(probe).backgroundColor;
      probe.remove();
      const channels = (color: string) =>
        (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
      const luminance = (color: string) =>
        channels(color)
          .map((channel) => channel / 255)
          .map((channel) =>
            channel <= 0.04045
              ? channel / 12.92
              : ((channel + 0.055) / 1.055) ** 2.4,
          )
          .reduce(
            (sum, channel, index) =>
              sum + channel * [0.2126, 0.7152, 0.0722][index],
            0,
          );
      const foreground = luminance(style.color),
        background = luminance(style.backgroundColor);
      return {
        background: style.backgroundColor,
        expected,
        ratio:
          (Math.max(foreground, background) + 0.05) /
          (Math.min(foreground, background) + 0.05),
      };
    });
    expect(paint.background).toBe(paint.expected);
    expect(paint.ratio).toBeGreaterThanOrEqual(4.5);
    const before = await editor.textContent();
    await paragraph.dblclick({ position: { x: 18, y: 12 } });
    const selected = await page.evaluate(
      () => getSelection()?.toString() ?? '',
    );
    expect(selected.length).toBeGreaterThan(0);
    await page.keyboard.press('ControlOrMeta+c');
    await expect.poll(readClipboard).toBe(selected);
    await page.keyboard.type('This must not edit the Skill');
    await expect(editor).toHaveText(before!);
    await expect(viewer.getByRole('toolbar', { name: '文字格式' })).toHaveCount(
      0,
    );
    await viewer.screenshot({
      path: test.info().outputPath(`default-skill-${appearance}.png`),
    });
    await viewer.getByTestId('workspace-default-skill-source').click();
    await expect(viewer.locator('.tiptap')).toHaveCount(0);
    await expect(
      viewer.getByTestId('workspace-skill-guide').locator('pre'),
    ).toContainText('name: verd-authoring');
    await viewer
      .getByRole('button', { name: '内容编写规范', exact: true })
      .click();
    await expect(viewer.locator('.tiptap')).toContainText('通用表达与事实');
    await viewer.getByTestId('workspace-default-skill-back').click();
    await expect(viewer).toHaveCount(0);
    await expect(page.getByTestId('workspace-skill-default')).toBeFocused();
    await expect(page.getByRole('dialog')).toHaveCount(1);
  }
}
