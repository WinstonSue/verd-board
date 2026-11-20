import { expect, test, type Page } from '@playwright/test';
import {
  createFolder,
  directoryRow,
  folderAction,
} from './workspace-file-actions';
import { activeTabTitle } from './tab-actions';

export async function checkSidebarSelection(
  page: Page,
  readClipboard: () => Promise<string>,
) {
  try {
    await runSidebarSelection(page, readClipboard);
  } catch (error) {
    const state = await page
      .evaluate(() => {
        const active = document.activeElement;
        const target = document.querySelector<HTMLElement>(
          '.management-tree [data-entry-path="Target"]',
        );
        const aside = target?.closest('aside');
        const body = aside?.querySelector('.management-sidebar-body');
        const rect = target?.getBoundingClientRect();
        return {
          activeElement: active && {
            tag: active.tagName,
            className: active.className,
            label: active.getAttribute('aria-label'),
            text: active.textContent?.slice(0, 200),
          },
          sidebarClass: aside?.className,
          sidebarBodyDisplay: body && getComputedStyle(body).display,
          linkHref: document
            .querySelector('.workspace-pane.is-active a')
            ?.getAttribute('href'),
          notices: [
            ...document.querySelectorAll(
              '.sue-message-notice, .workspace-notice-banner',
            ),
          ].map((notice) => notice.textContent),
          target: target && {
            visible:
              target.getClientRects().length > 0 &&
              getComputedStyle(target).visibility !== 'hidden',
            rect: rect?.toJSON(),
            selected: target.getAttribute('aria-selected'),
          },
          selectedPaths: [
            ...document.querySelectorAll<HTMLElement>(
              '.management-tree .file-tree-row.is-selected',
            ),
          ].map((row) => row.dataset['entryPath']),
          currentFile: document
            .querySelector('.management-tree [aria-current="page"]')
            ?.closest('[data-file-id]')
            ?.getAttribute('data-file-id'),
        };
      })
      .catch((diagnosticError: unknown) => ({
        unavailable: String(diagnosticError),
      }));
    await test
      .info()
      .attach('sidebar-selection-state', {
        body: JSON.stringify(
          { ...state, clipboard: await readClipboard().catch(String) },
          null,
          2,
        ),
        contentType: 'application/json',
      })
      .catch(() => {});
    throw error;
  }
}

async function runSidebarSelection(
  page: Page,
  readClipboard: () => Promise<string>,
) {
  await createFolder(page, 'Target');
  await createFolder(page, 'Other');
  const previousClipboard = await readClipboard();
  await folderAction(page, 'Target', '复制链接');
  await expect(page.locator('.sue-message-notice')).toHaveText('已复制链接');
  // Another host's folder link can already be on the shared system clipboard.
  await expect.poll(readClipboard).not.toBe(previousClipboard);
  await expect.poll(readClipboard).toMatch(/^verd:\/\/folder\//);
  const href = await readClipboard();
  const before = Array.from(
    { length: 35 },
    (_, index) => `Before link ${index}`,
  );
  const after = Array.from({ length: 20 }, (_, index) => `After link ${index}`);
  const paragraph = (text: string) => ({
    type: 'paragraph',
    content: [{ type: 'text', text }],
  });
  await page
    .locator(
      'input[accept=".json,.verd,.verd.json,.verd-doc.json,.md,.markdown"]',
    )
    .setInputFiles({
      name: 'Links.verd-doc.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          format: 'verd-document',
          version: 1,
          id: 'sidebar-links',
          title: 'Links',
          text: {
            schemaVersion: 1,
            id: 'sidebar-links',
            kind: 'block',
            align: 'left',
            plainText: [...before, 'Open folder', ...after].join('\n'),
            content: {
              type: 'doc',
              content: [
                ...before.map(paragraph),
                {
                  type: 'paragraph',
                  content: [
                    {
                      type: 'text',
                      text: 'Open folder',
                      marks: [{ type: 'link', attrs: { href } }],
                    },
                  ],
                },
                ...after.map(paragraph),
              ],
            },
          },
        }),
      ),
    });
  const source = page.locator('.file-tree-row[data-file-id="sidebar-links"]');
  const sourceButton = source.locator('.file-tree-main');
  const target = directoryRow(page, 'Target');
  const other = directoryRow(page, 'Other');
  const highlighted = page.locator(
    '.management-tree .file-tree-row.is-highlighted',
  );
  const selected = page.locator('.management-tree .file-tree-row.is-selected');
  const link = page
    .locator('.workspace-pane.is-active')
    .getByRole('link', { name: 'Open folder', exact: true });
  await sourceButton.click();
  await expect(activeTabTitle(page)).toHaveText('Links');
  await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
  await expect(target).toBeHidden();
  await link.click({ modifiers: ['ControlOrMeta'] });
  await expect(target.locator('.file-tree-main')).toBeFocused();
  await expect(target).toHaveAttribute('aria-selected', 'true');
  await expect(highlighted).toHaveCount(1);
  await expect(sourceButton).toHaveAttribute('aria-current', 'page');
  await expect(source).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(target).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(activeTabTitle(page)).toHaveText('Links');

  await target.locator('.file-tree-more').click();
  await page.keyboard.press('Escape');
  await expect(target).toHaveAttribute('aria-selected', 'true');
  await sourceButton.click();
  await expect(selected).toHaveCount(0);
  await expect(highlighted).toHaveCount(1);
  await expect(source).toHaveClass(/is-highlighted/);
  await expect(sourceButton).toBeFocused();

  // A fresh nonce must reveal the same folder after navigation and another collapse.
  await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
  await expect(target).toBeHidden();
  await link.click({ modifiers: ['ControlOrMeta'] });
  await expect(target.locator('.file-tree-main')).toBeFocused();
  await expect(target).toHaveAttribute('aria-selected', 'true');
  await expect(highlighted).toHaveCount(1);
  await other
    .locator('.file-tree-main')
    .click({ modifiers: ['ControlOrMeta'] });
  await expect(selected).toHaveCount(2);
  await expect(highlighted).toHaveCount(2);
  await expect(activeTabTitle(page)).toHaveText('Links');
  await sourceButton.click();
  await expect(selected).toHaveCount(0);
  await expect(highlighted).toHaveCount(1);

  // An ordinary click establishes the anchor for the next range selection.
  await target.locator('.file-tree-main').click();
  await other.locator('.file-tree-main').click({ modifiers: ['Shift'] });
  await expect(other).toHaveAttribute('aria-selected', 'true');
  await expect(target).toHaveAttribute('aria-selected', 'true');
  await expect(source).not.toHaveAttribute('aria-selected', 'true');
  await expect(selected).toHaveCount(2);
  await sourceButton.focus();
  await sourceButton.press('Enter');
  await expect(selected).toHaveCount(0);
  await expect(highlighted).toHaveCount(1);
  await expect(sourceButton).toBeFocused();
}
