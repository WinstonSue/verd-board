import { electron, writeDesktopLauncher } from './desktop-launcher';
import { openWorkspaceMenu } from '../../web-e2e/src/app-actions';
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
    await writeDesktopLauncher(launcher, userData);
    desktop = await electron.launch({
      args: [launcher],
      env: {
        ...process.env,
        VERDBOARD_WORKSPACE_PATH: project,
        VERD_AGENT_RESOURCES: resources!,
      },
    });
    const page = await desktop.firstWindow();
    await expect(page.locator('.workspace-shell')).toBeVisible({
      timeout: 60000,
    });
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
    await openWorkspaceMenu(page);
    await page.getByTestId('workspace-open-settings').click();
    await page.getByTestId('settings-nav-workspace.data').click();
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
    const closed = page.waitForEvent('close');
    await desktop.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].close(),
    );
    await closed;
    await desktop.close();
    desktop = undefined;
  } finally {
    await desktop?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
