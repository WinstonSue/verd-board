import { openProductHome } from '../../web-e2e/src/app-actions';
import { electron, writeDesktopLauncher } from './desktop-launcher';
import { test, expect, type ElectronApplication } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// eslint-disable-next-line no-empty-pattern -- Electron owns its window; no browser fixture is needed.
test('Document authoring recommendations follows template links and remains read only across restart', async ({}, info) => {
  test.setTimeout(240_000);
  const directory = await mkdtemp(path.join(tmpdir(), 'verd-patterns-e2e-'));
  const source = path.resolve(
    __dirname,
    '../../../packages/agent/patterns/workspace/范式导航.verd-doc.json',
  );
  const original = await readFile(source, 'utf8');
  let desktop: ElectronApplication | undefined;
  try {
    const userData = path.join(directory, 'user-data');
    await mkdir(userData);
    const launcher = path.join(directory, 'launch.cjs');
    await writeDesktopLauncher(launcher, userData);
    desktop = await electron.launch({
      args: [launcher],
      env: {
        ...process.env,
        VERDBOARD_WORKSPACE_PATH: path.join(directory, 'initial'),
      },
    });
    const page = await desktop.firstWindow();
    await expect(page.locator('.workspace-shell')).toBeVisible();
    await (
      await openProductHome(page)
    )
      .getByTestId('workspace-open-patterns')
      .click();
    await expect(page.getByRole('tab', { selected: true })).toContainText(
      '文档编写推荐库',
    );
    await expect(
      page.locator('.workspace-pane.is-active .board-document-content h1'),
    ).toHaveText('文档编写推荐库');
    const active = () => page.locator('.workspace-pane.is-active');
    const followLink = async (fileId: string, title: string) => {
      await active()
        .locator(`a[href="verd://file/${encodeURIComponent(fileId)}"]`)
        .first()
        .click({ modifiers: ['ControlOrMeta'] });
      await expect(active().locator('.board-document-content h1')).toHaveText(
        title,
      );
    };
    const returnToDocument = async (title: string) => {
      await active().getByTestId('navigation-return').click();
      await expect(active().locator('.board-document-content h1')).toHaveText(
        title,
      );
    };
    for (const [id, title] of [
      ['technical-proposal', '技术方案'],
      ['adr', 'ADR 决策记录'],
      ['system-design', '系统设计'],
      ['requirements', '需求梳理'],
    ]) {
      await followLink(`pattern:${id}`, title);
      await page.screenshot({ path: info.outputPath(`template-${id}.png`) });
      await returnToDocument('文档编写推荐库');
    }
    await followLink('pattern-guide:rich-document', '富文本文档 · 编写规则');
    await followLink('pattern:rich-document', '方案正文');
    await page.screenshot({
      path: info.outputPath('template-rich-document.png'),
    });
    await returnToDocument('富文本文档 · 编写规则');
    await returnToDocument('文档编写推荐库');
    await followLink(
      'pattern-guide:multi-system',
      '导航与多系统方案 · 编写规则',
    );
    await active()
      .getByRole('link', { name: '打开原生模板', exact: true })
      .click({ modifiers: ['ControlOrMeta'] });
    await expect(
      active().locator(
        'svg[data-surface="root"][data-instance-id="pattern:multi-system/pattern:multi/overview"]',
      ),
    ).toBeVisible();
    await returnToDocument('导航与多系统方案 · 编写规则');
    const navigationTemplate = page.locator(
      '.file-tree-name[title="multi-system/文档导航.verd-doc.json"]',
    );
    if (!(await navigationTemplate.isVisible()))
      await page
        .getByRole('button', { name: 'multi-system', exact: true })
        .click();
    await navigationTemplate.click();
    await expect(active().locator('.board-document-content h1')).toHaveText(
      '文档导航',
    );
    await page.screenshot({
      path: info.outputPath('template-multi-system.png'),
    });
    await page
      .locator('.file-tree-name[title="范式导航.verd-doc.json"]')
      .click();
    await expect(active().locator('.board-document-content h1')).toHaveText(
      '文档编写推荐库',
    );
    const copied = path.join(
      userData,
      'workspaces/agent-patterns/范式导航.verd-doc.json',
    );
    await expect(page.getByTestId('workspace-readonly')).toHaveText('只读');
    const editor = active().locator('.ProseMirror');
    await expect(editor).toHaveAttribute('contenteditable', 'false');
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type('Read only edit attempt');
    await expect(editor).not.toContainText('Read only edit attempt');
    expect(await readFile(copied, 'utf8')).toBe(original);
    const closed = page.waitForEvent('close');
    await desktop.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].close(),
    );
    await closed;
    await desktop.close();
    desktop = undefined;
    expect(await readFile(copied, 'utf8')).toBe(original);
    desktop = await electron.launch({
      args: [launcher],
      env: { ...process.env },
    });
    const restored = await desktop.firstWindow();
    await expect(restored.getByTestId('workspace-readonly')).toBeVisible();
    await expect(
      restored.locator('.workspace-pane.is-active .ProseMirror'),
    ).toHaveAttribute('contenteditable', 'false');
    expect(await readFile(source, 'utf8')).toBe(original);
  } finally {
    await desktop?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
