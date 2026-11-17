import { expect, test, type Locator, type Page } from '@playwright/test';

export async function exerciseDocumentTables(page: Page) {
  const paragraph = (text = '', id = text, href?: string) => ({
    type: 'paragraph',
    attrs: { blockId: id },
    content: text
      ? [
          {
            type: 'text',
            text,
            ...(href ? { marks: [{ type: 'link', attrs: { href } }] } : {}),
          },
        ]
      : [],
  });
  const table = (
    fixed: boolean,
    columns = 3,
    id = fixed ? 'fixed-table' : 'fluid-table',
  ) => ({
    type: 'table',
    attrs: { blockId: id },
    content: Array.from({ length: 3 }, (_, row) => ({
      type: 'tableRow',
      content: Array.from({ length: columns }, (_, column) => ({
        type: row === 0 ? 'tableHeader' : 'tableCell',
        ...(fixed
          ? { attrs: { colwidth: [columns === 1 ? 100 : 120 + column * 20] } }
          : {}),
        content: [
          paragraph(
            row === 0 && column === 1
              ? ''
              : fixed
                ? `${row}-${column}`
                : row === 1 && column === 1
                  ? 'https://example.test/' + 'unbroken-segment'.repeat(8)
                  : '长中文内容与链接换行测试',
            `${id}-${row}-${column}`,
            !fixed && row === 1 && column === 1
              ? 'https://example.test/'
              : undefined,
          ),
        ],
      })),
    })),
  });
  const content = {
    type: 'doc',
    content: [
      paragraph('Before table'),
      table(true),
      paragraph('After table'),
      table(false),
      paragraph('Last paragraph'),
      table(true, 1, 'compact-table'),
    ],
  };
  await page
    .locator('input[accept=".json,.verd.json,.verd-doc.json,.md,.markdown"]')
    .setInputFiles({
      name: 'Table operations.verd-doc.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          format: 'verd-document',
          version: 1,
          id: 'table-operations',
          title: 'Table operations',
          text: {
            schemaVersion: 1,
            id: 'table-operations',
            kind: 'block',
            plainText: '',
            content,
          },
        }),
      ),
    });
  await page
    .locator('.file-tree-name')
    .filter({ hasText: /^Table operations$/ })
    .click();
  const pane = page.locator('.workspace-pane.is-active');
  const editor = pane.locator('.tiptap');
  const primary = editor.locator('table').first();
  const rowMenu = pane.getByRole('dialog', { name: '行操作', exact: true });
  const colMenu = pane.getByRole('dialog', { name: '列操作', exact: true });
  const wholeMenu = pane.getByRole('dialog', { name: '表格操作', exact: true });
  const row = (index: number) =>
    pane.getByRole('button', { name: `选择第 ${index} 行`, exact: true });
  const column = (index: number) =>
    pane.getByRole('button', { name: `选择第 ${index} 列`, exact: true });
  const cellAt = (row: number, column: number) =>
    primary
      .locator('tr')
      .nth(row - 1)
      .locator('th,td')
      .nth(column - 1);
  const handles = pane.locator('.document-table-handle:visible');
  const expectHandles = async (rowIndex: number, columnIndex: number) => {
    await expect(row(rowIndex)).toBeVisible();
    await expect(column(columnIndex)).toBeVisible();
    await expect(handles).toHaveCount(2);
  };
  const expectWholeHandleAtTableTop = async (table: Locator) => {
    const handle = pane.getByRole('button', { name: '段落操作', exact: true });
    await expect(handle).toBeVisible();
    await expect
      .poll(async () => {
        const grip = (await handle.boundingBox())!;
        const bounds = (await table.boundingBox())!;
        return Math.abs(grip.y + grip.height / 2 - bounds.y);
      })
      .toBeLessThan(1);
  };
  const undo = async () => {
    await editor.focus();
    await page.keyboard.press('ControlOrMeta+z');
  };
  const selectRow = async (index: number) => {
    await cellAt(index, 1).hover();
    await row(index).click();
    await expect(rowMenu).toBeVisible();
  };
  const selectColumn = async (index: number) => {
    await primary
      .locator('tr')
      .first()
      .locator('th,td')
      .nth(index - 1)
      .hover();
    await column(index).click();
    await expect(colMenu).toBeVisible();
  };
  const openWhole = async () => {
    await primary.locator('tr').first().hover();
    await pane.getByRole('button', { name: '段落操作', exact: true }).click();
    await expect(wholeMenu).toBeVisible();
  };
  const dragTo = async (handle: Locator, x: number, y: number) => {
    const bounds = (await handle.boundingBox())!;
    await page.mouse.move(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(x, y, { steps: 12 });
    await page.mouse.up();
  };
  const before = editor.getByText('Before table', { exact: true });
  await before.click();
  await expect(handles).toHaveCount(0);
  await cellAt(2, 2).hover();
  await expectHandles(2, 2);
  const tableBounds = (await primary.boundingBox())!;
  const rowBounds = (await cellAt(2, 2).boundingBox())!;
  // Crossing the narrow gutter must keep the hovered handle reachable.
  await page.mouse.move(tableBounds.x - 1, rowBounds.y + rowBounds.height / 2);
  await expectHandles(2, 2);
  await row(2).hover();
  await expectHandles(2, 2);
  await row(2).focus();
  await before.hover();
  await expectHandles(2, 2);
  await page.keyboard.press('Enter');
  await expect(rowMenu).toBeVisible();
  await rowMenu.getByRole('button', { name: '全选表格', exact: true }).hover();
  await expectHandles(2, 2);
  await page.keyboard.press('Escape');

  await cellAt(2, 2).locator('p').click();
  await expect(editor).toBeFocused();
  await expect
    .poll(() =>
      cellAt(2, 2).evaluate((element) => {
        const selection = window.getSelection();
        return (
          selection?.isCollapsed &&
          !!selection.anchorNode &&
          element.contains(selection.anchorNode)
        );
      }),
    )
    .toBe(true);
  await before.hover();
  await expectHandles(2, 2);
  await page.keyboard.press('Tab');
  await expectHandles(2, 3);
  await page.keyboard.press('Shift+Tab');
  await expectHandles(2, 2);
  await cellAt(3, 1).hover();
  await expectHandles(3, 1);
  await before.hover();
  await expectHandles(2, 2);
  await pane.locator('.doc-toolbar button').first().focus();
  await expect(handles).toHaveCount(0);
  const other = editor.locator('table').nth(1);
  await other.locator('th').first().hover();
  await expectHandles(1, 1);
  await expectWholeHandleAtTableTop(other);
  expect((await row(1).boundingBox())!.y).toBeGreaterThan(
    (await other.boundingBox())!.y,
  );
  await cellAt(1, 2).hover();
  await expectHandles(1, 2);
  await expectWholeHandleAtTableTop(primary);
  await page.screenshot({ path: test.info().outputPath('table-handles.png') });
  await before.hover();
  await expect(handles).toHaveCount(0);

  await primary.locator('th').nth(1).locator('p').click();
  await expect(primary.locator('th').nth(1).locator('p')).not.toHaveAttribute(
    'data-placeholder',
    /输入/,
  );
  await expect(
    pane
      .locator('.doc-toolbar')
      .getByRole('button', { name: '表格', exact: true }),
  ).toHaveCount(0);
  await selectRow(2);
  await rowMenu.getByRole('button', { name: '全选表格', exact: true }).click();
  await expect(wholeMenu).toBeVisible();
  await page.keyboard.press('Escape');
  const originalBounds = await primary.boundingBox();
  await openWhole();
  await expect(wholeMenu).toBeInViewport({ ratio: 1 });
  expect(await primary.boundingBox()).toEqual(originalBounds);
  await page.screenshot({ path: test.info().outputPath('table-menu.png') });
  for (const name of [
    '上方插入行',
    '下方插入行',
    '左侧插入列',
    '右侧插入列',
    '表头行',
    '表头列',
    '复制表格',
    '删除表格',
  ])
    await expect(
      wholeMenu.getByRole('button', { name, exact: true }),
    ).toBeEnabled();
  await expect(
    wholeMenu.getByRole('button', { name: '删除行', exact: true }),
  ).toBeDisabled();
  await wholeMenu
    .getByRole('button', { name: '下方插入行', exact: true })
    .click();
  await expect(primary.locator('tr')).toHaveCount(4);
  await undo();
  await expect(primary.locator('tr')).toHaveCount(3);
  await page.keyboard.press('Escape');

  // A cancelled drag must not commit a move or leave the floating controls stuck.
  await primary.locator('tr').nth(1).hover();
  const cancelHandle = (await row(2).boundingBox())!;
  const cancelTarget = (await primary.locator('tr').last().boundingBox())!;
  await page.mouse.move(cancelHandle.x + 8, cancelHandle.y + 8);
  await page.mouse.down();
  await page.mouse.move(
    cancelTarget.x - 10,
    cancelTarget.y + cancelTarget.height - 2,
    { steps: 8 },
  );
  await expect(pane.locator('.document-table-drop-line')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(pane.locator('.document-table-drop-line')).toHaveCount(0);
  await expect(primary.locator('tr').nth(1)).toContainText('1-0');

  await selectRow(1);
  await expect(
    rowMenu.getByRole('button', { name: '上移行', exact: true }),
  ).toBeDisabled();
  await rowMenu.getByRole('button', { name: '下移行', exact: true }).click();
  await expect(primary.locator('tr').nth(1).locator('th')).toHaveCount(3);
  await expect(primary.locator('tr').first()).toContainText('1-0');
  await undo();
  await selectRow(2);
  await rowMenu
    .getByRole('button', { name: '上方插入行', exact: true })
    .click();
  await expect(primary.locator('tr')).toHaveCount(4);
  await undo();
  await primary.locator('tr').nth(1).hover();
  const lastRow = (await primary.locator('tr').last().boundingBox())!;
  await dragTo(row(2), lastRow.x - 10, lastRow.y + lastRow.height - 2);
  await expect(primary.locator('tr').last()).toContainText('1-0');
  await undo();

  await selectColumn(1);
  await expect(
    colMenu.getByRole('button', { name: '左移列', exact: true }),
  ).toBeDisabled();
  await colMenu.getByRole('button', { name: '右移列', exact: true }).click();
  await expect(primary.locator('tr').nth(1).locator('td').nth(1)).toHaveText(
    '1-0',
  );
  await undo();
  await selectColumn(2);
  await colMenu
    .getByRole('button', { name: '右侧插入列', exact: true })
    .click();
  await expect(primary.locator('tr').first().locator('th,td')).toHaveCount(4);
  await undo();
  await cellAt(1, 3).hover();
  const firstCell = (await primary.locator('th').first().boundingBox())!;
  await dragTo(column(3), firstCell.x + 2, firstCell.y - 10);
  await expect(primary.locator('tr').nth(1).locator('td').first()).toHaveText(
    '1-2',
  );
  await undo();

  await selectRow(1);
  await cellAt(2, 1).hover();
  await row(2).click({ modifiers: ['Shift'] });
  await expect(primary.locator('.selectedCell')).toHaveCount(6);
  await rowMenu.getByRole('button', { name: '删除行', exact: true }).click();
  await expect(primary.locator('tr')).toHaveCount(1);
  await selectRow(1);
  await rowMenu.getByRole('button', { name: '删除行', exact: true }).click();
  await expect(editor.locator('table')).toHaveCount(2);
  await before.click();
  await expect(handles).toHaveCount(0);
  await undo();
  await expect(primary.locator('tr')).toHaveCount(1);
  await undo();
  await expect(primary.locator('tr')).toHaveCount(3);
  await selectColumn(2);
  await colMenu.getByRole('button', { name: '删除列', exact: true }).click();
  await expect(primary.locator('tr').first().locator('th,td')).toHaveCount(2);
  await undo();

  // Opening table controls must not change document geometry or replace text tools.
  await page.keyboard.press('Escape');
  await editor
    .getByText('Before table', { exact: true })
    .dblclick({ position: { x: 16, y: 12 } });
  await expect
    .poll(() => page.evaluate(() => getSelection()?.toString()))
    .toBe('Before');
  await expect(
    pane.getByRole('toolbar', { name: '文字格式', exact: true }),
  ).toBeVisible();
  await expect(wholeMenu).toHaveCount(0);
  const fluid = editor.locator('table').nth(1);
  const widths = await fluid
    .locator('tr')
    .first()
    .locator('th')
    .evaluateAll((cells) =>
      cells.map((cell) => cell.getBoundingClientRect().width),
    );
  expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(2);
  const compactWidth = (await editor.locator('table').nth(2).boundingBox())!
    .width;
  expect(compactWidth).toBeGreaterThanOrEqual(100);
  expect(compactWidth).toBeLessThan(110);
  expect(
    await fluid.locator('a').evaluate((link) => link.getClientRects().length),
  ).toBeGreaterThan(1);
  await fluid.locator('th').first().hover();
  await column(1).click();
  await expect(colMenu).toBeVisible();
  await expect(fluid.locator('.selectedCell')).toHaveCount(3);
  await expect(primary.locator('.selectedCell')).toHaveCount(0);
  await page.keyboard.press('Escape');
  const cell = primary.locator('th').first();
  const beforeWidth = (await cell.boundingBox())!;
  await page.mouse.move(
    beforeWidth.x + beforeWidth.width - 1,
    beforeWidth.y + 12,
  );
  await page.mouse.down();
  await page.mouse.move(
    beforeWidth.x + beforeWidth.width + 39,
    beforeWidth.y + 12,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect
    .poll(async () => (await cell.boundingBox())!.width)
    .toBeGreaterThan(beforeWidth.width + 20);

  await openWhole();
  await wholeMenu
    .getByRole('button', { name: '整表下移', exact: true })
    .click();
  await expect
    .poll(() =>
      primary.evaluate(
        (table) =>
          table.closest('.tableWrapper')?.previousElementSibling?.textContent,
      ),
    )
    .toBe('After table');
  await undo();
  await primary.locator('tr').first().hover();
  const afterParagraph = (await editor
    .getByText('After table', { exact: true })
    .boundingBox())!;
  await dragTo(
    pane.getByRole('button', { name: '段落操作', exact: true }),
    afterParagraph.x + 20,
    afterParagraph.y + afterParagraph.height - 1,
  );
  await expect
    .poll(() =>
      primary.evaluate(
        (table) =>
          table.closest('.tableWrapper')?.previousElementSibling?.textContent,
      ),
    )
    .toBe('After table');
  await undo();
  await expect(primary.locator('tr').nth(1).locator('td').first()).toHaveText(
    '1-0',
  );
  await selectColumn(3);
  await colMenu.getByRole('button', { name: '左移列', exact: true }).click();
  await expect(primary.locator('tr').nth(1).locator('td').nth(1)).toHaveText(
    '1-2',
  );
  await expect(pane.getByText('已保存', { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    editor.locator('table').first().locator('tr').nth(1).locator('td').nth(1),
  ).toHaveText('1-2');
  await page.setViewportSize({ width: 640, height: 700 });
  const wrapper = editor.locator('.tableWrapper').first();
  await expect
    .poll(() =>
      wrapper.evaluate((element) => element.scrollWidth > element.clientWidth),
    )
    .toBe(true);
  await wrapper.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  await cellAt(2, 3).hover();
  await expectHandles(2, 3);
  await expectWholeHandleAtTableTop(primary);
  await expect(primary).not.toContainText('输入 / 插入内容');
}
