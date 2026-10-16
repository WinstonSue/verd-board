import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { selectDrawingTool } from './drawing-tools';
import { selectAppAction } from './app-actions';
import { bodyEditor, editBody } from './body-editor';
import { persistedWorkspace } from './workspace-nav';
import { expandPropertyGroup } from './property-group';
const canvas = (page: Page) =>
  page.locator('svg[aria-label="Frame canvas"][data-surface="root"]:visible');
const nodes = (page: Page) =>
  canvas(page).locator('[data-cell-kind="geometry"]');
async function create(page: Page, x = 220, y = 220) {
  await selectDrawingTool(page, '形状');
  await page.getByTestId('shape-rectangle').click();
  const box = (await canvas(page).boundingBox())!;
  await page.mouse.click(box.x + x, box.y + y);
}
const saved = async (page: Page) => {
  const ws = (await persistedWorkspace(page)) as any;
  return (
    (ws?.manifest?.rootId && ws.records?.[ws.manifest.rootId]?.cells) || {}
  );
};

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  const skip = page.getByRole('button', { name: '跳过', exact: true });
  if (await skip.isVisible()) await skip.click();
});

for (const width of [800, 1440])
  test(`Sidebar stays outside the canvas and toggles without history or camera changes at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await create(page, 180, 220);
    await expect(nodes(page)).toHaveCount(1);
    const undo = page.getByRole('button', { name: '撤销', exact: true });
    const world = canvas(page).locator('[data-frame-world]');
    const initial = await world.getAttribute('transform');
    const sidebar = (await page.locator('.frame-inspector').boundingBox())!;
    const box = (await canvas(page).boundingBox())!;
    expect(sidebar.width).toBe(300);
    // The workspace tab strip occupies the top ~39px; the inspector still
    // spans from under it to the viewport bottom.
    expect(sidebar.y + sidebar.height).toBe(900);
    expect(box.x + box.width).toBe(sidebar.x);
    const controls = (await page
      .locator('.frame-bottom-controls')
      .boundingBox())!;
    expect(controls.x + controls.width).toBeLessThanOrEqual(sidebar.x);
    await page.getByRole('button', { name: '属性', exact: true }).click();
    await expect(page.locator('.frame-inspector')).toBeHidden();
    // The file tree stays on the left; with the inspector hidden the canvas
    // must now reach the viewport's right edge.
    const expanded = (await canvas(page).boundingBox())!;
    expect(expanded.x + expanded.width).toBe(width);
    await expect(world).toHaveAttribute('transform', initial!);
    await page.getByRole('button', { name: '属性', exact: true }).click();
    await expect(world).toHaveAttribute('transform', initial!);
    await undo.click();
    await expect(nodes(page)).toHaveCount(0);
    await expect(undo).toBeDisabled();
  });

test('first complete body session supplies a plain name, then body and explicit empty name stay independent through save and history', async ({
  page,
}) => {
  await create(page);
  const editor = await bodyEditor(page);
  await page.keyboard.type('Complete first session');
  await editor.press('ControlOrMeta+a');
  await page
    .getByRole('toolbar', { name: 'Text formatting' })
    .getByRole('button', { name: 'Bold', exact: true })
    .click();
  await editor.press('Escape');
  const name = page.getByTestId('inspector-name');
  await expect(name).toHaveValue('Complete first session');
  expect(await name.evaluate((el) => el.tagName)).toBe('INPUT');
  await editBody(page, 'Later body');
  await expect(name).toHaveValue('Complete first session');
  await name.fill('');
  await editBody(page, 'Third body');
  await expect(name).toHaveValue('');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(nodes(page)).toContainText('Later body');
  await expect(name).toHaveValue('');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(name).toHaveValue('Complete first session');
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect(name).toHaveValue('');
  await expect
    .poll(async () => Object.values(await saved(page)).map((c: any) => c.name))
    .toEqual(['']);
  await page.reload();
  await nodes(page).click();
  await expect(name).toHaveValue('');
  await expect(nodes(page)).toContainText('Later body');
  await expandPropertyGroup(page);
  await page.getByRole('checkbox', { name: '锁定', exact: true }).check();
  await expect(name).toBeDisabled();
  await nodes(page).hover();
  await expect(nodes(page).locator('[data-port-id]')).toHaveCount(0);
});

test('shape dismissal leaves selection and bidirectional arrows persist both markers with straight routes', async ({
  page,
}) => {
  await selectDrawingTool(page, '形状');
  await expect(page.getByTestId('shape-rectangle')).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  const box = (await canvas(page).boundingBox())!;
  await page.mouse.click(box.x + 350, box.y + 250);
  await expect(nodes(page)).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: '选择', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await create(page);
  await selectDrawingTool(page, '双向箭头');
  await page.mouse.move(box.x + 450, box.y + 350);
  await page.mouse.down();
  await page.mouse.move(box.x + 700, box.y + 430, { steps: 8 });
  await expect(
    canvas(page).locator('[data-drawing-preview] [data-arrow-marker]'),
  ).toHaveCount(2);
  await page.mouse.up();
  const edge = canvas(page).locator('[data-cell-kind="arrow"]');
  await expect(edge.locator('[data-arrow-marker]')).toHaveCount(2);
  await expect
    .poll(async () =>
      Object.values(await saved(page)).find((c: any) => c.kind === 'arrow'),
    )
    .toMatchObject({
      route: { mode: 'straight' },
      data: { sourceMarker: 'arrow', targetMarker: 'arrow' },
    });
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(edge).toHaveCount(0);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await page.reload();
  await expect(edge.locator('[data-arrow-marker]')).toHaveCount(2);
});

test('visible ports trim thick curves at both ends while export keeps canonical endpoints without ports', async ({
  page,
}) => {
  const node = (id: string, x: number, side: string) => ({
    id,
    kind: 'geometry',
    cellType: 'node',
    geometry: {
      x,
      y: 150,
      width: 100,
      height: 80,
      outline: 'rectangle',
      rotation: 0.2,
    },
    appearance: { strokeWidth: 12 },
    ports: [{ id: side, side, direction: 'both' }],
    content: { label: id },
  });
  const fixture = {
    store: {
      rootId: 'r',
      cells: {
        r: {
          id: 'r',
          kind: 'frame',
          cellType: 'frame',
          geometry: { x: 0, y: 0, width: 960, height: 640 },
          children: ['a', 'b', 'e'],
          groups: [],
        },
        a: node('a', 100, 'right'),
        b: node('b', 500, 'left'),
        e: {
          id: 'e',
          kind: 'arrow',
          cellType: 'edge',
          source: { cellId: 'a', portId: 'right' },
          target: { cellId: 'b', portId: 'left' },
          route: {
            mode: 'curve',
            points: [
              [200, 190],
              [350, 260],
              [500, 190],
            ],
          },
          appearance: { strokeWidth: 8 },
          data: { sourceMarker: 'arrow', targetMarker: 'arrow' },
          labels: [{ text: 'Unchanged label', position: 0.5 }],
        },
      },
    },
  };
  const chooser = page.waitForEvent('filechooser');
  await selectAppAction(page, '打开');
  await (
    await chooser
  ).setFiles({
    name: 'ports.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(fixture)),
  });
  const edge = canvas(page).locator('[data-cell-kind="arrow"]');
  const path = edge.locator('path').first();
  await canvas(page).press('Escape');
  await page.mouse.move(10, 10);
  const canonical = await path.getAttribute('d');
  await nodes(page).first().click();
  await nodes(page)
    .last()
    .click({ modifiers: ['Shift'] });
  await expect(nodes(page).locator('[data-port-id]')).toHaveCount(2);
  await expect(path).not.toHaveAttribute('d', canonical!);
  expect(await path.getAttribute('d')).not.toMatch(/NaN|Infinity/);
  await expect(edge).toContainText('Unchanged label');
  const download = page.waitForEvent('download');
  await selectAppAction(page, '图像导出');
  await page.getByLabel('Image format').selectOption('svg');
  await page.getByLabel('Image scope').selectOption('frame');
  await page
    .getByRole('dialog', { name: '图像导出' })
    .getByTestId('image-export-button')
    .click();
  const xml = readFileSync((await (await download).path())!, 'utf8');
  expect(xml).not.toContain('data-port-id');
  expect(xml).toContain(`d="${canonical}"`);
});
