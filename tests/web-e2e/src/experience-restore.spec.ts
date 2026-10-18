import { expect, test, type Page } from '@playwright/test';
import { selectDrawingTool } from './drawing-tools';
import {
  activateBoardTab,
  clearWorkspaceStorage,
  persistedWorkspace,
} from './workspace-nav';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const canvas = (page: Page) =>
  page.locator('svg[aria-label="Frame canvas"][data-surface="root"]:visible');
const cells = (page: Page, kind: string) =>
  canvas(page).locator(`[data-cell-kind="${kind}"]`);
const world = (page: Page) =>
  canvas(page).locator('g[transform*="scale"]').first();
const emptyPoint = async (page: Page) => {
  const point = await canvas(page).evaluate((svg) => {
    const rect = svg.getBoundingClientRect();
    for (let y = 100; y < rect.height - 160; y += 28) {
      for (let x = 150; x < rect.width - 480; x += 28) {
        const hit = document.elementFromPoint(rect.left + x, rect.top + y);
        if (hit === svg) return { x: rect.left + x, y: rect.top + y };
      }
    }
    return null;
  });
  expect(point).toBeTruthy();
  return point!;
};

const persisted = persistedWorkspace;

const allCells = async (page: Page) => {
  const data = await persisted(page);
  return Object.values(data?.records ?? {}).flatMap((record) =>
    Object.values(
      (record as { cells?: Record<string, any> } | undefined)?.cells ?? {},
    ),
  );
};
const findCell = async (page: Page, kind: string) =>
  (await allCells(page)).find((cell) => cell.kind === kind);

const snapshotFile = (
  name: string,
  label: string,
  zoom: number,
  theme: string,
) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'verd-open-'));
  const file = path.join(dir, name);
  writeFileSync(
    file,
    JSON.stringify({
      store: {
        rootId: 'file',
        cells: {
          file: {
            id: 'file',
            kind: 'frame',
            cellType: 'frame',
            geometry: { x: 0, y: 0, width: 960, height: 640 },
            children: ['node'],
            groups: [],
            view: {
              viewport: { zoom, origination: [12, 24] },
              theme: { themeColorMode: theme },
            },
          },
          node: {
            id: 'node',
            kind: 'geometry',
            cellType: 'node',
            geometry: { x: 40, y: 40, width: 80, height: 48 },
            content: { label },
          },
        },
      },
    }),
  );
  return file;
};

test('restores editing, gestures, summaries, and file open', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.evaluate(() => indexedDB.deleteDatabase('VerdBoard'));
  await clearWorkspaceStorage(page);
  await page.reload();
  const skip = page.getByRole('button', { name: '跳过', exact: true });
  if (await skip.isVisible().catch(() => false)) await skip.click();

  const frameBox = async () => {
    const frame = await page.locator('.verd-frame').boundingBox();
    const svg = await canvas(page).boundingBox();
    return { frame, svg };
  };
  for (const [width, height] of [
    [1440, 900],
    [1280, 720],
    [800, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    const { frame, svg } = await frameBox();
    expect(svg?.width, `canvas width at ${width}x${height}`).toBe(
      frame!.width - 300,
    );
    expect(svg?.height, `canvas height at ${width}x${height}`).toBe(
      frame?.height,
    );
    const tools = await page.locator('.frame-tools').evaluate((element) => {
      const style = getComputedStyle(element);
      return (
        element.scrollWidth <= element.clientWidth + 1 ||
        style.flexWrap === 'wrap' ||
        style.overflow === 'auto' ||
        style.overflowX === 'auto' ||
        style.overflowY === 'auto'
      );
    });
    expect(tools, `tools reachable at ${width}x${height}`).toBe(true);
    await expect(
      page.getByRole('button', { name: '选择', exact: true }),
    ).toBeVisible();
    if (width === 800) {
      await expect(page.locator('.frame-inspector')).toBeVisible();
      await expect(
        page.getByRole('menu', { name: '更多', exact: true }),
      ).toBeHidden();
      const more = page.getByRole('button', { name: '更多', exact: true });
      await more.click();
      await expect(
        page.getByRole('menuitem', { name: '打开', exact: true }),
      ).toBeVisible();
      await more.click();
      if (width === 800) {
        await expect(page.locator('.frame-inspector.is-open')).toBeVisible();
        const theme = page.getByLabel('Theme', { exact: true });
        await theme.selectOption('dark');
        await expect
          .poll(async () => {
            const data = await persisted(page);
            const root = data?.records[data.manifest.rootId] as
              | {
                  frame?: { view?: { theme?: { themeColorMode?: string } } };
                }
              | undefined;
            return root?.frame?.view?.theme?.themeColorMode;
          })
          .toBe('dark');
        await page.getByRole('button', { name: '撤销', exact: true }).click();
        await expect.poll(async () => theme.inputValue()).not.toBe('dark');
      }
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  await selectDrawingTool(page, '思维导图');
  const box = (await canvas(page).boundingBox())!;
  await page.mouse.click(box.x + 520, box.y + 280);
  await page.getByRole('button', { name: '选择', exact: true }).click();
  await cells(page, 'mind-root').last().click();
  await page
    .getByRole('button', { name: 'Selection bold', exact: true })
    .click();
  await page
    .getByLabel('Selection text color', { exact: true })
    .fill('#ff0000');
  await page
    .getByLabel('Selection link URL', { exact: true })
    .fill('https://example.com');
  await page
    .getByRole('button', { name: 'Apply selection link', exact: true })
    .click();
  const formatted = async () => findCell(page, 'mind-root');
  await expect
    .poll(async () => JSON.stringify((await formatted())?.content?.text ?? {}))
    .toContain('bold');
  const beforeEdit = await formatted();
  await cells(page, 'mind-root')
    .last()
    .locator('path')
    .first()
    .dispatchEvent('dblclick');
  const editor = page.locator(
    '[data-frame-text-editor] [contenteditable="true"]',
  );
  await expect(editor).toBeVisible();
  await editor.focus();
  await page.keyboard.press('End');
  await page.keyboard.type('Z');
  await page.getByRole('spinbutton', { name: 'x', exact: true }).focus();
  await expect
    .poll(async () => (await formatted())?.content?.label)
    .toContain('Z');
  const edited = await formatted();
  expect(JSON.stringify(edited.content.text)).toContain('bold');
  expect(JSON.stringify(edited.content.text)).toContain('#ff0000');
  expect(JSON.stringify(edited.content.text)).toContain('https://example.com');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect
    .poll(async () => (await formatted())?.content?.label)
    .toBe(beforeEdit.content.label);
  expect(JSON.stringify((await formatted()).content.text)).toContain('bold');
  await page.reload();
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await cells(page, 'mind-root').last().click();
  expect(JSON.stringify((await formatted()).content.text)).toContain(
    'https://example.com',
  );

  await canvas(page).press('Tab');
  await page.keyboard.press('Escape');
  await expect(cells(page, 'mind-child')).toHaveCount(1);
  await cells(page, 'mind-child').first().click();
  await canvas(page).press('Tab');
  await page.keyboard.press('Escape');
  await expect(cells(page, 'mind-child')).toHaveCount(2);
  await cells(page, 'mind-child').first().click();
  const parentId = await cells(page, 'mind-child')
    .first()
    .getAttribute('data-cell-id');
  await page.locator(`[data-mind-fold="${parentId}"]`).click();
  await expect
    .poll(async () => (await findCell(page, 'mind-child'))?.data?.collapsed)
    .toBe(true);
  await canvas(page).press('Tab');
  await page.keyboard.press('Escape');
  await expect
    .poll(async () => {
      const nodes = (await allCells(page)).filter(
        (cell) => cell.kind === 'mind-child',
      );
      return [nodes.length, nodes.some((cell) => cell.data?.collapsed)];
    })
    .toEqual([3, false]);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect
    .poll(async () => {
      const nodes = (await allCells(page)).filter(
        (cell) => cell.kind === 'mind-child',
      );
      return [nodes.length, nodes[0]?.data?.collapsed];
    })
    .toEqual([2, true]);

  await cells(page, 'mind-root')
    .locator('path')
    .first()
    .click({
      position: { x: 6, y: 10 },
    });
  await expect(page.getByTestId('inspector-name')).toBeVisible();
  await page
    .getByRole('button', { name: 'Mind layout standard', exact: true })
    .click();
  await page.getByLabel('Mind right node count', { exact: true }).fill('1');
  await page
    .getByLabel('Mind right node count', { exact: true })
    .press('Enter');
  await canvas(page).press('Tab');
  const formatting = page.getByRole('toolbar', {
    name: 'Text formatting',
    exact: true,
  });
  await expect(formatting).toBeVisible();
  await canvas(page).focus();
  await page.keyboard.press('Escape');
  await expect(formatting).toBeHidden();
  const topics = cells(page, 'mind-child');
  await expect(topics).toHaveCount(2);
  await topics
    .nth(0)
    .locator('path')
    .first()
    .click({ position: { x: 6, y: 10 } });
  await topics
    .nth(1)
    .locator('path')
    .first()
    .click({ modifiers: ['Shift'], position: { x: 6, y: 10 } });
  await page.getByRole('button', { name: '概要', exact: true }).click();
  await expect(cells(page, 'mind-summary-edge')).toHaveCount(2);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(cells(page, 'mind-summary-edge')).toHaveCount(0);

  await activateBoardTab(page);
  await page.getByRole('button', { name: '形状', exact: true }).click();
  await page.getByTestId('shape-rectangle').click();
  const empty = await emptyPoint(page);
  await page.mouse.click(empty.x, empty.y);
  await page.getByRole('button', { name: '选择', exact: true }).click();
  const shape = cells(page, 'geometry').last();
  await shape.click();
  await expect(
    page.getByRole('toolbar', { name: 'Selection actions' }),
  ).toHaveCount(0);
  const dragFrom = await shape.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    for (let y = rect.top + 6; y < rect.bottom - 6; y += 8) {
      for (let x = rect.left + 6; x < rect.right - 6; x += 8) {
        const hit = document.elementFromPoint(x, y);
        if (hit && node.contains(hit)) return { x, y };
      }
    }
    return null;
  });
  expect(dragFrom).toBeTruthy();
  await page.mouse.move(dragFrom!.x, dragFrom!.y);
  await page.mouse.down();
  await page.mouse.move(dragFrom!.x + 36, dragFrom!.y + 20, { steps: 6 });
  await expect(
    page.getByRole('toolbar', { name: 'Selection actions' }),
  ).toHaveCount(0);
  await page.mouse.up();
  await expect(
    page.getByRole('toolbar', { name: 'Selection actions' }),
  ).toHaveCount(0);

  const transform = () => world(page).getAttribute('transform');
  await canvas(page).focus();
  const resting = await transform();
  const pan = await emptyPoint(page);
  await page.keyboard.down('Space');
  await page.mouse.move(pan.x, pan.y);
  await page.mouse.down();
  await page.mouse.move(pan.x + 60, pan.y + 40, { steps: 3 });
  await page.mouse.up();
  await page.keyboard.up('Space');
  expect(await transform()).not.toBe(resting);
  const panned = await transform();
  await page.getByTestId('inspector-name').evaluate((element) => {
    if (element instanceof HTMLElement) element.focus();
  });
  await page.keyboard.down('Space');
  await page.mouse.move(pan.x, pan.y);
  await page.mouse.down();
  await page.mouse.move(pan.x + 60, pan.y + 40, { steps: 3 });
  await page.mouse.up();
  await page.keyboard.up('Space');
  expect(await transform()).toBe(panned);

  await canvas(page).focus();
  const beforeMiddle = await transform();
  const middle = await emptyPoint(page);
  await page.mouse.move(middle.x, middle.y);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(middle.x + 60, middle.y - 40, { steps: 3 });
  await page.mouse.up({ button: 'middle' });
  expect(await transform()).not.toBe(beforeMiddle);

  const menu = await emptyPoint(page);
  const contextMenu = page.getByRole('dialog', { name: 'Selection actions' });
  await page.mouse.click(menu.x, menu.y, { button: 'right' });
  await expect(
    contextMenu.getByRole('button', { name: '复制', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(contextMenu).toBeHidden();
  const beforeRight = await transform();
  const right = await emptyPoint(page);
  await page.mouse.move(right.x, right.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(right.x + 80, right.y - 40, { steps: 4 });
  await page.mouse.up({ button: 'right' });
  expect(await transform()).not.toBe(beforeRight);
  await expect(contextMenu).toBeHidden();

  const beforePaste = await cells(page, 'geometry').count();
  await canvas(page).focus();
  await canvas(page).evaluate((svg) => {
    const data = new DataTransfer();
    data.setData('text/plain', 'Pasted sentence');
    svg.dispatchEvent(
      new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      }),
    );
  });
  await expect(cells(page, 'geometry')).toHaveCount(beforePaste + 1);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(cells(page, 'geometry')).toHaveCount(beforePaste);

  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  await canvas(page).evaluate(
    (svg, bytes) => {
      const file = new File([new Uint8Array(bytes)], 'drop.png', {
        type: 'image/png',
      });
      const data = new DataTransfer();
      data.items.add(file);
      const rect = svg.getBoundingClientRect();
      svg.dispatchEvent(
        new DragEvent('dragover', {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + 180,
          clientY: rect.top + 120,
          dataTransfer: data,
        }),
      );
      svg.dispatchEvent(
        new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + 180,
          clientY: rect.top + 120,
          dataTransfer: data,
        }),
      );
    },
    [...png],
  );
  await expect(cells(page, 'image')).toHaveCount(1);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(cells(page, 'image')).toHaveCount(0);

  const themeBeforeOpen = await page
    .getByLabel('Theme', { exact: true })
    .inputValue();
  const openInput = page
    .locator('.workspace-pane.is-active')
    .locator('input[accept="application/json,.md,.markdown,.mmd,.mermaid"]');
  await openInput
    .nth(1)
    .setInputFiles(snapshotFile('open.json', 'Opened node', 2, 'dark'));
  await expect(
    cells(page, 'geometry').filter({ hasText: 'Opened node' }),
  ).toHaveCount(1);
  await expect(page.getByLabel('Theme', { exact: true })).toHaveValue('dark');
  await expect
    .poll(async () => world(page).getAttribute('transform'))
    .toContain('scale(1)');
  const fittedOpenView = await world(page).getAttribute('transform');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.getByLabel('Theme', { exact: true })).toHaveValue(
    themeBeforeOpen,
  );
  await expect
    .poll(async () => world(page).getAttribute('transform'))
    .toBe(fittedOpenView);
  await expect(
    cells(page, 'geometry').filter({ hasText: 'Opened node' }),
  ).toHaveCount(0);
  await page.reload();
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await expect(
    page
      .locator('.workspace-pane.is-active')
      .getByLabel('Theme', { exact: true }),
  ).toHaveValue(themeBeforeOpen);
  await expect(
    cells(page, 'geometry').filter({ hasText: 'Opened node' }),
  ).toHaveCount(0);

  const beforeImport = await cells(page, 'geometry').count();
  await openInput
    .nth(0)
    .setInputFiles(snapshotFile('import.json', 'Imported node', 1, 'default'));
  await expect(
    cells(page, 'geometry').filter({ hasText: 'Imported node' }),
  ).toHaveCount(1);
  expect(await cells(page, 'geometry').count()).toBeGreaterThan(beforeImport);

  const invalid = path.join(tmpdir(), 'verd-invalid.json');
  writeFileSync(invalid, '{');
  const beforeInvalid = await world(page).getAttribute('transform');
  await openInput.nth(1).setInputFiles(invalid);
  await expect(page.getByRole('alert')).toContainText(
    /Invalid|Unsupported|Unexpected/,
  );
  await expect(world(page)).toHaveAttribute('transform', beforeInvalid);
  await expect(
    cells(page, 'geometry').filter({ hasText: 'Imported node' }),
  ).toHaveCount(1);
});
