import { cellBodyPoint } from '../../helpers/port-controls';
import { expect, test, type Page, type Locator } from './service-fixture';
import path from 'node:path';
import { openActiveFile, openAppMenu } from './app-actions';

const active = (page: Page) => page.locator('.workspace-pane.is-active');
const upload = (page: Page) =>
  page.locator(
    'input[accept=".json,.verd,.verd.json,.verd-doc.json,.md,.markdown"]',
  );
async function openDocument(page: Page) {
  const id = 'toolbar-refinement-doc';
  await upload(page).setInputFiles({
    name: 'Toolbar refinement.verd-doc.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        format: 'verd-document',
        version: 1,
        id,
        title: 'Toolbar refinement',
        text: {
          id,
          schemaVersion: 1,
          kind: 'block',
          plainText: 'Preserve selection.',
          content: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Preserve selection.' }],
              },
            ],
          },
        },
      }),
    ),
  });
  await page.locator(`[data-file-id="${id}"] .file-tree-name`).click();
  await expect(active(page).locator('.document-page')).toBeVisible();
}

for (const appearance of ['light', 'dark'] as const) {
  test(`content management restores ordinary pointer focus and visible keyboard focus (${appearance})`, async ({
    page,
  }) => {
    await page.addInitScript(
      (value) => localStorage.setItem('verdboard.appearance', value),
      appearance,
    );
    await page.goto('/');
    await openActiveFile(page);
    await openDocument(page);
    const trigger = active(page).getByRole('button', {
      name: '内容管理',
      exact: true,
    });
    const dialog = page.getByRole('dialog', { name: '内容管理', exact: true });
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).toHaveCSS('outline-style', 'none');
    await expect(trigger).toHaveCSS('box-shadow', 'none');
    await trigger.press('Enter');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveCSS('outline-style', 'solid');
    await expect(trigger).not.toHaveAttribute('data-pointer-focus', 'true');
  });
}

for (const width of [800, 1440]) {
  test(`inspector controls live at the right and retain panel and canvas state (${width}px)`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await upload(page).setInputFiles(
      path.resolve(
        __dirname,
        '../../fixtures/ai-canvas/whiteboard-basic.verd.json',
      ),
    );
    await page
      .locator(
        '[data-file-id="canvas-basic"].file-tree-name, [data-file-id="canvas-basic"] .file-tree-name',
      )
      .click();
    const canvas = active(page).locator(
      'svg[aria-label="Frame canvas"][data-surface="root"]',
    );
    const node = canvas.locator('[data-cell-id="shape-request"]');
    if (width === 800) {
      const box = (await node.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.keyboard.down('Control');
      await page.mouse.wheel(0, -200);
      await page.keyboard.up('Control');
    }
    const point = await cellBodyPoint(node);
    await page.mouse.click(point.x, point.y);
    const inspector = active(page).getByRole('complementary', {
      name: 'Properties',
    });
    const field = inspector.getByTestId('inspector-name');
    const name = await field.inputValue();
    const selected = await inspector.getAttribute('data-selected-cell-id');
    const world = canvas.locator('> [data-frame-world]');
    const camera = await world.getAttribute('transform');
    const toolbar = active(page).getByRole('toolbar', { name: 'App actions' });
    await expect(toolbar.locator('button')).toHaveCount(3);
    await expect(toolbar.locator('button').nth(0)).toHaveAttribute(
      'aria-label',
      '查找',
    );
    await expect(toolbar.locator('button').nth(1)).toHaveAttribute(
      'aria-label',
      '演示',
    );
    await expect(toolbar.locator('button').nth(2)).toHaveAttribute(
      'aria-label',
      '更多',
    );
    const [initialArea, initialToolbar] = await Promise.all([
      canvas.boundingBox(),
      toolbar.boundingBox(),
    ]);
    expect(initialToolbar!.x + initialToolbar!.width).toBeCloseTo(
      initialArea!.x + initialArea!.width - 8,
      0,
    );
    expect(initialToolbar!.y).toBeCloseTo(initialArea!.y + 8, 0);
    await toolbar.getByRole('button', { name: '查找', exact: true }).click();
    const find = active(page).getByRole('search', { name: '查找画布' });
    const input = find.getByRole('textbox', { name: '查找', exact: true });
    await expect(input).toBeFocused();
    const [inputBox, searchButton] = await Promise.all([
      input.boundingBox(),
      toolbar.getByRole('button', { name: '演示', exact: true }).boundingBox(),
    ]);
    if (width === 800) {
      // The narrow canvas wraps the search field above the action buttons.
      expect(inputBox!.y + inputBox!.height).toBeLessThanOrEqual(
        searchButton!.y,
      );
      const bounds = (await canvas.boundingBox())!;
      expect(inputBox!.x).toBeGreaterThanOrEqual(bounds.x);
      expect(inputBox!.x + inputBox!.width).toBeLessThanOrEqual(
        bounds.x + bounds.width,
      );
    } else {
      expect(inputBox!.x + inputBox!.width).toBeLessThan(searchButton!.x);
      expect(inputBox!.y + inputBox!.height / 2).toBeCloseTo(
        searchButton!.y + searchButton!.height / 2,
        0,
      );
    }
    await input.press('Escape');
    await expect(find).toHaveCount(0);
    await field.evaluate((node) =>
      node.setAttribute('data-retained-inspector-field', 'yes'),
    );
    await expect(
      active(page)
        .getByRole('toolbar', { name: 'App actions' })
        .locator('[data-action-id="product.inspector.toggle"]'),
    ).toHaveCount(0);
    await inspector.getByTestId('inspector-collapse').click();
    await expect(inspector).toBeHidden();
    const expand = active(page).getByTestId('inspector-expand');
    await expect(expand).toBeVisible();
    await expect(expand).toBeFocused();
    const [area, button] = await Promise.all([
      canvas.boundingBox(),
      expand.boundingBox(),
    ]);
    expect(area!.x + area!.width).toBeCloseTo(width, 0);
    expect(button!.x).toBeGreaterThan(width - 64);
    expect(button!.y).toBeLessThan(area!.y + 64);
    const [toolbarBox, expandBox] = await Promise.all([
      toolbar.boundingBox(),
      active(page).locator('.frame-inspector-reopen').boundingBox(),
    ]);
    expect(toolbarBox!.x + toolbarBox!.width + 8).toBeLessThanOrEqual(
      expandBox!.x,
    );
    const menu = await openAppMenu(page);
    await expect(menu).toBeInViewport({ ratio: 1 });
    await page.keyboard.press('Escape');
    await expect(world).toHaveAttribute('transform', camera!);
    await page.screenshot({ path: info.outputPath('inspector-collapsed.png') });
    await expand.press('Enter');
    await expect(inspector).toBeVisible();
    await expect(inspector.getByTestId('inspector-collapse')).toBeFocused();
    await expect(inspector).toHaveAttribute('data-selected-cell-id', selected!);
    await expect(field).toHaveValue(name);
    await expect(field).toHaveAttribute('data-retained-inspector-field', 'yes');
    await expect(world).toHaveAttribute('transform', camera!);
    await page.screenshot({ path: info.outputPath('inspector-expanded.png') });
  });
}

const menuStyle = (menu: Locator) =>
  menu.evaluate((element) => {
    const panel = getComputedStyle(element);
    const row = getComputedStyle(element.querySelector('button')!);
    return {
      width: panel.width,
      radius: panel.borderRadius,
      border: panel.borderTopWidth,
      padding: panel.padding,
      shadow: panel.boxShadow,
      rowHeight: row.minHeight,
      rowPadding: row.padding,
      rowGap: row.gap,
      rowRadius: row.borderRadius,
    };
  });
for (const appearance of ['light', 'dark'] as const) {
  test(`document menu matches canvas chrome and keeps insertion and shortcuts (${appearance})`, async ({
    page,
  }, info) => {
    await page.addInitScript(
      (value) => localStorage.setItem('verdboard.appearance', value),
      appearance,
    );
    await page.setViewportSize({ width: 900, height: 800 });
    await page.goto('/');
    await openActiveFile(page);
    const canvasMenu = await openAppMenu(page);
    const expected = await menuStyle(canvasMenu);
    await page.keyboard.press('Escape');
    await openDocument(page);
    const trigger = active(page)
      .getByRole('toolbar', { name: 'document', exact: true })
      .getByRole('button', { name: '文档', exact: true });
    await trigger.click();
    const menu = page.getByRole('dialog', { name: '文档', exact: true });
    expect(await menuStyle(menu)).toEqual(expected);
    await expect(
      menu.locator('[data-action-id="document.undo"] svg'),
    ).toHaveCount(1);
    await expect(
      menu.locator('[data-action-id="document.undo"] kbd'),
    ).not.toBeEmpty();
    await expect(
      menu.locator('[data-action-id="document.command-palette"]'),
    ).toHaveAttribute('data-group-start', '');
    await expect(
      menu.locator('[data-action-id="document.command-palette"] kbd'),
    ).not.toBeEmpty();
    await expect(
      menu.locator('[data-action-id="document.export-json"]'),
    ).toHaveAttribute('data-group-start', '');
    const insert = menu.getByRole('button', { name: '插入', exact: true });
    await expect(insert).toBeFocused();
    await expect(insert).toHaveCSS('outline-style', 'none');
    await page.screenshot({ path: info.outputPath('document-menu.png') });
    await insert.press('ArrowRight');
    const submenu = page.getByRole('dialog', { name: '插入', exact: true });
    await expect(
      submenu.getByRole('button', { name: '图片', exact: true }).locator('svg'),
    ).toHaveCount(1);
    await page.setViewportSize({ width: 640, height: 800 });
    await expect(menu).toBeInViewport({ ratio: 1 });
    await expect(submenu).toBeInViewport({ ratio: 1 });
    await page.keyboard.press('Escape');
    await expect(submenu).toHaveCount(0);
    await expect(insert).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
  });
}
