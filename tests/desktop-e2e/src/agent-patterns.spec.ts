import { electron, writeDesktopLauncher } from './desktop-launcher';
import { openWorkspaceMenu } from '../../web-e2e/src/app-actions';
import { test, expect, type ElectronApplication } from '@playwright/test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// eslint-disable-next-line no-empty-pattern -- Electron owns its window; no browser fixture is needed.
test('Document authoring recommendations follows template links and preserves edits on subsequent opens and restart', async ({}, info) => {
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
    await openWorkspaceMenu(page);
    await page.getByTestId('workspace-open-patterns').click();
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
    const local = JSON.parse(await readFile(copied, 'utf8'));
    local.title = '本地范式副本';
    await writeFile(copied, JSON.stringify(local, null, 2));
    await expect(page.getByRole('tab', { selected: true })).toContainText(
      '本地范式副本',
    );
    await openWorkspaceMenu(page);
    await page.getByTestId('workspace-open-patterns').click();
    expect(JSON.parse(await readFile(copied, 'utf8')).title).toBe(
      '本地范式副本',
    );
    expect(await readFile(source, 'utf8')).toBe(original);
    const editor = active().locator('.board-document-content');
    await editor.click();
    await editor.press('ControlOrMeta+End');
    await editor.press('Enter');
    await editor.pressSequentially('Pattern library edit survives restart.');
    await expect(editor).toContainText(
      'Pattern library edit survives restart.',
    );
    const closed = page.waitForEvent('close');
    await desktop.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].close(),
    );
    await closed;
    await desktop.close();
    desktop = undefined;
    expect(JSON.parse(await readFile(copied, 'utf8')).text.plainText).toContain(
      'Pattern library edit survives restart.',
    );
    desktop = await electron.launch({
      args: [launcher],
      env: { ...process.env },
    });
    const restored = await desktop.firstWindow();
    await expect(
      restored.locator('.workspace-pane.is-active .board-document-content'),
    ).toContainText('Pattern library edit survives restart.');
    expect(await readFile(source, 'utf8')).toBe(original);
  } finally {
    await desktop?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
