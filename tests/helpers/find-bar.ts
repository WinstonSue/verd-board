import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const documentFile = {
  format: 'verd-document',
  version: 1,
  id: 'unified-find-doc',
  title: 'Unified find document',
  text: {
    schemaVersion: 1,
    id: 'unified-find-doc',
    kind: 'block',
    plainText: 'cat sat cat\nCAT',
    content: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'cat sat cat' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'CAT' }] },
      ],
    },
  },
};

/** The same user interactions run in isolated Web and real Desktop sessions. */
export async function exerciseFindBars(
  page: Page,
  outputPath: (name: string) => string,
  appearance: 'light' | 'dark',
  url = '/',
) {
  await page.addInitScript(
    (value) => localStorage.setItem('verdboard.appearance', value),
    appearance,
  );
  await page.goto(url);
  const canvasFile = JSON.parse(
    readFileSync(
      path.resolve(__dirname, '../fixtures/ai-canvas/mind-map.verd.json'),
      'utf8',
    ),
  );
  await page
    .locator(
      'input[accept=".json,.verd,.verd.json,.verd-doc.json,.md,.markdown"]',
    )
    .setInputFiles({
      name: 'unified-find.verd',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          format: 'verd-canvas-bundle',
          version: 1,
          rootFileId: canvasFile.frame.id,
          files: [canvasFile, documentFile],
        }),
      ),
    });
  const pane = page.locator('.workspace-pane.is-active');
  const openFile = async (title: string, width: number) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const expand = page.getByRole('button', {
      name: /^(展开侧栏|Expand sidebar)$/,
    });
    if (await expand.isVisible()) await expand.click();
    await page.locator('.file-tree-name').filter({ hasText: title }).click();
    await expect(
      page.getByTestId('workspace-navigation-progress'),
    ).not.toHaveClass(/is-pending/);
    await page.setViewportSize({ width, height: 900 });
    if (width === 390) {
      const collapse = page.getByRole('button', {
        name: /^(收起侧栏|Collapse sidebar)$/,
      });
      if (await collapse.isVisible()) await collapse.click();
    }
  };
  for (const width of [1440, 390]) {
    await openFile(canvasFile.frame.name, width);
    const canvas = pane.locator(
      'svg[aria-label="Frame canvas"][data-surface="root"]',
    );
    await canvas.focus();
    await expect(canvas).toBeFocused();
    await page.keyboard.press('ControlOrMeta+f');
    const search = pane.getByRole('search', { name: '查找画布' });
    const input = search.getByRole('textbox', { name: '查找', exact: true });
    await input.fill('十月内测');
    await expect(search.getByRole('status')).toHaveText('1/1');
    await expect(input).toBeFocused();
    await expect(canvas.locator('[data-cell-id="leaf-beta"]')).toBeVisible();
    const caseToggle = search.getByRole('button', {
      name: '区分大小写',
      exact: true,
    });
    if ((await caseToggle.getAttribute('aria-pressed')) !== 'true')
      await caseToggle.click();
    await search.getByRole('button', { name: '关闭查找', exact: true }).click();
    await expect(canvas.locator('[data-cell-id="leaf-beta"]')).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+f');
    await expect(input).toHaveValue('十月内测');
    await expect(input).toBeFocused();
    await expect(
      search.getByRole('button', { name: '区分大小写' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await input.fill('无匹配');
    await expect(search.getByRole('status')).toHaveText('0/0');
    await expect(
      search.getByRole('button', { name: '下一个', exact: true }),
    ).toBeDisabled();
    await expect(search).toBeInViewport({ ratio: 1 });
    await page.mouse.move(0, 0);
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await page.screenshot({
      path: outputPath(`find-canvas-${appearance}-${width}.png`),
      animations: 'disabled',
    });
    expect(
      await search.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await input.press('Escape');
    await expect(search).toHaveCount(0);
    await expect(canvas).toBeFocused();

    await openFile(documentFile.title, width);
    await pane
      .getByRole('toolbar', { name: 'document', exact: true })
      .getByRole('button', { name: '查找', exact: true })
      .click();
    const find = pane.getByRole('search', { name: '查找文档' });
    const query = find.getByRole('textbox', { name: '查找', exact: true });
    await query.fill('cat');
    await expect(query).toBeFocused();
    await expect(find.getByRole('status')).toHaveText('1/3');
    await expect(pane.locator('[data-document-search-match]')).toHaveText(
      'cat',
    );
    await query.press('Enter');
    await expect(find.getByRole('status')).toHaveText('2/3');
    await query.press('Shift+Enter');
    await expect(find.getByRole('status')).toHaveText('1/3');
    await find.getByRole('button', { name: '区分大小写' }).click();
    await expect(find.getByRole('status')).toHaveText('1/2');
    await find.getByRole('button', { name: '区分大小写' }).click();
    await find.getByRole('button', { name: '替换', exact: true }).click();
    const replacement = find.getByRole('textbox', {
      name: '替换为…',
      exact: true,
    });
    await replacement.fill('dog');
    const queryBounds = (await query.boundingBox())!,
      replacementBounds = (await replacement.boundingBox())!;
    expect(replacementBounds.y).toBeGreaterThanOrEqual(
      queryBounds.y + queryBounds.height,
    );
    await expect
      .poll(async () => {
        const matchBounds = await pane
          .locator('[data-document-search-match]')
          .boundingBox();
        const panelBounds = await find
          .locator('.find-bar__replacement')
          .boundingBox();
        return (
          !!matchBounds &&
          !!panelBounds &&
          matchBounds.y >= panelBounds.y + panelBounds.height
        );
      })
      .toBe(true);
    await expect(find).toBeInViewport({ ratio: 1 });
    expect(
      await find.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await page.mouse.move(0, 0);
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await page.screenshot({
      path: outputPath(`find-document-${appearance}-${width}.png`),
      animations: 'disabled',
    });
    if (width === 1440) {
      await find.getByRole('button', { name: '替换当前', exact: true }).click();
      await expect(find.getByRole('status')).toHaveText('1/2');
      await expect(
        find.getByRole('button', { name: '全部替换', exact: true }),
      ).toBeEnabled();
      await find.getByRole('button', { name: '全部替换', exact: true }).click();
      await expect(find.getByRole('status')).toHaveText('0/0');
      await expect(pane.locator('.tiptap')).toContainText('dog sat dog');
      await expect(
        find.getByRole('button', { name: '替换', exact: true }),
      ).toBeEnabled();
      await query.press('Escape');
      await expect(pane.locator('.tiptap')).toBeFocused();
      await expect(pane.locator('[data-document-search-match]')).toHaveCount(0);
      await page.keyboard.press('ControlOrMeta+z');
      await expect(pane.locator('.tiptap')).toContainText('CAT');
      await page.keyboard.press('ControlOrMeta+f');
      await expect(query).toHaveValue('cat');
      await expect(find.getByRole('status')).toHaveText('1/2');
      await query.press('Escape');
      await expect(pane.locator('.tiptap')).toBeFocused();
      await page.keyboard.press('ControlOrMeta+z');
      await expect(pane.locator('.tiptap')).toContainText('cat sat cat');
    } else {
      await query.press('Escape');
      await expect(find).toHaveCount(0);
      await expect(pane.locator('.tiptap')).toBeFocused();
      await page.keyboard.press('ControlOrMeta+f');
      await expect(query).toHaveValue('cat');
      await expect(query).toBeFocused();
      await query.press('Escape');
    }
  }
}
