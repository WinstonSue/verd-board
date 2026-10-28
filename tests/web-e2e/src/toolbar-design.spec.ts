import { expect, test, type Page } from '@playwright/test';
import { createArchitectureFrameSnapshot } from '../../../packages/engine/architecture/src/cell-commands';
import {
  createCellStore,
  createFrameCell,
} from '../../../packages/engine/core/src/cell/types';
import { createMindFrameSnapshot } from '../../../packages/engine/mind/src/cell-commands';
import { createWorkflowFrameSnapshot } from '../../../packages/engine/workflow/src/cell-commands';
import {
  createUmlClassFrameSnapshot,
  createUmlSequenceFrameSnapshot,
} from '../../../packages/engine/uml/src/model';
import { setAppLanguage } from './app-actions';

const toolbar = (page: Page) =>
  page.getByRole('toolbar', { name: 'Drawing tools' });
const canvas = (page: Page) =>
  page.locator('svg[aria-label="Frame canvas"][data-surface="root"]:visible');
const scenarios = [
  {
    name: 'board',
    snapshot: () => ({ store: createCellStore(createFrameCell('frame')) }),
  },
  {
    name: 'mind',
    snapshot: () => createMindFrameSnapshot('frame', 'topic'),
    action: 'mind.root',
    kind: 'mind-root',
  },
  {
    name: 'workflow',
    snapshot: () => createWorkflowFrameSnapshot('frame', 'topic'),
    action: 'workflow.task',
    kind: 'workflow-task',
  },
  {
    name: 'architecture',
    snapshot: () => createArchitectureFrameSnapshot('frame', 'topic'),
    action: 'architecture.box',
    kind: 'architecture-module',
  },
  {
    name: 'uml-class',
    snapshot: () => createUmlClassFrameSnapshot('frame', 'topic'),
    action: 'uml.add-class',
    kind: 'uml-class',
  },
  {
    name: 'uml-sequence',
    snapshot: () => createUmlSequenceFrameSnapshot('frame', 'topic'),
    action: 'uml.add-participant',
    kind: 'uml-participant',
  },
];

for (const [appearance, language] of [
  ['light', 'zh'],
  ['dark', 'en'],
] as const) {
  test(`all canvas tool rails are compact and usable in ${appearance} ${language}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.emulateMedia({ colorScheme: appearance });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const skip = page.getByRole('button', { name: '跳过', exact: true });
    if (await skip.isVisible()) await skip.click();
    await setAppLanguage(page, language);
    for (const scenario of scenarios) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/');
      await page
        .locator('.file-tree-header')
        .getByRole('button', {
          name: language === 'zh' ? '新建画布' : 'New canvas',
          exact: true,
        })
        .click();
      await expect(
        page.locator('.workspace-pane.is-active').getByTestId('verd-board'),
      ).toBeVisible();
      await page
        .locator('.workspace-pane.is-active')
        .locator('input[type="file"][accept^="application/json"]')
        .nth(1)
        .setInputFiles({
          name: `${scenario.name}.json`,
          mimeType: 'application/json',
          buffer: Buffer.from(JSON.stringify(scenario.snapshot())),
        });
      await expect(toolbar(page)).toBeVisible();
      await expect(
        page
          .locator('.workspace-pane.is-active')
          .getByTestId(`verd-${scenario.name}`),
      ).toBeVisible();
      await expect(toolbar(page)).toHaveCSS('width', '48px');
      const buttons = toolbar(page).getByRole('button');
      for (const button of await buttons.all()) {
        await expect(button).toHaveCSS('width', '36px');
        await expect(button).toHaveCSS('height', '36px');
        await expect(button.locator('svg').first()).toBeVisible();
        await expect(button).toHaveText('');
        await expect(button).toHaveAttribute('aria-label', /.+/);
      }
      if (scenario.action) {
        const cells = canvas(page).locator(
          `[data-cell-kind="${scenario.kind}"]`,
        );
        const before = await cells.count();
        const create = toolbar(page).locator(
          `[data-action-id="${scenario.action}"]`,
        );
        await expect(create).not.toHaveAttribute('aria-pressed');
        await create.click();
        await expect(cells).toHaveCount(before + 1);
        await page
          .getByRole('button', {
            name: language === 'zh' ? '撤销' : 'Undo',
            exact: true,
          })
          .click();
        await expect(cells).toHaveCount(before);
      }
      await page.screenshot({
        path: testInfo.outputPath(`${scenario.name}-wide.png`),
      });
      await toolbar(page).screenshot({
        path: testInfo.outputPath(`${scenario.name}-toolbar.png`),
      });
      for (const viewport of [
        { width: 800, height: 600 },
        { width: 390, height: 844 },
      ]) {
        await page.setViewportSize(viewport);
        await expect(toolbar(page)).toBeInViewport({ ratio: 1 });
        const last = toolbar(page).locator('button:not(:disabled)').last();
        await last.scrollIntoViewIfNeeded();
        await expect(last).toBeInViewport({ ratio: 1 });
        await page.keyboard.press('Tab');
        await last.focus();
        await expect(last).toBeFocused();
        await last.hover();
        await page.screenshot({
          path: testInfo.outputPath(`${scenario.name}-${viewport.width}.png`),
        });
        const railBounds = (await toolbar(page).boundingBox())!;
        const bottomBounds = (await page
          .locator('.workspace-pane.is-active .frame-bottom-controls')
          .boundingBox())!;
        expect(railBounds.y + railBounds.height).toBeLessThanOrEqual(
          bottomBounds.y - 8,
        );
        await expect(page.getByRole('tooltip')).toBeVisible();
      }
      await page.screenshot({
        path: testInfo.outputPath(`${scenario.name}-narrow.png`),
      });
    }
    expect(errors).toEqual([]);
  });
}

test('pen style menu keeps its localized selection and returns keyboard focus', async ({
  page,
}) => {
  await page.goto('/');
  await setAppLanguage(page, 'zh');
  const skip = page.getByRole('button', { name: '跳过', exact: true });
  if (await skip.isVisible()) await skip.click();
  await toolbar(page)
    .getByRole('button', { name: '画笔', exact: true })
    .click();
  const style = toolbar(page).getByRole('button', {
    name: '笔型',
    exact: true,
  });
  await style.click();
  await page
    .getByRole('menuitemradio', { name: '荧光笔', exact: true })
    .click();
  await style.click();
  await expect(
    page.getByRole('menuitemradio', { name: '荧光笔', exact: true }),
  ).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(style).toBeFocused();
});

test('UML parameter popovers preserve self calls, branch drafts and one-step undo', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await setAppLanguage(page, 'zh');
  const skip = page.getByRole('button', { name: '跳过', exact: true });
  if (await skip.isVisible()) await skip.click();
  await page
    .locator('.workspace-pane.is-active')
    .locator('input[type="file"][accept^="application/json"]')
    .nth(1)
    .setInputFiles({
      name: 'sequence.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify(createUmlSequenceFrameSnapshot('frame', 'sequence')),
      ),
    });
  await expect(page.getByTestId('verd-uml-sequence')).toBeVisible();
  const tools = toolbar(page).getByRole('group', { name: 'UML 工具' });
  await expect(
    tools.getByRole('button', { name: '添加消息', exact: true }),
  ).toBeDisabled();
  await tools.getByRole('button', { name: '添加参与者', exact: true }).click();
  await tools.getByRole('button', { name: '添加 Actor', exact: true }).click();
  await tools.getByRole('button', { name: '组合片段', exact: true }).click();
  const fragment = page.getByRole('dialog', { name: '组合片段', exact: true });
  await fragment.getByLabel('片段类型').selectOption('loop');
  await fragment
    .getByRole('button', { name: '添加 loop 片段', exact: true })
    .click();
  await expect(fragment).toHaveCount(0);
  const trigger = tools.getByRole('button', { name: '添加消息', exact: true });
  await trigger.click();
  const message = page.getByRole('dialog', { name: '添加消息', exact: true });
  const endpoint = await message.getByLabel('发送方 / 来源').inputValue();
  await message.getByLabel('接收方 / 目标').selectOption(endpoint);
  const operand = await message
    .getByLabel('插入分支')
    .locator('option')
    .nth(1)
    .getAttribute('value');
  await message.getByLabel('插入分支').selectOption(operand!);
  await page.keyboard.press('Escape');
  await expect(message).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(message.getByLabel('接收方 / 目标')).toHaveValue(endpoint);
  await expect(message.getByLabel('插入分支')).toHaveValue(operand!);
  await page.screenshot({
    path: testInfo.outputPath('uml-message-parameters.png'),
  });
  await message.getByRole('button', { name: '添加消息', exact: true }).click();
  await expect(message).toHaveCount(0);
  await expect(
    canvas(page).locator('[data-cell-kind="uml-message"]'),
  ).toHaveCount(1);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(
    canvas(page).locator('[data-cell-kind="uml-message"]'),
  ).toHaveCount(0);
  await tools
    .getByRole('button', { name: '添加激活区间', exact: true })
    .click();
  const activation = page.getByRole('dialog', {
    name: '添加激活区间',
    exact: true,
  });
  await expect(activation.getByLabel('插入分支')).toHaveValue(operand!);
  await activation
    .getByRole('button', { name: '添加激活区间', exact: true })
    .click();
  await expect(canvas(page).locator('[data-uml-activation]')).toHaveCount(1);
});
