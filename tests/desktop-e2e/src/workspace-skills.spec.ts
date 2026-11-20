import { test, expect, type ElectronApplication } from '@playwright/test';
import { electron, writeDesktopLauncher } from './desktop-launcher';
import { openSettings } from '../../web-e2e/src/app-actions';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { exerciseDefaultSkillViewer } from '../../web-e2e/src/default-skill-viewer-actions';

test('Desktop default Skills use the readonly document editor in light and dark appearance', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'verd-skill-viewer-'));
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
        VERDBOARD_WORKSPACE_PATH: path.join(directory, 'workspace'),
      },
    });
    const page = await desktop.firstWindow();
    await expect(page.locator('.workspace-shell')).toBeVisible({
      timeout: 60000,
    });
    await exerciseDefaultSkillViewer(page, () =>
      desktop!.evaluate(({ clipboard }) => clipboard.readText()),
    );
  } finally {
    await desktop?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('Desktop edits standard workspace Skills and preserves an external edit over a stale draft', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'verd-skills-e2e-'));
  let desktop: ElectronApplication | undefined;
  try {
    const userData = path.join(directory, 'user-data');
    const project = path.join(directory, 'project');
    await mkdir(userData);
    await mkdir(project);
    const launcher = path.join(directory, 'launch.cjs');
    await writeDesktopLauncher(launcher, userData);
    desktop = await electron.launch({
      args: [launcher],
      env: { ...process.env, VERDBOARD_WORKSPACE_PATH: project },
    });
    let page = await desktop.firstWindow();
    await expect(page.locator('.workspace-shell')).toBeVisible({
      timeout: 60000,
    });
    await openSettings(page);
    await page.getByTestId('settings-nav-workspace.skills').click();
    await expect(page.getByTestId('workspace-skill-default')).toBeInViewport();
    await page.getByTestId('workspace-skill-default').click();
    const viewer = page.getByTestId('workspace-default-skill-viewer');
    await viewer.getByTestId('workspace-default-skill-source').click();
    await expect(viewer).toContainText('name: verd-authoring');
    await viewer
      .getByRole('button', { name: '内容编写规范', exact: true })
      .click();
    await expect(viewer.getByTestId('workspace-skill-guide')).toContainText(
      '通用表达与事实',
    );
    await viewer.screenshot({
      path: test.info().outputPath('content-guide.png'),
    });
    await viewer.getByTestId('workspace-default-skill-source').click();
    await expect(viewer.getByTestId('workspace-skill-guide')).toContainText(
      '# 内容编写规范',
    );
    await viewer
      .getByRole('button', { name: '汇报与讲解场景', exact: true })
      .click();
    await expect(viewer.getByTestId('workspace-skill-guide')).toContainText(
      '事故与失败复盘',
    );
    await viewer
      .getByRole('button', { name: '图表编写规范', exact: true })
      .click();
    await expect(viewer.getByTestId('workspace-skill-guide')).toContainText(
      '图表的信息价值与表达',
    );
    await viewer.getByTestId('workspace-default-skill-back').click();
    await page
      .getByTestId('workspace-skill-description')
      .fill('Project writing requirements');
    await page.getByTestId('workspace-skill-body').fill('Use Chinese.');
    await page.getByTestId('workspace-skill-body').press('ControlOrMeta+Enter');
    const skill = path.join(project, '.agents/skills/verd-workspace/SKILL.md');
    await expect
      .poll(() => readFile(skill, 'utf8').catch(() => ''))
      .toContain('Use Chinese.');
    await expect(page.getByTestId('workspace-skill-save')).toBeDisabled();
    await page.getByTestId('workspace-skill-body').fill('Unsaved local draft');
    const external = (await readFile(skill, 'utf8')).replace(
      'Use Chinese.',
      'External terminology.',
    );
    await writeFile(skill, external);
    await expect(page.getByTestId('workspace-skills-settings')).toContainText(
      '文件已被外部修改',
    );
    await page.getByTestId('workspace-skill-save').click();
    await expect(page.getByTestId('workspace-skills-settings')).toContainText(
      '请重新加载',
    );
    expect(await readFile(skill, 'utf8')).toBe(external);
    await page.getByTestId('workspace-skill-reload').click();
    await expect(page.getByTestId('workspace-skill-body')).toHaveValue(
      'External terminology.',
    );
    await page.getByTestId('settings-nav-workspace.custom-skills').click();
    await page.getByTestId('workspace-custom-skill-new').click();
    await page
      .getByTestId('workspace-custom-skill-name')
      .fill('domain-writing');
    await page
      .getByTestId('workspace-skill-description')
      .fill('Domain requirements');
    await page
      .getByTestId('workspace-skill-body')
      .fill('Use bounded context terms.');
    await page.getByTestId('workspace-skill-body').press('ControlOrMeta+Enter');
    const customFile = path.join(
      project,
      '.agents/skills/domain-writing/SKILL.md',
    );
    await expect
      .poll(() => readFile(customFile, 'utf8').catch(() => ''))
      .toContain('name: domain-writing');
    await expect(page.getByTestId('workspace-skill-remove')).toBeEnabled();
    const foreign = path.join(project, '.agents/skills/foreign-skill/SKILL.md');
    await mkdir(path.dirname(foreign), { recursive: true });
    await writeFile(
      foreign,
      '---\nname: foreign-skill\ndescription: Foreign writing instructions\nlicense: MIT\n---\nPreserve optional metadata.',
    );
    await expect(
      page
        .getByTestId('workspace-skill-scope')
        .locator('option', { hasText: 'foreign-skill' }),
    ).toHaveCount(1);
    await page
      .getByTestId('workspace-skill-scope')
      .selectOption({ label: 'foreign-skill' });
    await expect(page.getByTestId('workspace-skill-body')).toHaveValue(
      'Preserve optional metadata.',
    );
    await page
      .getByTestId('workspace-skill-body')
      .fill('Updated external Skill.');
    await page.getByTestId('workspace-skill-body').press('ControlOrMeta+Enter');
    await expect
      .poll(() => readFile(foreign, 'utf8'))
      .toContain('Updated external Skill.');
    expect(await readFile(foreign, 'utf8')).toContain('license: MIT');
    await page.getByTestId('my-back').click();
    await expect(page.locator('[data-entry-path=".agents"]')).toHaveCount(0);
    await desktop.close();
    desktop = undefined;
    desktop = await electron.launch({
      args: [launcher],
      env: { ...process.env, VERDBOARD_WORKSPACE_PATH: project },
    });
    page = await desktop.firstWindow();
    await expect(page.locator('.workspace-shell')).toBeVisible({
      timeout: 60000,
    });
    await openSettings(page);
    await page.getByTestId('settings-nav-workspace.custom-skills').click();
    await expect(page.getByTestId('workspace-skill-body')).toHaveValue(
      'Use bounded context terms.',
    );
    await page.getByTestId('settings-nav-workspace.skills').click();
    await expect(page.getByTestId('workspace-skill-body')).toHaveValue(
      'External terminology.',
    );
    await page
      .getByTestId('workspace-skill-body')
      .fill('Saved before Desktop shutdown.');
    const closed = page.waitForEvent('close');
    await desktop.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].close(),
    );
    await closed;
    expect(await readFile(skill, 'utf8')).toContain(
      'Saved before Desktop shutdown.',
    );
  } finally {
    await desktop?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
