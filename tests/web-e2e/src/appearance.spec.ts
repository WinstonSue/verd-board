import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  openAppMenu,
  openSettings,
  selectAppAction,
  setAppLanguage,
} from './app-actions';

const active = (page: Page) => page.locator('.workspace-pane.is-active');
const canvas = (page: Page) =>
  active(page).locator('svg[data-surface="root"]').first();
const paragraph = (text: string) => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
});
const documentFile = {
  format: 'verd-document',
  version: 1,
  id: 'appearance-document',
  title: 'Appearance document',
  text: {
    schemaVersion: 1,
    id: 'appearance-document',
    kind: 'block',
    align: 'left',
    plainText: 'Appearance body',
    content: {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Appearance heading' }],
        },
        paragraph('Appearance body'),
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Authored red',
              marks: [{ type: 'textStyle', attrs: { color: '#b91c1c' } }],
            },
          ],
        },
        {
          type: 'codeBlock',
          content: [{ type: 'text', text: 'const appearance = true;' }],
        },
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                { type: 'tableHeader', content: [paragraph('Header')] },
                { type: 'tableCell', content: [paragraph('Value')] },
              ],
            },
          ],
        },
        {
          type: 'frameReference',
          attrs: { targetFrameId: 'appearance-board' },
        },
      ],
    },
  },
};
const cards = ['document-frame', 'document-reference'].map((kind, i) => ({
  id: `appearance-card-${i}`,
  kind,
  cellType: 'node',
  geometry: { x: 20 + i * 540, y: 20, width: 500, height: 420 },
  data: { targetDocumentId: documentFile.id },
}));
const boardFile = {
  format: 'verd-frame',
  version: 2,
  frame: {
    id: 'appearance-board',
    kind: 'frame',
    cellType: 'frame',
    name: 'Appearance board',
    geometry: { x: 0, y: 0, width: 1100, height: 600 },
    view: {
      theme: {
        themeColorMode: 'default',
        boardBackground: '#f9f8ed',
        gridEnabled: true,
      },
    },
    children: cards.map((card) => card.id),
    groups: [],
  },
  cells: Object.fromEntries(cards.map((card) => [card.id, card])),
};
async function seed(page: Page) {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await setAppLanguage(page, 'zh');
  await page
    .locator('input[accept=".json,.verd.json,.verd-doc.json,.md,.markdown"]')
    .setInputFiles({
      name: 'appearance.verd.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          format: 'verd-canvas-bundle',
          version: 1,
          rootFileId: boardFile.frame.id,
          files: [boardFile, documentFile],
        }),
      ),
    });
  await page
    .locator('.file-tree-name')
    .filter({ hasText: /^Appearance board$/ })
    .click();
  await expect(
    active(page)
      .locator('[data-cell-id="appearance-card-0"]')
      .getByText('Appearance body', { exact: true }),
  ).toBeVisible();
}
async function appearance(page: Page, value: string) {
  // This entry also works while a standalone document is active.
  await page.locator('.workspace-sidebar-footer button').click();
  await page.getByTestId('settings-appearance').selectOption(value);
  await page.getByTestId('my-back').click();
}
const colors = (locator: Locator) =>
  locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      color: style.color,
      border: style.borderTopColor,
      scheme: style.colorScheme,
    };
  });
async function exportedSvg(page: Page) {
  await selectAppAction(page, '图像导出');
  const dialog = page.getByRole('dialog', { name: '图像导出', exact: true });
  await dialog.getByLabel('Image format').selectOption('svg');
  const downloading = page.waitForEvent('download');
  await dialog.getByTestId('image-export-button').click();
  const stream = await (await downloading).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  // Export IDs are deliberately regenerated for every standalone SVG.
  return Buffer.concat(chunks)
    .toString()
    .replace(/export-[0-9a-f-]{36}-/g, 'export-ID-');
}

test('system appearance, manual overrides, reload, and other windows stay synchronized', async ({
  page,
  context,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute(
    'data-verd-appearance',
    'dark',
  );
  await openSettings(page);
  await expect(page.getByTestId('settings-appearance')).toHaveValue('system');
  await page.getByTestId('settings-appearance').selectOption('light');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute(
    'data-verd-appearance',
    'light',
  );
  await page.reload();
  await openSettings(page);
  await expect(page.getByTestId('settings-appearance')).toHaveValue('light');
  const other = await context.newPage();
  await other.goto('/');
  await expect(other.locator('html')).toHaveAttribute(
    'data-verd-appearance',
    'light',
  );
  await page.getByTestId('settings-appearance').selectOption('dark');
  await expect(other.locator('html')).toHaveAttribute(
    'data-verd-appearance',
    'dark',
  );
  await page.getByTestId('settings-appearance').selectOption('system');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute(
    'data-verd-appearance',
    'light',
  );
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute(
    'data-verd-appearance',
    'dark',
  );
  await other.close();
});

test('dark interface covers settings, portaled menus, help, and readonly at wide and narrow sizes', async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  for (const [language, width] of [
    ['zh', 1440],
    ['en', 390],
  ] as const) {
    await page.setViewportSize({ width, height: 900 });
    await openSettings(page);
    await page.getByTestId('settings-language').selectOption(language);
    await expect(page.getByTestId('settings-appearance')).toBeInViewport();
    expect((await colors(page.getByTestId('my-page'))).background).toBe(
      'rgb(15, 23, 42)',
    );
    expect(
      (await colors(page.getByTestId('settings-appearance'))).background,
    ).toBe('rgb(30, 41, 59)');
    await page.screenshot({
      path: testInfo.outputPath(`dark-settings-${language}.png`),
    });
    await page.getByTestId('my-back').click();
    const tabs = page.locator('ylib-tabs');
    await expect(tabs.locator('.tab[data-active] .tab-title')).toHaveCSS(
      'color',
      'rgb(226, 232, 240)',
    );
    const groups = tabs.getByLabel(
      language === 'zh' ? '选择分组' : 'Select group',
      { exact: true },
    );
    expect((await colors(groups)).background).toBe('rgb(30, 41, 59)');
    await groups.click();
    expect((await colors(tabs.locator('.group-dropdown'))).background).toBe(
      'rgb(30, 41, 59)',
    );
    await groups.click();
    const menu = await openAppMenu(page);
    expect((await colors(menu)).background).toBe('rgb(30, 41, 59)');
    await page.keyboard.press('Escape');
  }
  await selectAppAction(page, 'Keyboard shortcuts');
  expect((await colors(page.getByRole('dialog'))).background).toBe(
    'rgb(30, 41, 59)',
  );
  expect(
    await page
      .getByRole('dialog')
      .evaluate(
        (element) => getComputedStyle(element, '::backdrop').backgroundColor,
      ),
  ).toBe('rgba(2, 6, 23, 0.6)');
  await page.keyboard.press('Escape');
  await page.goto('/?readonly=1');
  await page.locator('.workspace-sidebar-footer button').click();
  await page.getByTestId('settings-appearance').selectOption('light');
  await expect(page.locator('html')).toHaveAttribute(
    'data-verd-appearance',
    'light',
  );
});

test('canvas, embedded documents, camera, exported images and content writes are unchanged by appearance', async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    const state = window as typeof window & { appearanceWrites: number };
    state.appearanceWrites = 0;
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
      if (['files', 'trash'].includes(this.name)) state.appearanceWrites++;
      return put.apply(this, args);
    };
  });
  await seed(page);
  // Wait for the imported bundle's debounced content writes to finish.
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const state = window as typeof window & { appearanceWrites: number };
        const before = state.appearanceWrites;
        await new Promise((resolve) => setTimeout(resolve, 500));
        return state.appearanceWrites - before;
      }),
    )
    .toBe(0);
  const writes = () =>
    page.evaluate(
      () =>
        (window as typeof window & { appearanceWrites: number })
          .appearanceWrites,
    );
  const count = await writes();
  const card = active(page)
    .locator('[data-cell-id="appearance-card-0"]')
    .first();
  await card.getByText('Appearance body', { exact: true }).dblclick();
  const embedded = card.locator('.document-page');
  await expect(embedded).toBeVisible();
  const original = await colors(embedded);
  await card.locator('.ProseMirror').press('Escape');
  const world = canvas(page).locator('> [data-frame-world]');
  const camera = await world.getAttribute('transform');
  const reader = active(page)
    .locator(
      '[data-cell-id="appearance-card-1"] [data-document-preview-scroll]',
    )
    .first();
  const reading = await colors(reader);
  const exported = await exportedSvg(page);
  await appearance(page, 'dark');
  await card.getByText('Appearance body', { exact: true }).dblclick();
  await expect(embedded).toBeVisible();
  expect(await colors(embedded)).toEqual(original);
  expect(await colors(reader)).toEqual(reading);
  await expect(world).toHaveAttribute('transform', camera!);
  expect((await colors(canvas(page))).background).toBe('rgb(249, 248, 237)');
  await card.locator('.ProseMirror').press('Escape');
  const darkExport = await exportedSvg(page);
  await testInfo.attach('light-export', {
    body: exported,
    contentType: 'image/svg+xml',
  });
  await testInfo.attach('dark-export', {
    body: darkExport,
    contentType: 'image/svg+xml',
  });
  expect(
    darkExport === exported,
    'SVG image exports must keep the same colors and content',
  ).toBe(true);
  expect(await writes()).toBe(count);
  await page.screenshot({
    path: testInfo.outputPath('dark-interface-original-canvas.png'),
  });
  await page
    .locator('.file-tree-name')
    .filter({ hasText: /^Appearance document$/ })
    .click();
  const document = active(page).locator('.document-page');
  expect((await colors(document)).background).toBe('rgb(30, 41, 59)');
  expect(
    (
      await colors(
        document.getByText('Appearance body', { exact: true }).first(),
      )
    ).color,
  ).toBe('rgb(226, 232, 240)');
  expect((await colors(document.locator('pre').first())).background).toBe(
    'rgb(15, 23, 42)',
  );
  expect(
    (await colors(document.getByText('Authored red', { exact: true }).first()))
      .color,
  ).toBe('rgb(185, 28, 28)');
  expect(
    (await colors(document.locator('svg[data-surface="root"]').first()))
      .background,
  ).toBe('rgb(249, 248, 237)');
  expect(await writes()).toBe(count);
  await page.screenshot({ path: testInfo.outputPath('dark-document.png') });
});
