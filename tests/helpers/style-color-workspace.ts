import { expect, type Page, type TestInfo } from '@playwright/test';
import type {
  Cell,
  FrameCell,
  NodeCell,
} from '../../packages/engine/core/src/cell/types';
import { selectNode } from './diagram-colors';
import {
  openSettings,
  selectHistoryAction,
  setAppLanguage,
} from '../web-e2e/src/app-actions';
import { roleTone } from '../web-e2e/src/theme-role-values';
import { selectPropertyValue } from './property-select';
import { selectSetting } from './settings-controls';

type NativeFile = { frame: FrameCell; cells: Record<string, Cell> };

/** Exercise the real multi-file Session, inspector, history and theme settings. */
export async function exerciseStyleColorWorkspace(
  page: Page,
  info: TestInfo,
  readFiles: () => Promise<Record<string, NativeFile>>,
) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await setAppLanguage(page, 'zh');
  await page
    .locator('.file-tree-file[data-file-id="style-board"] .file-tree-main')
    .click();
  const pane = page.locator('.workspace-pane.is-active');
  const canvas = pane.locator('svg[data-surface="root"]').first();
  const source = canvas.locator('[data-cell-id="style-source"]').first();
  const stroke = canvas
    .locator('[data-cell-id="style-edge"] path[stroke]')
    .first();
  const styles = () => pane.getByRole('group', { name: '风格色', exact: true });
  const family = () =>
    styles().getByRole('button', { name: '风格色 5', exact: true });
  await expect(source).toBeVisible();
  const before = await readFiles();
  const legacy = before['style-legacy'];
  expect(legacy).toBeDefined();
  const sourceGeometry = (
    before['style-board'].cells['style-source'] as NodeCell
  ).geometry;
  const saved = async (styleColor: string | undefined, theme?: string) => {
    await expect
      .poll(async () => {
        const files = await readFiles();
        const board = files['style-board'];
        return [
          (board.cells['style-source'] as NodeCell).appearance?.styleColor,
          theme ? board.frame.view?.theme?.themeColorMode : undefined,
        ];
      })
      .toEqual([styleColor, theme]);
    const files = await readFiles();
    expect(files['style-legacy']).toEqual(legacy);
    expect(
      (files['style-board'].cells['style-source'] as NodeCell).geometry,
    ).toEqual(sourceGeometry);
    await expect(
      page.getByText('Ungroup first to move part of a group', { exact: true }),
    ).toHaveCount(0);
  };
  await selectNode(source);
  await family().click();
  await saved('series-5');
  await selectHistoryAction(page, '撤销');
  await saved(undefined);
  await selectHistoryAction(page, '重做');
  await saved('series-5');
  await selectNode(source);
  await styles().getByRole('button', { name: '自动', exact: true }).click();
  await saved(undefined);
  await selectNode(source);
  await family().click();
  await saved('series-5');
  for (const theme of ['default', 'soft', 'retro', 'dark', 'colorful'])
    for (const appearance of ['light', 'dark'] as const) {
      await canvas.press('Escape');
      await selectPropertyValue(
        pane.getByLabel('Theme', { exact: true }),
        theme,
      );
      const settings = await openSettings(page);
      await selectSetting(
        settings.getByTestId('settings-appearance'),
        appearance,
      );
      await page.getByTestId('my-back').click();
      await expect(canvas).toHaveAttribute('data-board-appearance', appearance);
      const tone = await roleTone(page, theme, appearance, 4);
      await expect(source).toHaveAttribute('fill', tone.fill);
      await expect(stroke).toHaveAttribute('stroke', tone.strokeColor);
      await selectNode(source);
      await expect(family()).toHaveAttribute('aria-pressed', 'true');
      await saved('series-5', theme);
      await page.mouse.move(0, 0);
      await page.screenshot({
        path: info.outputPath(`style-family-${theme}-${appearance}.png`),
        animations: 'disabled',
      });
    }
  await page.reload();
  await page
    .locator('.file-tree-file[data-file-id="style-board"] .file-tree-main')
    .click();
  await selectNode(source);
  await expect(family()).toHaveAttribute('aria-pressed', 'true');
  await expect(source).toHaveAttribute(
    'fill',
    (await roleTone(page, 'colorful', 'dark', 4)).fill,
  );
  await saved('series-5', 'colorful');
  await styles().getByRole('button', { name: '自动', exact: true }).click();
  await expect(source).toHaveAttribute(
    'fill',
    (await roleTone(page, 'colorful', 'dark', 0)).fill,
  );
  await saved(undefined, 'colorful');

  await selectNode(source);
  await pane
    .getByLabel('填充', { exact: true })
    .evaluate((input: HTMLInputElement) => {
      input.value = '#ffffff';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  await family().click();
  await saved('series-5');
  await canvas.press('Escape');
  await selectPropertyValue(pane.getByLabel('Theme', { exact: true }), 'retro');
  await expect(source).toHaveAttribute('fill', '#ffffff');
  await saved('series-5', 'retro');
  await selectNode(source);
  await pane.getByLabel('Reset fill to theme', { exact: true }).click();
  await expect(source).toHaveAttribute(
    'fill',
    (await roleTone(page, 'retro', 'dark', 4)).fill,
  );
  await saved('series-5', 'retro');
  expect(errors).toEqual([]);
}
