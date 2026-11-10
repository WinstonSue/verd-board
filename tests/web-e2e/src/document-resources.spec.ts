import { test, expect } from './service-fixture';
import { exerciseDocumentResources } from './document-resource-actions';
test('native formulas, folds and local PDF remain usable after reload', async ({
  page,
}) => {
  await page.goto('/');
  await exerciseDocumentResources(page);
});

test('HTTPS embed loads on demand and cannot access the app document', async ({
  page,
}) => {
  await page.route('https://embed.example.test/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<p>Embedded page</p><script>try{parent.document.body.dataset.compromised="yes"}catch{document.body.dataset.isolated="yes"}</script>',
    }),
  );
  await page.goto('/');
  const native = {
    format: 'verd-document',
    version: 1,
    id: 'embed-test',
    title: 'Embed Test',
    text: {
      schemaVersion: 1,
      id: 'embed-test',
      kind: 'block',
      plainText: '',
      content: {
        type: 'doc',
        content: [
          {
            type: 'webEmbed',
            attrs: {
              url: 'https://embed.example.test/page',
              title: 'External reference',
            },
          },
        ],
      },
    },
  };
  await page
    .locator('input[accept=".json,.verd.json,.verd-doc.json,.md,.markdown"]')
    .setInputFiles({
      name: 'Embed Test.verd-doc.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(native)),
    });
  await page
    .locator('.file-tree-name')
    .filter({ hasText: /^Embed Test$/ })
    .click();
  const pane = page.locator('.workspace-pane.is-active');
  await expect(pane.locator('iframe')).toHaveCount(0);
  await pane.getByRole('button', { name: '加载网页' }).click();
  await expect(pane.locator('iframe')).toHaveAttribute(
    'sandbox',
    'allow-scripts allow-forms allow-same-origin',
  );
  await expect(pane.frameLocator('iframe').locator('body')).toHaveAttribute(
    'data-isolated',
    'yes',
  );
  await expect(page.locator('body')).not.toHaveAttribute(
    'data-compromised',
    'yes',
  );
  await pane.getByRole('button', { name: '收起', exact: true }).click();
  await expect(pane.locator('iframe')).toHaveCount(0);
});

test('pasting a HTTPS URL offers a non-loading bookmark choice', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .locator('input[accept=".json,.verd.json,.verd-doc.json,.md,.markdown"]')
    .setInputFiles({
      name: 'Paste Note.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('Text'),
    });
  await page
    .locator('.file-tree-name')
    .filter({ hasText: /^Paste Note$/ })
    .click();
  const pane = page.locator('.workspace-pane.is-active');
  await pane.locator('.tiptap').evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.setData('text/plain', 'https://example.test/reference');
    element.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  const choice = page.getByRole('dialog', { name: '插入网页', exact: true });
  await expect(choice).toBeVisible();
  await choice.getByLabel('标题', { exact: true }).fill('Saved reference');
  await choice.getByRole('button', { name: '书签卡片', exact: true }).click();
  await expect(
    pane.getByText('Saved reference', { exact: true }),
  ).toBeVisible();
  await expect(pane.locator('iframe')).toHaveCount(0);
});

test('new fold blocks stay open while editing their body', async ({ page }) => {
  await page.goto('/');
  await page
    .locator('input[accept=".json,.verd.json,.verd-doc.json,.md,.markdown"]')
    .setInputFiles({
      name: 'Folds.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from(''),
    });
  await page
    .locator('.file-tree-name')
    .filter({ hasText: /^Folds$/ })
    .click();
  const editor = page.locator('.workspace-pane.is-active .tiptap');
  await editor.click();
  await page.keyboard.type('/');
  await page
    .getByRole('menu', { name: '插入内容', exact: true })
    .getByRole('button', { name: '折叠块', exact: true })
    .click();
  const details = editor.locator('[data-type=details]');
  await expect(details).toHaveClass(/is-open/);
  const body = details.locator('[data-type=detailsContent] p').first();
  await body.click();
  await page.keyboard.type('Folded body');
  await expect(details).toHaveClass(/is-open/);
  await expect(body).toHaveText('Folded body');
});
