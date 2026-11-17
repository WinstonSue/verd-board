import { expect, type Page } from '@playwright/test';

export async function exerciseDocumentListHandles(page: Page) {
  const item = (id: string, text: string, children: object[] = []) => ({
    type: 'listItem',
    attrs: { blockId: id },
    content: [
      { type: 'paragraph', content: [{ type: 'text', text }] },
      ...children,
    ],
  });
  const content = [
    {
      type: 'bulletList',
      content: [
        item('bullet-parent', 'Bullet parent', [
          {
            type: 'bulletList',
            content: [item('bullet-child', 'Nested bullet')],
          },
        ]),
      ],
    },
    {
      type: 'orderedList',
      attrs: { start: 100 },
      content: [item('number-100', 'Number one hundred')],
    },
    {
      type: 'orderedList',
      attrs: { start: 999 },
      content: [item('number-999', 'Number nine hundred ninety nine')],
    },
  ];
  await page
    .locator('input[accept=".json,.verd.json,.verd-doc.json,.md,.markdown"]')
    .setInputFiles({
      name: 'List handles.verd-doc.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          format: 'verd-document',
          version: 1,
          id: 'list-handles',
          title: 'List handles',
          text: {
            schemaVersion: 1,
            id: 'list-handles',
            kind: 'block',
            plainText:
              'Bullet parent\nNested bullet\nNumber one hundred\nNumber nine hundred ninety nine',
            content: { type: 'doc', content },
          },
        }),
      ),
    });
  await page
    .locator('.file-tree-name')
    .filter({ hasText: /^List handles$/ })
    .click();
  const pane = page.locator('.workspace-pane.is-active');
  const handle = pane.getByRole('button', { name: '段落操作', exact: true });
  for (const id of [
    'bullet-parent',
    'bullet-child',
    'number-100',
    'number-999',
  ]) {
    const block = pane.locator(`.tiptap li[data-block-id="${id}"]`);
    await block.locator(':scope > p').hover();
    await expect(handle).toBeVisible();
    await expect
      .poll(async () => {
        const grip = (await handle.boundingBox())!;
        const occupied = await block.evaluate((item) => {
          const list = item.parentElement!;
          let left = list.getBoundingClientRect().left;
          const fold = item.querySelector<HTMLElement>(
            ':scope > .document-list-fold',
          );
          if (fold) left = Math.min(left, fold.getBoundingClientRect().left);
          if (list instanceof HTMLOListElement) {
            const style = getComputedStyle(item, '::marker');
            const context = document.createElement('canvas').getContext('2d')!;
            context.font = style.font;
            left = Math.min(
              left,
              item.getBoundingClientRect().left -
                context.measureText(`${list.start}.`).width -
                parseFloat(style.fontSize) / 2,
            );
          }
          return left;
        });
        return grip.x + grip.width <= occupied - 4 + 0.5;
      })
      .toBe(true);
  }
}
