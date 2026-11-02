import { roleTone } from './theme-role-values';
import { readable } from './text-color-checks';
import { persistedWorkspace } from './workspace-nav';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  openAppMenu,
  openActiveFile,
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
              marks: [
                {
                  type: 'textStyle',
                  attrs: { color: '#b91c1c', colorSource: 'custom' },
                },
              ],
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
const shapes = [false, true].map((custom, i) => ({
  id: custom ? 'custom-shape' : 'legacy-shape',
  kind: 'geometry',
  cellType: 'node',
  geometry: {
    x: 60 + i * 300,
    y: 480,
    width: 220,
    height: 70,
    outline: 'rectangle',
  },
  appearance: {
    fill: '#fff',
    strokeColor: '#64748b',
    ...(custom
      ? { colorSources: { fill: 'custom', strokeColor: 'custom' } }
      : {}),
  },
  content: { label: custom ? 'Custom white' : 'Theme colors' },
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
    children: [...cards, ...shapes].map((card) => card.id),
    groups: [],
  },
  cells: Object.fromEntries(
    [...cards, ...shapes].map((card) => [card.id, card]),
  ),
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
async function exportedSvg(
  page: Page,
  mode?: 'current' | 'light' | 'dark',
  background?: string,
) {
  await selectAppAction(page, '图像导出');
  const dialog = page.getByRole('dialog', { name: '图像导出', exact: true });
  await dialog.getByLabel('Image format').selectOption('svg');
  if (mode) await dialog.getByLabel('Image appearance').selectOption(mode);
  if (background)
    await dialog.getByLabel('Image background').selectOption(background);
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
  await openActiveFile(page);
  for (const [language, width] of [
    ['zh', 1440],
    ['en', 390],
  ] as const) {
    await page.setViewportSize({ width, height: 900 });
    await openSettings(page);
    await page.getByTestId('settings-nav-personal.general').click();
    await page.getByTestId('settings-language').selectOption(language);
    await expect(page.getByTestId('settings-appearance')).toBeInViewport();
    expect((await colors(page.getByTestId('my-page'))).background).toBe(
      'rgb(30, 30, 30)',
    );
    expect(
      (await colors(page.getByTestId('settings-appearance'))).background,
    ).toBe('rgb(24, 24, 24)');
    await page.screenshot({
      path: testInfo.outputPath(`dark-settings-${language}.png`),
    });
    await page.getByTestId('my-back').click();
    const tabs = page.locator('ylib-tabs');
    await expect(tabs.locator('.tab[data-active] .tab-title')).toHaveCSS(
      'color',
      'rgb(230, 230, 230)',
    );
    const groups = tabs.getByLabel(
      language === 'zh' ? '选择分组' : 'Select group',
      { exact: true },
    );
    await page.mouse.move(width - 10, 890);
    await expect(groups).toHaveCSS('background-color', 'rgb(30, 30, 30)');
    await groups.click();
    expect((await colors(tabs.locator('.group-dropdown'))).background).toBe(
      'rgb(30, 30, 30)',
    );
    await groups.click();
    const menu = await openAppMenu(page);
    expect((await colors(menu)).background).toBe('rgb(30, 30, 30)');
    await page.keyboard.press('Escape');
  }
  await selectAppAction(page, 'Keyboard shortcuts');
  expect((await colors(page.getByRole('dialog'))).background).toBe(
    'rgb(30, 30, 30)',
  );
  expect(
    await page
      .getByRole('dialog')
      .evaluate(
        (element) => getComputedStyle(element, '::backdrop').backgroundColor,
      ),
  ).toBe('rgba(0, 0, 0, 0.6)');
  await page.keyboard.press('Escape');
  await page.goto('/?readonly=1');
  await page.locator('.workspace-sidebar-footer button').click();
  await page.getByTestId('settings-nav-personal.general').click();
  await page.getByTestId('settings-appearance').selectOption('light');
  await expect(page.locator('html')).toHaveAttribute(
    'data-verd-appearance',
    'light',
  );
});

test('canvas and embedded documents adapt without changing authored colors, camera or content writes', async ({
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
  const embedded = card.locator('[data-document-editing]');
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
  expect((await colors(embedded)).color).not.toEqual(original.color);
  expect((await colors(reader)).background).not.toEqual(reading.background);
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
    'Current appearance exports must adapt their theme colors',
  ).toBe(false);
  expect(await exportedSvg(page, 'light')).toBe(exported);
  expect(await exportedSvg(page, 'dark')).toBe(darkExport);
  await expect(
    active(page).locator('[data-cell-id="custom-shape"]'),
  ).toHaveAttribute('fill', '#fff');
  await expect(
    active(page).locator('[data-cell-id="legacy-shape"]'),
  ).toHaveAttribute('fill', (await roleTone(page, 'default', 'dark')).fill);
  expect(await writes()).toBe(count);
  await page.screenshot({
    path: testInfo.outputPath('dark-interface-original-canvas.png'),
  });
  await page
    .locator('.file-tree-name')
    .filter({ hasText: /^Appearance document$/ })
    .click();
  const document = active(page).locator('.document-page');
  expect((await colors(document)).background).toBe('rgb(30, 30, 30)');
  expect(
    (
      await colors(
        document.getByText('Appearance body', { exact: true }).first(),
      )
    ).color,
  ).toBe('rgb(230, 230, 230)');
  expect((await colors(document.locator('pre').first())).background).toBe(
    'rgb(24, 24, 24)',
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

test('all six neutral themes have light and dark variants, including export overrides', async ({
  page,
}, testInfo) => {
  await seed(page);
  await active(page)
    .getByLabel('Reset canvas background', { exact: true })
    .click();
  const names = ['经典', '缤纷', '柔和', '复古', '清新', '海洋'];
  const ids = ['default', 'colorful', 'soft', 'retro', 'dark', 'starry'];
  const selector = active(page).getByLabel('Theme', { exact: true });
  await expect(selector.locator('option')).toHaveText(names);
  for (const id of ids) {
    await selector.selectOption(id);
    await appearance(page, 'light');
    const light = (await colors(canvas(page))).background;
    await page.screenshot({ path: testInfo.outputPath(`${id}-light.png`) });
    await appearance(page, 'dark');
    expect((await colors(canvas(page))).background).not.toBe(light);
    await page.screenshot({ path: testInfo.outputPath(`${id}-dark.png`) });
  }
  const lightSvg = await exportedSvg(page, 'light', 'theme');
  const darkSvg = await exportedSvg(page, 'dark', 'theme');
  expect(lightSvg).toContain('data-board-appearance="light"');
  expect(darkSvg).toContain('data-board-appearance="dark"');
  expect(lightSvg).toContain('#eff7fb');
  expect(darkSvg).toContain('#0d2537');
  await expect(canvas(page)).toHaveAttribute('data-board-appearance', 'dark');
});

for (const fixture of [
  'mind-map',
  'workflow-process',
  'architecture',
  'uml-class',
  'uml-sequence',
  'whiteboard-advanced',
]) {
  test(`${fixture} adapts its diagram content and preserves its geometry`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    await setAppLanguage(page, 'zh');
    const file = JSON.parse(
      readFileSync(
        path.resolve(
          __dirname,
          `../../fixtures/ai-canvas/${fixture}.verd.json`,
        ),
        'utf8',
      ),
    );
    // Model the unmarked fixed-color marks used by legacy native workspaces.
    const markLegacy = (node: any) => {
      if (node?.type === 'text') {
        node.marks ??= [];
        const style = node.marks.find((mark: any) => mark.type === 'textStyle');
        if (style) style.attrs = { ...style.attrs, color: '#24354b' };
        else
          node.marks.push({ type: 'textStyle', attrs: { color: '#24354b' } });
      }
      node?.content?.forEach(markLegacy);
    };
    for (const cell of Object.values<any>(file.cells)) {
      if (!cell.content?.text && cell.content?.label)
        cell.content.text = {
          schemaVersion: 1,
          id: `${cell.id}-legacy-text`,
          kind: 'inline',
          plainText: cell.content.label,
          content: { type: 'doc', content: [paragraph(cell.content.label)] },
        };
      if (cell.content?.text) markLegacy(cell.content.text.content);
      cell.labels?.forEach((label: any, at: number) => {
        label.richText ??= {
          schemaVersion: 1,
          id: `${cell.id}-label-${at}`,
          kind: 'inline',
          plainText: label.text,
          content: { type: 'doc', content: [paragraph(label.text)] },
        };
        markLegacy(label.richText.content);
      });
      Object.values<any>(cell.data?.cells ?? {}).forEach((entry) => {
        if (entry.text) markLegacy(entry.text.content);
      });
    }
    file.frame.name = `Appearance ${fixture}`;
    file.frame.view = {
      ...file.frame.view,
      theme: { themeColorMode: 'retro', backgroundMode: 'theme' },
    };
    await page
      .locator('input[accept=".json,.verd.json,.verd-doc.json,.md,.markdown"]')
      .setInputFiles({
        name: `${fixture}.verd.json`,
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(file)),
      });
    await page
      .locator('.file-tree-name')
      .filter({ hasText: new RegExp(`^Appearance ${fixture}$`) })
      .click();
    const target = canvas(page);
    await expect
      .poll(() => target.locator('[data-cell-id]:visible').count())
      .toBeGreaterThan(0);
    await readable(target);
    const world = target.locator('> [data-frame-world]');
    const camera = await world.getAttribute('transform');
    const count = await target.locator('[data-cell-id]').count();
    const text = await target.textContent();
    const light = await target
      .locator('[data-cell-kind]')
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const outline =
            node.querySelector('[data-frame-node-outline]') ?? node;
          return [
            getComputedStyle(outline).fill,
            getComputedStyle(outline).stroke,
          ];
        }),
      );
    await appearance(page, 'dark');
    await expect(target).toHaveAttribute('data-board-appearance', 'dark');
    await expect(target.locator('[data-cell-id]')).toHaveCount(count);
    await expect(target).toHaveText(text ?? '');
    await expect(world).toHaveAttribute('transform', camera!);
    const dark = await target.locator('[data-cell-kind]').evaluateAll((nodes) =>
      nodes.map((node) => {
        const outline = node.querySelector('[data-frame-node-outline]') ?? node;
        return [
          getComputedStyle(outline).fill,
          getComputedStyle(outline).stroke,
        ];
      }),
    );
    expect(dark).not.toEqual(light);
    await readable(target);
    // Assert concrete painted parts: a single changed wrapper must not hide a
    // class box, lifeline, fragment or domain node that still uses old colors.
    const roleParts = target.locator(
      '[data-uml-class] > rect, [data-uml-lifeline] > rect, [data-uml-lifeline] circle, [data-cell-kind="workflow-task"], [data-cell-kind="workflow-decision"], [data-cell-kind="architecture-module"]',
    );
    const painted = await roleParts.evaluateAll((parts) =>
      parts.map((part) => ({
        fill: getComputedStyle(part).fill,
        stroke: getComputedStyle(part).stroke,
      })),
    );
    for (const part of painted) {
      expect(part.fill).not.toBe('rgb(55, 49, 40)');
      expect(part.stroke).not.toBe('rgb(186, 166, 129)');
    }
    if (
      [
        'workflow-process',
        'architecture',
        'uml-class',
        'uml-sequence',
      ].includes(fixture)
    ) {
      expect(painted.length).toBeGreaterThan(0);
      expect(new Set(painted.map((part) => part.stroke)).size).toBeGreaterThan(
        1,
      );
    }
    for (const theme of [
      'default',
      'colorful',
      'soft',
      'retro',
      'dark',
      'starry',
    ]) {
      await target.press('Escape');
      await active(page)
        .getByLabel('Theme', { exact: true })
        .selectOption(theme);
      for (const mode of ['light', 'dark']) {
        await appearance(page, mode);
        await readable(target);
        await expect(world).toHaveAttribute('transform', camera!);
      }
    }
    await page.screenshot({ path: testInfo.outputPath(`${fixture}-dark.png`) });
  });
}

test('raster exports honor explicit light and dark appearances for PNG and JPEG', async ({
  page,
}) => {
  await seed(page);
  await active(page)
    .getByLabel('Theme', { exact: true })
    .selectOption('starry');
  for (const format of ['png', 'jpeg'])
    for (const mode of ['light', 'dark']) {
      await selectAppAction(page, '图像导出');
      const dialog = page.getByRole('dialog', {
        name: '图像导出',
        exact: true,
      });
      await dialog.getByLabel('Image format').selectOption(format);
      await dialog.getByLabel('Image scale').selectOption('1');
      await dialog.getByLabel('Image appearance').selectOption(mode);
      await dialog.getByLabel('Image background').selectOption('theme');
      const downloaded = page.waitForEvent('download');
      await dialog.getByTestId('image-export-button').click();
      const stream = await (await downloaded).createReadStream(),
        chunks: Buffer[] = [];
      for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
      const data = Buffer.concat(chunks).toString('base64');
      const pixel = await page.evaluate(
        async ({ data, format }) => {
          const image = new Image();
          image.src = `data:image/${format};base64,${data}`;
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = image.width;
          canvas.height = image.height;
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(image, 0, 0);
          return Array.from(ctx.getImageData(0, 0, 1, 1).data);
        },
        { data, format },
      );
      const expected = mode === 'light' ? [239, 247, 251] : [13, 37, 55];
      for (let i = 0; i < 3; i++)
        expect(Math.abs(pixel[i] - expected[i])).toBeLessThanOrEqual(
          format === 'jpeg' ? 3 : 0,
        );
      expect(pixel[3]).toBe(255);
    }
});

test('manual default-colored overrides persist and can be reset independently to theme colors', async ({
  page,
}) => {
  await seed(page);
  await appearance(page, 'dark');
  const shape = active(page).locator('[data-cell-id="legacy-shape"]');
  await shape.click();
  await active(page).getByLabel('填充', { exact: true }).fill('#ffffff');
  await expect(shape).toHaveAttribute('fill', '#ffffff');
  await expect
    .poll(async () => {
      const workspace = await persistedWorkspace(page);
      const file = Object.values(workspace?.records ?? {}).find(
        (record) => record.frame.id === 'appearance-board',
      );
      return file?.cells['legacy-shape']?.appearance?.colorSources?.fill;
    })
    .toBe('custom');
  await page.reload();
  await expect(shape).toHaveAttribute('fill', '#ffffff');
  await appearance(page, 'light');
  await appearance(page, 'dark');
  await expect(shape).toHaveAttribute('fill', '#ffffff');
  await shape.click();
  await active(page).getByLabel('Reset fill to theme', { exact: true }).click();
  await expect(shape).toHaveAttribute(
    'fill',
    (await roleTone(page, 'default', 'dark')).fill,
  );
  await expect(
    active(page).locator('[data-cell-id="custom-shape"]'),
  ).toHaveAttribute('fill', '#fff');
});

test('repeated references retain the source theme through static preview, inline editing and export', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await setAppLanguage(page, 'zh');
  const targetId = 'appearance-theme-target',
    parentId = 'appearance-theme-parent';
  const refs = [0, 1].map((i) => ({
    id: `theme-ref-${i}`,
    kind: 'frame-reference',
    cellType: 'node',
    geometry: { x: 30 + i * 440, y: 30, width: 400, height: 300 },
    data: { targetFrameId: targetId },
  }));
  const frame = (
    id: string,
    name: string,
    themeColorMode: string,
    children: string[],
  ) => ({
    id,
    kind: 'frame',
    cellType: 'frame',
    name,
    geometry: { x: 0, y: 0, width: 950, height: 500 },
    children,
    groups: [],
    view: { theme: { themeColorMode, backgroundMode: 'theme' } },
  });
  const files = [
    {
      format: 'verd-frame',
      version: 2,
      frame: frame(
        parentId,
        'Theme parent',
        'default',
        refs.map((ref) => ref.id),
      ),
      cells: Object.fromEntries(refs.map((ref) => [ref.id, ref])),
    },
    {
      format: 'verd-frame',
      version: 2,
      frame: frame(targetId, 'Theme target', 'retro', ['source-shape']),
      cells: {
        'source-shape': {
          id: 'source-shape',
          kind: 'geometry',
          cellType: 'node',
          geometry: {
            x: 20,
            y: 20,
            width: 200,
            height: 100,
            outline: 'rectangle',
          },
          appearance: { fill: '#fff', strokeColor: '#64748b' },
          content: { label: 'Source theme' },
        },
      },
    },
  ];
  await page
    .locator('input[accept=".json,.verd.json,.verd-doc.json,.md,.markdown"]')
    .setInputFiles({
      name: 'themes.verd.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          format: 'verd-canvas-bundle',
          version: 1,
          rootFileId: parentId,
          files,
        }),
      ),
    });
  await page
    .locator('.file-tree-name')
    .filter({ hasText: /^Theme parent$/ })
    .click();
  const first = canvas(page).locator('[data-cell-id="theme-ref-0"]');
  const second = canvas(page).locator('[data-cell-id="theme-ref-1"]');
  for (const ref of [first, second])
    await expect(ref.locator('[data-cell-id="source-shape"]')).toHaveAttribute(
      'fill',
      (await roleTone(page, 'retro', 'light')).fill,
    );
  await page.emulateMedia({ colorScheme: 'dark' });
  for (const ref of [first, second])
    await expect(ref.locator('[data-cell-id="source-shape"]')).toHaveAttribute(
      'fill',
      (await roleTone(page, 'retro', 'dark')).fill,
    );
  await first
    .locator(':scope > [data-frame-contents] > [data-frame-content-plate]')
    .dblclick({ position: { x: 25, y: 90 } });
  const nested = first.locator('svg[data-surface="nested"]');
  await expect(nested).toBeVisible();
  await expect(nested.locator('[data-cell-id="source-shape"]')).toHaveAttribute(
    'fill',
    (await roleTone(page, 'retro', 'dark')).fill,
  );
  const world = nested.locator('> [data-frame-world]');
  const camera = await world.getAttribute('transform');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(nested).toBeVisible();
  await expect(nested.locator('[data-cell-id="source-shape"]')).toHaveAttribute(
    'fill',
    (await roleTone(page, 'retro', 'light')).fill,
  );
  await expect(second.locator('[data-cell-id="source-shape"]')).toHaveAttribute(
    'fill',
    (await roleTone(page, 'retro', 'light')).fill,
  );
  await expect(world).toHaveAttribute('transform', camera!);
  const exported = await exportedSvg(page, 'dark');
  expect(exported).toContain((await roleTone(page, 'retro', 'dark')).fill);
  expect(exported).toContain('#28251f');
});
