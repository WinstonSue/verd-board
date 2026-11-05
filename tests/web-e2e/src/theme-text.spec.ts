import { selectSetting } from '../../helpers/settings-controls';
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { setAppLanguage, selectAppAction } from './app-actions';
import { persistedWorkspace } from './workspace-nav';
import { readable, textColorSamples } from './text-color-checks';

test.use({ actionTimeout: 10_000 });

const pane = (page: Page) => page.locator('.workspace-pane.is-active');
async function appearance(page: Page, value: 'light' | 'dark') {
  await page.locator('.workspace-sidebar-footer button').click();
  await selectSetting(page.getByTestId('settings-appearance'), value);
  await page.getByTestId('my-back').click();
}
async function seed(page: Page, embedded = false) {
  await page.addInitScript(() => {
    const observed = window as unknown as { themeContentWrites: number };
    observed.themeContentWrites = 0;
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, ...args) {
      if (
        this.name === 'files' &&
        value?.kind === 'file' &&
        /\.verd(?:-doc)?\.json$/.test(value.path)
      )
        observed.themeContentWrites++;
      return put.call(this, value, ...args);
    };
  });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await setAppLanguage(page, 'zh');
  const files = [
    'theme-text-sources.verd.json',
    'theme-text-sources.verd-doc.json',
  ].map((name) =>
    JSON.parse(
      readFileSync(
        path.resolve(__dirname, '../../fixtures/diagrams', name),
        'utf8',
      ),
    ),
  );
  if (embedded)
    files.push({
      format: 'verd-frame',
      version: 2,
      frame: {
        id: 'theme-text-host',
        kind: 'frame',
        cellType: 'frame',
        name: 'Theme text host',
        geometry: { x: 0, y: 0, width: 600, height: 500 },
        children: ['text-document-frame'],
        groups: [],
      },
      cells: {
        'text-document-frame': {
          id: 'text-document-frame',
          kind: 'document-frame',
          cellType: 'node',
          geometry: { x: 40, y: 40, width: 500, height: 400 },
          data: { targetDocumentId: 'theme-text-document' },
        },
      },
    });
  await page
    .locator('input[accept=".json,.verd.json,.verd-doc.json,.md,.markdown"]')
    .setInputFiles({
      name: 'theme-text.verd.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          format: 'verd-canvas-bundle',
          version: 1,
          rootFileId: embedded ? 'theme-text-host' : 'theme-text-board',
          files,
        }),
      ),
    });
  await page
    .locator('.file-tree-name')
    .filter({
      hasText: embedded ? /^Theme text host$/ : /^Theme text sources$/,
    })
    .click();
  await expect(
    pane(page).getByText(embedded ? 'Legacy document body' : 'Legacy task', {
      exact: true,
    }),
  ).toBeVisible();
  await expect
    .poll(async () => Object.keys(await nativeContents(page)))
    .toEqual(
      expect.arrayContaining([
        'Theme text sources.verd.json',
        'Theme text document.verd-doc.json',
        ...(embedded ? ['Theme text host.verd.json'] : []),
      ]),
    );
}

async function nativeContents(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('verdboard-host');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const files = await new Promise<any[]>((resolve, reject) => {
      const request = db
        .transaction('files', 'readonly')
        .objectStore('files')
        .getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return Object.fromEntries(
      files
        .filter(
          (file) =>
            file.kind === 'file' && /\.verd(?:-doc)?\.json$/.test(file.path),
        )
        .sort((a, b) => a.path.localeCompare(b.path))
        .map((file) => [file.path, new TextDecoder().decode(file.content)]),
    );
  });
}
async function resetWriteCount(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { themeContentWrites: number }).themeContentWrites =
      0;
  });
}
async function writeCount(page: Page) {
  return page.evaluate(
    () =>
      (window as unknown as { themeContentWrites: number }).themeContentWrites,
  );
}

test('real legacy text marks follow all six themes in static text, editing, references and source documents without content writes', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  await seed(page);
  const selector = pane(page).getByLabel('Theme', { exact: true });
  for (const theme of [
    'default',
    'colorful',
    'soft',
    'retro',
    'dark',
    'starry',
  ]) {
    const svg = pane(page).locator('svg[data-surface="root"]').first();
    const bounds = (await svg.boundingBox())!;
    await svg.click({
      position: { x: bounds.width - 120, y: bounds.height - 100 },
    });
    await selector.selectOption(theme);
    await expect
      .poll(
        async () =>
          (await persistedWorkspace(page))?.records['theme-text-board']?.frame
            .view.theme.themeColorMode,
      )
      .toBe(theme);
    const before = await nativeContents(page);
    await resetWriteCount(page);
    for (const mode of ['dark', 'light'] as const) {
      await appearance(page, mode);
      await readable(pane(page));
      const task = pane(page).locator('[data-cell-id="text-task"]');
      await task.dblclick();
      await expect(task.locator('.ProseMirror')).toBeVisible();
      await readable(task);
      await task.locator('.ProseMirror').press('Escape');
      await page
        .locator('.file-tree-name')
        .filter({ hasText: /^Theme text document$/ })
        .click();
      await expect(pane(page).locator('.ProseMirror')).toBeVisible();
      await readable(pane(page));
      await page
        .locator('.file-tree-name')
        .filter({ hasText: /^Theme text sources$/ })
        .click();
    }
    expect(await nativeContents(page)).toEqual(before);
    expect(await writeCount(page)).toBe(0);
  }
  await appearance(page, 'dark');
  await page.screenshot({
    path: testInfo.outputPath('theme-text-dark.png'),
    animations: 'disabled',
  });
  await page
    .locator('.file-tree-name')
    .filter({ hasText: /^Theme text document$/ })
    .click();
  for (const mode of ['light', 'dark'] as const) {
    await appearance(page, mode);
    await readable(pane(page));
    await expect(
      pane(page).getByText('Custom document red', { exact: true }),
    ).toHaveCSS('color', 'rgb(185, 28, 28)');
  }
});

test('embedded document editing preserves theme-following text without rewriting its source', async ({
  page,
}) => {
  await seed(page, true);
  const before = await nativeContents(page);
  await resetWriteCount(page);
  for (const mode of ['dark', 'light'] as const) {
    await appearance(page, mode);
    const card = pane(page).locator('[data-cell-id="text-document-frame"]');
    await readable(card);
    await card.getByText('Legacy document body', { exact: true }).dblclick();
    await expect(card.locator('.ProseMirror')).toBeVisible();
    await readable(card);
    await card.locator('.ProseMirror').press('Escape');
  }
  expect(await nativeContents(page)).toEqual(before);
  expect(await writeCount(page)).toBe(0);
});

test('explicitly choosing the displayed color creates a persistent custom override that can be reset, undone and redone', async ({
  page,
}) => {
  await seed(page);
  await appearance(page, 'dark');
  const task = pane(page).locator('[data-cell-id="text-task"]');
  await task.click();
  const color = pane(page).getByLabel('Selection text color', { exact: true });
  await expect(color).toHaveValue('#e2e8f0');
  await color.dispatchEvent('input');
  const source = async () => {
    const cell = (await persistedWorkspace(page))?.records['theme-text-board']
      ?.cells['text-task'];
    return cell?.content.text.content.content[0].content[0].marks.find(
      (mark: { type: string }) => mark.type === 'textStyle',
    )?.attrs;
  };
  await expect
    .poll(source)
    .toMatchObject({ color: '#e2e8f0', colorSource: 'custom' });
  await appearance(page, 'light');
  await expect(task.getByText('Legacy task', { exact: true })).toHaveCSS(
    'color',
    'rgb(226, 232, 240)',
  );
  await page.reload();
  await expect(task.getByText('Legacy task', { exact: true })).toHaveCSS(
    'color',
    'rgb(226, 232, 240)',
  );
  await task.click();
  await pane(page)
    .getByLabel('Reset selection text color to theme', { exact: true })
    .click();
  await expect(task.getByText('Legacy task', { exact: true })).toHaveCSS(
    'color',
    'rgb(15, 23, 42)',
  );
  await task.click();
  await page.keyboard.press('Meta+z');
  await expect(task.getByText('Legacy task', { exact: true })).toHaveCSS(
    'color',
    'rgb(226, 232, 240)',
  );
  await page.keyboard.press('Meta+Shift+z');
  await expect(task.getByText('Legacy task', { exact: true })).toHaveCSS(
    'color',
    'rgb(15, 23, 42)',
  );
});

test('SVG and raster exports use the same resolved text colors as the live scene', async ({
  page,
}) => {
  await seed(page);
  await appearance(page, 'dark');
  for (const mode of ['light', 'dark']) {
    await selectAppAction(page, '图像导出');
    const dialog = page.getByRole('dialog', { name: '图像导出', exact: true });
    await dialog.getByLabel('Image format').selectOption('svg');
    await dialog.getByLabel('Image appearance').selectOption(mode);
    await dialog.getByLabel('Image background').selectOption('theme');
    const pending = page.waitForEvent('download');
    await dialog.getByTestId('image-export-button').click();
    const stream = await (await pending).createReadStream(),
      chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    const svg = Buffer.concat(chunks).toString();
    await page.evaluate((source) => {
      const host = document.createElement('div');
      host.dataset['themeExportCheck'] = '';
      host.innerHTML = source;
      document.body.append(host);
    }, svg);
    const exported = page.locator('[data-theme-export-check]');
    const samples = await exported.evaluate(textColorSamples);
    await exported.evaluate((element) => element.remove());
    expect(samples.length).toBeGreaterThan(0);
    expect(
      samples.filter(
        (sample: { source: string; ratio: number }) =>
          sample.source !== 'custom' &&
          (!Number.isFinite(sample.ratio) || sample.ratio < 4.5),
      ),
    ).toEqual([]);
    await selectAppAction(page, '图像导出');
    const raster = page.getByRole('dialog', { name: '图像导出', exact: true });
    await raster.getByLabel('Image format').selectOption('png');
    await raster.getByLabel('Image appearance').selectOption(mode);
    await raster.getByLabel('Image background').selectOption('theme');
    const rasterPending = page.waitForEvent('download');
    await raster.getByTestId('image-export-button').click();
    const rasterStream = await (await rasterPending).createReadStream(),
      rasterChunks: Buffer[] = [];
    for await (const chunk of rasterStream!)
      rasterChunks.push(Buffer.from(chunk));
    const glyphPixels = await page.evaluate(
      async ({ data, mode }) => {
        const image = new Image();
        image.src = `data:image/png;base64,${data}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d')!;
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(
          0,
          0,
          image.width,
          image.height,
        ).data;
        const color = mode === 'dark' ? [226, 232, 240] : [15, 23, 42];
        let hits = 0;
        for (let at = 0; at < pixels.length; at += 4)
          if (
            pixels[at] === color[0] &&
            pixels[at + 1] === color[1] &&
            pixels[at + 2] === color[2] &&
            pixels[at + 3] === 255
          )
            hits++;
        return hits;
      },
      { data: Buffer.concat(rasterChunks).toString('base64'), mode },
    );
    expect(glyphPixels).toBeGreaterThan(20);
  }
});
