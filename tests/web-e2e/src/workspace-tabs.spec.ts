import { test, expect, type Page } from '@playwright/test';
import { setAppLanguage } from './app-actions';
import {
  openGroups,
  createGroup,
  switchGroup,
  deleteGroup,
} from './tab-actions';

const strip = (page: Page) => page.locator('ylib-tabs');
const tab = (page: Page, id: string) =>
  strip(page).locator(`[role="tab"][data-tab-id="${id}"]`);
const ids = (page: Page) =>
  strip(page)
    .getByRole('tab')
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-tab-id')),
    );
const active = (page: Page) => page.locator('.workspace-pane.is-active');
const close = async (page: Page, id: string, label: string) => {
  await tab(page, id).click({ button: 'right' });
  await strip(page).getByRole('button', { name: label, exact: true }).click();
};
async function seed(page: Page) {
  await page.goto('/');
  await setAppLanguage(page, 'zh');
  const files = ['a', 'b', 'c'].map((id) => ({
    format: 'verd-frame',
    version: 2,
    frame: {
      id,
      name: `Tab ${id.toUpperCase()}`,
      kind: 'frame',
      cellType: 'frame',
      geometry: { x: 0, y: 0, width: 1000, height: 800 },
      children: [],
      groups: [],
    },
    cells: {},
  }));
  await page
    .locator('input[accept=".json,.verd.json,.verd-doc.json,.md,.markdown"]')
    .setInputFiles({
      name: 'tabs.verd.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          format: 'verd-canvas-bundle',
          version: 1,
          rootFileId: 'a',
          files: [
            ...files,
            {
              format: 'verd-document',
              version: 1,
              id: 'doc',
              title: 'Tab document',
              text: {
                schemaVersion: 1,
                id: 'doc',
                kind: 'block',
                plainText: 'Saved body',
                content: {
                  type: 'doc',
                  content: [
                    {
                      type: 'paragraph',
                      content: [{ type: 'text', text: 'Saved body' }],
                    },
                  ],
                },
              },
            },
          ],
        }),
      ),
    });
  await page
    .locator('.file-tree-name')
    .getByText('Tab A', { exact: true })
    .click();
  await close(page, 'a', '关闭其他所有');
  for (const name of ['Tab B', 'Tab C', 'Tab document'])
    await page
      .locator('.file-tree-name')
      .getByText(name, { exact: true })
      .click();
  await expect.poll(() => ids(page)).toEqual(['a', 'b', 'c', 'doc']);
}

test('real tab menus close left, right and others after dragging, preserving the active tab and saved content', async ({
  page,
}) => {
  await seed(page);
  const title = active(page).locator('.document-page__title');
  await title.fill('Renamed before closing');
  await tab(page, 'doc').dragTo(tab(page, 'b'), {
    targetPosition: { x: 2, y: 15 },
  });
  await expect.poll(() => ids(page)).toEqual(['a', 'doc', 'b', 'c']);
  await close(page, 'b', '关闭右侧所有');
  await expect.poll(() => ids(page)).toEqual(['a', 'doc', 'b']);
  await expect(tab(page, 'doc')).toHaveAttribute('aria-selected', 'true');
  await close(page, 'b', '关闭左侧所有');
  await expect.poll(() => ids(page)).toEqual(['b']);
  await expect(tab(page, 'b')).toHaveAttribute('aria-selected', 'true');
  await page
    .locator('.file-tree-name')
    .getByText('Tab A', { exact: true })
    .click();
  await close(page, 'b', '关闭其他所有');
  await expect.poll(() => ids(page)).toEqual(['b']);
  await expect(tab(page, 'b')).toHaveAttribute('aria-selected', 'true');
  await expect(active(page).getByTestId('save-status')).toHaveAttribute(
    'data-save-state',
    'saved',
  );
  await page.reload();
  await expect.poll(() => ids(page)).toEqual(['b']);
  await page
    .locator('.file-tree-name')
    .getByText('Renamed before closing', { exact: true })
    .click();
  await expect(active(page).locator('.document-page__title')).toHaveValue(
    'Renamed before closing',
  );
  await tab(page, 'doc').hover();
  await tab(page, 'doc')
    .getByRole('button', { name: '关闭 Renamed before closing', exact: true })
    .click();
  await close(page, 'b', '关闭');
  await expect(page.locator('.workspace-empty')).toBeVisible();
});

test('groups retain independent tab sets, share one editor, rename, delete and restore after reload', async ({
  page,
}) => {
  await seed(page);
  const editor = active(page).locator('.ProseMirror[contenteditable="true"]');
  await editor.click();
  await editor.press('ControlOrMeta+End');
  await editor.pressSequentially(' shared edit');
  await editor.evaluate((node) =>
    node.setAttribute('data-shared-instance', 'yes'),
  );
  await createGroup(page, '  Research  ');
  await expect(page.locator('.workspace-empty')).toBeVisible();
  await expect(strip(page).getByRole('tab')).toHaveCount(0);
  await page
    .locator('.file-tree-name')
    .getByText('Tab document', { exact: true })
    .click();
  await expect(
    active(page).locator('[data-shared-instance="yes"]'),
  ).toBeVisible();
  await expect(
    page
      .locator('.workspace-panes > .workspace-pane')
      .filter({ has: page.locator('.document-page__title') }),
  ).toHaveCount(1);
  await page
    .locator('.file-tree-name')
    .getByText('Tab A', { exact: true })
    .click();
  await expect.poll(() => ids(page)).toEqual(['doc', 'a']);
  await switchGroup(page, '默认分组');
  await expect.poll(() => ids(page)).toEqual(['a', 'b', 'c', 'doc']);
  await expect(tab(page, 'doc')).toHaveAttribute('aria-selected', 'true');
  await switchGroup(page, 'Research');
  await expect(tab(page, 'a')).toHaveAttribute('aria-selected', 'true');
  await openGroups(page);
  await strip(page)
    .getByRole('button', { name: 'Research', exact: true })
    .hover();
  await strip(page)
    .getByRole('button', { name: '重命名 Research', exact: true })
    .click();
  await page.getByRole('dialog').getByRole('textbox').fill('Writing');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '确定', exact: true })
    .click();
  await expect(active(page).getByTestId('save-status')).toHaveAttribute(
    'data-save-state',
    'saved',
  );
  await page.reload();
  await expect.poll(() => ids(page)).toEqual(['doc', 'a']);
  await expect(tab(page, 'a')).toHaveAttribute('aria-selected', 'true');
  await page
    .locator('.file-tree-name')
    .getByText('Tab document', { exact: true })
    .click();
  await active(page)
    .locator('.document-page__title')
    .fill('Group source title');
  await deleteGroup(page, 'Writing');
  await expect.poll(() => ids(page)).toEqual(['a', 'b', 'c', 'doc']);
  await expect(active(page).locator('.board-document-content')).toContainText(
    'shared edit',
  );
  await deleteGroup(page, '默认分组');
  await expect(page.locator('.workspace-empty')).toBeVisible();
  await expect(
    page
      .locator('.file-tree-name')
      .getByText('Group source title', { exact: true }),
  ).toBeVisible();
  await page
    .locator('.file-tree-name')
    .getByText('Group source title', { exact: true })
    .click();
  await expect(active(page).locator('.board-document-content')).toContainText(
    'shared edit',
  );
});
