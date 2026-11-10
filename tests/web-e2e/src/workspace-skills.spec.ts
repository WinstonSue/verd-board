import { expect, test, type Page } from './service-fixture';
import { openSettings } from './app-actions';
async function chooseScope(page: Page, label: string) {
  await page.getByTestId('workspace-skill-scope').selectOption({ label });
}

test('workspace settings persist common and pattern Skills and recycle only the supplement', async ({
  page,
}) => {
  await page.goto('/');
  await openSettings(page);
  await page.getByTestId('settings-nav-workspace.skills').click();
  await expect(page.getByTestId('workspace-skill-default')).toBeInViewport();
  await page
    .getByTestId('workspace-skill-description')
    .fill('Project terminology and language');
  await page
    .getByTestId('workspace-skill-body')
    .fill('Use Chinese and project terminology.');
  await page.getByTestId('workspace-skill-body').press('ControlOrMeta+Enter');
  await expect(page.getByTestId('workspace-skill-save')).toBeDisabled();
  await chooseScope(page, '分层架构');
  await page
    .getByTestId('workspace-skill-body')
    .fill('Describe responsibilities before interfaces.');
  await page.getByTestId('workspace-skill-body').press('ControlOrMeta+Enter');
  await expect(page.getByTestId('workspace-skill-save')).toBeDisabled();
  await page.getByTestId('workspace-skill-default').click();
  await expect(page.getByTestId('workspace-skill-guide')).not.toBeEmpty();
  const viewer = page.getByTestId('workspace-default-skill-viewer');
  await viewer
    .getByRole('button', { name: 'verd-architecture', exact: true })
    .click();
  await viewer.getByTestId('workspace-default-skill-source').click();
  await expect(viewer).toContainText('name: verd-architecture');
  await viewer
    .getByRole('button', { name: '分层架构 · 编写规则', exact: true })
    .click();
  await expect(viewer.getByTestId('workspace-skill-guide')).not.toBeEmpty();
  await viewer
    .getByRole('button', { name: '关闭默认 Skill', exact: true })
    .click();
  await page.getByTestId('my-back').click();
  await expect(page.locator('[data-entry-path=".agents"]')).toHaveCount(0);
  await page.reload();
  await openSettings(page);
  await page.getByTestId('settings-nav-workspace.skills').click();
  await expect(page.getByTestId('workspace-skill-body')).toHaveValue(
    'Use Chinese and project terminology.',
  );
  await chooseScope(page, '分层架构');
  await expect(page.getByTestId('workspace-skill-body')).toHaveValue(
    'Describe responsibilities before interfaces.',
  );
  await page.getByTestId('workspace-skill-remove').click();
  await expect(page.getByTestId('workspace-skill-body')).toHaveValue('');
  await chooseScope(page, '工作区通用');
  await expect(page.getByTestId('workspace-skill-body')).toHaveValue(
    'Use Chinese and project terminology.',
  );
});

test('independent custom Skills can be created, edited, reopened and deleted from their own settings entry', async ({
  page,
}) => {
  await page.goto('/');
  await openSettings(page);
  await page.getByTestId('settings-nav-workspace.custom-skills').click();
  await expect(page.getByTestId('workspace-custom-skill-empty')).toBeVisible();
  await page.getByTestId('workspace-custom-skill-new').click();
  await page.getByTestId('workspace-custom-skill-name').fill('domain-writing');
  await page
    .getByTestId('workspace-skill-description')
    .fill('Domain writing instructions');
  await page
    .getByTestId('workspace-skill-body')
    .fill('Use project terminology.');
  await page.getByTestId('workspace-skill-body').press('ControlOrMeta+Enter');
  await expect(page.getByTestId('workspace-skill-remove')).toBeEnabled();
  await expect(page.getByTestId('workspace-custom-skill-name')).toHaveAttribute(
    'readonly',
    '',
  );
  await page
    .getByTestId('workspace-skill-body')
    .fill('Updated domain terminology.');
  await page.getByTestId('settings-nav-workspace.skills').click();
  await page.getByTestId('settings-nav-workspace.custom-skills').click();
  await expect(page.getByTestId('workspace-skill-body')).toHaveValue(
    'Updated domain terminology.',
  );
  await page.getByTestId('my-back').click();
  await page.reload();
  await openSettings(page);
  await page.getByTestId('settings-nav-workspace.custom-skills').click();
  await expect(page.getByTestId('workspace-skill-scope')).toHaveValue(
    '.agents/skills/domain-writing/SKILL.md',
  );
  await page.getByTestId('workspace-custom-skill-new').click();
  await page.getByTestId('workspace-custom-skill-name').fill('domain-writing');
  await page.getByTestId('workspace-skill-description').fill('Duplicate');
  await page.getByTestId('workspace-skill-body').fill('Must not overwrite');
  await page.getByTestId('workspace-skill-save').click();
  await expect(page.getByTestId('workspace-skills-settings')).toContainText(
    '同名 Skill 已存在',
  );
  await page.getByTestId('workspace-custom-skill-cancel').click();
  await expect(page.getByTestId('workspace-skill-body')).toHaveValue(
    'Updated domain terminology.',
  );
  await page.getByTestId('workspace-skill-remove').click();
  await expect(page.getByTestId('workspace-custom-skill-empty')).toBeVisible();
});
