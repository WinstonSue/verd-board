import { installSaveProbe } from './service-routes';
import { test, expect, type Page } from './service-fixture';
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

async function seed(
  page: Page,
  titles: { canvas?: string; document?: string } = {},
) {
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
  await installSaveProbe(page);
  const production = test.info().project.metadata['runtime'] === 'production';
  const mainScript = production ? '**/assets/index-*.js' : '**/src/main.tsx';
  await page.route(mainScript, (route) => route.abort());
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
    title: titles.document ?? 'Note',
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
      content: JSON.stringify(frame('a', titles.canvas ?? 'Quiet A', true)),
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
      const { createServiceWorkspaceHost } = await import(modulePath);
      const host = createServiceWorkspaceHost();
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
      modulePath: production
        ? '/test-support/workspace-host.js'
        : '/@fs' +
          path.resolve(
            __dirname,
            '../../../apps/web/src/test-support/workspace-host.ts',
          ),
      writes,
    },
  );
  await page.unroute(mainScript);
  await page.reload();
  await expect(status(page)).toHaveAttribute('data-save-state', 'saved');
  await expect(active(page)).toHaveAttribute('data-pane-entrance', 'complete');
}

test('canvas and document keep save feedback next to truncated long titles', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 800, height: 900 });
  const title = '这是一个用于验证保存状态始终紧邻标题的很长文件名称'.repeat(4);
  await seed(page, { canvas: title, document: title + '文档' });
  for (const name of [title, title + '文档']) {
    await open(page, name);
    const navigation = active(page).locator('.workspace-file-navigation');
    const titleNode = navigation.locator('.workspace-file-navigation-title');
    const feedback = navigation.locator('.workspace-file-navigation-status');
    await expect(feedback.getByTestId('save-status')).toHaveText('已保存');
    const [heading, saved, fileInfo, row] = await Promise.all([
      titleNode.boundingBox(),
      feedback.boundingBox(),
      navigation
        .getByRole('button', { name: '文件信息', exact: true })
        .boundingBox(),
      navigation.boundingBox(),
    ]);
    expect(saved!.x - heading!.x - heading!.width).toBeCloseTo(8, 0);
    expect(fileInfo!.x - saved!.x - saved!.width).toBeCloseTo(8, 0);
    expect(fileInfo!.x + fileInfo!.width).toBeLessThanOrEqual(
      row!.x + row!.width,
    );
    for (const button of await navigation
      .locator('.workspace-file-navigation-actions button')
      .all()) {
      const bounds = (await button.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(fileInfo!.x + fileInfo!.width);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(row!.x + row!.width);
    }
    expect(
      await titleNode.evaluate((node) => node.scrollWidth > node.clientWidth),
    ).toBe(true);
    await expect(
      navigation
        .locator('.workspace-file-navigation-actions')
        .getByTestId('save-status'),
    ).toHaveCount(0);
    await page.screenshot({
      path: info.outputPath(
        `long-title-${name === title ? 'canvas' : 'document'}.png`,
      ),
    });
  }
});

test('disk files stay saved through first render, tab activation and folder navigation', async ({
  page,
}) => {
  await seed(page);
  await expect(status(page)).toHaveText('已保存');
  await expect(
    active(page)
      .locator('.workspace-file-navigation')
      .getByTestId('save-status'),
  ).toHaveCount(1);
  await expect(
    active(page).locator('.frame-app-toolbar').getByTestId('save-status'),
  ).toHaveCount(0);
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
  await expect(status(page)).toHaveText('已保存');
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
  await expect(status(page)).toHaveText('已保存');
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
  await page.keyboard.insertText(' edited');
  await expect(
    active(page).locator('.document-page__save.is-saving'),
  ).toBeVisible();
  await open(page, 'Quiet B');
  await expect(status(page)).toHaveAttribute('data-save-state', 'saved');
  await expect(status(page)).toHaveText('已保存');
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
  await expect(status(page)).toHaveText('已保存');
});
