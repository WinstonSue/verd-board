import { test, expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { electron, writeDesktopLauncher } from './desktop-launcher';
import { exerciseDocumentBlockActions } from '../../web-e2e/src/document-block-actions';
import { exerciseDocumentResources } from '../../web-e2e/src/document-resource-actions';
import { activeTabTitle } from '../../web-e2e/src/tab-actions';
import { exerciseDocumentInlineReferences } from '../../web-e2e/src/document-inline-reference-actions';
import { openDocumentInsert } from '../../web-e2e/src/app-actions';

test('Desktop inserts inline references and opens insertion from the document menu', async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), 'verd-inline-reference-'),
  );
  const userData = path.join(directory, 'user-data');
  const launcher = path.join(directory, 'launch.cjs');
  let desktop: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    await mkdir(userData);
    await writeDesktopLauncher(launcher, userData);
    desktop = await electron.launch({
      args: [launcher],
      env: {
        ...process.env,
        VERDBOARD_WORKSPACE_PATH: path.join(directory, 'workspace'),
      },
    });
    const page = await desktop.firstWindow();
    await page.setViewportSize({ width: 640, height: 600 });
    await exerciseDocumentInlineReferences(page);
    const menu = await openDocumentInsert(page);
    const primary = page.getByRole('dialog', { name: '文档', exact: true });
    const insert = primary.getByRole('button', { name: '插入', exact: true });
    await expect(primary).toBeInViewport({ ratio: 1 });
    await expect(menu).toBeInViewport({ ratio: 1 });
    await expect(
      menu.getByRole('button', { name: '图片', exact: true }),
    ).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(insert).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('button', { name: '文档', exact: true }),
    ).toBeFocused();
  } finally {
    await desktop?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('Desktop reads local PDF with packaged worker and preserves attachment references', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'verd-rich-e2e-'));
  const userData = path.join(directory, 'user-data');
  await mkdir(userData);
  const launcher = path.join(directory, 'launch.cjs');
  await writeDesktopLauncher(launcher, userData);
  const desktop = await electron.launch({
    args: [launcher],
    env: {
      ...process.env,
      VERDBOARD_WORKSPACE_PATH: path.join(userData, 'workspaces', 'default'),
    },
  });
  try {
    const page = await desktop.firstWindow();
    page.on('console', (m) => {
      if (m.type() === 'error') console.log('CONSOLE', m.text());
    });
    page.on('pageerror', (error) => console.log('PAGE ERROR', error.message));
    await expect(
      page.locator(
        'input[accept=".json,.verd.json,.verd-doc.json,.md,.markdown"]',
      ),
    ).toBeAttached({ timeout: 45000 });
    await exerciseDocumentResources(page);
    const editor = page.locator('.workspace-pane.is-active .tiptap');
    const block = editor.getByText('Parent', { exact: true });
    await block.hover();
    await page.getByRole('button', { name: '段落操作', exact: true }).click();
    const options = page.getByRole('dialog', { name: '段落操作', exact: true });
    await expect(options).toBeVisible();
    await expect(
      options.getByRole('button', { name: '复制此段链接', exact: true }),
    ).toBeEnabled();
    await page.keyboard.press('Escape');
    await expect(options).toHaveCount(0);
    await exerciseDocumentBlockActions(page);
    const fixture = JSON.parse(
      await readFile(
        path.resolve(
          __dirname,
          '../../fixtures/ai-canvas/whiteboard-basic.verd.json',
        ),
        'utf8',
      ),
    );
    await page
      .locator('input[accept=".json,.verd.json,.verd-doc.json,.md,.markdown"]')
      .setInputFiles({
        name: 'Link canvas.verd.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(fixture)),
      });
    await page
      .locator('.file-tree-name')
      .filter({ hasText: fixture.frame.name })
      .click();
    const node = page.locator(
      '.workspace-pane.is-active [data-cell-id="shape-request"]',
    );
    await node.dblclick();
    const nodeEditor = node.locator('.ProseMirror');
    await nodeEditor.press('ControlOrMeta+a');
    await nodeEditor.press('ControlOrMeta+k');
    const linkDialog = page.getByRole('dialog', {
      name: '编辑链接',
      exact: true,
    });
    const target = linkDialog.getByRole('combobox', {
      name: '搜索工作区或输入网址',
    });
    await target.click();
    await target.fill('Block actions');
    await linkDialog
      .getByRole('option', { name: /^Block actions/ })
      .first()
      .click();
    await expect(target).toHaveValue('Block actions');
    await expect(linkDialog).not.toContainText('verd://');
    await expect(nodeEditor.locator('a')).toHaveCount(0);
    await linkDialog.getByRole('button', { name: '保存', exact: true }).click();
    await expect(nodeEditor.locator('a')).toHaveAttribute(
      'href',
      'verd://file/block-actions',
    );
    await expect(nodeEditor).toBeFocused();
    await nodeEditor.press('ControlOrMeta+k');
    await expect(target).toHaveValue('Block actions');
    await page.keyboard.press('Escape');
    await expect(linkDialog).toBeHidden();
    await expect(nodeEditor).toBeFocused();
    await nodeEditor.press('Escape');
    await node.locator('a').click({ modifiers: ['ControlOrMeta'] });
    await expect(activeTabTitle(page)).toHaveText('Block actions');
    const remoteDenied = await desktop.evaluate(async ({ BrowserWindow }) => {
      return BrowserWindow.getAllWindows()[0].webContents.mainFrame.frames
        .length;
    });
    expect(remoteDenied).toBe(0);
  } finally {
    await desktop.close();
    await rm(directory, { recursive: true, force: true });
  }
});
