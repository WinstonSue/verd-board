import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Exercise the actual product components without depending on workspace file navigation.
for (const width of [800, 1440]) {
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
    await page.route('**/app/app.tsx*', async (route) => {
      const response = await route.fetch();
      const source = await response.text();
      const reactUrl = source.match(
        /from\s+["']([^"']*\/react\.js[^"']*)["']/,
      )?.[1];
      if (!reactUrl) throw new Error('Unable to resolve the app React runtime');
      await route.fulfill({
        response,
        contentType: 'text/javascript',
        body: `
        import React from ${JSON.stringify(reactUrl)};
        import { VerdFrame, DocumentPage, I18nProvider } from ${JSON.stringify('/@fs' + path.join(root, 'packages/product/ui/src/index.ts'))};
        const { createElement, useState } = React;
        export default function App() {
          const [value, setValue] = useState(${JSON.stringify(initial)});
          const [document, setDocument] = useState({ id: 'layout-doc', schemaVersion: 1, kind: 'block', plainText: 'Body', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body' }] }] } });
          const [surface, setSurface] = useState('canvas');
          window.__showLayoutDocument = () => setSurface('document');
          return createElement(I18nProvider, { language: 'zh', persistLanguage: false }, createElement('div', { style: { height: '100vh', width: '100%' } },
            surface === 'canvas' ? createElement(VerdFrame, { value, frameId: ${JSON.stringify(file.frame.id)}, showSaveStatus: false, onChange: change => setValue(change.snapshot), onOpenFrame: () => {} }) :
            createElement(DocumentPage, { value: document, title: 'Layout document', showSaveStatus: false, onChange: change => setDocument(change.value), onPresent: async () => ({ status: 'completed' }) })
          ));
        }
      `,
      });
    });
    await page.goto('/');
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
      await expect(input).toBeFocused();
      const [field, button, row, area] = await Promise.all([
        input.boundingBox(),
        actions
          .getByRole('button', { name: '查找', exact: true })
          .boundingBox(),
        actions.boundingBox(),
        canvas.boundingBox(),
      ]);
      expect(field!.x + field!.width).toBeLessThan(row!.x);
      expect(field!.y + field!.height / 2).toBeCloseTo(
        button!.y + button!.height / 2,
        0,
      );
      expect((await search.boundingBox())!.height).toBeCloseTo(row!.height, 0);
      expect(field!.x).toBeGreaterThanOrEqual(area!.x);
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
      await input.press('Escape');
      await expect(search).toHaveCount(0);
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
  });
}
