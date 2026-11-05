import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { activeTabTitle } from './tab-actions';

const pane = (page: Page) => page.locator('.workspace-pane.is-active');
const navigation = (page: Page) =>
  pane(page).locator('.workspace-file-navigation');
const canvas = (page: Page) =>
  pane(page).locator('svg[data-surface="root"]').first();
const row = (page: Page, name: string) =>
  page
    .locator('.file-tree-file .file-tree-name')
    .filter({ hasText: name })
    .first();
async function skipOnboarding(page: Page) {
  const skip = page.getByRole('button', { name: '跳过', exact: true });
  if (await skip.isVisible()) await skip.click();
}
const target = JSON.parse(
  readFileSync(
    path.resolve(__dirname, '../../fixtures/ai-canvas/workflow-dag.verd.json'),
    'utf8',
  ),
);
target.frame.name = '共享流程图';
target.organization = { kind: 'subgraph', ownerFrameId: 'reference-owner' };
const reference = (id: string, x: number) => ({
  id,
  kind: 'frame-reference',
  cellType: 'node',
  name: id === 'owner-ref-2' ? '第二处入口' : '流程预览',
  geometry: { x, y: 40, width: 340, height: 280 },
  data: { targetFrameId: target.frame.id },
});
const board = (
  id: string,
  name: string,
  refs: ReturnType<typeof reference>[],
) => ({
  format: 'verd-frame',
  version: 2,
  frame: {
    id,
    kind: 'frame',
    cellType: 'frame',
    name,
    geometry: { x: 0, y: 0, width: 1000, height: 700 },
    children: refs.map((ref) => ref.id),
    groups: [],
  },
  cells: Object.fromEntries(refs.map((ref) => [ref.id, ref])),
});
const paragraph = (text: string) => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
});
const heading = (text: string) => ({
  type: 'heading',
  attrs: { level: 2 },
  content: [{ type: 'text', text }],
});
const frameReference = {
  type: 'frameReference',
  attrs: { targetFrameId: target.frame.id },
};
const document = {
  format: 'verd-document',
  version: 1,
  id: 'reference-document',
  title: '引用说明',
  text: {
    schemaVersion: 1,
    id: 'reference-document',
    kind: 'block',
    align: 'left',
    plainText: '',
    content: {
      type: 'doc',
      content: [
        heading('第一章'),
        frameReference,
        ...Array.from({ length: 24 }, (_, index) =>
          paragraph(`中间正文 ${index}`),
        ),
        heading('第二章'),
        frameReference,
        paragraph('结尾'),
      ],
    },
  },
};

test('groups repeated embeds, distinguishes entry from ownership, and restores reading and canvas positions', async ({
  page,
}, info) => {
  page.on('pageerror', (error) =>
    console.error('Navigation page error:', error),
  );
  page.on('console', (message) => {
    if (message.type() === 'error')
      console.error('Navigation console error:', message.text());
  });
  await page.goto('/');
  await skipOnboarding(page);
  const files = [
    target,
    board('reference-owner', '归属画布', [
      reference('owner-ref-1', 20),
      reference('owner-ref-2', 430),
    ]),
    board('reference-other', '另一画布', [reference('other-ref', 20)]),
    document,
  ];
  await page
    .locator('input[accept=".json,.verd.json,.verd-doc.json,.md,.markdown"]')
    .setInputFiles({
      name: 'reference-navigation.verd.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          format: 'verd-canvas-bundle',
          version: 1,
          files,
          rootFileId: target.frame.id,
        }),
      ),
    });
  await row(page, '共享流程图').click();
  await expect(
    navigation(page).locator('.workspace-file-navigation-title'),
  ).toHaveText('共享流程图');
  await expect(navigation(page).getByTestId('navigation-return')).toHaveCount(
    0,
  );
  const trigger = navigation(page).getByTestId('reference-locations-trigger');
  await expect(trigger).toHaveText('被引用 5 处');
  await trigger.click();
  const locations = page.getByRole('menu', { name: '引用位置', exact: true });
  await expect(locations.getByRole('menuitem')).toHaveCount(5);
  await expect(locations).toContainText('引用说明 · 文档 · 2 处');
  await expect(locations).toContainText('归属画布 · 画布 · 2 处');
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await trigger.click();
  await locations
    .getByRole('menuitem', { name: '第二章 · 第 2 处', exact: true })
    .click();
  const second = pane(page).locator('.document-frame-reference').nth(1);
  await expect(activeTabTitle(page)).toHaveText('引用说明');
  await expect(second).toBeInViewport();
  await expect(second.locator('..')).toHaveClass(/ProseMirror-selectednode/);
  const reading = await pane(page)
    .locator('.document-page__content')
    .evaluate((element) => element.scrollTop);
  expect(reading).toBeGreaterThan(0);
  await second.getByRole('button', { name: '打开原图', exact: true }).click();
  await expect(navigation(page).getByTestId('navigation-return')).toHaveText(
    '返回 引用说明',
  );
  await navigation(page).getByTestId('navigation-return').click();
  await expect(second).toBeInViewport();
  await expect
    .poll(async () =>
      Math.abs(
        (await pane(page)
          .locator('.document-page__content')
          .evaluate((element) => element.scrollTop)) - reading,
      ),
    )
    .toBeLessThanOrEqual(2);

  await row(page, '另一画布').click();
  const shell = canvas(page).locator('[data-cell-id="other-ref"]');
  await shell
    .locator(':scope > [data-frame-header] > rect')
    .first()
    .click({ position: { x: 12, y: 12 } });
  const transform = await canvas(page)
    .locator(':scope > [data-frame-world]')
    .first()
    .getAttribute('transform');
  await pane(page).getByTestId('frame-open').click();
  await expect(navigation(page).getByTestId('navigation-return')).toHaveText(
    '返回 另一画布',
  );
  await navigation(page)
    .getByRole('button', { name: '文件信息', exact: true })
    .click();
  await expect(
    page.getByRole('menu', { name: '文件信息', exact: true }),
  ).toContainText('所属画布：归属画布');
  await page.keyboard.press('Escape');
  await navigation(page).getByTestId('navigation-return').click();
  await expect(
    navigation(page).locator('.workspace-file-navigation-title'),
  ).toHaveText('另一画布');
  await expect(shell).toBeInViewport();
  expect(transform).not.toBeNull();
  await expect(
    canvas(page).locator(':scope > [data-frame-world]').first(),
  ).toHaveAttribute('transform', transform!);

  // Tab activation keeps each file's own source. Direct file-tree open clears it.
  await page
    .locator('ylib-tabs')
    .getByRole('tab', { name: /^共享流程图 / })
    .click();
  await expect(navigation(page).getByTestId('navigation-return')).toHaveText(
    '返回 另一画布',
  );
  await row(page, '共享流程图').click();
  await expect(navigation(page).getByTestId('navigation-return')).toHaveCount(
    0,
  );
  await page.setViewportSize({ width: 960, height: 720 });
  await trigger.click();
  await expect(locations).toBeInViewport();
  await page.screenshot({ path: info.outputPath('reference-locations.png') });
  await locations
    .getByRole('menuitem', { name: '第二处入口 · 第 2 处', exact: true })
    .click();
  const ownerShell = canvas(page).locator('[data-cell-id="owner-ref-2"]');
  await expect(ownerShell).toBeInViewport();
  await pane(page).getByTestId('frame-open').click();
  await expect(navigation(page).getByTestId('navigation-return')).toHaveText(
    '返回 归属画布',
  );
  await navigation(page).getByTestId('navigation-return').click();
  await canvas(page).focus();
  await page.keyboard.press('Backspace');
  await expect(ownerShell).toHaveCount(0);
  await page
    .locator('ylib-tabs')
    .getByRole('tab', { name: /^共享流程图 / })
    .click();
  await expect(trigger).toHaveText('被引用 4 处');
  await navigation(page).getByTestId('navigation-return').click();
  await expect(
    page.getByText('引用已被移除，已返回来源文件。', { exact: true }),
  ).toBeVisible();
  await expect(
    navigation(page).locator('.workspace-file-navigation-title'),
  ).toHaveText('归属画布');
  await page
    .locator('ylib-tabs')
    .getByRole('tab', { name: /^共享流程图 / })
    .click();
  await page
    .getByRole('button', { name: '「归属画布」的操作', exact: true })
    .click();
  await page.getByRole('menuitem', { name: '移入回收站', exact: true }).click();
  await expect(navigation(page).getByTestId('navigation-return')).toHaveCount(
    0,
  );
  await expect(trigger).toHaveText('被引用 3 处');
});
