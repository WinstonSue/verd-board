import { bodyEditor, editBody } from './body-editor';
import { selectAppAction } from './app-actions';
import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { selectDrawingTool } from './drawing-tools';
import { expandPropertyGroup } from './property-group';
import {
  activateBoardTab,
  backToPreviousCanvas,
  clearWorkspaceStorage,
  persistedWorkspace,
} from './workspace-nav';
const canvas = (page: Page) =>
  page.locator('svg[aria-label="Frame canvas"][data-surface="root"]:visible');
const cells = (page: Page, kind: string) =>
  canvas(page).locator(
    kind === 'frame'
      ? '[data-cell-kind="frame"],[data-cell-kind="frame-reference"]'
      : `[data-cell-kind="${kind}"]`,
  );
const persisted = persistedWorkspace;
const createAt = async (page: Page, label: string, x = 280, y = 180) => {
  await selectDrawingTool(page, label);
  if (label === '形状') await page.getByTestId('shape-rectangle').click();
  const box = (await canvas(page).boundingBox())!;
  await page.mouse.click(box.x + x, box.y + y);
  await page.getByRole('button', { name: '选择', exact: true }).click();
};

test('multi-selection drag and group alignment preserve member spacing with one-step history and refresh', async ({
  page,
}) => {
  await page.goto('/');
  await createAt(page, '形状', 180, 160);
  await createAt(page, '形状', 400, 160);
  await createAt(page, '形状', 650, 400);
  const nodes = cells(page, 'geometry');
  const ids = await nodes.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('data-cell-id')!),
  );
  const saved = async () => {
    const data = await persisted(page);
    return data?.records[data.manifest.rootId];
  };
  await expect
    .poll(async () => Object.keys((await saved())?.cells ?? {}).length)
    .toBe(3);
  const before = (await saved())!.cells;
  await nodes.nth(0).click();
  await nodes.nth(1).click({ modifiers: ['Shift'] });
  const box = (await nodes.nth(0).locator('path').first().boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 70, box.y + 55, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(async () => (await saved())?.cells[ids[1]].geometry.x)
    .toBe(before[ids[1]].geometry.x + 50);
  expect((await saved())!.cells[ids[0]].geometry.y).toBe(
    before[ids[0]].geometry.y + 35,
  );
  expect((await saved())!.cells[ids[2]]).toEqual(before[ids[2]]);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect.poll(async () => (await saved())?.cells).toEqual(before);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expandPropertyGroup(page);
  await page.getByRole('button', { name: '分组', exact: true }).click();
  await nodes.nth(0).click();
  await nodes.nth(2).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: '右对齐', exact: true }).click();
  await expect
    .poll(async () => {
      const cells = (await saved())?.cells;
      return (
        cells && [
          cells[ids[1]].geometry.x - cells[ids[0]].geometry.x,
          cells[ids[1]].geometry.x +
            cells[ids[1]].geometry.width -
            cells[ids[2]].geometry.x -
            cells[ids[2]].geometry.width,
        ]
      );
    })
    .toEqual([220, 0]);
  await page.reload();
  await expect(nodes).toHaveCount(3);
  await nodes.nth(0).click();
  await expandPropertyGroup(page);
  await expect(
    page.getByRole('button', { name: '取消分组', exact: true }),
  ).toBeVisible();
  await nodes.nth(0).dblclick();
  await editBody(page, 'Group member');
  await expect(nodes.nth(0)).toContainText('Group member');
  await expect(nodes.nth(1)).toHaveText('');
  await canvas(page).press('Escape');
  await canvas(page).press('Escape');
  await nodes.nth(0).click();
  await expect(
    page.getByRole('button', { name: '取消分组', exact: true }),
  ).toBeVisible();
});

test('grid, Frame aspect ratio and automatic stylus protection retain their product controls', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Canvas grid', { exact: true }).check();
  await page.getByLabel('Canvas grid size', { exact: true }).fill('32');
  await page.getByLabel('Canvas grid size', { exact: true }).press('Enter');
  await expect(canvas(page)).toHaveCSS('background-image', /radial-gradient/);
  await createAt(page, '容器', 280, 180);
  await cells(page, 'frame').locator('[data-frame-title-id]').first().click();
  const id = (await cells(page, 'frame').getAttribute('data-cell-id'))!;
  await page.getByLabel('比例').selectOption('16:9');
  await expect
    .poll(async () => {
      const data = await persisted(page);
      const shell = Object.values(data?.records ?? {})
        .flatMap((record: any) => Object.values(record.cells ?? {}))
        .find((cell: any) => cell.id === id) as
        | { aspectRatio?: string; geometry: { width: number; height: number } }
        | undefined;
      const root = data?.records[data.manifest.rootId];
      return (
        shell && {
          ratio: shell.aspectRatio,
          aspect: shell.geometry.width / shell.geometry.height,
          grid: root?.frame?.view?.theme?.gridSize,
        }
      );
    })
    .toEqual({ ratio: '16:9', aspect: 16 / 9, grid: 32 });
  const box = (await canvas(page).boundingBox())!;
  await canvas(page).dispatchEvent('pointerdown', {
    pointerType: 'pen',
    pointerId: 7,
    button: 0,
    clientX: box.x + 30,
    clientY: box.y + 30,
  });
  await canvas(page).dispatchEvent('pointerup', {
    pointerType: 'pen',
    pointerId: 7,
    button: 0,
    clientX: box.x + 30,
    clientY: box.y + 30,
  });
  await expect(
    page.getByRole('button', { name: 'Exit stylus mode', exact: true }),
  ).toBeVisible();
  await createAt(page, '形状', 600, 420);
  await expect(cells(page, 'geometry')).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Exit stylus mode', exact: true })
    .click();
  await createAt(page, '形状', 600, 420);
  await expect(cells(page, 'geometry')).toHaveCount(1);
  await expect
    .poll(async () => {
      const data = await persisted(page);
      return Object.values(
        data?.records[data.manifest.rootId]?.cells ?? {},
      ).filter((cell: any) => cell.kind === 'geometry').length;
    })
    .toBe(1);
  await page.reload();
  await expect(page.getByLabel('Canvas grid', { exact: true })).toBeChecked();
  await expect(
    page.getByLabel('Canvas grid size', { exact: true }),
  ).toHaveValue('32');
  await cells(page, 'frame').locator('[data-frame-title-id]').first().click();
  await expect(page.getByLabel('比例')).toHaveValue('16:9');
});

test('new mind topics inherit typography and expand their layout without copying text or links', async ({
  page,
}) => {
  const { a } = await summaryFixture(page);
  await a.click();
  await page
    .getByRole('button', { name: 'Selection bold', exact: true })
    .click();
  await page
    .getByLabel('Selection font size', { exact: true })
    .selectOption('32px');
  await page
    .getByLabel('Selection link URL', { exact: true })
    .fill('https://example.com');
  await page
    .getByRole('button', { name: 'Apply selection link', exact: true })
    .click();
  await canvas(page).press('Tab');
  const topic = cells(page, 'mind-child').filter({ hasText: 'Topic' }).last();
  const id = await topic.getAttribute('data-cell-id');
  await expect(topic.locator('strong')).toBeVisible();
  await expect(topic.locator('a')).toHaveCount(0);
  await expect(topic.locator('[style*="font-size: 32px"]')).toBeVisible();
  await expect
    .poll(async () => {
      const data = await persisted(page);
      return Object.values(data?.records ?? {})
        .map((record: any) => record.cells[id!])
        .find(Boolean)?.content?.text?.plainText;
    })
    .toBe('Topic');
  await page.reload();
  await expect(
    canvas(page).locator(`[data-cell-id="${id}"] strong`),
  ).toBeVisible();
});

const summaryFixture = async (page: Page) => {
  await page.goto('/');
  await selectAppAction(page, '文本导入');
  const dialog = page.getByRole('dialog', { name: '文本导入' });
  await dialog.getByLabel('导入格式').selectOption('markdown');
  await dialog
    .getByLabel('源文本')
    .fill('# Center\n## Topic A\n## Topic B\n## Topic C');
  await dialog.getByRole('button', { name: '插入', exact: true }).click();
  await cells(page, 'frame').locator('[data-frame-title-id]').first().click();
  await page.getByTestId('frame-open').locator('visible=true').click();
  await page.getByRole('button', { name: '适配画布', exact: true }).click();
  const a = cells(page, 'mind-child').filter({ hasText: 'Topic A' }),
    b = cells(page, 'mind-child').filter({ hasText: 'Topic B' }),
    c = cells(page, 'mind-child').filter({ hasText: 'Topic C' });
  const aId = (await a.getAttribute('data-cell-id'))!,
    bId = (await b.getAttribute('data-cell-id'))!,
    cId = (await c.getAttribute('data-cell-id'))!;
  await a.click();
  await c.click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: '概要', exact: true }).click();
  await expect(cells(page, 'mind-summary')).toHaveCount(1);
  await expect(canvas(page).locator('[data-mind-summary-bracket]')).toHaveCount(
    1,
  );
  await page.getByRole('button', { name: '适配画布', exact: true }).click();
  return { a, b, c, aId, bId, cId };
};
const summaryRange = async (page: Page) => {
  const data = await persisted(page);
  const edge = Object.values(data?.records ?? {})
    .flatMap((record: any) => Object.values(record.cells))
    .find((cell: any) => cell.kind === 'mind-summary-edge') as any;
  return edge ? [edge.data.startSiblingId, edge.data.endSiblingId] : null;
};
const savedMindParent = async (page: Page, childId: string) => {
  const data = await persisted(page);
  const edge = Object.values(data?.records ?? {})
    .flatMap((record: any) => Object.values(record.cells))
    .find(
      (cell: any) =>
        cell.kind === 'mind-branch' && cell.target.cellId === childId,
    ) as any;
  return edge?.source.cellId;
};

test('mind style inheritance, branch appearance and image edits survive history, navigation and refresh', async ({
  page,
}) => {
  const { a, aId } = await summaryFixture(page);
  await a.click();
  await page
    .getByLabel('填充', { exact: true })
    .locator('visible=true')
    .fill('#ffeeaa');
  await page
    .getByLabel('描边', { exact: true })
    .locator('visible=true')
    .fill('#aa0000');
  await page
    .getByLabel('Stroke width', { exact: true })
    .locator('visible=true')
    .fill('4');
  await page
    .getByLabel('Stroke width', { exact: true })
    .locator('visible=true')
    .press('Enter');
  await page
    .getByLabel('Stroke style', { exact: true })
    .locator('visible=true')
    .selectOption('dotted');
  await page.getByLabel('Mind topic shape').selectOption('underline');
  await page.getByLabel('Mind branch shape').selectOption('polyline');
  await page.getByLabel('Mind branch color').fill('#008800');
  await page.getByLabel('Mind branch width').fill('5');
  await page.getByLabel('Mind branch width').press('Enter');
  await page.getByLabel('Mind branch style').selectOption('dotted');
  const imageUrl = await page.evaluate(() => {
    const image = document.createElement('canvas');
    image.width = 64;
    image.height = 32;
    const context = image.getContext('2d')!;
    context.fillStyle = '#008800';
    context.fillRect(0, 0, 64, 32);
    return image.toDataURL('image/png');
  });
  const file = {
    name: 'mind-image.png',
    mimeType: 'image/png',
    buffer: Buffer.from(imageUrl.split(',')[1], 'base64'),
  };
  await page.getByLabel('Mind image file').setInputFiles(file);
  await expect(a.locator('[data-mind-image]')).toBeVisible();
  await page.getByLabel('Mind image width').fill('48');
  await page.getByLabel('Mind image width').press('Enter');
  await expect(a.locator('[data-mind-image]')).toHaveAttribute('width', '48');
  await expect(a.locator('[data-mind-image]')).toHaveAttribute('height', '24');
  await page.getByLabel('Mind emojis').fill('🙂 🚀');
  await expect(a.locator('[data-mind-emojis]')).toHaveText('🙂 🚀');
  const saved = async (id: string) =>
    Object.values((await persisted(page))?.records ?? {})
      .flatMap((record: any) => Object.values(record.cells))
      .find((cell: any) => cell.id === id) as any;
  await expect
    .poll(async () => (await saved(aId))?.data?.image?.width)
    .toBe(48);
  await page.getByLabel('Mind image file').setInputFiles({
    name: 'broken.png',
    mimeType: 'image/png',
    buffer: Buffer.from('invalid image'),
  });
  await expect(
    page.getByRole('alert').filter({ hasText: /decode/i }),
  ).toBeVisible();
  await expect(a.locator('[data-mind-image]')).toHaveAttribute(
    'href',
    imageUrl,
  );
  await canvas(page).press('Tab');
  await expect(cells(page, 'mind-child')).toHaveCount(4);
  await editBody(page, 'Inherited child');
  const child = cells(page, 'mind-child').filter({
    hasText: 'Inherited child',
  });
  const childId = (await child.getAttribute('data-cell-id'))!;
  await expect
    .poll(async () => (await saved(childId))?.appearance)
    .toEqual({
      fill: '#ffeeaa',
      strokeColor: '#aa0000',
      strokeWidth: 4,
      strokeStyle: 'dotted',
    });
  await expect
    .poll(async () => (await saved(childId))?.data?.branchAppearance)
    .toEqual({ strokeColor: '#008800', strokeWidth: 5, strokeStyle: 'dotted' });
  expect((await saved(childId))?.data?.image).toBeUndefined();
  expect((await saved(childId))?.data?.emojis).toBeUndefined();
  await expect(child.locator('[data-mind-hit-box]')).toHaveCount(1);
  await canvas(page).press('Enter');
  await expect(cells(page, 'mind-child')).toHaveCount(5);
  await editBody(page, 'Inherited sibling');
  const sibling = cells(page, 'mind-child').filter({
    hasText: 'Inherited sibling',
  });
  const siblingId = (await sibling.getAttribute('data-cell-id'))!;
  await expect.poll(() => savedMindParent(page, siblingId)).toBe(aId);
  await expect
    .poll(async () => (await saved(siblingId))?.geometry?.outline)
    .toBe('underline');
  const styledBranch = cells(page, 'mind-branch')
    .filter({ has: page.locator('[data-mind-branch-shape="polyline"]') })
    .locator('path[stroke="#008800"]')
    .first();
  await expect(styledBranch).toHaveAttribute('stroke-width', '5');
  await expect(styledBranch).toHaveAttribute('stroke-dasharray', '2 4');
  await a.locator('[data-mind-hit-box]').click({ position: { x: 5, y: 5 } });
  await page.getByRole('button', { name: '移除图片', exact: true }).click();
  await expect(a.locator('[data-mind-image]')).toHaveCount(0);
  await page
    .getByRole('button', { name: '撤销', exact: true })
    .locator('visible=true')
    .click();
  await expect(a.locator('[data-mind-image]')).toHaveAttribute('width', '48');
  await backToPreviousCanvas(page);
  await page.reload();
  await expect(cells(page, 'mind-child')).toHaveCount(5);
  const restored = cells(page, 'mind-child').filter({ hasText: 'Topic A' });
  await expect(restored.locator('[data-mind-image]')).toHaveAttribute(
    'href',
    imageUrl,
  );
  await expect(restored.locator('[data-mind-emojis]')).toHaveText('🙂 🚀');
  await expect
    .poll(async () => (await saved(siblingId))?.data?.branchShape)
    .toBe('polyline');
});

test('mind drags reorder siblings, change parents using the pointer and ignore cycles without losing history', async ({
  page,
}) => {
  const { a, b, c, aId, bId, cId } = await summaryFixture(page);
  const rootId = await cells(page, 'mind-root').getAttribute('data-cell-id');
  const bounds = async (node: typeof a) =>
    (await node.locator('path').first().boundingBox())!;
  const from = await bounds(c),
    first = await bounds(a);
  await page.mouse.move(from.x + 8, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(first.x + first.width / 2, first.y - 8, { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => summaryRange(page)).toEqual([cId, bId]);
  await expect
    .poll(async () => (await bounds(c)).y < (await bounds(a)).y)
    .toBe(true);
  await expect
    .poll(async () => (await bounds(a)).y < (await bounds(b)).y)
    .toBe(true);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect.poll(() => summaryRange(page)).toEqual([aId, cId]);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect.poll(() => summaryRange(page)).toEqual([cId, bId]);
  const source = await bounds(a),
    target = await bounds(b);
  await page.mouse.move(
    source.x + source.width - 8,
    source.y + source.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    target.x + target.width / 2,
    target.y + target.height / 2,
    { steps: 10 },
  );
  await page.mouse.up();
  await expect.poll(() => savedMindParent(page, aId)).toBe(bId);
  await expect(cells(page, 'mind-branch')).toHaveCount(3);
  const ancestor = await bounds(b),
    descendant = await bounds(a);
  await page.mouse.move(ancestor.x + 8, ancestor.y + ancestor.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    descendant.x + descendant.width / 2,
    descendant.y + descendant.height / 2,
    { steps: 10 },
  );
  await page.mouse.up();
  await expect(canvas(page).locator('[data-mind-ghost]')).toHaveCount(0);
  await expect(
    page.getByRole('alert').filter({ hasText: 'cycle' }),
  ).toHaveCount(0);
  await expect.poll(() => savedMindParent(page, aId)).toBe(bId);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect.poll(() => savedMindParent(page, aId)).toBe(rootId);
  await backToPreviousCanvas(page);
  await page.reload();
  await expect(cells(page, 'mind-child')).toHaveCount(3);
  await expect.poll(() => summaryRange(page)).toEqual([cId, bId]);
});

for (const grip of ['left', 'right'] as const) {
  test(`Mind hotzone captures an entire branch with a ${grip} grab, previews without saving, cancels and commits once`, async ({
    page,
  }) => {
    const { a, b, aId, bId } = await summaryFixture(page);
    await a.click();
    await canvas(page).press('Tab');
    await expect(cells(page, 'mind-child')).toHaveCount(4);
    await editBody(page, 'Nested child');
    await canvas(page).press('Escape');
    const child = cells(page, 'mind-child').filter({ hasText: 'Nested child' });
    const childId = (await child.getAttribute('data-cell-id'))!;
    await expect.poll(() => savedMindParent(page, childId)).toBe(aId);
    await page.getByRole('button', { name: '适配画布', exact: true }).click();
    const before = await persisted(page);
    const rootId = await cells(page, 'mind-root').getAttribute('data-cell-id');
    const bounds = async (node: typeof a) =>
      (await node.locator('path').first().boundingBox())!;
    const source = await bounds(a),
      target = await bounds(b);
    const offset = grip === 'left' ? 8 : source.width - 8;
    const destination = {
      x: target.x + target.width + 20 + offset,
      y: target.y + target.height / 2,
    };
    const begin = async () => {
      await page.mouse.move(source.x + offset, source.y + source.height / 2);
      await page.mouse.down();
      await page.mouse.move(destination.x, destination.y, { steps: 8 });
    };
    await begin();
    const ghost = canvas(page).locator('[data-mind-ghost]');
    await expect(ghost).toBeVisible();
    await expect(
      ghost.locator(`[data-draft-cell-id="${childId}"]`),
    ).toBeVisible();
    await expect(
      canvas(page).locator('[data-mind-drop-target]'),
    ).toHaveAttribute('data-mind-drop-target', bId);
    await expect.poll(() => persisted(page)).toEqual(before);
    await page.mouse.move(destination.x + 250, destination.y - 250, {
      steps: 5,
    });
    await expect(ghost).toHaveCount(0);
    await page.mouse.move(destination.x, destination.y, { steps: 5 });
    await expect(ghost).toBeVisible();
    await canvas(page).press('Escape');
    await page.mouse.up();
    await expect(ghost).toHaveCount(0);
    await expect.poll(() => persisted(page)).toEqual(before);
    await begin();
    await expect(ghost).toBeVisible();
    await page.mouse.up();
    await expect(ghost).toHaveCount(0);
    await expect.poll(() => savedMindParent(page, aId)).toBe(bId);
    expect(await savedMindParent(page, childId)).toBe(aId);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    await expect.poll(() => savedMindParent(page, aId)).toBe(rootId);
    await page.getByRole('button', { name: '重做', exact: true }).click();
    await expect.poll(() => savedMindParent(page, aId)).toBe(bId);
    await page.reload();
    await expect.poll(() => savedMindParent(page, aId)).toBe(bId);
    await expect(cells(page, 'mind-child')).toHaveCount(4);
  });
}

test('summary brackets adjust sibling ids through one transaction and persist in embedded and detail views', async ({
  page,
}) => {
  const { aId, bId, cId, b } = await summaryFixture(page);
  await expect.poll(() => summaryRange(page)).toEqual([aId, cId]);
  await cells(page, 'mind-summary').click();
  const handle = canvas(page).locator('[data-summary-handle="start"]');
  await expect(handle).toBeVisible();
  const from = (await handle.boundingBox())!,
    to = (await b.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  await expect.poll(() => summaryRange(page)).toEqual([bId, cId]);
  await expect(cells(page, 'mind-branch')).toHaveCount(3);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect.poll(() => summaryRange(page)).toEqual([aId, cId]);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect.poll(() => summaryRange(page)).toEqual([bId, cId]);
  await backToPreviousCanvas(page);
  await expect(canvas(page).locator('[data-mind-summary-bracket]')).toHaveCount(
    1,
  );
  await cells(page, 'mind-summary').click();
  const embeddedHandle = (await handle.boundingBox())!,
    embeddedA = (await cells(page, 'mind-child')
      .filter({ hasText: 'Topic A' })
      .boundingBox())!;
  await page.mouse.move(
    embeddedHandle.x + embeddedHandle.width / 2,
    embeddedHandle.y + embeddedHandle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    embeddedA.x + embeddedA.width / 2,
    embeddedA.y + embeddedA.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect.poll(() => summaryRange(page)).toEqual([aId, cId]);
  await page.reload();
  await expect(canvas(page).locator('[data-mind-summary-bracket]')).toHaveCount(
    1,
  );
  await expect.poll(() => summaryRange(page)).toEqual([aId, cId]);
  await cells(page, 'frame').locator('[data-frame-title-id]').first().click();
  await page.getByTestId('frame-open').locator('visible=true').click();
  await expect(cells(page, 'mind-summary')).toHaveCount(1);
  await cells(page, 'mind-summary').click();
  await expect(canvas(page).locator('[data-summary-handle]')).toHaveCount(2);
  const exported = (await downloadImage(page, 'svg')).bytes.toString();
  expect(exported).toContain('data-mind-summary-bracket');
  expect(exported).not.toContain('data-summary-handle');
});

test('deleting covered topics shrinks the summary and removing its last topic is fully undoable', async ({
  page,
}) => {
  const { a, b, c, aId, bId, cId } = await summaryFixture(page);
  await a.click();
  await canvas(page).press('Delete');
  await expect.poll(() => summaryRange(page)).toEqual([bId, cId]);
  await b.click();
  await canvas(page).press('Delete');
  await expect.poll(() => summaryRange(page)).toEqual([cId, cId]);
  await c.click();
  await canvas(page).press('Delete');
  await expect(cells(page, 'mind-summary')).toHaveCount(0);
  await expect(cells(page, 'mind-summary-edge')).toHaveCount(0);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(cells(page, 'mind-summary')).toHaveCount(1);
  await expect.poll(() => summaryRange(page)).toEqual([cId, cId]);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(cells(page, 'mind-child')).toHaveCount(3);
  await expect.poll(() => summaryRange(page)).toEqual([aId, cId]);
});

test('product runs the native runtime and autosaves partitioned documents', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('[data-runtime="cells"]')).toBeVisible();
  await createAt(page, '形状');
  await expect(cells(page, 'geometry')).toHaveCount(1);
  await expect
    .poll(async () => {
      const data = await persisted(page);
      return data?.records[data.manifest.rootId]?.frame?.children?.length;
    })
    .toBe(1);
  await page.reload();
  await expect(cells(page, 'geometry')).toHaveCount(1);
  await expect(page.locator('.board-container')).toHaveCount(0);
});

test('embedded mind editing and detail editing share cells across navigation and refresh', async ({
  page,
}) => {
  await page.goto('/');
  await createAt(page, '思维导图');
  await expect(cells(page, 'mind-root')).toHaveCount(1);
  // Embedded previews are view-only; add the child on the detail canvas.
  await cells(page, 'frame').locator('[data-frame-title-id]').first().click();
  await page.getByTestId('frame-open').locator('visible=true').click();
  await expect(
    page.locator('.verd-frame[data-testid="verd-mind"]:visible'),
  ).toBeVisible();
  await cells(page, 'mind-root').click();
  await canvas(page).press('Tab');
  await expect(cells(page, 'mind-child')).toHaveCount(1);
  await page.getByRole('button', { name: '子主题', exact: true }).click();
  await expect(cells(page, 'mind-child')).toHaveCount(2);
  await backToPreviousCanvas(page);
  await expect(cells(page, 'mind-child')).toHaveCount(2);
  await expect
    .poll(async () => {
      const data = await persisted(page);
      return Object.values(data?.records ?? {})
        .flatMap((record: any) => Object.values(record.cells))
        .filter((cell: any) => cell.kind === 'mind-child').length;
    })
    .toBe(2);
  await page.reload();
  await expect(cells(page, 'mind-child')).toHaveCount(2);
});

test('deleting a container and undo restores its entire subtree', async ({
  page,
}) => {
  await page.goto('/');
  await createAt(page, '思维导图');
  await cells(page, 'frame').locator('[data-frame-title-id]').first().click();
  await page.getByTestId('frame-open').locator('visible=true').click();
  await cells(page, 'mind-root').click();
  await canvas(page).press('Tab');
  await expect(cells(page, 'mind-child')).toHaveCount(1);
  await backToPreviousCanvas(page);
  await cells(page, 'frame').locator('[data-frame-title-id]').first().click();
  await canvas(page).press('Delete');
  await expect(cells(page, 'frame')).toHaveCount(0);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(cells(page, 'frame')).toHaveCount(1);
  await expect(cells(page, 'mind-child')).toHaveCount(1);
  await expect(cells(page, 'mind-branch')).toHaveCount(1);
});

test('draws and erases native freehand through one transaction history', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '画笔', exact: true }).click();
  const box = (await canvas(page).boundingBox())!;
  await page.mouse.move(box.x + 280, box.y + 180);
  await page.mouse.down();
  await page.mouse.move(box.x + 520, box.y + 330, { steps: 12 });
  await page.mouse.up();
  await expect(cells(page, 'freehand')).toHaveCount(1);
  await page.getByRole('button', { name: '橡皮擦', exact: true }).click();
  await page.mouse.move(box.x + 280, box.y + 180);
  await page.mouse.down();
  await page.mouse.move(box.x + 520, box.y + 330, { steps: 12 });
  await page.mouse.up();
  await expect(cells(page, 'freehand')).toHaveCount(0);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(cells(page, 'freehand')).toHaveCount(1);
});

test('imports Markdown into a native embedded Frame, edits detail and exports the mounted document', async ({
  page,
}) => {
  await page.goto('/');
  await selectAppAction(page, '文本导入');
  const dialog = page.getByRole('dialog', { name: '文本导入' });
  await dialog.getByLabel('导入格式').selectOption('markdown');
  await dialog
    .getByLabel('源文本')
    .fill('# Center\n## Research\n### Notes\n## Plan');
  await expect(dialog.locator('[data-cell-kind="mind-root"]')).toHaveCount(1);
  await expect(dialog.locator('[data-cell-kind="mind-child"]')).toHaveCount(3);
  await dialog.getByRole('button', { name: '插入', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(cells(page, 'mind-child')).toHaveCount(3);
  await cells(page, 'frame').locator('[data-frame-title-id]').first().click();
  await page.getByTestId('frame-open').locator('visible=true').click();
  await page.getByRole('button', { name: '子主题', exact: true }).click();
  await expect(cells(page, 'mind-child')).toHaveCount(4);
  await selectAppAction(page, '导出为 Markdown');
  // Markdown export previews first; the dialog's download button saves it.
  const preview = page.getByRole('dialog', { name: 'Markdown preview' });
  const download = page.waitForEvent('download');
  await preview.getByRole('button', { name: '下载', exact: true }).click();
  const file = await download;
  const stream = await file.createReadStream();
  let text = '';
  for await (const chunk of stream!) text += chunk.toString();
  expect(text).toContain('# Center');
  expect(text).toContain('### Notes');
  expect(text).toContain('Topic');
  await backToPreviousCanvas(page);
  await expect
    .poll(async () => {
      const data = await persisted(page);
      return Object.keys(data?.manifest.frames ?? {}).length;
    })
    .toBe(2);
  await page.reload();
  await expect(cells(page, 'mind-child')).toHaveCount(4);
});

test('imports Mermaid geometry and bound labeled arrows through the native converter', async ({
  page,
}) => {
  await page.goto('/');
  await selectAppAction(page, '文本导入');
  const dialog = page.getByRole('dialog', { name: '文本导入' });
  await dialog
    .getByLabel('源文本')
    .fill('flowchart LR\nA[Input] -->|uses| B{Decision}');
  await expect(dialog.locator('[data-cell-kind="geometry"]')).toHaveCount(2);
  await expect(dialog.locator('[data-cell-kind="arrow"]')).toHaveCount(1);
  await dialog.getByRole('button', { name: '插入', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(cells(page, 'geometry')).toHaveCount(2);
  await expect(cells(page, 'arrow')).toHaveCount(1);
  await expect(cells(page, 'arrow').locator('[data-edge-label]')).toHaveText(
    'uses',
  );
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(cells(page, 'geometry')).toHaveCount(0);
  await expect(cells(page, 'arrow')).toHaveCount(0);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect(cells(page, 'arrow')).toHaveCount(1);
  await expect
    .poll(async () => {
      const data = await persisted(page);
      return data?.records[data.manifest.rootId]?.frame?.children?.length;
    })
    .toBe(3);
  await page.reload();
  await expect(cells(page, 'geometry')).toHaveCount(2);
  await expect(cells(page, 'arrow').locator('[data-edge-label]')).toHaveText(
    'uses',
  );
});

test('draws every whiteboard symbol with the native renderer and restores them from real autosave', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: '形状', exact: true }).click();
  const shapeSelect = page.locator('.frame-shape-grid button[data-shape]');
  const shapes = await shapeSelect.evaluateAll((buttons) =>
    buttons.map((button) => button.getAttribute('data-shape')!),
  );
  expect(shapes).toHaveLength(65);
  const box = (await canvas(page).boundingBox())!;
  for (const [index, shape] of shapes.entries()) {
    if (!(await shapeSelect.first().isVisible()))
      await selectDrawingTool(page, '形状');
    await page.getByTestId(`shape-${shape}`).click();
    await page.mouse.click(box.x + 300, box.y + 220);
    await expect(cells(page, 'geometry')).toHaveCount(index + 1);
    const drawing = cells(page, 'geometry')
      .last()
      .locator('[data-shape-renderer="rough"]');
    await expect(drawing).toHaveCount(1);
    expect(await drawing.locator('path').count()).toBeGreaterThan(0);
    expect(await drawing.innerHTML()).not.toMatch(/NaN|Infinity/);
  }
  await expect
    .poll(async () => {
      const saved = await persisted(page);
      const record = saved?.records[saved.manifest.rootId];
      return Object.values(record?.cells ?? {}).map(
        (cell: any) => cell.geometry.outline,
      );
    })
    .toEqual(shapes);
  await page.reload();
  await expect(cells(page, 'geometry')).toHaveCount(shapes.length);
  await expect(
    canvas(page).locator('[data-shape-renderer="rough"]'),
  ).toHaveCount(shapes.length);
  expect(errors).toEqual([]);
});

test('uses shape contours for erasing, preserves boundary ports and supports native shape text editing', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '形状', exact: true }).click();
  await page.getByTestId('shape-diamond').click();
  const box = (await canvas(page).boundingBox())!;
  await page.mouse.click(box.x + 300, box.y + 220);
  await page.getByRole('button', { name: '橡皮擦', exact: true }).click();
  // This point lies inside the bounding box, outside the diamond contour.
  await page.mouse.click(box.x + 302, box.y + 222);
  await expect(cells(page, 'geometry')).toHaveCount(1);
  await page.mouse.click(box.x + 380, box.y + 270);
  await expect(cells(page, 'geometry')).toHaveCount(0);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(cells(page, 'geometry')).toHaveCount(1);
  await page.getByRole('button', { name: '形状', exact: true }).click();
  await page.getByTestId('shape-manualInput').click();
  await page.mouse.click(box.x + 500, box.y + 320);
  const input = cells(page, 'geometry').last();
  await input.hover();
  expect(
    Number(await input.locator('[data-port-id="top"]').getAttribute('cy')),
  ).toBeCloseTo(332.5);
  await page.getByRole('button', { name: '选择', exact: true }).click();
  await input.click();
  await editBody(page, 'Native input');
  await input.dblclick();
  const editor = input.locator('[contenteditable="true"]');
  await expect(editor).toBeVisible();
  await expect(input.locator('[data-frame-rich-text]')).toHaveCount(0);
  await editor.fill('Edited input');
  await page.getByRole('button', { name: '选择', exact: true }).click();
  await expect
    .poll(async () => {
      const saved = await persisted(page);
      return Object.values(saved?.records[saved.manifest.rootId]?.cells ?? {})
        .map((cell: any) => cell.content?.label)
        .includes('Edited input');
    })
    .toBe(true);
  await page.reload();
  await expect(cells(page, 'geometry').last()).toContainText('Edited input');
});

test('resizes, rotates and formats a native shape with undo and durable rich text', async ({
  page,
}) => {
  await page.goto('/');
  await createAt(page, '形状');
  const node = cells(page, 'geometry');
  await node.click();
  const drag = async (
    handle: import('@playwright/test').Locator,
    dx: number,
    dy: number,
  ) => {
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + dx,
      box.y + box.height / 2 + dy,
      { steps: 8 },
    );
    await page.mouse.up();
  };
  await expect(node.locator('[data-resize-handle]')).toHaveCount(8);
  await drag(node.locator('[data-resize-handle="se"]'), 80, 40);
  const savedGeometry = async () => {
    const data = await persisted(page);
    return Object.values(data?.records[data.manifest.rootId]?.cells ?? {}).find(
      (cell: any) => cell.kind === 'geometry',
    ) as any;
  };
  await expect
    .poll(async () => (await savedGeometry())?.geometry.width)
    .toBe(240);
  await expect
    .poll(async () => (await savedGeometry())?.geometry.height)
    .toBe(140);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect
    .poll(async () => (await savedGeometry())?.geometry.width)
    .toBe(160);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await node.click();
  await drag(node.locator('[data-rotate-handle]'), 90, 98);
  await expect
    .poll(async () =>
      Math.round(((await savedGeometry())?.geometry.rotation * 180) / Math.PI),
    )
    .toBe(90);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await node.dblclick();
  const editor = node.locator('[contenteditable="true"]');
  await editor.fill('Formatted cell');
  await editor.press('ControlOrMeta+A');
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString()))
    .toBe('Formatted cell');
  await page
    .getByRole('toolbar', { name: 'Text formatting' })
    .getByRole('button', { name: 'Bold', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Bold', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await editor.press('Enter');
  await expect(node.locator('strong')).toHaveText('Formatted cell');
  await expect
    .poll(
      async () =>
        JSON.stringify((await savedGeometry())?.content?.text?.content) ?? '',
    )
    .toContain('"type":"bold"');
  await page.reload();
  await expect(node.locator('strong')).toHaveText('Formatted cell');
});

test('edits arrow bindings, route segments and multiple labels through native transactions', async ({
  page,
}) => {
  await page.goto('/');
  await createAt(page, '形状', 260, 180);
  await createAt(page, '形状', 560, 340);
  await selectDrawingTool(page, '箭头');
  const box = (await canvas(page).boundingBox())!;
  await page.mouse.move(box.x + 340, box.y + 230);
  await page.mouse.down();
  await page.mouse.move(box.x + 640, box.y + 390, { steps: 8 });
  await page.mouse.up();
  await page.getByRole('button', { name: '选择', exact: true }).click();
  const edge = cells(page, 'arrow');
  await expect(page.locator('.frame-inspector__header')).toHaveText('连线');
  const savedEdge = async () => {
    const data = await persisted(page);
    return Object.values(data?.records[data.manifest.rootId]?.cells ?? {}).find(
      (cell: any) => cell.kind === 'arrow',
    ) as any;
  };
  await expect
    .poll(async () => {
      const arrow = await savedEdge();
      return !!arrow?.source.cellId && !!arrow?.target.cellId;
    })
    .toBe(true);
  await page.getByLabel('Edge label 1', { exact: true }).fill('First');
  await page.getByRole('button', { name: '添加标签', exact: true }).click();
  await page.getByLabel('Edge label 2', { exact: true }).fill('Second');
  await page
    .getByLabel('Edge route', { exact: true })
    .selectOption('orthogonal');
  const segment = edge.locator('[data-edge-segment]').first();
  const segmentBox = (await segment.boundingBox())!;
  await page.mouse.move(
    segmentBox.x + segmentBox.width / 2,
    segmentBox.y + segmentBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    segmentBox.x + segmentBox.width / 2 + 40,
    segmentBox.y + segmentBox.height / 2 + 30,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect
    .poll(async () => (await savedEdge())?.route.points?.length ?? 0)
    .toBeGreaterThan(2);
  const endpoint = edge.locator('[data-edge-endpoint="target"]');
  const endpointBox = (await endpoint.boundingBox())!;
  await page.mouse.move(
    endpointBox.x + endpointBox.width / 2,
    endpointBox.y + endpointBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(box.x + 450, box.y + 520, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => !!(await savedEdge())?.target.point).toBe(true);
  await expect
    .poll(async () =>
      (await savedEdge())?.labels.map((label: any) => label.text),
    )
    .toEqual(['First', 'Second']);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect
    .poll(async () => !!(await savedEdge())?.target.cellId)
    .toBe(true);
  await page.reload();
  await expect(edge).toContainText('First');
  await expect(edge).toContainText('Second');
});

test('saves a mind note before closing its editor and hides collapsed descendants', async ({
  page,
}) => {
  await page.goto('/');
  await createAt(page, '思维导图');
  await cells(page, 'frame').locator('[data-frame-title-id]').first().click();
  await page.getByTestId('frame-open').locator('visible=true').click();
  await cells(page, 'mind-root').click();
  await canvas(page).press('Tab');
  await cells(page, 'mind-child').click();
  await canvas(page).press('Tab');
  await expect(cells(page, 'mind-child')).toHaveCount(2);
  await cells(page, 'mind-child').first().click();
  await page.getByTitle('添加笔记').click();
  const note = page.getByRole('region', { name: 'Mind note' });
  await note
    .locator('[contenteditable="true"]')
    .fill('Final keystroke is saved');
  await note.getByRole('button', { name: '完成笔记', exact: true }).click();
  await expect(
    cells(page, 'mind-child').first().locator('[data-mind-note]'),
  ).toContainText('Final keystroke is saved');
  await page.getByLabel('Collapse topic', { exact: true }).check();
  await expect(cells(page, 'mind-child')).toHaveCount(1);
  await expect(cells(page, 'mind-branch')).toHaveCount(1);
  await expect
    .poll(async () => {
      const data = await persisted(page);
      return Object.values(data?.records ?? {})
        .flatMap((record: any) => Object.values(record.cells))
        .filter(
          (cell: any) =>
            cell.kind === 'mind-child' &&
            cell.data?.note?.plainText === 'Final keystroke is saved',
        ).length;
    })
    .toBe(1);
  await backToPreviousCanvas(page);
  await page.reload();
  await activateBoardTab(page);
  await expect(cells(page, 'mind-child')).toHaveCount(1);
  await cells(page, 'frame').locator('[data-frame-title-id]').first().click();
  await page.getByTestId('frame-open').locator('visible=true').click();
  await cells(page, 'mind-child').click();
  await page.getByLabel('Collapse topic', { exact: true }).uncheck();
  await expect(cells(page, 'mind-child')).toHaveCount(2);
  await expect(
    cells(page, 'mind-child').first().locator('[data-mind-note]'),
  ).toContainText('Final keystroke is saved');
});

test('table cell editing, fill, structure and track resize survive undo and refresh', async ({
  page,
}) => {
  await page.goto('/');
  await createAt(page, '表格', 100, 120);
  const table = cells(page, 'table');
  const entry = table.locator('[data-table-entry]').first();
  await entry.click();
  await expect(
    table.getByRole('toolbar', { name: 'Table controls' }),
  ).toBeVisible();
  await entry.dblclick();
  const editor = entry.locator('[contenteditable="true"]');
  await editor.fill('native table');
  await editor.press('Escape');
  await expect(entry).toContainText('native table');
  await table.getByLabel('Cell fill').fill('#aabbcc');
  await table.getByRole('button', { name: 'Insert row', exact: true }).click();
  await expect(table.locator('[data-table-entry]')).toHaveCount(12);
  const line = table.locator('[data-table-resize="column-0"]');
  const bounds = (await line.boundingBox())!;
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width / 2 + 35,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.up();
  await expect
    .poll(async () => {
      const data = await persisted(page);
      const cell = Object.values(
        data?.records[data.manifest.rootId]?.cells ?? {},
      ).find((cell: any) => cell.kind === 'table') as any;
      return cell?.data?.columns[0]?.width;
    })
    .toBeGreaterThan(140);
  await table.getByRole('grid').press('ControlOrMeta+z');
  await expect
    .poll(async () => {
      const data = await persisted(page);
      const cell = Object.values(
        data?.records[data.manifest.rootId]?.cells ?? {},
      ).find((cell: any) => cell.kind === 'table') as any;
      return cell?.geometry.width;
    })
    .toBe(420);
  await page.reload();
  await expect(table.locator('[data-table-entry]')).toHaveCount(12);
  await expect(table).toContainText('native table');
  await expect(
    table.locator('[data-table-entry]').first().locator('rect').first(),
  ).toHaveAttribute('fill', '#aabbcc');
});

test('swimlane title, direction and lane count persist as native grid data', async ({
  page,
}) => {
  await page.goto('/');
  await createAt(page, '泳道', 60, 100);
  const lane = cells(page, 'swimlane');
  await lane.locator('[data-table-entry]').first().click();
  await lane.getByLabel('Swimlane title', { exact: true }).check();
  await lane.getByLabel('Lane count').fill('4');
  await expect(lane.locator('[data-table-entry]')).toHaveCount(9);
  await lane.getByLabel('Swimlane direction').selectOption('vertical');
  const title = lane.locator('[data-table-role="title"]');
  await title.dblclick();
  await title.locator('[contenteditable="true"]').fill('Team lanes');
  await title.locator('[contenteditable="true"]').press('Escape');
  await expect
    .poll(async () => {
      const data = await persisted(page);
      const cell = Object.values(
        data?.records[data.manifest.rootId]?.cells ?? {},
      ).find((cell: any) => cell.kind === 'swimlane') as any;
      return (
        cell?.data?.direction === 'vertical' &&
        cell?.data?.columns.length === 4 &&
        cell?.data?.cells.some(
          (entry: any) =>
            entry.role === 'title' && entry.text?.plainText === 'Team lanes',
        )
      );
    })
    .toBe(true);
  await page.reload();
  await expect(lane).toContainText('Team lanes');
  await lane.locator('[data-table-entry]').first().click();
  await expect(
    lane.getByLabel('Swimlane title', { exact: true }),
  ).toBeChecked();
  await expect(lane.getByLabel('Swimlane direction')).toHaveValue('vertical');
});

test('vector line multi-click creation, closure, curve editing and vertex transactions persist', async ({
  page,
}) => {
  await page.goto('/');
  await selectDrawingTool(page, '折线');
  const box = (await canvas(page).boundingBox())!;
  const click = (x: number, y: number) =>
    page.mouse.click(box.x + x, box.y + y);
  await click(150, 120);
  await click(300, 120);
  await click(300, 240);
  await expect(cells(page, 'vector-line')).toHaveCount(0);
  await expect(canvas(page).locator('[data-drawing-preview]')).toBeVisible();
  await click(150, 120);
  const line = cells(page, 'vector-line');
  await expect(line).toHaveCount(1);
  await expect(line.locator('[data-vector-path]')).toHaveAttribute('d', /Z/);
  await expect(
    page.getByRole('button', { name: '选择', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.click(box.x + 230, box.y + 120);
  await page.getByLabel('Vector line shape').selectOption('curve');
  await expect(line.locator('[data-vector-path]')).toHaveAttribute('d', /C/);
  const first = line.locator('[data-vector-point="0"]');
  const bounds = (await first.boundingBox())!;
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width / 2 - 25,
    bounds.y + bounds.height / 2 + 30,
  );
  await page.mouse.up();
  await expect(line.locator('[data-vector-path]')).toHaveAttribute('d', /Z/);
  const insert = line.locator('[data-vector-insert="1"]');
  const middle = (await insert.boundingBox())!;
  await page.mouse.move(
    middle.x + middle.width / 2,
    middle.y + middle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    middle.x + middle.width / 2 + 30,
    middle.y + middle.height / 2,
  );
  await page.mouse.up();
  await expect(line.locator('[data-vector-point]')).toHaveCount(4);
  await canvas(page).press('ControlOrMeta+z');
  await expect(line.locator('[data-vector-point]')).toHaveCount(3);
  await canvas(page).press('ControlOrMeta+Shift+z');
  await expect(line.locator('[data-vector-point]')).toHaveCount(4);
  await expect
    .poll(async () => {
      const data = await persisted(page);
      const cell = Object.values(
        data?.records[data.manifest.rootId]?.cells ?? {},
      ).find((cell: any) => cell.kind === 'vector-line') as any;
      return cell?.data?.shape === 'curve' && cell?.data?.points.length === 5;
    })
    .toBe(true);
  await page.reload();
  await expect(line).toHaveCount(1);
  await expect(line.locator('[data-vector-path]')).toHaveAttribute('d', /C.*Z/);
});

test('open vector lines complete on double click and keyboard, and single point drafts are discarded', async ({
  page,
}) => {
  await page.goto('/');
  const box = (await canvas(page).boundingBox())!;
  await selectDrawingTool(page, '折线');
  await page.mouse.click(box.x + 100, box.y + 100);
  await canvas(page).press('Escape');
  await expect(cells(page, 'vector-line')).toHaveCount(0);
  await selectDrawingTool(page, '折线');
  await page.mouse.click(box.x + 100, box.y + 100);
  await page.mouse.dblclick(box.x + 250, box.y + 150);
  await expect(cells(page, 'vector-line')).toHaveCount(1);
  await expect(
    cells(page, 'vector-line').locator('[data-vector-path]'),
  ).not.toHaveAttribute('d', /Z/);
  await selectDrawingTool(page, '折线');
  await page.mouse.click(box.x + 100, box.y + 250);
  await page.mouse.click(box.x + 250, box.y + 250);
  await page.mouse.move(box.x + 300, box.y + 300);
  await canvas(page).press('Enter');
  await expect(cells(page, 'vector-line')).toHaveCount(2);
});

test('vector line eraser hits a rendered curve and deletion can be undone', async ({
  page,
}) => {
  await page.goto('/');
  await selectDrawingTool(page, '折线');
  const box = (await canvas(page).boundingBox())!;
  await page.mouse.click(box.x + 100, box.y + 100);
  await page.mouse.click(box.x + 250, box.y + 250);
  await page.mouse.dblclick(box.x + 400, box.y + 100);
  const line = cells(page, 'vector-line');
  await page.mouse.click(box.x + 175, box.y + 175);
  await page.getByLabel('Vector line shape').selectOption('curve');
  const position = await line
    .locator('[data-vector-path]')
    .evaluate((element) => {
      const path = element as SVGPathElement;
      const point = path.getPointAtLength(path.getTotalLength() / 4);
      const transformed = new DOMPoint(point.x, point.y).matrixTransform(
        path.getScreenCTM()!,
      );
      return { x: transformed.x, y: transformed.y };
    });
  await page.getByRole('button', { name: '橡皮擦', exact: true }).click();
  await page.mouse.click(position.x, position.y);
  await expect(line).toHaveCount(0);
  await canvas(page).press('ControlOrMeta+z');
  await expect(line).toHaveCount(1);
});

const downloadImage = async (
  page: Page,
  format: 'svg' | 'png' | 'jpeg',
  scope = 'frame',
) => {
  await selectAppAction(page, '图像导出');
  const dialog = page.getByRole('dialog', { name: '图像导出', exact: true });
  await dialog.getByLabel('Image format').selectOption(format);
  await dialog.getByLabel('Image scope').selectOption(scope);
  if (format !== 'svg')
    await dialog.getByLabel('Image scale').selectOption('1');
  const download = page.waitForEvent('download');
  await dialog.getByTestId('image-export-button').click();
  const file = await download;
  const path = await file.path();
  if (!path) throw new Error('Missing exported image');
  return { name: file.suggestedFilename(), bytes: readFileSync(path) };
};
const imagePixels = (page: Page, bytes: number[]) =>
  page.evaluate(async (bytes) => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)]));
    const image = document.createElement('canvas');
    image.width = bitmap.width;
    image.height = bitmap.height;
    const context = image.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height).data;
    let opaque = 0,
      red = 0,
      dark = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (pixels[i + 3]) {
        opaque++;
        if (pixels[i] > 180 && pixels[i + 1] < 80 && pixels[i + 2] < 80) red++;
        if (pixels[i] < 100 && pixels[i + 1] < 100 && pixels[i + 2] < 100)
          dark++;
      }
    return {
      width: image.width,
      height: image.height,
      corner: [...pixels.slice(0, 4)],
      opaque,
      red,
      dark,
    };
  }, bytes);

test('image exports preserve rich text, selection scope, transparency and real JPEG encoding', async ({
  page,
}) => {
  await page.goto('/');
  await createAt(page, '形状', 100, 120);
  await createAt(page, '形状', 400, 120);
  const node = cells(page, 'geometry').first(),
    otherId = await cells(page, 'geometry').last().getAttribute('data-cell-id');
  await node.click();
  await editBody(page, 'Export rich text');
  await node.dblclick({ position: { x: 70, y: 50 } });
  const editor = node.locator('[contenteditable="true"]');
  await editor.fill('Export rich text');
  await editor.press('ControlOrMeta+a');
  await page
    .getByRole('toolbar', { name: 'Text formatting', exact: true })
    .getByRole('button', { name: 'Bold', exact: true })
    .click();
  await editor.press('Escape');
  const selected = await downloadImage(page, 'svg', 'selection');
  const xml = selected.bytes.toString('utf8');
  expect(xml).toContain('Export rich text');
  expect(xml).toContain('<strong');
  expect(xml).not.toContain(`data-cell-id="${otherId}"`);
  expect(xml).not.toContain('data-port-id');
  expect(xml).not.toContain('data-selection-handles');
  expect(xml).not.toContain('contenteditable');
  const svg = await downloadImage(page, 'svg');
  expect(svg.bytes.toString('utf8')).toContain(`data-cell-id="${otherId}"`);
  const png = await downloadImage(page, 'png');
  expect([...png.bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const pngPixels = await imagePixels(page, [...png.bytes]);
  expect(pngPixels.width).toBeGreaterThan(450);
  expect(pngPixels.corner[3]).toBe(0);
  expect(pngPixels.dark).toBeGreaterThan(30);
  const jpg = await downloadImage(page, 'jpeg');
  expect([...jpg.bytes.slice(0, 2)]).toEqual([255, 216]);
  expect(jpg.name).toMatch(/\.jpg$/);
  const jpgPixels = await imagePixels(page, [...jpg.bytes]);
  expect(jpgPixels.corner).toEqual([255, 255, 255, 255]);
  await page.getByRole('button', { name: '+', exact: true }).click();
  const zoomed = await downloadImage(page, 'png');
  expect((await imagePixels(page, [...zoomed.bytes])).width).toBe(
    pngPixels.width,
  );
  await canvas(page).press('ControlOrMeta+Shift+e');
  await expect(
    page.getByRole('dialog', { name: '图像导出', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(cells(page, 'geometry')).toHaveCount(2);
});

test('image export embeds uploaded images and renders nested and detail frames without editor controls', async ({
  page,
}) => {
  await page.goto('/');
  const png = await page.evaluate(() => {
    const image = document.createElement('canvas');
    image.width = 40;
    image.height = 30;
    const context = image.getContext('2d')!;
    context.fillStyle = '#ff0000';
    context.fillRect(0, 0, 40, 30);
    return image.toDataURL();
  });
  await page.locator('input[type="file"][accept="image/*"]').setInputFiles({
    name: 'red.png',
    mimeType: 'image/png',
    buffer: Buffer.from(png.split(',')[1], 'base64'),
  });
  await expect(cells(page, 'image')).toHaveCount(1);
  await createAt(page, '思维导图', 260, 120);
  const svg = await downloadImage(page, 'svg');
  const xml = svg.bytes.toString('utf8');
  expect(xml).toContain('data-cell-kind="mind-root"');
  expect(xml).toContain('data:image/png;base64');
  expect(xml).not.toContain('data-port-id');
  const raster = await downloadImage(page, 'png');
  expect((await imagePixels(page, [...raster.bytes])).red).toBeGreaterThan(500);
  await cells(page, 'frame').locator('[data-frame-title-id]').first().click();
  await page.getByTestId('frame-open').locator('visible=true').click();
  const detail = await downloadImage(page, 'svg');
  const detailXml = detail.bytes.toString('utf8');
  expect(detailXml).toContain('data-cell-kind="mind-root"');
  expect(detailXml).not.toContain('data-cell-kind="frame"');
  expect(detailXml).not.toContain('data:image/png;base64');
});

test('image export reports unavailable assets and cleans up its temporary renderer', async ({
  page,
}) => {
  await page.goto('/');
  await page.route('**/missing-export-image.png', (route) =>
    route.fulfill({ status: 404, body: 'Missing' }),
  );
  const snapshot = {
    store: {
      rootId: 'import-root',
      cells: {
        'import-root': {
          id: 'import-root',
          kind: 'frame',
          cellType: 'frame',
          geometry: { x: 0, y: 0, width: 500, height: 400 },
          children: ['missing'],
          groups: [],
        },
        missing: {
          id: 'missing',
          kind: 'image',
          cellType: 'node',
          geometry: { x: 40, y: 40, width: 100, height: 100 },
          data: { url: '/missing-export-image.png' },
        },
      },
    },
  };
  await page
    .locator('input[type="file"][accept^="application/json"]')
    .nth(1)
    .setInputFiles({
      name: 'missing.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(snapshot)),
    });
  await expect(cells(page, 'image')).toHaveCount(1);
  await selectAppAction(page, '图像导出');
  const dialog = page.getByRole('dialog', { name: '图像导出', exact: true });
  await dialog.getByTestId('image-export-button').click();
  await expect(dialog.getByRole('alert')).toContainText(
    'Cannot export resource',
  );
  await expect(
    page.locator('svg[aria-label="Frame canvas"][data-surface="root"]:visible'),
  ).toHaveCount(1);
  await expect(dialog.getByTestId('image-export-button')).toBeEnabled();
});

test('multi-selection appearance and group layer blocks survive history, shortcuts and refresh', async ({
  page,
}) => {
  await page.goto('/');
  await createAt(page, '形状', 200, 200);
  await createAt(page, '形状', 440, 200);
  await createAt(page, '形状', 680, 200);
  const nodes = cells(page, 'geometry');
  const ids = await nodes.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('data-cell-id')!),
  );
  const first = canvas(page).locator(`[data-cell-id="${ids[0]}"]`),
    second = canvas(page).locator(`[data-cell-id="${ids[1]}"]`);
  await first.click();
  await second.click({ modifiers: ['Shift'] });
  await page.getByLabel('Stroke width', { exact: true }).fill('5');
  await page.getByLabel('Stroke width', { exact: true }).press('Enter');
  await page.getByLabel('Shadow', { exact: true }).selectOption('md');
  const saved = async () => {
    const data = await persisted(page);
    return data?.records[data.manifest.rootId];
  };
  await expect
    .poll(async () => (await saved())?.cells[ids[0]]?.appearance?.shadow)
    .toBe('md');
  await expect
    .poll(async () => (await saved())?.cells[ids[1]]?.appearance?.shadow)
    .toBe('md');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect
    .poll(
      async () => (await saved())?.cells[ids[0]]?.appearance?.shadow ?? 'none',
    )
    .toBe('none');
  await expect
    .poll(
      async () => (await saved())?.cells[ids[1]]?.appearance?.shadow ?? 'none',
    )
    .toBe('none');
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expandPropertyGroup(page);
  await page.getByRole('button', { name: '分组', exact: true }).click();
  await first.click();
  await page.getByLabel('Fill color', { exact: true }).fill('#ff0000');
  await expect
    .poll(async () => (await saved())?.cells[ids[1]]?.appearance?.fill)
    .toBe('#ff0000');
  await canvas(page).focus();
  await page.keyboard.press('ControlOrMeta+Shift+]');
  await expect
    .poll(async () => (await saved())?.frame.children)
    .toEqual([ids[2], ids[0], ids[1]]);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect.poll(async () => (await saved())?.frame.children).toEqual(ids);
  await first.click();
  await expandPropertyGroup(page);
  await page.getByRole('button', { name: '置于底层', exact: true }).click();
  await page.reload();
  await expect(nodes).toHaveCount(3);
  await expect(first.locator(':scope > g[filter]')).toHaveAttribute(
    'filter',
    /-md\)$/,
  );
  await first.click();
  await expect(page.getByLabel('Shadow', { exact: true })).toHaveValue('md');
  await expect(page.getByLabel('Stroke width', { exact: true })).toHaveValue(
    '5',
  );
  await expect(page.getByLabel('Fill color', { exact: true })).toHaveValue(
    '#ff0000',
  );
});

test('native keyboard cut and paste preserve a group closure with fresh identity and one-step undo', async ({
  page,
}) => {
  await page.goto('/');
  await createAt(page, '形状', 220, 240);
  await createAt(page, '形状', 460, 240);
  const original = await cells(page, 'geometry').evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('data-cell-id')!),
  );
  await cells(page, 'geometry').first().click();
  await cells(page, 'geometry')
    .last()
    .click({ modifiers: ['Shift'] });
  await expandPropertyGroup(page);
  await page.getByRole('button', { name: '分组', exact: true }).click();
  await cells(page, 'geometry').first().click();
  await page.getByLabel('Shadow', { exact: true }).selectOption('lg');
  await canvas(page).focus();
  await page.keyboard.press('ControlOrMeta+x');
  await expect(cells(page, 'geometry')).toHaveCount(0);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(cells(page, 'geometry')).toHaveCount(2);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect(cells(page, 'geometry')).toHaveCount(0);
  await canvas(page).focus();
  await page.keyboard.press('ControlOrMeta+v');
  await expect(cells(page, 'geometry')).toHaveCount(2);
  const pasted = await cells(page, 'geometry').evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('data-cell-id')!),
  );
  expect(pasted.every((id) => !original.includes(id))).toBe(true);
  await cells(page, 'geometry').first().click();
  await expect(
    page.getByRole('button', { name: '取消分组', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Shadow', { exact: true })).toHaveValue('lg');
  await expect
    .poll(async () => {
      const data = await persisted(page);
      return data?.records[data.manifest.rootId].frame.groups.length;
    })
    .toBe(1);
  await page.reload();
  await expect(cells(page, 'geometry')).toHaveCount(2);
  await expect(
    cells(page, 'geometry').first().locator(':scope > g[filter]'),
  ).toHaveAttribute('filter', /-lg\)$/);
});

test('shadow filters remain self-contained in SVG and affect exported PNG pixels', async ({
  page,
}) => {
  await page.goto('/');
  await createAt(page, '形状', 220, 240);
  await cells(page, 'geometry').click();
  await page.getByLabel('填充', { exact: true }).fill('#ff0000');
  await page.getByRole('button', { name: '无描边', exact: true }).click();
  const without = await downloadImage(page, 'png');
  const before = await imagePixels(page, [...without.bytes]);
  await cells(page, 'geometry').click();
  await page.getByLabel('Shadow', { exact: true }).selectOption('lg');
  const exported = await downloadImage(page, 'svg');
  const xml = exported.bytes.toString('utf8');
  expect(xml).toContain('<feDropShadow');
  const exportedShadow = await page.evaluate((xml) => {
    const document = new DOMParser().parseFromString(xml, 'image/svg+xml');
    const painted = document.querySelector(
      '[data-cell-kind="geometry"] > g[filter]',
    );
    const filter = painted?.getAttribute('filter');
    const definition = filter?.startsWith('url(#')
      ? document.getElementById(filter.slice(5, -1))
      : null;
    return definition?.querySelector('feDropShadow')?.getAttribute('dy');
  }, xml);
  expect(exportedShadow).toBe('12');
  const image = await downloadImage(page, 'png');
  const after = await imagePixels(page, [...image.bytes]);
  expect(after.dark).toBeGreaterThan(before.dark + 20);
  expect(after.red).toBeGreaterThan(500);
});

test('context actions retain multi-selection and use system clipboard with history', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await createAt(page, '形状', 220, 240);
  await createAt(page, '形状', 460, 240);
  await cells(page, 'geometry').first().click();
  await cells(page, 'geometry')
    .last()
    .click({ modifiers: ['Shift'] });
  await cells(page, 'geometry').first().click({ button: 'right' });
  const actions = page.getByRole('dialog', { name: 'Selection actions' });
  await expect(actions).toBeVisible();
  await actions.getByLabel('Shadow', { exact: true }).selectOption('sm');
  await expect(
    cells(page, 'geometry').first().locator(':scope > g[filter]'),
  ).toHaveAttribute('filter', /-sm\)$/);
  await expect(
    cells(page, 'geometry').last().locator(':scope > g[filter]'),
  ).toHaveAttribute('filter', /-sm\)$/);
  await actions.getByRole('button', { name: '剪切', exact: true }).click();
  await expect(cells(page, 'geometry')).toHaveCount(0);
  await expect(actions).toBeHidden();
  await canvas(page).click({ button: 'right', position: { x: 100, y: 400 } });
  await actions.getByRole('button', { name: '粘贴', exact: true }).click();
  await expect(cells(page, 'geometry')).toHaveCount(2);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(cells(page, 'geometry')).toHaveCount(0);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect(cells(page, 'geometry')).toHaveCount(2);
});

test('right-click then left-click on a shape only selects it, without node or canvas drift', async ({
  page,
}) => {
  await page.goto('/');
  await createAt(page, '形状', 280, 180);
  const node = cells(page, 'geometry').first();
  const outline = node.locator('path').first();
  const world = canvas(page).locator('[data-frame-world]');
  const d = await outline.getAttribute('d');
  const transform = await world.getAttribute('transform');
  const box = (await node.boundingBox())!;
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(center.x, center.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.up({ button: 'right' });
  const actions = page.getByRole('dialog', { name: 'Selection actions' });
  await expect(actions).toBeVisible();
  await page.mouse.move(center.x + 8, center.y + 4, { steps: 2 });
  await page.mouse.move(center.x + 12, center.y + 6, { steps: 2 });
  await expect(actions).toBeVisible();
  await expect(world).toHaveAttribute('transform', transform!);
  await page.mouse.click(center.x - box.width / 3, center.y);
  await expect(actions).toBeHidden();
  await expect(node).toHaveAttribute('stroke', '#6366f1');
  await page.mouse.move(center.x + 20, center.y + 10, { steps: 3 });
  await page.mouse.move(center.x - 30, center.y - 8, { steps: 3 });
  await expect(outline).toHaveAttribute('d', d!);
  await expect(world).toHaveAttribute('transform', transform!);
});

test('drawing and export shortcuts work on the canvas and preserve typing in inspectors', async ({
  page,
}) => {
  await page.goto('/');
  await canvas(page).focus();
  await page.keyboard.press('o');
  await page.getByRole('button', { name: '形状', exact: true }).click();
  await expect(page.getByTestId('shape-ellipse')).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', { name: '选择', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await canvas(page).press('o');
  const box = (await canvas(page).boundingBox())!;
  await page.mouse.click(box.x + 220, box.y + 240);
  await canvas(page).press('v');
  await cells(page, 'geometry').click();
  const label = page.getByTestId('inspector-name');
  await label.fill('r o m p t');
  await expect(
    page.getByRole('button', { name: '选择', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await canvas(page).focus();
  await page.keyboard.press('p');
  await expect(
    page.getByRole('button', { name: '画笔', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('v');
  await expect(
    page.getByRole('button', { name: '选择', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('h');
  await expect(
    page.getByRole('button', { name: '手型', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('v');
  await page.keyboard.press('r');
  await page.getByRole('button', { name: '形状', exact: true }).click();
  await expect(page.getByTestId('shape-rectangle')).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  const download = page.waitForEvent('download');
  await page.keyboard.press('ControlOrMeta+s');
  expect((await download).suggestedFilename()).toBe('verd-frame.json');
});

type MindScreenBox = { x: number; y: number; width: number; height: number };
const mindLayoutDirection = (
  layout: string,
  root: MindScreenBox,
  topic: MindScreenBox,
): boolean => {
  if (layout.endsWith('-indented')) {
    const horizontal = layout.startsWith('left-')
      ? topic.x + topic.width < root.x + root.width
      : topic.x > root.x;
    const vertical = layout.includes('-top-')
      ? topic.y + topic.height <= root.y + 3
      : topic.y >= root.y + root.height - 3;
    return horizontal && vertical;
  }
  if (layout === 'upward') return topic.y + topic.height <= root.y + 3;
  if (layout === 'downward') return topic.y >= root.y + root.height - 3;
  if (layout === 'left') return topic.x + topic.width <= root.x + 3;
  if (layout === 'right') return topic.x >= root.x + root.width - 3;
  return (
    topic.x >= root.x + root.width - 3 || topic.x + topic.width <= root.x + 3
  );
};

test('all nine mind layouts keep root origins and render sibling directions through history and refresh', async ({
  page,
}) => {
  const { a, b, c } = await summaryFixture(page);
  const center = cells(page, 'mind-root');
  const centerId = (await center.getAttribute('data-cell-id'))!;
  const saved = async () => {
    const data = await persisted(page);
    return Object.values(data?.records ?? {})
      .map((record: any) => record.cells[centerId])
      .find(Boolean) as any;
  };
  await expect.poll(async () => (await saved())?.geometry).toBeTruthy();
  const originalOrigin = (await saved()).geometry;
  await center.click();
  const layout = page.getByLabel('More mind layouts', { exact: true });
  const layouts = [
    'right',
    'left',
    'standard',
    'upward',
    'downward',
    'right-bottom-indented',
    'right-top-indented',
    'left-top-indented',
    'left-bottom-indented',
  ];
  for (const value of layouts) {
    if (['standard', 'right', 'downward'].includes(value))
      await page
        .getByRole('button', { name: `Mind layout ${value}`, exact: true })
        .click();
    else await layout.selectOption(value);
    await expect.poll(async () => (await saved())?.data.layout).toBe(value);
    await page.getByRole('button', { name: '适配画布', exact: true }).click();
    await expect(cells(page, 'mind-summary')).toHaveCount(1);
    const root = (await center
      .locator(':scope > g > path')
      .first()
      .boundingBox())!;
    const topics = await Promise.all(
      [a, b, c].map((topic) =>
        topic.locator(':scope > g > path').first().boundingBox(),
      ),
    );
    expect(topics.every(Boolean)).toBe(true);
    expect(
      topics.every((topic) => mindLayoutDirection(value, root, topic!)),
      value,
    ).toBe(true);
    expect((await saved())?.geometry).toEqual(originalOrigin);
  }
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(layout).toHaveValue('left-top-indented');
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect(layout).toHaveValue('left-bottom-indented');
  await page.reload();
  await center.click();
  await expect(layout).toHaveValue('left-bottom-indented');
  await expect(cells(page, 'mind-child')).toHaveCount(3);
  await expect(cells(page, 'mind-summary')).toHaveCount(1);
});

test('mind paste remaps subtree identities, summary ranges and root-child roles without changing originals', async ({
  page,
}) => {
  const { a, aId, b, bId } = await summaryFixture(page);
  await a.click();
  await canvas(page).press('Tab');
  await editBody(page, 'A leaf');
  const leaf = cells(page, 'mind-child').filter({ hasText: 'A leaf' });
  const leafId = (await leaf.getAttribute('data-cell-id'))!;
  const sourceIds = await cells(page, 'mind-child').evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('data-cell-id')!),
  );
  await a.click();
  await canvas(page).press('ControlOrMeta+c');
  await b.click();
  await canvas(page).press('ControlOrMeta+v');
  await expect(cells(page, 'mind-child')).toHaveCount(6);
  const copies = await cells(page, 'mind-child').evaluateAll(
    (elements, ids) =>
      elements
        .map((element) => element.getAttribute('data-cell-id')!)
        .filter((id) => !ids.includes(id)),
    sourceIds,
  );
  expect(copies).toHaveLength(2);
  await expect
    .poll(async () => {
      const parents = await Promise.all(
        copies.map((id) => savedMindParent(page, id)),
      );
      return parents.filter((parent) => parent === bId).length;
    })
    .toBe(1);
  expect(await savedMindParent(page, leafId)).toBe(aId);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(cells(page, 'mind-child')).toHaveCount(4);
  const center = cells(page, 'mind-root');
  await center.click();
  await canvas(page).press('ControlOrMeta+c');
  await a.click();
  await canvas(page).press('ControlOrMeta+v');
  await expect(cells(page, 'mind-root')).toHaveCount(1);
  await expect(cells(page, 'mind-child')).toHaveCount(9);
  await expect(cells(page, 'mind-summary')).toHaveCount(2);
  await expect
    .poll(async () => {
      const data = await persisted(page);
      const ranges = Object.values(data?.records ?? {})
        .flatMap((record: any) => Object.values(record.cells))
        .filter((cell: any) => cell.kind === 'mind-summary-edge') as any[];
      return ranges.filter(
        (edge) =>
          !sourceIds.includes(edge.data.startSiblingId) &&
          !sourceIds.includes(edge.data.endSiblingId),
      ).length;
    })
    .toBe(1);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(cells(page, 'mind-child')).toHaveCount(4);
  await a.click();
  await canvas(page).press('ControlOrMeta+/');
  await expect(leaf).toHaveCount(0);
  await canvas(page).press('ControlOrMeta+c');
  await canvas(page).click({ position: { x: 40, y: 400 } });
  await canvas(page).press('ControlOrMeta+v');
  await expect(cells(page, 'mind-root')).toHaveCount(2);
  await expect(cells(page, 'mind-child')).toHaveCount(4);
  await expect
    .poll(async () => {
      const data = await persisted(page);
      return Object.values(data?.records ?? {})
        .flatMap((record: any) => Object.values(record.cells))
        .filter((cell: any) => cell.kind === 'mind-root').length;
    })
    .toBe(2);
  await page.reload();
  await expect(cells(page, 'mind-root')).toHaveCount(2);
  await expect(cells(page, 'mind-child')).toHaveCount(4);
});

test('mind typing, expand and note shortcuts retain first characters, history and saved content', async ({
  page,
}) => {
  const { aId } = await summaryFixture(page);
  const a = canvas(page).locator(`[data-cell-id="${aId}"]`);
  await a.click();
  await canvas(page).press('Tab');
  await editBody(page, 'Leaf');
  await a.click();
  await canvas(page).press('ControlOrMeta+/');
  await expect(
    cells(page, 'mind-child').filter({ hasText: 'Leaf' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(
    cells(page, 'mind-child').filter({ hasText: 'Leaf' }),
  ).toHaveCount(1);
  await a.click();
  await canvas(page).press('x');
  const editor = a.locator('[contenteditable="true"]');
  await expect(editor).toHaveText('x');
  await expect(editor).toBeFocused();
  await editor.press('y');
  await editor.press('Enter');
  await expect(a).toHaveText('xy');
  await a.click();
  await canvas(page).press('ControlOrMeta+Shift+n');
  const note = page.getByRole('region', { name: 'Mind note' });
  await expect(note).toBeVisible();
  await note.locator('[contenteditable="true"]').fill('Shortcut note');
  await note.getByRole('button', { name: '完成笔记', exact: true }).click();
  await cells(page, 'mind-child').filter({ hasText: 'Topic B' }).click();
  await a.click();
  await expect(note).toBeHidden();
  await canvas(page).press('ControlOrMeta+Shift+n');
  await expect(note).toBeVisible();
  await expect(note.locator('[contenteditable="true"]')).toHaveText(
    'Shortcut note',
  );
  await note.getByRole('button', { name: '完成笔记', exact: true }).click();
  await expect
    .poll(async () => {
      const data = await persisted(page);
      return Object.values(data?.records ?? {})
        .map((record: any) => record.cells[aId])
        .find(Boolean)?.data?.note?.plainText;
    })
    .toBe('Shortcut note');
  await page.reload();
  await expect(a).toContainText('xy');
  await a.click();
  await page.getByRole('button', { name: '编辑笔记', exact: true }).click();
  await expect(note.locator('[contenteditable="true"]')).toHaveText(
    'Shortcut note',
  );
});

test('horizontal vector lines retain their stroke and visible shadow in PNG export', async ({
  page,
}) => {
  await page.goto('/');
  await selectDrawingTool(page, '折线');
  const box = (await canvas(page).boundingBox())!;
  await page.mouse.click(box.x + 220, box.y + 240);
  await page.mouse.click(box.x + 520, box.y + 240);
  await canvas(page).press('Enter');
  const line = cells(page, 'vector-line');
  await expect(line).toHaveCount(1);
  await page.mouse.click(box.x + 350, box.y + 240);
  await page.getByLabel('Stroke width', { exact: true }).fill('4');
  await page.getByLabel('Stroke width', { exact: true }).press('Enter');
  const before = await imagePixels(page, [
    ...(await downloadImage(page, 'png')).bytes,
  ]);
  expect(before.opaque).toBeGreaterThan(600);
  await page.mouse.click(box.x + 350, box.y + 240);
  await page.getByLabel('Shadow', { exact: true }).selectOption('lg');
  await expect(line.locator(':scope > g[filter]')).toHaveAttribute(
    'filter',
    /-lg\)$/,
  );
  const after = await imagePixels(page, [
    ...(await downloadImage(page, 'png')).bytes,
  ]);
  expect(after.opaque).toBeGreaterThan(600);
  expect(after.opaque).toBeGreaterThan(before.opaque + 500);
});

test('batch text formatting preserves labels through history, duplication, clear cancellation and refresh', async ({
  page,
}) => {
  await page.goto('/');
  await createAt(page, '形状', 200, 160);
  await cells(page, 'geometry').first().click();
  await editBody(page, 'Alpha');
  await createAt(page, '形状', 460, 320);
  await cells(page, 'geometry').nth(1).click();
  await editBody(page, 'Beta');
  await canvas(page).press('ControlOrMeta+a');
  await page
    .getByRole('button', { name: 'Selection bold', exact: true })
    .click();
  await page
    .getByLabel('Selection font size', { exact: true })
    .selectOption('24px');
  await page
    .getByLabel('Selection text alignment', { exact: true })
    .selectOption('left');
  await expect(cells(page, 'geometry').locator('strong')).toHaveCount(2);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(
    page.getByLabel('Selection text alignment', { exact: true }),
  ).toHaveValue('center');
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect(
    page.getByLabel('Selection text alignment', { exact: true }),
  ).toHaveValue('left');
  await canvas(page).press('ControlOrMeta+d');
  await expect(cells(page, 'geometry')).toHaveCount(4);
  await expect(cells(page, 'geometry').locator('strong')).toHaveCount(4);
  await canvas(page).press('ControlOrMeta+Backspace');
  const dialog = page.getByRole('dialog', { name: 'Clear frame' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(cells(page, 'geometry')).toHaveCount(4);
  await canvas(page).press('ControlOrMeta+=');
  await expect(page.getByTestId('canvas-zoom-label')).toHaveText('110%');
  await canvas(page).press('ControlOrMeta+0');
  await expect(page.getByTestId('canvas-zoom-label')).toHaveText('100%');
  await expect
    .poll(async () => {
      const data = await persisted(page);
      return Object.values(
        data?.records[data.manifest.rootId]?.cells ?? {},
      ).filter(
        (cell: any) =>
          cell.kind === 'geometry' && cell.content.text?.align === 'left',
      ).length;
    })
    .toBe(4);
  await page.reload();
  await expect(cells(page, 'geometry').locator('strong')).toHaveCount(4);
  await selectAppAction(page, '清空');
  await dialog
    .getByRole('button', { name: 'Confirm clear frame', exact: true })
    .click();
  await expect(cells(page, 'geometry')).toHaveCount(0);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(cells(page, 'geometry').locator('strong')).toHaveCount(4);
});

for (const [tool, anchor, member, add] of [
  ['思维导图', 'mind-root', 'mind-child', '子主题'],
  ['流程图', 'workflow-start', 'workflow-task', '任务'],
  ['架构图', 'architecture-layer', 'architecture-module', '模块'],
] as const) {
  test(`clearing ${anchor} detail preserves its required anchor and sibling frame with one-step undo`, async ({
    page,
  }) => {
    await page.goto('/');
    await createAt(page, '形状', 60, 60);
    await createAt(page, tool);
    await cells(page, 'frame').locator('[data-frame-title-id]').first().click();
    await page.getByTestId('frame-open').locator('visible=true').click();
    await page.getByRole('button', { name: add, exact: true }).click();
    await expect(cells(page, member)).toHaveCount(1);
    await selectAppAction(page, '清空');
    await page
      .getByRole('button', { name: 'Confirm clear frame', exact: true })
      .click();
    await expect(cells(page, member)).toHaveCount(0);
    await expect(cells(page, anchor)).toHaveCount(1);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    await expect(cells(page, member)).toHaveCount(1);
    await page.getByRole('button', { name: '重做', exact: true }).click();
    await expect(cells(page, member)).toHaveCount(0);
    await backToPreviousCanvas(page);
    await expect(cells(page, 'geometry')).toHaveCount(1);
    await expect
      .poll(async () => {
        const data = await persisted(page);
        const saved = Object.values(data?.records ?? {}).flatMap(
          (record: any) => Object.values(record.cells),
        ) as any[];
        return [
          saved.filter((cell) => cell.kind === anchor).length,
          saved.filter((cell) => cell.kind === member).length,
          saved.filter((cell) => cell.kind === 'geometry').length,
        ];
      })
      .toEqual([1, 0, 1]);
    await page.reload();
    await expect(cells(page, anchor)).toHaveCount(1);
    await expect(cells(page, member)).toHaveCount(0);
    await expect(cells(page, 'geometry')).toHaveCount(1);
  });
}

test('moving a shape into a native frame frees boundary arrows and persists ownership with exact undo', async ({
  page,
}) => {
  await page.goto('/');
  await createAt(page, '形状', 140, 140);
  await createAt(page, '形状', 440, 280);
  await selectDrawingTool(page, '箭头');
  const box = (await canvas(page).boundingBox())!;
  await page.mouse.move(box.x + 220, box.y + 190);
  await page.mouse.down();
  await page.mouse.move(box.x + 520, box.y + 330, { steps: 8 });
  await page.mouse.up();
  await createAt(page, '容器', 600, 400);
  const source = cells(page, 'geometry').first();
  const sourceId = (await source.getAttribute('data-cell-id'))!;
  await source.click();
  await expandPropertyGroup(page);
  const moveToFrame = page
    .getByLabel('Move to frame', { exact: true })
    .locator('visible=true');
  // The shell on the board is a reference; the option value is the target file.
  const targetId = (await moveToFrame
    .locator('option:not([value=""])')
    .first()
    .getAttribute('value'))!;
  const saved = async () => {
    const data = await persisted(page);
    return data
      ? {
          root: data.records[data.manifest.rootId],
          target: data.records[targetId],
        }
      : null;
  };
  await expect
    .poll(
      async () =>
        Object.values((await saved())?.root?.cells ?? {}).find(
          (cell: any) => cell.kind === 'arrow',
        ) as any,
    )
    .toMatchObject({ source: { cellId: sourceId } });
  await moveToFrame.selectOption(targetId);
  await page
    .getByRole('button', { name: 'Move selection to frame', exact: true })
    .locator('visible=true')
    .click();
  await expect
    .poll(async () => (await saved())?.target?.frame.children)
    .toEqual([sourceId]);
  await expect
    .poll(async () => (await saved())?.root?.cells[sourceId])
    .toBeUndefined();
  expect(
    Object.values((await saved())!.root.cells).find(
      (cell: any) => cell.kind === 'arrow',
    ),
  ).toMatchObject({ source: { point: expect.any(Array) } });
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect
    .poll(async () => (await saved())?.root?.cells[sourceId]?.id)
    .toBe(sourceId);
  expect(
    Object.values((await saved())!.root.cells).find(
      (cell: any) => cell.kind === 'arrow',
    ),
  ).toMatchObject({ source: { cellId: sourceId } });
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect
    .poll(async () => (await saved())?.target?.frame.children)
    .toEqual([sourceId]);
  await page.reload();
  await expect(
    cells(page, 'frame').locator(`[data-cell-id="${sourceId}"]`),
  ).toHaveCount(1);
  await cells(page, 'frame').locator('[data-frame-title-id]').first().click();
  await page.getByTestId('frame-open').locator('visible=true').click();
  await page.getByRole('button', { name: '适配画布', exact: true }).click();
  await cells(page, 'geometry').click();
  await expandPropertyGroup(page);
  const rootId = (await persisted(page))!.manifest.rootId;
  await page
    .getByLabel('Move to frame', { exact: true })
    .locator('visible=true')
    .selectOption(rootId);
  await page
    .getByRole('button', { name: 'Move selection to frame', exact: true })
    .locator('visible=true')
    .click();
  await expect(cells(page, 'geometry')).toHaveCount(0);
  await expect
    .poll(async () => (await saved())?.root?.cells[sourceId]?.id)
    .toBe(sourceId);
});

test('workflow ports reject DAG cycles and cross-graph links, while process cycles persist with start protection', async ({
  page,
}) => {
  await page.goto('/');
  await createAt(page, '流程图');
  await cells(page, 'frame').locator('[data-frame-title-id]').first().click();
  await page.getByTestId('frame-open').locator('visible=true').click();
  await page.getByTestId('palette-task').click();
  await page.getByTestId('palette-decision').click();
  await page.getByRole('button', { name: '适配画布', exact: true }).click();
  const task = cells(page, 'workflow-task').first(),
    decision = cells(page, 'workflow-decision');
  const taskId = (await task.getAttribute('data-cell-id'))!;
  await task.hover();
  await task.locator('[data-port-id="right"]').click();
  await decision.hover();
  await decision.locator('[data-port-id="left"]').click();
  await expect(cells(page, 'workflow-edge')).toHaveCount(1);
  await decision.hover();
  await decision.locator('[data-port-id="bottom"]').click();
  await task.hover();
  await task.locator('[data-port-id="bottom"]').click();
  await expect(page.getByRole('alert').first()).toContainText('Cycle');
  await expect(cells(page, 'workflow-edge')).toHaveCount(1);
  const start = cells(page, 'workflow-start').first();
  await start.click();
  await page.getByTestId('workflow-graph-mode').selectOption('process');
  await decision.hover();
  await decision.locator('[data-port-id="bottom"]').click();
  await task.hover();
  await task.locator('[data-port-id="bottom"]').click();
  await expect(cells(page, 'workflow-edge')).toHaveCount(2);
  await expect(page.getByTestId('workflow-auto-layout')).toBeDisabled();
  await start.click();
  await expect(
    page
      .getByRole('complementary')
      .getByRole('button', { name: '删除', exact: true }),
  ).toBeDisabled();
  await expect(start).toHaveCount(1);
  await page.getByRole('button', { name: '添加流程图', exact: true }).click();
  const other = cells(page, 'workflow-start').nth(1);
  await other.click();
  await page.getByTestId('palette-task').click();
  await page.getByRole('button', { name: '适配画布', exact: true }).click();
  await task.hover();
  await task.locator('[data-port-id="top"]').click();
  await cells(page, 'workflow-task').nth(1).hover();
  await cells(page, 'workflow-task')
    .nth(1)
    .locator('[data-port-id="top"]')
    .click();
  await expect(page.getByRole('alert').first()).toContainText(
    'Workflow edges must stay in one graph',
  );
  await expect(cells(page, 'workflow-edge')).toHaveCount(2);
  await expect
    .poll(async () => {
      const data = await persisted(page);
      return Object.values(data?.records ?? {})
        .flatMap((record: any) => Object.values(record.cells))
        .filter((cell: any) => cell.kind === 'workflow-start').length;
    })
    .toBe(2);
  await page.reload();
  await activateBoardTab(page);
  await cells(page, 'frame').locator('[data-frame-title-id]').first().click();
  await page.getByTestId('frame-open').locator('visible=true').click();
  await expect(cells(page, 'workflow-edge')).toHaveCount(2);
  await expect(task).toHaveAttribute('data-cell-id', taskId);
});

test('architecture dependencies route across layers, reject self-links and retain placed modules after reload', async ({
  page,
}) => {
  await page.goto('/');
  await createAt(page, '架构图');
  await cells(page, 'frame').locator('[data-frame-title-id]').first().click();
  await page.getByTestId('frame-open').locator('visible=true').click();
  await page.getByRole('button', { name: '模块', exact: true }).click();
  const first = cells(page, 'architecture-module').first();
  await page.getByRole('button', { name: '添加层', exact: true }).click();
  await page.getByRole('button', { name: '模块', exact: true }).click();
  const second = cells(page, 'architecture-module').nth(1);
  const secondId = (await second.getAttribute('data-cell-id'))!;
  await second.click();
  const layers = await page
    .getByLabel('Architecture layer', { exact: true })
    .locator('option')
    .evaluateAll((options) =>
      options.map((option) => (option as HTMLOptionElement).value),
    );
  await page
    .getByLabel('Architecture layer', { exact: true })
    .selectOption(layers[1]);
  await page.getByRole('button', { name: '适配画布', exact: true }).click();
  await first.hover();
  await first.locator('[data-port-id="bottom"]').click();
  await second.hover();
  await second.locator('[data-port-id="top"]').click();
  const edge = cells(page, 'architecture-edge');
  await expect(edge).toHaveCount(1);
  await expect(edge.locator('[data-edge-hit]')).toHaveAttribute('d', /L/);
  await first.hover();
  await first.locator('[data-port-id="top"]').click();
  await first.hover();
  await first.locator('[data-port-id="left"]').click();
  await expect(page.getByRole('alert').first()).toContainText(
    'Invalid architecture dependency',
  );
  await expect(edge).toHaveCount(1);
  await second.click();
  await page.getByRole('spinbutton', { name: 'x', exact: true }).fill('340');
  await page.getByRole('spinbutton', { name: 'x', exact: true }).press('Enter');
  await expect
    .poll(async () => {
      const data = await persisted(page);
      return Object.values(data?.records ?? {})
        .map((record: any) => record.cells[secondId])
        .find(Boolean)?.data?.placed;
    })
    .toBe(true);
  await page.reload();
  await activateBoardTab(page);
  await cells(page, 'frame').locator('[data-frame-title-id]').first().click();
  await page.getByTestId('frame-open').locator('visible=true').click();
  await expect(edge).toHaveCount(1);
  await second.click();
  await expect(
    page.getByRole('spinbutton', { name: 'x', exact: true }),
  ).toHaveValue('340');
});

test('legacy domain workspace migrates shared copies and detached documents through real startup without changing its backup', async ({
  page,
}) => {
  const fixture = JSON.parse(
    readFileSync('../fixtures/legacy/domain-workspace.json', 'utf8'),
  );
  await page.goto('/');
  await expect(canvas(page)).toBeVisible();
  await expect
    .poll(async () => (await persisted(page))?.manifest.format)
    .toBe('verd-workspace');
  await page.evaluate(async (source) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('VerdBoard');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('verdboard_store', 'readwrite'),
        store = transaction.objectStore('verdboard_store');
      store.clear();
      Object.entries(source).forEach(([key, value]) => store.put(value, key));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  }, fixture);
  await clearWorkspaceStorage(page);
  await page.reload();
  await expect(cells(page, 'mind-root')).toHaveCount(2);
  await expect(cells(page, 'architecture-module')).toHaveCount(2);
  // The import-files commit lands after the migrated cells render.
  await expect
    .poll(async () => (await persisted(page))?.manifest.detachedFrameIds)
    .toHaveLength(2);
  const data = await persisted(page);
  const frames = cells(page, 'frame');
  await frames.first().locator('[data-frame-title-id]').first().click();
  await page.getByTestId('frame-open').locator('visible=true').click();
  await cells(page, 'mind-child').click();
  await editBody(page, 'Independent edit');
  await backToPreviousCanvas(page);
  await expect(
    cells(page, 'mind-child').filter({ hasText: 'Shared topic' }),
  ).toHaveCount(1);
  await expect(
    cells(page, 'mind-child').filter({ hasText: 'Independent edit' }),
  ).toHaveCount(1);
  await expect
    .poll(async () => {
      const saved = await persisted(page);
      return Object.values(saved?.records ?? {})
        .flatMap((record: any) => Object.values(record.cells))
        .filter((cell: any) => cell.content?.label === 'Independent edit')
        .length;
    })
    .toBe(1);
  await page.reload();
  await expect(
    cells(page, 'mind-child').filter({ hasText: 'Independent edit' }),
  ).toHaveCount(1);
  const workflowId = data!.manifest.detachedFrameIds.find((id: string) =>
    Object.values(data!.records[id].cells).some(
      (cell: any) => cell.kind === 'workflow-start',
    ),
  )!;
  // The file tree buttons carry the canvas path as their tooltip; the
  // detached file's display name is deduplicated, so open it by path.
  await page
    .locator(`.file-tree-name[title="${data!.paths[workflowId]}"]`)
    .click();
  await expect(cells(page, 'workflow-start')).toHaveCount(2);
  await expect(cells(page, 'workflow-edge')).toHaveCount(3);
  const backup = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open('VerdBoard');
      request.onsuccess = () => resolve(request.result);
    });
    const result = await new Promise((resolve) => {
      const request = db
        .transaction('verdboard_store')
        .objectStore('verdboard_store')
        .get('legacy_workspace_backup');
      request.onsuccess = () => resolve(request.result);
    });
    db.close();
    return result;
  });
  expect(backup).toEqual(fixture);
});
