import { expect, test, serviceFixture, type Page } from './service-fixture';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { openActiveFile, openTrash } from './app-actions';
import { selectDrawingTool } from './drawing-tools';
import { createFolder, directoryRow } from './workspace-file-actions';
import { persistedWorkspace } from './workspace-nav';
import { nativePackageFixture } from '../../helpers/workspace-package';
const canvas = (page: Page) =>
  page.locator(
    '.workspace-pane.is-active svg[aria-label="Frame canvas"][data-surface="root"]',
  );
const source = (page: Page, id: string) =>
  page.locator(`[data-entry-kind="file"][data-file-id="${id}"]`);
const action = async (
  page: Page,
  row: ReturnType<typeof source>,
  name: string,
) => {
  await row.locator('.file-tree-more').click();
  await page.getByRole('menuitem', { name, exact: true }).click();
};
async function createChart(page: Page) {
  await page.goto('/');
  await openActiveFile(page);
  const skip = page.getByRole('button', { name: '跳过', exact: true });
  if (await skip.isVisible()) await skip.click();
  await selectDrawingTool(page, '流程图');
  const bounds = (await canvas(page).boundingBox())!;
  await page.mouse.click(
    bounds.x + bounds.width * 0.3,
    bounds.y + bounds.height * 0.35,
  );
  await page.getByRole('button', { name: '选择', exact: true }).click();
  await canvas(page)
    .locator('[data-cell-kind="frame-reference"] > [data-frame-header] > rect')
    .first()
    .click({ position: { x: 12, y: 12 } });
  await page.getByTestId('frame-open').click();
  const active = page.locator('[data-entry-kind="file"].is-active');
  await expect(active).toContainText('未命名流程图');
  return (await active.getAttribute('data-file-id'))!;
}
test('independent diagrams have one real entry and keep references after rename, move and restore', async ({
  page,
}) => {
  const id = await createChart(page);
  await expect(page.locator(`[data-file-id="${id}"]`)).toHaveCount(1);
  await expect(page.locator('[data-entry-kind="shortcut"]')).toHaveCount(0);
  await expect(source(page, id)).toContainText('未命名流程图');
  await action(page, source(page, id), '重命名/移动');
  let dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox').fill('流程');
  await dialog.getByRole('button', { name: '确定', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await createFolder(page, '架构图');
  await action(page, source(page, id), '移动到…');
  dialog = page.getByRole('dialog');
  await dialog
    .getByRole('combobox', { name: '目标目录', exact: true })
    .selectOption('架构图');
  await dialog.getByRole('button', { name: '确定', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(async () => (await persistedWorkspace(page))?.paths[id])
    .toBe('架构图/流程.verd');
  await page.reload();
  await directoryRow(page, '架构图').locator('.file-tree-dir-toggle').click();
  await expect(source(page, id)).toHaveCount(1);
  await action(page, source(page, id), '移入回收站');
  await expect(source(page, id)).toHaveCount(0);
  await openTrash(page);
  await page
    .getByRole('button', { name: '还原 流程.verd', exact: true })
    .click();
  await page.getByTestId('workspace-settings-back').click();
  await expect(source(page, id)).toHaveCount(1);
  await source(page, id).locator('.file-tree-name').click();
  await expect(canvas(page)).toBeVisible();
  await page.getByRole('button', { name: '所有内容', exact: true }).click();
  await page
    .locator('.content-tabs')
    .getByRole('button', { name: '图表', exact: true })
    .click();
  await expect(
    page
      .locator('.chart-library tbody tr')
      .filter({ hasText: '架构图/流程.verd' }),
  ).toHaveCount(1);
  await expect(
    page.getByRole('combobox', { name: '归属', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: '整理已有图表', exact: true }),
  ).toHaveCount(0);
});

test('ordinary originals are visible, preview without copies and keep their bytes through rename and trash', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.workspace-shell')).toBeVisible();
  const assets = nativePackageFixture()
    .assets.slice(0, 2)
    .map((asset) => ({ name: asset.name, bytes: [...asset.bytes] }));
  const modulePath =
    test.info().project.metadata['runtime'] === 'production'
      ? '/test-support/workspace-host.js'
      : '/@fs' +
        path.resolve(
          __dirname,
          '../../../apps/web/src/test-support/workspace-host.ts',
        );
  await page.evaluate(
    async ({ modulePath, assets }) => {
      const { createServiceWorkspaceHost } = await import(
        /* @vite-ignore */ modulePath
      );
      const host = createServiceWorkspaceHost(),
        handle = await host.openWorkspace({ default: true });
      const snapshot = await host.readSnapshot(handle);
      const receipt = await host.commit(handle, {
        transactionId: 'ordinary-resources',
        mkdirs: ['资源', '空目录'],
        writes: [
          {
            path: 'AGENTS.md',
            content: '# Workspace agent instructions',
            expectedVersion:
              snapshot.entries.find(
                (entry: { path: string }) => entry.path === 'AGENTS.md',
              )?.version ?? null,
          },
          {
            path: '资源/agent.md',
            content: '# Nested agent instructions',
            expectedVersion: null,
          },
          {
            path: '资源/broken.verd',
            content: '{',
            expectedVersion: null,
          },
          {
            path: '资源/notes.md',
            content: '# original bytes',
            expectedVersion: null,
          },
          ...assets.map((asset) => ({
            path: '资源/' + asset.name,
            content: new Uint8Array(asset.bytes),
            expectedVersion: null,
          })),
        ],
        resourceWrites: [
          {
            path: 'history/hidden.verd',
            content: '{}',
            expectedVersion: null,
          },
        ],
        session: {
          ...(snapshot.session ?? { tabs: [], activeTabId: null }),
          expandedDirs: ['资源'],
        },
      });
      if (receipt.outcome !== 'applied') throw new Error('Seed failed');
    },
    { modulePath, assets },
  );
  await page.reload();
  await directoryRow(page, '资源').locator('.file-tree-dir-toggle').click();
  await expect(
    page.locator('.file-tree-row[data-entry-kind="resource"]'),
  ).toHaveCount(3);
  await expect(
    page
      .locator('.file-tree')
      .getByRole('button', { name: '空目录', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.file-tree')).not.toContainText('.verdscrolls');
  await expect(page.locator('.file-tree')).not.toContainText('AGENTS.md');
  await expect(page.locator('.file-tree')).not.toContainText('agent.md');
  await page
    .locator('.file-tree-name')
    .filter({ hasText: /^photo.png$/ })
    .click();
  let reader = page.getByRole('dialog', { name: 'photo.png', exact: true });
  await expect(reader.locator('img')).toBeVisible();
  await expect
    .poll(() =>
      reader
        .locator('img')
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBeGreaterThan(0);
  await reader.getByRole('button', { name: '关闭', exact: true }).click();
  await page
    .locator('.file-tree-name')
    .filter({ hasText: /^reference.pdf$/ })
    .click();
  reader = page.getByRole('dialog', { name: 'reference.pdf', exact: true });
  await expect(reader.getByLabel('PDF 内查找')).toBeVisible();
  await expect(
    reader.getByRole('button', { name: '复制页码引用', exact: true }),
  ).toHaveCount(0);
  await reader.getByRole('button', { name: '关闭', exact: true }).click();
  const raw = page.locator('.file-tree-row[data-entry-path="资源/notes.md"]');
  await raw.locator('.file-tree-name').click();
  await expect
    .poll(() =>
      serviceFixture(page).openedPaths.some((location) =>
        location.endsWith('/资源/notes.md'),
      ),
    )
    .toBe(true);
  expect(
    await readFile(
      path.join(serviceFixture(page).workspace, '资源/notes.md'),
      'utf8',
    ),
  ).toBe('# original bytes');
  await action(page, raw, '重命名');
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox').fill('renamed.md');
  await dialog.getByRole('button', { name: '确定', exact: true }).click();
  const renamed = page.locator(
    '.file-tree-row[data-entry-path="资源/renamed.md"]',
  );
  await expect(renamed).toBeVisible();
  await action(page, renamed, '移入回收站');
  await expect(renamed).toHaveCount(0);
  await openTrash(page);
  await page
    .getByRole('button', { name: '还原 renamed.md', exact: true })
    .click();
  await page.getByTestId('workspace-settings-back').click();
  await renamed.locator('.file-tree-name').click();
  await expect
    .poll(() =>
      serviceFixture(page).openedPaths.some((location) =>
        location.endsWith('/资源/renamed.md'),
      ),
    )
    .toBe(true);
  expect(
    await readFile(
      path.join(serviceFixture(page).workspace, '资源/renamed.md'),
      'utf8',
    ),
  ).toBe('# original bytes');
  await page.getByRole('button', { name: '所有内容', exact: true }).click();
  const content = page.getByTestId('workspace-management-page');
  await expect(content.locator('[data-entry-kind="resource"]')).toHaveCount(3);
  await expect(content.locator('[data-entry-kind="failed"]')).toHaveCount(1);
  await content.locator('[data-entry-kind="failed"] button').click();
  const error = page.getByTestId('workspace-file-error');
  await expect(error).toContainText('资源/broken.verd');
  await expect(
    error.getByRole('button', { name: '重试', exact: true }),
  ).toBeVisible();
  await error.getByRole('button', { name: '重试', exact: true }).click();
  await expect(error).toBeVisible();
  const { managedKeys, guide } = await page.evaluate(async (modulePath) => {
    const { createServiceWorkspaceHost } = await import(
      /* @vite-ignore */ modulePath
    );
    const host = createServiceWorkspaceHost(),
      handle = await host.openWorkspace({ default: true });
    return {
      managedKeys: (await host.readSnapshot(handle)).resources.map(
        (entry: { key: string }) => entry.key,
      ),
      guide: new TextDecoder().decode(
        (await host.readFile(handle, 'AGENTS.md')).content,
      ),
    };
  }, modulePath);
  expect(managedKeys).toEqual(['history/hidden.verd']);
  expect(guide.split('<!-- verdscrolls:agent:start -->')[0].trim()).toBe(
    '# Workspace agent instructions',
  );
});
