import { expect, type Page } from '@playwright/test';
import { activeTabTitle } from './tab-actions';

export async function exerciseDocumentInlineReferences(page: Page) {
  const fileInput = page.locator(
    'input[accept=".json,.verd.json,.verd-doc.json,.md,.markdown"]',
  );
  const treeFile = (title: string) =>
    page.locator('.file-tree-name').getByText(title, { exact: true });
  for (const [id, title] of [
    ['inline-reference-destination', 'Reference destination'],
    ['inline-reference-source', 'Reference source'],
  ]) {
    await fileInput.setInputFiles({
      name: `${title}.verd-doc.json`,
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          format: 'verd-document',
          version: 1,
          id,
          title,
          text: {
            schemaVersion: 1,
            id,
            kind: 'block',
            align: 'left',
            plainText: '',
            content: { type: 'doc', content: [{ type: 'paragraph' }] },
          },
        }),
      ),
    });
    await expect(treeFile(title)).toBeVisible();
  }
  await treeFile('Reference source').click();
  const editor = page.locator('.workspace-pane.is-active .tiptap');
  const references = page.getByRole('listbox', { name: '引用文档与图表' });
  await editor.focus();
  await page.keyboard.type('dev@example.test');
  await expect(references).toBeHidden();
  await page.keyboard.type(' @');
  await expect(references).toBeInViewport({ ratio: 1 });
  await expect(editor).toBeFocused();
  await page.keyboard.type('nothing');
  await expect(references.getByRole('status')).toHaveText('没有匹配的结果');
  await expect(editor).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(references).toBeHidden();
  await expect(editor).toHaveText('dev@example.test @nothing');

  await page.keyboard.type(' @');
  await page.keyboard.type('destination');
  await expect(references.getByRole('option')).toHaveCount(1);
  await page.keyboard.press('Enter');
  const link = editor.getByRole('link', { name: 'Reference destination' });
  await expect(link).toHaveAttribute(
    'href',
    'verd://file/inline-reference-destination',
  );
  await expect(references).toBeHidden();
  await editor.press('ControlOrMeta+z');
  await expect(editor).toHaveText('dev@example.test @nothing @destination');
  await editor.press('ControlOrMeta+Shift+z');
  await page
    .locator('.workspace-pane.is-active .document-page__status')
    .click();
  await link.click({ modifiers: ['ControlOrMeta'] });
  await expect(activeTabTitle(page)).toHaveText('Reference destination');

  await treeFile('Reference source').click();
  await editor.press('ControlOrMeta+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('@');
  await expect(references).toBeVisible();
  const textWithOpenReference = await editor.innerText();
  await treeFile('Reference destination').click();
  await expect(references).toBeHidden();
  await treeFile('Reference source').click();
  await expect(references).toBeHidden();
  await expect(editor).toHaveText(textWithOpenReference, {
    useInnerText: true,
  });

  await treeFile('Reference destination').click();
  await editor.focus();
  await page.keyboard.type('Previous');
  await page.keyboard.press('Enter');
  const lastBlock = editor.locator(':scope > :last-child');
  const paragraphHint = '输入 / 插入内容，输入 @ 引用文档或画布';
  await expect(lastBlock).toHaveAttribute('data-placeholder', paragraphHint);
  const slash = page.getByRole('menu', { name: '插入内容', exact: true });
  await page.keyboard.type('/cancelt');
  await page.keyboard.press('Backspace');
  await expect(slash.getByRole('status')).toHaveText('没有匹配的结果');
  await expect(editor).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(slash).toBeHidden();
  await expect(lastBlock).toHaveText('/cancel');
  await expect(editor).toBeFocused();
  for (let index = 0; index < '/cancel'.length; index++)
    await page.keyboard.press('Backspace');

  await page.keyboard.type('/');
  await expect(slash).toBeVisible();
  const activeCommand = slash.locator('button[data-active="true"]');
  const firstCommand = (await activeCommand.textContent()) ?? '';
  await page.keyboard.press('ArrowDown');
  await expect(activeCommand).not.toHaveText(firstCommand);
  await page.keyboard.press('ArrowUp');
  await expect(activeCommand).toHaveText(firstCommand);
  const input = await page.context().newCDPSession(page);
  try {
    await input.send('Input.imeSetComposition', {
      text: 'erjibiaoti',
      selectionStart: 10,
      selectionEnd: 10,
    });
    await input.send('Input.insertText', { text: '二级标题' });
  } finally {
    await input.detach();
  }
  await expect(slash.getByRole('button')).toHaveCount(1);
  await expect(editor).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(editor.locator('h2')).toHaveAttribute(
    'data-placeholder',
    '标题 2',
  );
  await expect(slash).toBeHidden();
  await editor.press('ControlOrMeta+z');
  await expect(lastBlock).toHaveText('/二级标题');

  for (let index = 0; index < '/二级标题'.length; index++)
    await page.keyboard.press('Backspace');
  await expect(lastBlock).toHaveText('');
  await page.keyboard.type('## ');
  const heading = editor.locator('h2');
  await expect(heading).toHaveAttribute('data-placeholder', '标题 2');
  await page.keyboard.type('Title');
  await expect(heading).toHaveText('Title');
  const blockId = (await heading.getAttribute('data-block-id'))!;
  expect(blockId).toBeTruthy();
  for (let index = 0; index < 'Title'.length; index++)
    await page.keyboard.press('Backspace');
  await expect(heading).toHaveAttribute('data-placeholder', '标题 2');
  const blocksBefore = await editor.locator(':scope > *').count();
  await page.keyboard.press('Backspace');
  await expect(heading).toHaveCount(0);
  await expect(lastBlock).toHaveAttribute('data-block-id', blockId);
  await expect(lastBlock).toHaveAttribute('data-placeholder', paragraphHint);
  await expect(editor.locator(':scope > *')).toHaveCount(blocksBefore);
  await page.keyboard.press('Backspace');
  await expect(editor.locator(':scope > *')).toHaveCount(blocksBefore - 1);
}
