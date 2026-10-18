import { test, expect, type Page } from '@playwright/test';

const paragraph = (value: string) => ({
  type: 'paragraph',
  content: [{ type: 'text', text: value }],
});
const heading = (value: string) => ({
  type: 'heading',
  attrs: { level: 2 },
  content: [{ type: 'text', text: value }],
});
const link = (label: string, href: string) => ({
  type: 'paragraph',
  content: [
    { type: 'text', text: label, marks: [{ type: 'link', attrs: { href } }] },
  ],
});
const documentFile = (id: string, title: string, content: object[]) => ({
  format: 'verd-document',
  version: 1,
  id,
  title,
  text: {
    schemaVersion: 1,
    id,
    kind: 'block',
    align: 'left',
    plainText: title,
    content: { type: 'doc', content },
  },
});
const source = documentFile('e2e-source', 'Navigation source', [
  link(
    'Open second target section',
    'verd://file/e2e-target#%E7%9B%AE%E6%A0%87%E7%AB%A0%E8%8A%82-1',
  ),
  link('Open canvas', 'verd://file/e2e-canvas'),
  link('Local section', '#%E6%9C%AC%E9%A1%B5%E7%AB%A0%E8%8A%82'),
  link('Missing file', 'verd://file/does-not-exist'),
  ...Array.from({ length: 25 }, (_, index) =>
    paragraph(`Source body ${index}`),
  ),
  heading('本页章节'),
  paragraph('Local target.'),
]);
const destination = documentFile('e2e-target', 'Navigation target', [
  heading('目标章节'),
  paragraph('First section.'),
  ...Array.from({ length: 35 }, (_, index) =>
    paragraph(`Target body ${index}`),
  ),
  heading('目标章节'),
  paragraph('Second section.'),
]);
const canvasFile = {
  format: 'verd-frame',
  version: 2,
  frame: {
    id: 'e2e-canvas',
    name: 'Navigation canvas',
    kind: 'frame',
    cellType: 'frame',
    geometry: { x: 0, y: 0, width: 960, height: 640 },
    children: [],
    groups: [],
  },
  cells: {},
};
const activePane = (page: Page) => page.locator('.workspace-pane.is-active');
const openSource = async (page: Page) => {
  await page
    .locator('.file-tree-name')
    .filter({ hasText: /^Navigation source$/ })
    .click();
  await expect(activePane(page).locator('.document-page__title')).toHaveValue(
    'Navigation source',
  );
};
const selectedHeadingIndex = (page: Page) =>
  activePane(page)
    .locator('.tiptap')
    .evaluate((editor) => {
      const selected = window
        .getSelection()
        ?.anchorNode?.parentElement?.closest('h2');
      return [...editor.querySelectorAll('h2')].findIndex(
        (item) => item === selected,
      );
    });

test('native documents navigate to unmounted files, duplicate sections and canvases without changing text', async ({
  page,
}) => {
  await page.goto('/');
  const input = page.locator(
    'input[accept=".json,.verd.json,.verd-doc.json,.md,.markdown"]',
  );
  for (const { file, title, suffix } of [
    { file: destination, title: destination.title, suffix: 'verd-doc' },
    { file: source, title: source.title, suffix: 'verd-doc' },
    { file: canvasFile, title: canvasFile.frame.name, suffix: 'verd' },
  ]) {
    await input.setInputFiles({
      name: `${title}.${suffix}.json`,
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(file)),
    });
    await expect(
      page
        .locator('.file-tree-name')
        .filter({ hasText: new RegExp(`^${title}$`) }),
    ).toBeVisible();
  }
  await openSource(page);
  await expect(page.locator('.document-page')).toHaveCount(1);
  const link = activePane(page).getByRole('link', {
    name: 'Open second target section',
    exact: true,
  });
  await expect(link).toHaveAttribute('href', /^verd:\/\/file\/e2e-target#/);
  await link.click();
  await expect(activePane(page).locator('.document-page__title')).toHaveValue(
    'Navigation source',
  );
  await link.click({ modifiers: ['ControlOrMeta'] });
  await expect(activePane(page).locator('.document-page__title')).toHaveValue(
    'Navigation target',
  );
  await expect.poll(() => selectedHeadingIndex(page)).toBe(1);
  await expect(
    activePane(page)
      .getByRole('heading', { name: '目标章节', exact: true })
      .nth(1),
  ).toBeInViewport();
  await expect
    .poll(() =>
      activePane(page)
        .locator('.document-page__content')
        .evaluate((element) => element.scrollTop),
    )
    .toBeGreaterThan(0);

  await openSource(page);
  await activePane(page)
    .getByRole('link', { name: 'Local section', exact: true })
    .click({ modifiers: ['ControlOrMeta'] });
  await expect.poll(() => selectedHeadingIndex(page)).toBe(0);
  await expect(
    activePane(page).getByRole('heading', { name: '本页章节', exact: true }),
  ).toBeInViewport();
  // The contents are real editor DOM, so verify the native document export.
  await activePane(page)
    .getByRole('button', { name: '导出', exact: true })
    .click();
  const downloading = page.waitForEvent('download');
  await activePane(page)
    .getByRole('menuitem', { name: 'VerdBoard 文档 (.json)', exact: true })
    .click();
  const download = await downloading;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect(
    JSON.parse(Buffer.concat(chunks).toString()).text.content,
  ).toMatchObject(source.text.content);

  // Scroll the source editor back to its first link without changing its selection.
  await activePane(page)
    .locator('.document-page__content')
    .evaluate((element) => {
      element.scrollTop = 0;
    });
  const count = await page.locator('.workspace-pane').count();
  await activePane(page)
    .getByRole('link', { name: 'Missing file', exact: true })
    .click({ modifiers: ['ControlOrMeta'] });
  await expect(page.getByRole('alert')).toContainText('文件不存在');
  await expect(page.locator('.workspace-pane')).toHaveCount(count);
  await activePane(page)
    .getByRole('link', { name: 'Open canvas', exact: true })
    .click({ modifiers: ['ControlOrMeta'] });
  await expect(
    activePane(page).locator(
      'svg[aria-label="Frame canvas"][data-surface="root"]',
    ),
  ).toBeVisible();
  await expect(activePane(page).getByTestId('save-status')).toContainText(
    '已保存',
  );
  await page.goto('/?readonly=1');
  await openSource(page);
  await expect(activePane(page).locator('.tiptap')).toHaveAttribute(
    'contenteditable',
    'false',
  );
  await activePane(page)
    .getByRole('link', { name: 'Open second target section', exact: true })
    .click();
  await expect(activePane(page).locator('.document-page__title')).toHaveValue(
    'Navigation target',
  );
  // Readonly editors need no DOM caret; the target section must still scroll.
  await expect(
    activePane(page)
      .getByRole('heading', { name: '目标章节', exact: true })
      .nth(1),
  ).toBeInViewport();
  await expect
    .poll(() =>
      activePane(page)
        .locator('.document-page__content')
        .evaluate((element) => element.scrollTop),
    )
    .toBeGreaterThan(0);
});
