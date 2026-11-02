import { test, expect } from '@playwright/test';

const file = {
  format: 'verd-document',
  version: 1,
  id: 'toolbar-doc',
  title: 'Toolbar document',
  text: {
    schemaVersion: 1,
    id: 'toolbar-doc',
    kind: 'block',
    align: 'left',
    plainText: 'Open target\nTarget',
    content: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Open target',
              marks: [{ type: 'link', attrs: { href: '#target' } }],
            },
          ],
        },
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Target' }],
        },
      ],
    },
  },
};
test('document toolbar, link preference and body focus work across container widths', async ({
  page,
}, info) => {
  await page.goto('/');
  await page
    .locator('input[accept=".json,.verd.json,.verd-doc.json,.md,.markdown"]')
    .setInputFiles({
      name: 'Toolbar document.verd-doc.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(file)),
    });
  await page
    .locator('.file-tree-name')
    .filter({ hasText: /^Toolbar document$/ })
    .click();
  const pane = page.locator('.workspace-pane.is-active');
  await expect(pane.locator('.document-page__title')).toHaveValue(file.title);
  for (const width of [1440, 900, 640]) {
    await page.setViewportSize({ width, height: 900 });
    const toolbar = pane.getByRole('toolbar', {
      name: 'document',
      exact: true,
    });
    await expect
      .poll(() =>
        toolbar.evaluate((node) => node.getBoundingClientRect().height),
      )
      .toBeLessThanOrEqual(36);
    const insert = toolbar.getByRole('button', { name: '插入', exact: true });
    await insert.click();
    const menu = page.getByRole('dialog', { name: '插入', exact: true });
    await expect(menu).toBeInViewport({ ratio: 1 });
    await expect(
      menu.getByRole('button', { name: '图片', exact: true }),
    ).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(insert).toBeFocused();
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await pane.locator('.tiptap').focus();
  await expect
    .poll(() =>
      pane
        .locator('.tiptap')
        .evaluate((node) => getComputedStyle(node).outlineStyle),
    )
    .toBe('none');
  await page.screenshot({ path: info.outputPath('document-toolbar.png') });
  await page.getByTestId('workspace-my').click();
  await page.getByTestId('settings-nav-personal.editor').click();
  const preference = page.getByTestId('settings-link-activation');
  await expect(preference).toHaveValue('modifier');
  await preference.selectOption('click');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('verdboard.interaction-settings')!)
            .linkActivation,
      ),
    )
    .toBe('click');
  await page.getByTestId('settings-nav-personal.general').click();
  await page.getByTestId('settings-appearance').selectOption('dark');
  await page.getByTestId('settings-language').selectOption('en');
  await page.getByTestId('my-back').click();
  await pane.getByRole('link', { name: 'Open target' }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.getSelection()?.anchorNode?.parentElement?.closest('h2')
            ?.textContent,
      ),
    )
    .toBe('Target');
  await expect(
    pane.getByRole('button', { name: 'Insert', exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath('document-toolbar-dark-en.png'),
  });
  await page.reload();
  await page.getByTestId('workspace-my').click();
  await page.getByTestId('settings-nav-personal.editor').click();
  await expect(page.getByTestId('settings-link-activation')).toHaveValue(
    'click',
  );
});
