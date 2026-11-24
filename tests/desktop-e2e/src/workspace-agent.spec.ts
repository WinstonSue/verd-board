import { electron, writeDesktopLauncher } from './desktop-launcher';
import { openWorkspaceMenu } from '../../web-e2e/src/app-actions';
import { prepareFakeCodex } from '../../fixtures/codex-test-cli';
import { test, expect, type ElectronApplication } from '@playwright/test';
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  realpath,
} from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('new Desktop workspace exposes project context and built-in tools to an external agent', async () => {
  const resources = process.env['VERD_AGENT_RESOURCE_TEST_PATH'];
  test.skip(
    !resources,
    'Set VERD_AGENT_RESOURCE_TEST_PATH to an isolated prepared agent bundle',
  );
  const directory = await mkdtemp(path.join(tmpdir(), 'verd-project-e2e-'));
  let desktop: ElectronApplication | undefined;
  try {
    const userData = path.join(directory, 'user-data'),
      project = path.join(directory, 'Project with spaces');
    const codex = await prepareFakeCodex(directory);
    await mkdir(userData);
    await mkdir(project);
    await writeFile(
      path.join(project, 'AGENTS.md'),
      '# Existing project\nPreserve this.\n',
    );
    for (const [id, title] of [
      ['project-home', 'Project Home'],
      ['project-overview', 'Project Overview'],
    ]) {
      await writeFile(
        path.join(project, `${id}.verd-doc.json`),
        JSON.stringify({
          format: 'verd-document',
          version: 1,
          id,
          title,
          text: {
            schemaVersion: 1,
            id,
            kind: 'block',
            plainText: title,
            content: {
              type: 'doc',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: title }] },
              ],
            },
          },
        }),
      );
    }
    const launcher = path.join(directory, 'launch.cjs');
    await writeDesktopLauncher(launcher, userData, codex.preload);
    desktop = await electron.launch({
      args: [launcher],
      env: {
        ...process.env,
        VERDBOARD_WORKSPACE_PATH: project,
        VERD_AGENT_RESOURCES: resources!,
        VERDBOARD_CODEX_PATH: codex.executable,
      },
    });
    const page = await desktop.firstWindow();
    await expect(page.locator('.workspace-shell')).toBeVisible({
      timeout: 60000,
    });
    expect(await readFile(path.join(project, 'AGENTS.md'), 'utf8')).toBe(
      '# Existing project\nPreserve this.\n',
    );
    await openWorkspaceMenu(page);
    await page.getByTestId('workspace-open-settings').click();
    await page.getByTestId('settings-nav-workspace.data').click();
    await page
      .getByRole('button', { name: '启用或修复编写工具', exact: true })
      .click();
    await expect
      .poll(async () =>
        (await readFile(path.join(project, 'AGENTS.md'), 'utf8')).includes(
          'verdscrolls:agent:start',
        ),
      )
      .toBe(true);
    expect(
      (await readFile(path.join(project, 'AGENTS.md'), 'utf8')).startsWith(
        '# Existing project\nPreserve this.\n',
      ),
    ).toBe(true);
    const shared = await realpath(path.join(project, '.verdscrolls/shared'));
    expect(
      shared.startsWith(await realpath(path.join(userData, 'agent-resources'))),
    ).toBe(true);
    const verd = path.join(
      project,
      '.verdscrolls/shared/bin',
      process.platform === 'win32' ? 'verd.cmd' : 'verd',
    );
    function context() {
      const result = spawnSync(verd, ['context', '--json'], {
        cwd: project,
        env: { ...process.env, PATH: '/usr/bin:/bin' },
        encoding: 'utf8',
        shell: process.platform === 'win32',
      });
      expect(result.status, result.stderr).toBe(0);
      return JSON.parse(result.stdout);
    }
    expect(context().agent.ready).toBe(true);
    await expect(page.getByTestId('workspace-agent-status')).toContainText(
      '已就绪',
    );
    await page.getByTestId('settings-nav-workspace.project').click();
    await page
      .getByTestId('workspace-settings-description')
      .fill('Frontend delivery project');
    await page.getByTestId('workspace-settings-description').press('Tab');
    await expect
      .poll(() => context().description)
      .toBe('Frontend delivery project');
    await page
      .getByTestId('workspace-entry-documents')
      .getByRole('button', { name: '添加入口…', exact: true })
      .click();
    const picker = page.getByRole('dialog', {
      name: '添加阅读入口',
      exact: true,
    });
    await picker.getByRole('button', { name: /^添加 Project Home / }).click();
    await expect
      .poll(() => context().entryDocumentIds)
      .toEqual(['project-home']);
    await picker
      .getByRole('button', { name: /^添加 Project Overview / })
      .click();
    await expect
      .poll(() => context().entryDocumentIds)
      .toEqual(['project-home', 'project-overview']);
    await page.getByRole('button', { name: '返回工作区', exact: true }).click();
    await page
      .locator(
        '.file-tree-file[data-file-id="project-overview"] .file-tree-main',
      )
      .click();
    await page
      .locator('.workspace-pane.is-active')
      .getByTestId('document-agent-launch')
      .click();
    const agent = page.getByTestId('workspace-agent-dialog');
    await agent
      .getByRole('textbox', { name: '任务', exact: true })
      .fill('fixture-answer');
    await agent.getByRole('button', { name: '快速执行', exact: true }).click();
    await expect(
      agent.getByText('Codex ran in ' + (await realpath(project)), {
        exact: true,
      }),
    ).toBeVisible();
    await desktop.evaluate(({ shell }) => {
      shell.openExternal = async (target) => {
        (globalThis as { codexHandoff?: string }).codexHandoff = target;
      };
    });
    const task = agent.getByRole('textbox', { name: '任务', exact: true });
    await task.fill('继续处理任务 & 附件');
    await agent
      .getByRole('button', { name: '在 Codex 中继续', exact: true })
      .click();
    const projectRoot = await realpath(project);
    await expect
      .poll(() =>
        desktop!.evaluate(
          () => (globalThis as { codexHandoff?: string }).codexHandoff,
        ),
      )
      .toMatch(/^codex:\/\/threads\/new\?/);
    const handoff = new URL(
      (await desktop.evaluate(
        () => (globalThis as { codexHandoff?: string }).codexHandoff,
      ))!,
    );
    expect(handoff.searchParams.get('path')).toBe(projectRoot);
    expect(handoff.searchParams.get('prompt')).toContain('继续处理任务 & 附件');
    expect(handoff.searchParams.get('prompt')).toContain(
      'project-overview.verd-doc.json',
    );

    await agent.getByRole('button', { name: '关闭', exact: true }).click();
    await page
      .locator('.file-tree-file[data-file-id="project-home"] .file-tree-main')
      .click({ button: 'right' });
    await page
      .getByRole('menuitem', { name: '发起 Agent', exact: true })
      .click();
    await task.fill('fixture-edit');
    await agent.getByRole('button', { name: '快速执行', exact: true }).click();
    const apply = agent.getByRole('button', { name: '应用改动', exact: true });
    await expect(apply).toBeEnabled();
    const document = path.join(project, 'project-home.verd-doc.json');
    expect(JSON.parse(await readFile(document, 'utf8')).text.plainText).toBe(
      'Project Home',
    );
    await apply.click();
    await expect(
      agent.getByText('改动已应用。', { exact: true }),
    ).toBeVisible();
    expect(JSON.parse(await readFile(document, 'utf8')).text.plainText).toBe(
      'Reviewed Codex change',
    );

    const pidFile = path.join(project, '.verdscrolls/codex-fixture.pid');
    await task.fill('fixture-cancel');
    await agent.getByRole('button', { name: '快速执行', exact: true }).click();
    await expect
      .poll(() => readFile(pidFile, 'utf8').catch(() => ''))
      .toMatch(/^\d+$/);
    const pid = Number(await readFile(pidFile, 'utf8'));
    const closed = page.waitForEvent('close');
    await desktop.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].close(),
    );
    await closed;
    await desktop.close();
    desktop = undefined;
    await expect
      .poll(() => {
        try {
          process.kill(pid, 0);
          return true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
          throw error;
        }
      })
      .toBe(false);
  } finally {
    await desktop?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
