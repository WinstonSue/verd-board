import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type {
  Cell,
  FrameCell,
} from '../../../packages/engine/core/src/cell/types';
import { persistedWorkspace } from './workspace-nav';

test.use({ actionTimeout: 10_000 });

type SceneFile = {
  format: 'verd-frame';
  version: 2;
  frame: FrameCell;
  cells: Record<string, Cell>;
};
const fixtures = path.resolve(__dirname, '../../fixtures/ai-canvas');
const pane = (page: Page) => page.locator('.workspace-pane.is-active');
const canvas = (page: Page) =>
  pane(page).locator('svg[aria-label="Frame canvas"][data-surface="root"]');
const cell = (page: Page, id: string) =>
  canvas(page).locator(`[data-cell-id="${id}"]`);
const fileRow = (page: Page, name: string) =>
  page.locator('.file-tree-name').filter({ hasText: name });
const importInput = (page: Page) =>
  page.locator('input[accept=".json,.verd.json,.verd-doc.json,.md,.markdown"]');
const fixture = (name: string): SceneFile =>
  JSON.parse(readFileSync(path.join(fixtures, name), 'utf8'));
function collapsedMindFixture(): SceneFile {
  const scene = fixture('mind-map.verd.json');
  for (const id of ['mind-root', 'topic-features']) {
    const ancestor = scene.cells[id];
    if (ancestor.cellType === 'node')
      ancestor.data = { ...Object(ancestor.data), collapsed: true };
  }
  return scene;
}
const paragraph = (value: string) => ({
  type: 'paragraph',
  content: [{ type: 'text', text: value }],
});
const documentWithLink = (id: string, title: string, href: string) => ({
  format: 'verd-document',
  version: 1,
  id,
  title,
  text: {
    schemaVersion: 1,
    id,
    kind: 'block',
    align: 'left',
    plainText: [
      ...Array.from({ length: 35 }, (_, index) => `Before link ${index}`),
      'Open linked element',
      ...Array.from({ length: 25 }, (_, index) => `After link ${index}`),
    ].join('\n'),
    content: {
      type: 'doc',
      content: [
        ...Array.from({ length: 35 }, (_, index) =>
          paragraph(`Before link ${index}`),
        ),
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Open linked element',
              marks: [{ type: 'link', attrs: { href } }],
            },
          ],
        },
        ...Array.from({ length: 25 }, (_, index) =>
          paragraph(`After link ${index}`),
        ),
      ],
    },
  },
});
async function importJson(page: Page, name: string, value: unknown) {
  await importInput(page).setInputFiles({
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(value)),
  });
}
async function paletteAction(page: Page, id: string, query: string) {
  // Focus the canvas without replacing its selection before capture.
  await canvas(page).focus();
  await page.keyboard.press('ControlOrMeta+Shift+p');
  const dialog = page.getByRole('dialog', { name: '命令面板', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('combobox').fill(query);
  const action = dialog.locator(`[data-action-id="${id}"]`);
  await expect(action).toHaveAttribute('aria-disabled', 'false');
  await action.click();
  await expect(dialog).toHaveCount(0);
}
async function openDocumentLink(page: Page, title: string) {
  await fileRow(page, title).click();
  await expect(pane(page).locator('.document-page__title')).toHaveValue(title);
  const link = pane(page).getByRole('link', { name: 'Open linked element' });
  await link.scrollIntoViewIfNeeded();
  await link.click({ modifiers: ['ControlOrMeta'] });
}
async function exportScene(
  page: Page,
  title: string,
): Promise<{
  format: 'verd-canvas-bundle';
  files: SceneFile[];
}> {
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: `「${title}」的操作` }).click();
  await page
    .getByRole('menuitem', { name: '导出(含依赖)', exact: true })
    .click();
  const downloaded = await downloading;
  return JSON.parse(readFileSync((await downloaded.path())!, 'utf8'));
}

test('an imported module link copied through the palette opens from a document and returns to its reading position', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await importInput(page).setInputFiles(
    path.join(fixtures, 'architecture.verd.json'),
  );
  await fileRow(page, '分层架构').click();
  await cell(page, 'mod-order').click();
  await paletteAction(page, 'canvas.link.copy', '链接');
  const href = await page.evaluate(() => navigator.clipboard.readText());
  const address = new URL(href);
  expect(address.protocol).toBe('verd:');
  expect(address.host).toBe('file');
  expect(decodeURIComponent(address.pathname.slice(1))).toBe('canvas-arch');
  expect(decodeURIComponent(address.hash.slice(1))).toBe('cell:mod-order');

  const source = documentWithLink(
    'e2e-module-links',
    'Module link source',
    href,
  );
  await importJson(page, 'module-links.verd-doc.json', source);
  await fileRow(page, source.title).click();
  const link = pane(page).getByRole('link', { name: 'Open linked element' });
  await expect(link).toHaveAttribute('href', href);
  await link.scrollIntoViewIfNeeded();
  const readingPosition = await pane(page)
    .locator('.document-page__content')
    .evaluate((element) => element.scrollTop);
  expect(readingPosition).toBeGreaterThan(0);
  await link.click({ modifiers: ['ControlOrMeta'] });
  await expect(cell(page, 'mod-order')).toBeInViewport();
  await expect(
    cell(page, 'mod-order').locator('[data-interaction-stroke="selected"]'),
  ).toHaveAttribute('stroke', '#6366f1');
  await page.getByTestId('navigation-return').click();
  await expect(pane(page).locator('.document-page__title')).toHaveValue(
    source.title,
  );
  await expect
    .poll(async () =>
      Math.abs(
        (await pane(page)
          .locator('.document-page__content')
          .evaluate((element) => element.scrollTop)) - readingPosition,
      ),
    )
    .toBeLessThanOrEqual(2);
  await expect(link).toBeInViewport();
  await expect(pane(page).locator('.tiptap p')).toHaveCount(61);
});

test('a link expands both collapsed Mind ancestors temporarily while export and reopen keep canonical content', async ({
  page,
  browser,
}) => {
  const scene = collapsedMindFixture();
  await page.goto('/');
  await importJson(page, 'collapsed-mind.verd.json', scene);
  await fileRow(page, '思维导图').click();
  await expect(cell(page, 'mind-root')).toBeVisible();
  await expect(cell(page, 'topic-features')).toHaveCount(0);
  await expect(cell(page, 'leaf-canvas')).toHaveCount(0);
  const source = documentWithLink(
    'e2e-mind-links',
    'Mind link source',
    'verd://file/canvas-mind#cell%3Aleaf-canvas',
  );
  await importJson(page, 'mind-links.verd-doc.json', source);
  await openDocumentLink(page, source.title);
  await expect(cell(page, 'leaf-canvas')).toBeInViewport();
  await expect(
    cell(page, 'leaf-canvas').locator('[data-interaction-stroke="selected"]'),
  ).toHaveAttribute('stroke', '#6366f1');
  await expect(cell(page, 'topic-features')).toBeVisible();
  await expect
    .poll(async () => (await persistedWorkspace(page))?.records['canvas-mind'])
    .toMatchObject({ cells: scene.cells });

  const exported = await exportScene(page, '思维导图');
  expect(exported.format).toBe('verd-canvas-bundle');
  const mindFile = exported.files.find(
    (file) => file.frame.id === 'canvas-mind',
  );
  expect(mindFile).toBeDefined();
  for (const id of ['mind-root', 'topic-features'])
    expect(mindFile!.cells[id]).toMatchObject({
      data: { collapsed: true },
    });
  expect(mindFile!.cells['leaf-canvas']).toMatchObject(
    scene.cells['leaf-canvas'],
  );
  await expect(cell(page, 'leaf-canvas')).toBeVisible();

  // Reopen the actual exported artifact in an empty workspace, with no live
  // occurrence from the navigation able to supply temporary view state.
  const reopened = await browser.newContext();
  try {
    const target = await reopened.newPage();
    await target.goto(page.url());
    await importJson(target, 'reopened-mind.json', exported);
    await fileRow(target, '思维导图').click();
    await expect(cell(target, 'mind-root')).toBeVisible();
    await expect(cell(target, 'topic-features')).toHaveCount(0);
    await expect(cell(target, 'leaf-canvas')).toHaveCount(0);
    await expect(
      canvas(target).locator('[data-mind-fold="mind-root"]'),
    ).toHaveAttribute('aria-expanded', 'false');
  } finally {
    await reopened.close();
  }
});

test('professional creation through the palette is one undoable action with a stable redo identity', async ({
  page,
}) => {
  await page.goto('/');
  await importInput(page).setInputFiles(
    path.join(fixtures, 'architecture.verd.json'),
  );
  await fileRow(page, '分层架构').click();
  const modules = () =>
    canvas(page).locator('[data-cell-kind="architecture-module"]');
  await expect(modules()).toHaveCount(4);
  const originalIds = await modules().evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('data-cell-id')),
  );
  await cell(page, 'mod-order').click();
  await paletteAction(page, 'architecture.box', '模块');
  await expect(modules()).toHaveCount(5);
  const createdId = await modules().evaluateAll(
    (elements, originalIds) =>
      elements
        .map((element) => element.getAttribute('data-cell-id'))
        .find((id) => !originalIds.includes(id)),
    originalIds,
  );
  expect(createdId).toBeTruthy();
  // End the label editor before asking the canvas scope for history commands.
  await page.keyboard.press('Escape');
  await expect
    .poll(
      async () =>
        (await persistedWorkspace(page))?.records['canvas-arch'].cells[
          'layer-service'
        ].data.memberIds,
    )
    .toContain(createdId);
  await paletteAction(page, 'canvas.history.undo', '撤销');
  await expect(modules()).toHaveCount(4);
  await expect(cell(page, createdId!)).toHaveCount(0);
  await paletteAction(page, 'canvas.history.redo', '重做');
  await expect(modules()).toHaveCount(5);
  await expect(cell(page, createdId!)).toBeVisible();
  await expect
    .poll(
      async () =>
        (await persistedWorkspace(page))?.records['canvas-arch'].cells[
          'layer-service'
        ].data.memberIds,
    )
    .toContain(createdId);
});

test('return to an embedded document waits for its editor and restores the original caret and scroll', async ({
  page,
}) => {
  await page.goto('/');
  await importInput(page).setInputFiles(
    path.join(fixtures, 'architecture.verd.json'),
  );
  const source = documentWithLink(
    'e2e-embedded-origin-document',
    'Embedded origin document',
    'verd://file/canvas-arch#cell%3Amod-order',
  );
  await importJson(page, 'embedded-origin.verd-doc.json', source);
  const board: SceneFile = {
    format: 'verd-frame',
    version: 2,
    frame: {
      id: 'e2e-embedded-origin-board',
      kind: 'frame',
      cellType: 'frame',
      name: 'Embedded origin board',
      geometry: { x: 0, y: 0, width: 960, height: 640 },
      children: ['e2e-origin-card'],
      groups: [],
    },
    cells: {
      'e2e-origin-card': {
        id: 'e2e-origin-card',
        kind: 'document-frame',
        cellType: 'node',
        geometry: { x: 100, y: 80, width: 560, height: 340 },
        data: { targetDocumentId: source.id },
      },
    },
  };
  await importJson(page, 'embedded-origin-board.verd.json', board);
  await fileRow(page, 'Embedded origin board').click();
  const card = cell(page, 'e2e-origin-card');
  await card.getByText('Before link 0', { exact: true }).dblclick();
  const editing = card.locator('[data-document-editing]');
  await expect(editing).toBeVisible();
  const link = editing.getByRole('link', {
    name: 'Open linked element',
    exact: true,
  });
  await link.scrollIntoViewIfNeeded();
  await link.click();
  await link.evaluate(async (element) => {
    const text = element.firstChild!;
    const range = document.createRange();
    range.setStart(text, 0);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
  });
  await page.keyboard.press('Shift+ArrowRight');
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString()))
    .toBe('O');
  const scroller = editing.locator('[data-document-preview-scroll]');
  const scroll = await scroller.evaluate((element) => element.scrollTop);
  expect(scroll).toBeGreaterThan(0);
  await link.dispatchEvent('click', { button: 0, ctrlKey: true });
  await expect(cell(page, 'mod-order')).toBeInViewport();
  await page.getByTestId('navigation-return').click();
  await expect(editing).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString()))
    .toBe('O');
  await expect
    .poll(async () =>
      Math.abs(
        (await scroller.evaluate((element) => element.scrollTop)) - scroll,
      ),
    )
    .toBeLessThanOrEqual(2);
  await expect(editing.locator('.tiptap p')).toHaveCount(61);
});

test('canvas text opens with click preference and presentation overrides modifier preference', async ({
  page,
}) => {
  await page.goto('/');
  const scene = fixture('whiteboard-basic.verd.json');
  const node = scene.cells['shape-request'];
  if (node.cellType !== 'node') throw new Error('Expected fixture node');
  const label = 'Open toolbar document';
  const text = {
    schemaVersion: 1,
    id: 'canvas-link-text',
    kind: 'inline',
    plainText: label,
    content: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: label,
              marks: [
                {
                  type: 'link',
                  attrs: { href: 'verd://file/canvas-link-target' },
                },
              ],
            },
          ],
        },
      ],
    },
  };
  node.content = { ...node.content, label, text } as typeof node.content;
  await importJson(page, 'linked.verd.json', scene);
  await importJson(
    page,
    'target.verd-doc.json',
    documentWithLink(
      'canvas-link-target',
      'Canvas link target',
      'https://example.com',
    ),
  );
  await fileRow(page, scene.frame.name!).click();
  const link = pane(page).getByRole('link', { name: label, exact: true });
  await link.click();
  await expect(canvas(page)).toBeVisible();
  await page.evaluate(() => {
    const key = 'verdboard.interaction-settings';
    localStorage.setItem(key, JSON.stringify({ linkActivation: 'click' }));
    window.dispatchEvent(new StorageEvent('storage', { key }));
  });
  await link.hover();
  await expect(link).toHaveAttribute('title', '单击打开链接');
  await link.click();
  await expect(pane(page).locator('.document-page__title')).toHaveValue(
    'Canvas link target',
  );
  await fileRow(page, scene.frame.name!).click();
  await page.evaluate(() => {
    const key = 'verdboard.interaction-settings';
    localStorage.setItem(key, JSON.stringify({ linkActivation: 'modifier' }));
    window.dispatchEvent(new StorageEvent('storage', { key }));
  });
  await page.getByRole('button', { name: '演示', exact: true }).click();
  const presentation = page.getByTestId('presentation-mode');
  await expect(presentation).toBeVisible();
  await presentation.getByRole('link', { name: label, exact: true }).click();
  await expect(presentation).toHaveCount(0);
  await expect(pane(page).locator('.document-page__title')).toHaveValue(
    'Canvas link target',
  );
});
