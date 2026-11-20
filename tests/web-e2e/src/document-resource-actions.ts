import { openDocumentInsert } from './app-actions';
import { expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
function pdf() {
  const parts = ['%PDF-1.4\n'];
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const stream = 'BT /F1 16 Tf 40 200 Td (Local PDF) Tj ET';
  objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  const offsets = [0];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(parts.join('')));
    parts.push(`${i + 1} 0 obj\n${body}\nendobj\n`);
  });
  const xref = Buffer.byteLength(parts.join(''));
  parts.push(
    `xref\n0 6\n0000000000 65535 f \n${offsets
      .slice(1)
      .map((n) => String(n).padStart(10, '0') + ' 00000 n \n')
      .join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`,
  );
  return Buffer.from(parts.join(''));
}
export async function exerciseDocumentResources(page: Page) {
  const doc = {
    format: 'verd-document',
    version: 1,
    id: 'rich-test',
    title: 'Rich Test',
    text: {
      schemaVersion: 1,
      id: 'rich-test',
      kind: 'block',
      plainText: '',
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'inlineMath', attrs: { latex: 'x^2' } }],
          },
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                attrs: { blockId: 'rich-parent' },
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Parent' }],
                  },
                  {
                    type: 'bulletList',
                    content: [
                      {
                        type: 'listItem',
                        content: [
                          {
                            type: 'paragraph',
                            content: [{ type: 'text', text: 'Child' }],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            type: 'details',
            content: [
              {
                type: 'detailsSummary',
                content: [{ type: 'text', text: 'Summary' }],
              },
              {
                type: 'detailsContent',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Hidden body' }],
                  },
                ],
              },
            ],
          },
          { type: 'paragraph' },
        ],
      },
    },
  };
  await page
    .locator(
      'input[accept=".json,.verd,.verd.json,.verd-doc.json,.md,.markdown"]',
    )
    .setInputFiles({
      name: 'Rich.verd-doc.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(doc)),
    });
  await page
    .locator('.file-tree-name')
    .filter({ hasText: /^Rich Test$/ })
    .click();
  const pane = page.locator('.workspace-pane.is-active');
  await expect(pane.locator('.katex').first()).toBeVisible();
  await expect(pane.locator('.katex').first()).toHaveCSS(
    'font-family',
    /KaTeX_Main/,
  );
  await pane.locator('.document-list-fold').first().click();
  await expect(pane.locator('.tiptap ul ul')).toBeHidden();
  await openDocumentInsert(page);
  const paneFile = page.waitForEvent('filechooser');
  await page
    .getByRole('dialog', { name: '插入', exact: true })
    .getByRole('button', { name: '附件', exact: true })
    .click();
  await (
    await paneFile
  ).setFiles({
    name: 'Local.pdf',
    mimeType: 'application/pdf',
    buffer: pdf(),
  });
  await expect(pane.getByText('Local.pdf', { exact: true })).toBeVisible();
  await pane.getByRole('button', { name: '打开资料' }).click();
  const reader = page.getByRole('dialog', { name: 'Local.pdf', exact: true });
  await expect(reader.locator('canvas').last()).toBeVisible();
  await expect(reader.locator('.textLayer'))
    .toContainText('Local PDF')
    .catch(async (error) => {
      console.log('PDF reader state:', await reader.innerText());
      throw error;
    });
  await reader.getByRole('button', { name: '关闭', exact: true }).click();
  await page.reload();
  await expect(
    page
      .locator('.workspace-pane.is-active')
      .getByText('Local.pdf', { exact: true }),
  ).toBeVisible();
  const restored = page.locator('.workspace-pane.is-active');
  await expect(
    restored.locator('[data-block-id="rich-parent"] > ul'),
  ).toBeHidden();
  await expect(
    restored.locator('[data-block-id="rich-parent"] > .document-list-fold'),
  ).toHaveAttribute('aria-expanded', 'false');
  await openDocumentInsert(page);
  const restoredFile = page.waitForEvent('filechooser');
  await page
    .getByRole('dialog', { name: '插入', exact: true })
    .getByRole('button', { name: '附件', exact: true })
    .click();
  await (
    await restoredFile
  ).setFiles({
    name: 'Protected.pdf',
    mimeType: 'application/pdf',
    buffer: await readFile(
      path.resolve(__dirname, '../../fixtures/documents/password.pdf'),
    ),
  });
  await restored
    .locator('.workspace-resource-card')
    .filter({ hasText: 'Protected.pdf' })
    .getByRole('button', { name: '打开资料' })
    .click();
  const protectedReader = page.getByRole('dialog', {
    name: 'Protected.pdf',
    exact: true,
  });
  await protectedReader.locator('input[type=password]').fill('wrong');
  await protectedReader.getByRole('button', { name: '解锁' }).click();
  await expect(protectedReader.getByRole('alert')).toContainText('密码错误');
  await protectedReader.locator('input[type=password]').fill('verd-test');
  await protectedReader.getByRole('button', { name: '解锁' }).click();
  await expect(protectedReader.locator('.textLayer')).toContainText(
    'Protected PDF',
  );
  await protectedReader
    .getByRole('button', { name: '关闭', exact: true })
    .click();
}
