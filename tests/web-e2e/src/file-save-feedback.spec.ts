import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';

const active = (page: Page) => page.locator('.workspace-pane.is-active');
const status = (page: Page) => active(page).getByTestId('save-status');
const open = async (page: Page, title: string) => {
  await page
    .locator('.file-tree-name')
    .getByText(title, { exact: true })
    .click();
  await expect(page.locator('.workspace-content')).toHaveAttribute(
    'aria-busy',
    'false',
  );
};

async function seed(page: Page) {
  await page.addInitScript(() => {
    const waiters: Array<() => void> = [];
    const probe = {
      rejectNavigation: false,
      holdWrites: false,
      writes: [] as string[][],
      states: [] as string[],
      wait() {
        return new Promise<void>((resolve) => waiters.push(resolve));
      },
      release() {
        probe.holdWrites = false;
        waiters.splice(0).forEach((resolve) => resolve());
      },
    };
    (window as unknown as { __saveProbe: typeof probe }).__saveProbe = probe;
    new MutationObserver(() => {
      document
        .querySelectorAll<HTMLElement>('[data-testid="save-status"]')
        .forEach((node) => probe.states.push(node.dataset['saveState'] ?? ''));
    }).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
  });
  await page.route('**/host/web-workspace-host.ts*', async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    const marker = 'async commit(handle, request_) {';
    expect(source).toContain(marker);
    await route.fulfill({
      response,
      body: source.replace(
        marker,
        `${marker}
      const probe = globalThis.__saveProbe;
      probe?.writes.push((request_.writes ?? []).map(write => write.path));
      if (probe?.rejectNavigation && request_.session && !request_.writes?.length)
        return { transactionId: request_.transactionId, outcome: 'rejected', reason: 'io-error' };
      if (probe?.holdWrites && request_.writes?.length) await probe.wait();
    `,
      ),
    });
  });
  await page.route('**/src/main.tsx', (route) => route.abort());
  await page.goto('/');
  const frame = (id: string, name: string, reference = false) => ({
    format: 'verd-frame',
    version: 2,
    frame: {
      id,
      name,
      kind: 'frame',
      cellType: 'frame',
      geometry: { x: 0, y: 0, width: 1000, height: 800 },
      children: reference ? ['note-ref'] : [],
      groups: [],
    },
    cells: reference
      ? {
          'note-ref': {
            id: 'note-ref',
            kind: 'document-reference',
            cellType: 'node',
            geometry: { x: 20, y: 20, width: 400, height: 300 },
            data: { targetDocumentId: 'note' },
          },
        }
      : {},
  });
  const note = {
    format: 'verd-document',
    version: 1,
    id: 'note',
    title: 'Note',
    text: {
      schemaVersion: 1,
      kind: 'block',
      id: 'note',
      plainText: 'Body',
      content: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Body' }] },
        ],
      },
    },
  };
  const writes = [
    {
      path: 'folder/a.verd.json',
      content: JSON.stringify(frame('a', 'Quiet A', true)),
      expectedVersion: null,
    },
    {
      path: 'folder/b.verd.json',
      content: JSON.stringify(frame('b', 'Quiet B')),
      expectedVersion: null,
    },
    {
      path: 'note.verd-doc.json',
      content: JSON.stringify(note),
      expectedVersion: null,
    },
  ];
  await page.evaluate(
    async ({ modulePath, writes }) => {
      const { createWebWorkspaceHost } = await import(modulePath);
      const host = createWebWorkspaceHost();
      const handle = await host.openWorkspace({ default: true });
      const receipt = await host.commit(handle, {
        transactionId: 'save-feedback-seed',
        writes,
        session: {
          tabs: [{ fileId: 'a' }, { fileId: 'b' }, { fileId: 'note' }],
          activeTabId: 'a',
          expandedDirs: ['folder'],
        },
      });
      if (receipt.outcome !== 'applied')
        throw new Error('Unable to seed save feedback');
    },
    {
      modulePath:
        '/@fs' +
        path.resolve(
          __dirname,
          '../../../packages/product/app/src/host/web-workspace-host.ts',
        ),
      writes,
    },
  );
  await page.unroute('**/src/main.tsx');
  await page.reload();
  await expect(status(page)).toHaveAttribute('data-save-state', 'saved');
  await expect(active(page)).toHaveAttribute('data-pane-entrance', 'complete');
}

test('disk files stay saved through first render, tab activation and folder navigation', async ({
  page,
}) => {
  await seed(page);
  const initial = await status(page).textContent();
  expect(initial).toContain('保存时间未知');
  await open(page, 'Quiet B');
  await page
    .locator('.file-tree-dir-toggle')
    .getByText('folder', { exact: true })
    .click();
  await page
    .locator('.file-tree-dir-toggle')
    .getByText('folder', { exact: true })
    .click();
  await open(page, 'Quiet A');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __saveProbe: { writes: string[][] } })
            .__saveProbe.writes.length,
      ),
    )
    .toBeGreaterThan(0);
  await expect(status(page)).toHaveText(initial!);
  const probe = await page.evaluate(() => {
    const probe = (
      window as unknown as {
        __saveProbe: { writes: string[][]; states: string[] };
      }
    ).__saveProbe;
    return { writes: probe.writes, states: [...new Set(probe.states)] };
  });
  expect(probe.writes.every((writes) => writes.length === 0)).toBe(true);
  expect(probe.states).toEqual(['saved']);
});

test('navigation-only failure stays at workspace level and can be retried without changing file feedback', async ({
  page,
}) => {
  await seed(page);
  await page.evaluate(() => {
    (
      window as unknown as { __saveProbe: { rejectNavigation: boolean } }
    ).__saveProbe.rejectNavigation = true;
  });
  await open(page, 'Quiet B');
  await expect(page.getByTestId('workspace-save-error')).toBeVisible();
  await expect(status(page)).toHaveAttribute('data-save-state', 'saved');
  await expect(status(page)).toContainText('保存时间未知');
  await page.evaluate(() => {
    (
      window as unknown as { __saveProbe: { rejectNavigation: boolean } }
    ).__saveProbe.rejectNavigation = false;
  });
  await page.getByTestId('workspace-save-error').getByRole('button').click();
  await expect(page.getByTestId('workspace-save-error')).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      (
        window as unknown as { __saveProbe: { states: string[] } }
      ).__saveProbe.states.every((state) => state === 'saved'),
    ),
  ).toBe(true);
});

test('real source edits affect their referencing page but not an unrelated clean tab', async ({
  page,
}) => {
  await seed(page);
  await page.evaluate(() => {
    (
      window as unknown as { __saveProbe: { holdWrites: boolean } }
    ).__saveProbe.holdWrites = true;
  });
  await open(page, 'Note');
  const editor = active(page).locator('.ProseMirror[contenteditable="true"]');
  await editor.click();
  await editor.press('ControlOrMeta+End');
  await editor.pressSequentially(' edited');
  await expect(
    active(page).locator('.document-page__save.is-saving'),
  ).toBeVisible();
  await open(page, 'Quiet B');
  await expect(status(page)).toHaveAttribute('data-save-state', 'saved');
  await expect(status(page)).toContainText('保存时间未知');
  await open(page, 'Quiet A');
  await expect(status(page)).toHaveAttribute('data-save-state', 'saving');
  await page.evaluate(() => {
    (
      window as unknown as { __saveProbe: { release(): void } }
    ).__saveProbe.release();
  });
  await expect(status(page)).toHaveAttribute('data-save-state', 'saved');
  await expect(status(page)).not.toContainText('保存时间未知');
  await open(page, 'Quiet B');
  await expect(status(page)).toContainText('保存时间未知');
});
