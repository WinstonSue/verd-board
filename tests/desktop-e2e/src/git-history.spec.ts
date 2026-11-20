import {
  initializeVersions,
  openVersionSettings,
  closeVersionSettings,
  openScopedVersions,
} from '../../web-e2e/src/version-actions';
import { test, expect, type ElectronApplication } from '@playwright/test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { electron, writeDesktopLauncher } from './desktop-launcher';

const execute = promisify(execFile);
let directory: string;
let desktop: ElectronApplication | undefined;
test.beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'verd-desktop-git-e2e-'));
});
test.afterEach(async () => {
  await desktop?.close();
  desktop = undefined;
  await rm(directory, { recursive: true, force: true });
});

test('Desktop Git commits one file, preserves external staging and restores without advancing HEAD', async () => {
  const workspace = path.join(directory, 'workspace'),
    userData = path.join(directory, 'user-data');
  await mkdir(workspace);
  await mkdir(userData);
  await writeFile(path.join(workspace, 'notes.txt'), 'Before Git');
  const launcher = path.join(directory, 'launch.cjs');
  await writeDesktopLauncher(launcher, userData);
  desktop = await electron.launch({
    args: [launcher],
    env: { ...process.env, VERDBOARD_WORKSPACE_PATH: workspace },
  });
  const page = await desktop.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.stack ?? error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  try {
    await expect(page.locator('.workspace-shell')).toBeVisible({
      timeout: 60000,
    });
  } catch (error) {
    await test.info().attach('renderer-errors', {
      body: errors.join('\n'),
      contentType: 'text/plain',
    });
    await test.info().attach('renderer-body', {
      body: await page.locator('body').innerText(),
      contentType: 'text/plain',
    });
    throw error;
  }

  const settings = await initializeVersions(page);
  await settings
    .getByRole('textbox', { name: '版本说明', exact: true })
    .fill('Baseline');
  await settings
    .getByRole('button', { name: '为全部更改创建版本', exact: true })
    .click();
  await expect(settings.locator('.workspace-git-log article')).toHaveCount(1);
  const git = async (...args: string[]) =>
    (await execute('git', ['-C', workspace, ...args])).stdout.trim();
  const first = await git('rev-parse', 'HEAD');
  await closeVersionSettings(page);
  await writeFile(path.join(workspace, 'notes.txt'), 'After version');
  await writeFile(path.join(workspace, 'other.txt'), 'External staged content');
  await git('add', '--', 'other.txt');
  const dialog = await openScopedVersions(page, 'notes.txt');
  await expect(dialog).not.toContainText('Git');
  await expect(dialog).not.toContainText('other.txt');
  await dialog
    .getByRole('textbox', { name: '版本说明', exact: true })
    .fill('File update');
  await dialog
    .getByRole('button', { name: '为此文件创建版本', exact: true })
    .click();
  await expect(dialog.locator('.workspace-git-log article')).toHaveCount(2);
  expect(await git('show', 'HEAD:notes.txt')).toBe('After version');
  expect(await git('diff', '--cached', '--name-only')).toBe('other.txt');
  const head = await git('rev-parse', 'HEAD');
  await dialog
    .locator('.workspace-git-log article')
    .filter({ hasText: 'Baseline' })
    .getByRole('button', { name: '恢复此版本…', exact: true })
    .click();
  await dialog
    .getByRole('region', { name: '恢复预览', exact: true })
    .getByRole('button', { name: '确认恢复', exact: true })
    .click();
  await expect
    .poll(() => readFile(path.join(workspace, 'notes.txt'), 'utf8'))
    .toBe('Before Git');
  expect(await git('rev-parse', 'HEAD')).toBe(head);
  expect(await git('rev-list', '--count', 'HEAD')).toBe('2');
  expect(await git('show', `${first}:notes.txt`)).toBe('Before Git');
  expect(await git('diff', '--cached', '--name-only')).toBe('other.txt');
});

test('Desktop opens a project document directory and leaves repository operations with the project', async () => {
  const project = path.join(directory, 'project');
  const workspace = path.join(project, 'docs');
  const userData = path.join(directory, 'user-data');
  await mkdir(workspace, { recursive: true });
  await mkdir(userData);
  await writeFile(
    path.join(project, '.verd.config.json'),
    JSON.stringify({ workspace: 'docs' }),
  );
  await writeFile(path.join(project, 'code.txt'), 'Original code');
  await writeFile(path.join(workspace, 'notes.txt'), 'Original document');
  const git = async (...args: string[]) =>
    (await execute('git', ['-C', project, ...args])).stdout.trim();
  await git('init', '--initial-branch=main');
  await git('config', 'user.name', 'Project Writer');
  await git('config', 'user.email', 'project@example.com');
  await git('add', '.');
  await git('commit', '-m', 'Project baseline');
  const launcher = path.join(directory, 'launch.cjs');
  await writeDesktopLauncher(launcher, userData);
  desktop = await electron.launch({
    args: [launcher],
    env: { ...process.env, VERDBOARD_WORKSPACE_PATH: workspace },
  });
  const page = await desktop.firstWindow();
  await expect(page.locator('.workspace-shell')).toBeVisible({
    timeout: 60000,
  });
  await writeFile(path.join(project, 'code.txt'), 'Staged code');
  await git('add', 'code.txt');
  await writeFile(path.join(workspace, 'notes.txt'), 'Edited document');
  const dialog = await openScopedVersions(page, 'notes.txt');
  await dialog
    .getByRole('textbox', { name: '版本说明', exact: true })
    .fill('Document update');
  await dialog
    .getByRole('button', { name: '为此文件创建版本', exact: true })
    .click();
  await expect(dialog.locator('.workspace-git-log article')).toHaveCount(2);
  expect(await git('show', 'HEAD:code.txt')).toBe('Original code');
  expect(await git('show', ':code.txt')).toBe('Staged code');
  expect(await git('show', 'HEAD:docs/notes.txt')).toBe('Edited document');
  await page.keyboard.press('Escape');
  const settings = await openVersionSettings(page);
  await settings
    .getByRole('button', { name: '存储与同步', exact: true })
    .click();
  await expect(settings).toContainText('沿用项目 Git');
  await expect(settings.locator('.workspace-git-remote')).toHaveCount(0);
  await expect(settings.locator('.workspace-git-purge')).toHaveCount(0);
  await expect(
    settings.getByRole('button', { name: '初始化 Git 仓库', exact: true }),
  ).toHaveCount(0);
});
