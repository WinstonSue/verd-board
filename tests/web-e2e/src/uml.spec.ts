import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createUmlDiagram, importUmlText, umlCanvas } from './uml-actions';
import { persistedWorkspace } from './workspace-nav';
import { selectAppAction } from './app-actions';
const nodes = (page: Parameters<typeof umlCanvas>[0], kind: string) =>
  umlCanvas(page).locator(`[data-cell-kind="${kind}"]`);

test('UML class editing, six-way relationship settings, native save and Mermaid/image export', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await createUmlDiagram(page, 'class');
  const tools = page.getByRole('group', { name: 'UML 工具' });
  await tools.getByRole('button', { name: '类', exact: true }).click();
  await tools.getByRole('button', { name: '接口', exact: true }).click();
  await page.getByRole('button', { name: '适配画布', exact: true }).click();
  await nodes(page, 'uml-class')
    .first()
    .click({ position: { x: 12, y: 12 } });
  const attributes = page.getByLabel('属性（每行一项）');
  await attributes.fill('+id: string\n-name: string');
  await attributes.press('Tab');
  await expect(nodes(page, 'uml-class').first()).toContainText('+id: string');
  await tools.getByRole('button', { name: '关系', exact: true }).click();
  await nodes(page, 'uml-relation').click();
  await page.getByLabel('关系类型').selectOption('realization');
  await page.getByLabel('来源多重性').fill('1');
  await page.getByLabel('来源多重性').press('Tab');
  const saved = async () =>
    Object.values((await persistedWorkspace(page))?.records ?? {}).find(
      (f: any) =>
        Object.values(f.cells).some((c: any) => c.kind === 'uml-class-root'),
    ) as any;
  await expect
    .poll(
      async () =>
        (await saved())?.cells &&
        Object.values<any>((await saved()).cells).find(
          (c) => c.kind === 'uml-class',
        )?.data.attributes,
    )
    .toEqual(['+id: string', '-name: string']);
  const download = page.waitForEvent('download');
  await selectAppAction(page, '导出为 Mermaid');
  const exported = await download;
  const source = await readFile((await exported.path())!, 'utf8');
  expect(source).toContain('classDiagram');
  expect(source).toContain('..|>');
  await selectAppAction(page, '图像导出');
  const image = page.getByRole('dialog', { name: '图像导出' });
  await image.getByLabel('Image format').selectOption('svg');
  await image.getByLabel('Image scope').selectOption('frame');
  const imageDownload = page.waitForEvent('download');
  await image.getByTestId('image-export-button').click();
  const svg = await readFile((await (await imageDownload).path())!, 'utf8');
  expect(svg).toContain('data-uml-class');
  expect(svg).toContain('+id: string');
  await page.screenshot({ path: testInfo.outputPath('uml.png') });
  await page.reload();
  await expect(nodes(page, 'uml-class')).toHaveCount(2);
  await expect(nodes(page, 'uml-relation')).toHaveCount(1);
  await expect(nodes(page, 'uml-class').first()).toContainText('+id: string');
});

test('UML sequence native import preserves nested events, activation, self calls and message history', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await createUmlDiagram(page, 'sequence');
  await importUmlText(
    page,
    readFileSync(
      path.resolve(__dirname, '../../fixtures/ai-canvas/uml-sequence.mmd'),
      'utf8',
    ),
  );
  await expect(nodes(page, 'uml-participant')).toHaveCount(2);
  await expect(nodes(page, 'uml-message')).toHaveCount(3);
  await expect(umlCanvas(page).locator('[data-uml-fragment]')).toHaveCount(2);
  await expect(umlCanvas(page).locator('[data-uml-activation]')).toHaveCount(1);
  const saved = async () =>
    Object.values((await persistedWorkspace(page))?.records ?? {}).find(
      (f: any) =>
        Object.values(f.cells).some((c: any) => c.kind === 'uml-sequence-root'),
    ) as any;
  const message = nodes(page, 'uml-message').first();
  await message.click();
  const label = page.getByLabel('关系 / 消息名称');
  await label.fill('changed()');
  await label.press('Tab');
  await expect(message).toContainText('changed()');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(message).toContainText('request()');
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect(message).toContainText('changed()');
  await expect
    .poll(async () =>
      Object.values<any>((await saved())?.cells ?? {})
        .filter((c) => c.kind === 'uml-message')
        .map((c) => c.route.mode),
    )
    .toEqual(['straight', 'straight', 'straight']);
  const download = page.waitForEvent('download');
  await selectAppAction(page, '导出为 Mermaid');
  expect(await readFile((await (await download).path())!, 'utf8')).toContain(
    'loop each item',
  );
  await page.screenshot({ path: testInfo.outputPath('uml.png') });
  await page.reload();
  await expect(nodes(page, 'uml-message')).toHaveCount(3);
  await expect(umlCanvas(page).locator('[data-uml-activation]')).toHaveCount(1);
  await expect(nodes(page, 'uml-message').first()).toContainText('changed()');
});

test('UML structural drags reorder messages and participants and preserve one-step undo', async ({
  page,
}) => {
  await page.goto('/');
  await createUmlDiagram(page, 'sequence');
  const tools = page.getByRole('group', { name: 'UML 工具' });
  await tools.getByRole('button', { name: '参与者', exact: true }).click();
  await tools.getByRole('button', { name: 'Actor', exact: true }).click();
  for (let i = 0; i < 3; i++)
    await tools.getByRole('button', { name: '消息', exact: true }).click();
  await page.getByRole('button', { name: '适配画布', exact: true }).click();
  const saved = async () =>
    Object.values((await persistedWorkspace(page))?.records ?? {}).find(
      (f: any) =>
        Object.values(f.cells).some((c: any) => c.kind === 'uml-sequence-root'),
    ) as any;
  const root = async () =>
    Object.values<any>((await saved())?.cells ?? {}).find(
      (c) => c.kind === 'uml-sequence-root',
    );
  await expect.poll(async () => (await root())?.data.events.length).toBe(3);
  const before = (await root()).data;
  await nodes(page, 'uml-message').first().click();
  const handle = umlCanvas(page).getByRole('button', {
    name: 'Reorder message',
  });
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 250, {
    steps: 8,
  });
  await page.mouse.up();
  await expect
    .poll(async () => (await root()).data.events.map((e: any) => e.cellId))
    .toEqual([
      before.events[1].cellId,
      before.events[2].cellId,
      before.events[0].cellId,
    ]);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect
    .poll(async () => (await root()).data.events)
    .toEqual(before.events);
  const header = nodes(page, 'uml-participant')
    .first()
    .locator('[data-uml-lifeline] rect')
    .first();
  const head = (await header.boundingBox())!;
  const other = (await nodes(page, 'uml-participant').last().boundingBox())!;
  await page.mouse.move(head.x + head.width / 2, head.y + 15);
  await page.mouse.down();
  await page.mouse.move(other.x + other.width + 60, head.y + 15, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => (await root()).data.participantIds)
    .toEqual([...before.participantIds].reverse());
  await tools.getByRole('button', { name: 'loop', exact: true }).click();
  const insert = tools.getByLabel('插入分支');
  const options = await insert
    .locator('option')
    .evaluateAll((options) =>
      options.map((o) => (o as HTMLOptionElement).value),
    );
  await insert.selectOption(options[1]);
  await tools.getByRole('button', { name: '激活区间', exact: true }).click();
  await expect(umlCanvas(page).locator('[data-uml-activation]')).toHaveCount(1);
});
