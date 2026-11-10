import { expect, test } from './service-fixture';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Exercise the actual product components without depending on workspace file navigation.
for (const width of [540, 800, 1440]) {
  test(`canvas and document share action order, with inline canvas find (${width}px)`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const root = path.resolve(__dirname, '../../..');
    const file = JSON.parse(
      readFileSync(
        path.join(root, 'tests/fixtures/ai-canvas/whiteboard-basic.verd.json'),
        'utf8',
      ),
    );
    const initial = {
      store: {
        rootId: file.frame.id,
        cells: { [file.frame.id]: file.frame, ...file.cells },
      },
    };
    await page.addInitScript((value) => {
      (window as unknown as { __verdLayoutValue: unknown }).__verdLayoutValue =
        value;
    }, initial);
    await page.goto('/?harness=top-actions');
    const canvas = page.locator('svg[data-surface="root"]');
    await expect(canvas).toBeVisible();
    const actions = page.getByRole('toolbar', { name: 'App actions' });
    await expect(actions.locator('button')).toHaveCount(3);
    for (const [index, label] of ['查找', '演示', '更多'].entries())
      await expect(actions.locator('button').nth(index)).toHaveAttribute(
        'aria-label',
        label,
      );
    for (const collapsed of [false, true]) {
      if (collapsed) await page.getByTestId('inspector-collapse').click();
      await actions.getByRole('button', { name: '查找', exact: true }).click();
      const search = page.getByRole('search', { name: '查找画布' });
      const input = search.getByRole('textbox', { name: '查找', exact: true });
      const close = actions.getByRole('button', { name: '关闭查找' });
      await expect(input).toBeFocused();
      await expect(actions.getByRole('search')).toHaveCount(1);
      await expect(
        actions.getByRole('button', { name: '查找', exact: true }),
      ).toHaveCount(0);
      await expect(close).toHaveCount(1);
      await expect(close).toBeVisible();
      const [field, button, row, area] = await Promise.all([
        input.boundingBox(),
        close.boundingBox(),
        actions.boundingBox(),
        canvas.boundingBox(),
      ]);
      expect(field!.x).toBeGreaterThanOrEqual(row!.x);
      expect(field!.x + field!.width).toBeLessThanOrEqual(row!.x + row!.width);
      expect(button!.x + button!.width).toBeLessThanOrEqual(
        row!.x + row!.width,
      );
      expect(button!.y + button!.height).toBeLessThanOrEqual(
        row!.y + row!.height,
      );
      expect(
        await search.evaluate(
          (element) => getComputedStyle(element).borderTopWidth,
        ),
      ).toBe('0px');
      expect(field!.x).toBeGreaterThanOrEqual(area!.x);
      expect(row!.x + row!.width).toBeLessThanOrEqual(area!.x + area!.width);
      if (width >= 800)
        expect(field!.y + field!.height / 2).toBeCloseTo(
          button!.y + button!.height / 2,
          0,
        );
      if (collapsed) {
        const expand = await page
          .locator('.frame-inspector-reopen')
          .boundingBox();
        expect(row!.x + row!.width + 8).toBeLessThanOrEqual(expand!.x);
      }
      await input.fill('提交请求');
      await expect(search).toContainText('1/1');
      await page.screenshot({
        path: info.outputPath(
          `canvas-find-${collapsed ? 'collapsed' : 'expanded'}.png`,
        ),
      });
      if (collapsed) await input.press('Escape');
      else await close.click();
      await expect(search).toHaveCount(0);
      await expect(canvas).toBeFocused();
      await expect(
        actions.getByRole('button', { name: '查找', exact: true }),
      ).toBeVisible();
    }
    await page.evaluate(() =>
      (
        window as Window & { __showLayoutDocument(): void }
      ).__showLayoutDocument(),
    );
    const documentActions = page.locator('.doc-toolbar__actions');
    await expect(documentActions.locator('button')).toHaveCount(3);
    for (const [index, label] of ['查找', '演示', '文档'].entries())
      await expect(
        documentActions.locator('button').nth(index),
      ).toHaveAttribute('aria-label', label);
    const menu = await documentActions.locator('button').last().boundingBox();
    expect(menu!.x + menu!.width).toBeCloseTo(width - 8, 0);
    await page.screenshot({ path: info.outputPath('document-actions.png') });
    await documentActions
      .getByRole('button', { name: '查找', exact: true })
      .click();
    await expect(
      documentActions.getByRole('button', { name: '查找', exact: true }),
    ).toHaveCount(0);
    await expect(
      documentActions.getByRole('button', { name: '关闭查找' }),
    ).toHaveCount(1);
    const documentInput = documentActions.getByRole('textbox', {
      name: '查找',
      exact: true,
    });
    await expect(documentInput).toBeFocused();
    await documentInput.fill('Body');
    await expect(documentActions.getByRole('search')).toContainText('1/1');
    await documentInput.press('Escape');
    await expect(documentActions.getByRole('search')).toHaveCount(0);
    await expect(page.locator('.tiptap')).toBeFocused();
  });
}
