import { expect, test, type Page } from './service-fixture';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import {
  openWorkspaceMenu,
  openHistoryAction,
  openActiveFile,
  selectAppAction,
  setAppLanguage,
} from './app-actions';

const pane = (page: Page) => page.locator('.workspace-pane.is-active');
const canvas = (page: Page) =>
  pane(page).locator('svg[aria-label="Frame canvas"][data-surface="root"]');
const palette = (page: Page) =>
  page.getByRole('dialog', { name: /^(命令面板|Command palette)$/ });
const importInput = (page: Page) =>
  page.locator(
    'input[accept=".json,.verd,.verd.json,.verd-doc.json,.md,.markdown"]',
  );

for (const modifier of ['Control', 'Meta']) {
  test(`reload opens the workspace palette without clicking or focusing (${modifier})`, async ({
    page,
  }) => {
    await page.goto('/');
    await openActiveFile(page);
    await expect(canvas(page)).toBeVisible();
    await page.reload();
    await expect(page.locator('.workspace-shell')).toBeVisible();
    await expect(page.locator('body')).toBeFocused();
    const camera = await canvas(page)
      .locator('> [data-frame-world]')
      .getAttribute('transform');
    const count = await canvas(page).locator('[data-cell-id]').count();
    await page.keyboard.press(`${modifier}+Shift+p`);
    await expect(palette(page)).toHaveCount(1);
    await expect(palette(page).getByRole('combobox')).toBeFocused();
    await expect(
      palette(page).locator('[data-action-id="workspace.create-canvas"]'),
    ).toHaveCount(1);
    await expect(
      palette(page).locator('[data-action-id="canvas.selection.delete"]'),
    ).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('body')).toBeFocused();
    await expect(canvas(page).locator('[data-cell-id]')).toHaveCount(count);
    await expect(canvas(page).locator('> [data-frame-world]')).toHaveAttribute(
      'transform',
      camera!,
    );
  });
}

test('palette shortcut reaches canvas text editing without changing content or history', async ({
  page,
}) => {
  await page.goto('/');
  await importInput(page).setInputFiles(
    path.resolve(
      __dirname,
      '../../fixtures/ai-canvas/whiteboard-basic.verd.json',
    ),
  );
  await page.locator('[data-file-id="canvas-basic"] .file-tree-name').click();
  await expect(
    page.locator('[role="tab"][data-tab-id="canvas-basic"]'),
  ).toHaveAttribute('aria-selected', 'true');
  const undoDisabled = await (
    await openHistoryAction(page, '撤销')
  ).isDisabled();
  await page.keyboard.press('Escape');
  const target = canvas(page).locator('[data-cell-id="shape-request"]');
  await target.dblclick();
  const editor = pane(page).locator('[data-frame-text-editor] .ProseMirror');
  await expect(editor).toBeFocused();
  await page.keyboard.press('ControlOrMeta+a');
  const selection = await page.evaluate(() =>
    window.getSelection()?.toString(),
  );
  const text = await editor.textContent();
  await page.keyboard.press('ControlOrMeta+Shift+p');
  await expect(palette(page)).toHaveCount(1);
  await expect(
    palette(page).locator('[data-action-id="canvas.selection.delete"]'),
  ).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(palette(page)).toHaveCount(0);
  await expect(editor).toBeFocused();
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString()))
    .toBe(selection);
  await expect(target).toContainText(text!);
  await expect(await openHistoryAction(page, '撤销')).toHaveJSProperty(
    'disabled',
    undoDisabled,
  );
});

for (const [fixture, action, kind] of [
  ['whiteboard-basic', 'draw.shape', 'geometry'],
  ['mind-map', 'mind.add-child', 'mind-root'],
  ['workflow-dag', 'workflow.task', 'workflow-start'],
  ['architecture', 'architecture.box', 'architecture-layer'],
  ['uml-class', 'uml.add-class', 'uml-class'],
  ['uml-sequence', 'uml.add-participant', 'uml-participant'],
] as const) {
  test(`${fixture} compact palette entry preserves the canvas and all opening methods`, async ({
    page,
  }) => {
    await page.goto('/');
    const file = path.resolve(
      __dirname,
      `../../fixtures/ai-canvas/${fixture}.verd.json`,
    );
    const fileId = JSON.parse(readFileSync(file, 'utf8')).frame.id as string;
    await importInput(page).setInputFiles(file);
    await page.locator(`[data-file-id="${fileId}"] .file-tree-name`).click();
    await expect(
      canvas(page).locator(`[data-cell-kind="${kind}"]`).first(),
    ).toBeVisible();
    const trigger = pane(page).getByTestId('app-menu-trigger');
    const camera = await canvas(page)
      .locator('> [data-frame-world]')
      .getAttribute('transform');
    const count = await canvas(page).locator('[data-cell-id]').count();
    await selectAppAction(page, '命令面板');
    await expect(palette(page)).toHaveCount(1);
    await expect(palette(page).getByRole('combobox')).toBeFocused();
    await palette(page).getByRole('combobox').fill(action.split('.')[0]);
    await expect(
      palette(page).locator(`[data-action-id="${action}"]`),
    ).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await selectAppAction(page, '命令面板');
    await expect(palette(page)).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(pane(page).getByTestId('app-menu-trigger')).toBeFocused();
    await canvas(page).focus();
    await page.keyboard.press('ControlOrMeta+Shift+p');
    await expect(palette(page)).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(canvas(page)).toBeFocused();
    await expect(canvas(page).locator('[data-cell-id]')).toHaveCount(count);
    await expect(canvas(page).locator('> [data-frame-world]')).toHaveAttribute(
      'transform',
      camera!,
    );
    await expect(page.getByTestId('workspace-commands')).toHaveCount(0);
  });
}

test('toolbar palette binds the active embedded canvas rather than its outer board', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await importInput(page).setInputFiles(
    path.resolve(
      __dirname,
      '../../fixtures/ai-canvas/bundle-multi-canvas.verd.json',
    ),
  );
  await page
    .locator('[data-file-id="canvas-overview"] .file-tree-name')
    .click();
  const reference = canvas(page).locator('[data-cell-id="ov-ref"]');
  await reference.dblclick({ position: { x: 24, y: 48 } });
  const nested = reference.locator('svg[data-surface="nested"]');
  const target = nested.locator('[data-cell-id="d-create"]');
  await target.click({ position: { x: 12, y: 12 } });
  await nested.focus();
  await page.keyboard.press('ControlOrMeta+Shift+p');
  await expect(palette(page)).toHaveCount(1);
  await expect(
    palette(page).locator('[data-action-id="canvas.selection.delete"]'),
  ).toHaveAttribute('aria-disabled', 'false');
  await page.keyboard.press('Escape');
  await expect(nested).toBeFocused();
  await selectAppAction(page, '命令面板');
  await expect(
    palette(page).locator('[data-action-id="canvas.selection.delete"]'),
  ).toHaveAttribute('aria-disabled', 'false');
  await palette(page).getByRole('combobox').fill('链接');
  const copy = palette(page).locator('[data-action-id="canvas.link.copy"]');
  await expect(copy).toHaveAttribute('aria-disabled', 'false');
  await copy.click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain('cell%3Ad-create');
  const link = new URL(
    await page.evaluate(() => navigator.clipboard.readText()),
  );
  expect(decodeURIComponent(link.pathname.slice(1))).toBe('canvas-detail');
  await expect(target).toHaveCount(1);
  await expect(reference).toBeVisible();
  await expect(canvas(page).locator('[data-cell-id="ov-tag"]')).toBeVisible();
});

for (const [locale, readonly] of [
  ['zh', false],
  ['en', true],
] as const) {
  test(`document compact palette keeps its scope and text selection (${locale}, readonly=${readonly})`, async ({
    page,
  }) => {
    await page.goto('/');
    if (locale === 'en') await setAppLanguage(page, 'en');
    const id = 'palette-entry-document';
    await importInput(page).setInputFiles({
      name: 'palette-entry.verd-doc.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          format: 'verd-document',
          version: 1,
          id,
          title: 'Palette document',
          text: {
            schemaVersion: 1,
            id,
            kind: 'block',
            align: 'left',
            plainText: 'Preserve this text.',
            content: {
              type: 'doc',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Preserve this text.' }],
                },
              ],
            },
          },
        }),
      ),
    });
    const documentRow = page
      .locator('.file-tree-name')
      .filter({ hasText: /^Palette document$/ });
    await documentRow.click();
    await expect(pane(page).locator('.document-page__save')).toHaveClass(
      /is-saved/,
    );
    if (readonly) {
      await page.goto('/?readonly=1');
      await documentRow.click();
    }
    const trigger = pane(page)
      .getByRole('toolbar', { name: 'document', exact: true })
      .getByRole('button', {
        name: locale === 'zh' ? '文档' : 'Document',
        exact: true,
      });
    const editor = pane(page).locator('.tiptap');
    if (!readonly) {
      await editor.click();
      await page.keyboard.press('ControlOrMeta+a');
      await expect
        .poll(() => page.evaluate(() => window.getSelection()?.toString()))
        .toBe('Preserve this text.');
    }
    await trigger.click();
    await page
      .getByRole('dialog', {
        name: locale === 'zh' ? '文档' : 'Document',
        exact: true,
      })
      .getByRole('button', {
        name: locale === 'zh' ? '命令面板' : 'Command palette',
        exact: true,
      })
      .click();
    await expect(palette(page)).toHaveCount(1);
    await palette(page)
      .getByRole('combobox')
      .fill(locale === 'zh' ? '查找' : 'find');
    await expect(
      palette(page).locator('[data-action-id="document.find"]'),
    ).toBeVisible();
    await expect(
      palette(page).locator('[data-action-id="canvas.selection.delete"]'),
    ).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    if (!readonly) {
      await trigger.click();
      await page
        .getByRole('dialog', { name: '文档', exact: true })
        .getByRole('button', { name: '命令面板', exact: true })
        .click();
      await palette(page).getByRole('combobox').fill('加粗');
      await palette(page)
        .locator('[data-action-id="document.toggle-bold"]')
        .click();
      await expect(editor.locator('strong')).toHaveText('Preserve this text.');
      await page.keyboard.press('ControlOrMeta+z');
      await expect(editor.locator('strong')).toHaveCount(0);
      await expect(editor).toHaveText('Preserve this text.');
    }
    const keyboardOrigin = readonly ? trigger : editor;
    await keyboardOrigin.focus();
    await page.keyboard.press('ControlOrMeta+Shift+p');
    await expect(palette(page)).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(keyboardOrigin).toBeFocused();
  });
}

for (const [width, appearance] of [
  [800, 'dark'],
  [1440, 'light'],
] as const) {
  test(`workspace menu palette has no header row and restores focus (${width}, ${appearance})`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(
      (value) => localStorage.setItem('verdboard.appearance', value),
      appearance,
    );
    await page.goto('/');
    await openActiveFile(page);
    await expect(page.getByTestId('workspace-commands')).toHaveCount(0);
    const toolbar = pane(page).getByRole('toolbar', { name: 'App actions' });
    const trigger = toolbar.getByTestId('app-menu-trigger');
    await expect(toolbar.getByTestId('canvas-command-palette')).toHaveCount(0);
    await expect(trigger).toBeInViewport();
    await expect(trigger).toHaveAttribute('aria-label', '更多');
    const buttons = toolbar.locator('> .frame-tool-control > button, > button');
    await expect(buttons.nth(0)).toHaveAttribute('aria-label', '查找');
    await expect(buttons.nth(1)).toHaveText('发起 Agent');
    await expect(buttons.nth(2)).toHaveAttribute('aria-label', '演示');
    const menu = await openWorkspaceMenu(page);
    await expect(menu.getByTestId('workspace-open-settings')).toHaveText(
      '工作区设置',
    );
    await page.keyboard.press('Escape');
    await page.getByTestId('workspace-menu-trigger').focus();
    await page.keyboard.press('ControlOrMeta+Shift+p');
    await expect(palette(page)).toHaveCount(1);
    await palette(page).getByRole('combobox').fill('新建画布');
    await expect(
      palette(page).locator('[data-action-id="workspace.create-canvas"]'),
    ).toBeVisible();
    await expect(
      palette(page).locator('[data-action-id="canvas.selection.delete"]'),
    ).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('workspace-menu-trigger')).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath('command-entry.png') });
  });
}
