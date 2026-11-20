import { expect, type Page } from '@playwright/test';
import { nodePort } from './port-controls';
import { selectPropertyValue } from './property-select';
import { expandPropertyGroup } from '../web-e2e/src/property-group';
import {
  createArchitectureFrameSnapshot,
  createArchitectureLayerCell,
  createArchitectureModuleCell,
} from '../../packages/engine/architecture/src/cell-commands';
import type {
  FrameCell,
  NodeCell,
  Cell,
} from '../../packages/engine/core/src/cell/types';
import {
  createFrameCell,
  createCellStore,
} from '../../packages/engine/core/src/cell/types';
import { createMindFrameSnapshot } from '../../packages/engine/mind/src/cell-commands';
import { createWorkflowFrameSnapshot } from '../../packages/engine/workflow/src/cell-commands';
import {
  createUmlClassFrameSnapshot,
  createUmlSequenceFrameSnapshot,
} from '../../packages/engine/uml/src/model';

export function cardSceneFixtures() {
  return [
    ['board', { store: createCellStore(createFrameCell('cards-board')) }],
    ['mind', createMindFrameSnapshot('cards-mind', 'cards-mind:root')],
    [
      'workflow',
      createWorkflowFrameSnapshot('cards-workflow', 'cards-workflow:root'),
    ],
    [
      'architecture',
      createArchitectureFrameSnapshot(
        'cards-architecture',
        'cards-architecture:root',
      ),
    ],
    [
      'uml-class',
      createUmlClassFrameSnapshot('cards-uml-class', 'cards-uml-class:root'),
    ],
    [
      'uml-sequence',
      createUmlSequenceFrameSnapshot(
        'cards-uml-sequence',
        'cards-uml-sequence:root',
      ),
    ],
  ].map(([name, source]) => {
    const snapshot = source as ReturnType<
      typeof createArchitectureFrameSnapshot
    >;
    return {
      name: name as string,
      file: {
        format: 'verd-frame' as const,
        version: 2 as const,
        frame: snapshot.store.cells[snapshot.store.rootId] as FrameCell,
        cells: Object.fromEntries(
          Object.entries(snapshot.store.cells).filter(
            ([id]) => id !== snapshot.store.rootId,
          ),
        ),
      },
    };
  });
}

export async function exerciseSceneTextPaste(page: Page, scene: string) {
  const kinds: Record<string, string> = {
    architecture: 'architecture-module',
    'uml-class': 'uml-class',
    'uml-sequence': 'uml-participant',
  };
  const kind = kinds[scene];
  if (!kind) return;
  const surface = canvas(page);
  const nodes = surface.locator(`[data-cell-kind="${kind}"]`);
  const before = await nodes.count();
  const text = `Pasted ${scene} text`;
  await surface.focus();
  await surface.evaluate((element, text) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', text);
    element.dispatchEvent(
      new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData,
      }),
    );
  }, text);
  await expect(nodes).toHaveCount(before + 1);
  await expect(nodes.filter({ hasText: text })).toHaveCount(1);
  await expect(
    surface.locator('[data-cell-kind="architecture-module"]'),
  ).toHaveCount(scene === 'architecture' ? before + 1 : 0);
  await surface.press('ControlOrMeta+z');
  await expect(nodes).toHaveCount(before);
  await expect(nodes.filter({ hasText: text })).toHaveCount(0);
}

export async function exerciseCardEntrypoint(page: Page, ordinary = false) {
  const pane = page.locator('.workspace-pane.is-active');
  if (ordinary) {
    await pane
      .getByRole('toolbar', { name: 'Drawing tools' })
      .getByRole('button', { name: '形状', exact: true })
      .click();
    await page
      .getByRole('dialog', { name: '形状', exact: true })
      .getByRole('button', { name: '卡片', exact: true })
      .click();
  } else await pane.getByRole('button', { name: '卡片', exact: true }).click();
  await expect(canvas(page).locator('[data-cell-kind="card"]')).toHaveCount(0);
  const bounds = (await canvas(page).boundingBox())!;
  await page.mouse.click(
    bounds.x + bounds.width * 0.55,
    bounds.y + bounds.height * 0.6,
  );
  const card = canvas(page).locator('[data-cell-kind="card"]');
  await expect(card).toHaveCount(1);
  await card.dblclick();
  const editor = page.locator('.ProseMirror:visible');
  await expect(editor).toBeFocused();
  await editor.pressSequentially('Card title');
  await editor.press('Enter');
  await editor.pressSequentially('Independent explanation.');
  await editor.press('Escape');
  await expect(card).toContainText('Independent explanation.');
  const automaticFill = await card.getAttribute('fill');
  expect(automaticFill).toMatch(/^#[\da-f]{6}$/i);
  const styles = pane.getByRole('group', { name: '风格色', exact: true });
  await styles.getByRole('button', { name: '风格色 1', exact: true }).click();
  await expect(card).toHaveAttribute('fill', automaticFill!);
  await styles.getByRole('button', { name: '自动', exact: true }).click();
  await expect(
    styles.getByRole('button', { name: '自动', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(card).toHaveAttribute('fill', automaticFill!);
}

export async function openCardScene(page: Page, fileId: string) {
  await page
    .locator(
      `.file-tree-file[data-file-id=${JSON.stringify(fileId)}] .file-tree-main`,
    )
    .click();
  await expect(
    page.locator(`[role="tab"][data-tab-id=${JSON.stringify(fileId)}]`),
  ).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.workspace-content')).toHaveAttribute(
    'aria-busy',
    'false',
  );
  await expect(canvas(page)).toBeVisible();
}

export function architectureCardsFixture() {
  const snapshot = createArchitectureFrameSnapshot(
    'architecture-cards',
    'layer-a',
  );
  const frame = snapshot.store.cells[snapshot.store.rootId] as FrameCell;
  frame.geometry = { x: 0, y: 0, width: 1200, height: 760 };
  const a = snapshot.store.cells['layer-a'] as NodeCell<{
    order: string;
    memberIds: string[];
  }>;
  a.content = { label: '应用层' };
  a.geometry = {
    ...a.geometry,
    x: 40,
    y: 80,
    width: 360,
    height: 240,
    derived: false,
  };
  const b = createArchitectureLayerCell('layer-b', '1');
  b.content = { label: '数据层' };
  b.geometry = {
    ...b.geometry,
    x: 700,
    y: 80,
    width: 360,
    height: 240,
    derived: false,
  };
  const m = createArchitectureModuleCell('module-a');
  m.content = { label: '订单服务' };
  m.geometry = { ...m.geometry, x: 100, y: 160, width: 180, derived: false };
  m.data = { shape: 'box', placed: true };
  a.data!.memberIds = [m.id];
  frame.children.push(b.id, m.id);
  snapshot.store.cells[b.id] = b;
  snapshot.store.cells[m.id] = m;
  return {
    format: 'verd-frame' as const,
    version: 2 as const,
    frame,
    cells: Object.fromEntries(
      Object.entries(snapshot.store.cells).filter(([id]) => id !== frame.id),
    ),
  };
}
const canvas = (page: Page) =>
  page.locator('svg[aria-label="Frame canvas"][data-surface="root"]:visible');
const node = (page: Page, id: string) =>
  canvas(page).locator(`[data-cell-id="${id}"]`).first();
async function point(page: Page, x: number, y: number) {
  return node(page, 'layer-a').evaluate(
    (element, p) => {
      const m = (element as SVGGraphicsElement).getScreenCTM()!;
      return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
    },
    { x, y },
  );
}
async function drag(page: Page, from: [number, number], to: [number, number]) {
  const a = await point(page, ...from),
    b = await point(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.up();
}

export async function exerciseArchitectureCards(
  page: Page,
  readCells: () => Promise<Record<string, Cell>>,
) {
  await expect(node(page, 'layer-a')).toBeVisible();
  const toolbar = page.getByRole('toolbar', { name: 'Drawing tools' });
  await expect(
    toolbar.getByRole('button', { name: '泳道', exact: true }),
  ).toHaveCount(0);
  await expect(
    toolbar.getByRole('button', { name: '判断', exact: true }),
  ).toHaveCount(0);
  const layerTool = toolbar.getByRole('button', {
    name: '添加层',
    exact: true,
  });
  await layerTool.click();
  await expect(
    canvas(page).locator('[data-cell-kind="architecture-layer"]'),
  ).toHaveCount(2);
  await canvas(page).press('Escape');
  await layerTool.click();
  await drag(page, [60, 420], [400, 640]);
  await expect(
    canvas(page).locator('[data-cell-kind="architecture-layer"]'),
  ).toHaveCount(3);
  await canvas(page).press('ControlOrMeta+z');
  await expect(
    canvas(page).locator('[data-cell-kind="architecture-layer"]'),
  ).toHaveCount(2);
  await toolbar.getByRole('button', { name: '卡片', exact: true }).click();
  const at = await point(page, 450, 420);
  await page.mouse.click(at.x, at.y);
  const card = canvas(page).locator('[data-cell-kind="card"]').first();
  await expect(card).toBeVisible();
  await card.dblclick();
  const editor = page.locator('.ProseMirror:visible');
  await expect(editor).toBeFocused();
  await editor.pressSequentially('Responsibilities');
  await editor.press('Enter');
  await editor.pressSequentially('Validation belongs to each boundary.');
  await editor.press('Escape');
  await expect(card).toContainText('Responsibilities');
  const source = await point(page, 400, 200);
  await page.mouse.move(source.x, source.y);
  await (await nodePort(node(page, 'layer-a'), 'right')).click();
  const target = await point(page, 700, 200);
  await page.mouse.move(target.x, target.y);
  await (await nodePort(node(page, 'layer-b'), 'left')).click();
  const edge = canvas(page)
    .locator('[data-cell-kind="architecture-edge"]')
    .first();

  await expect(edge).toBeVisible();
  await expect
    .poll(async () =>
      Object.values(await readCells())
        .filter((cell) => cell.kind === 'architecture-edge')
        .map(
          (cell) => (cell as { data?: { relation?: string } }).data?.relation,
        ),
    )
    .toEqual(['dependency']);
  const hit = edge.locator('[data-edge-hit]').first();
  const middle = await hit.evaluate((element) => {
    const path = element as SVGPathElement;
    const point = path.getPointAtLength(path.getTotalLength() / 2),
      matrix = path.getScreenCTM()!;
    return {
      x: point.x * matrix.a + point.y * matrix.c + matrix.e,
      y: point.x * matrix.b + point.y * matrix.d + matrix.f,
    };
  });
  await page.mouse.click(middle.x, middle.y);
  await expandPropertyGroup(page, 'specific');
  await selectPropertyValue(
    page.getByLabel('Architecture relationship', { exact: true }),
    'flow',
  );
  await expect
    .poll(async () =>
      Object.values(await readCells())
        .filter((c) => c.kind === 'architecture-edge')
        .map((c) => (c as { data: { relation: string } }).data.relation),
    )
    .toEqual(['flow']);
  const cells = await readCells();
  const cardId = Object.values(cells).find((cell) => cell.kind === 'card')!.id;
  await drag(page, [55, 95], [155, 145]);
  await expect
    .poll(
      async () =>
        (await readCells())['module-a'] &&
        ((await readCells())['module-a'] as NodeCell).geometry.x,
    )
    .toBe(200);
  expect((await readCells())[cardId]).toEqual(cells[cardId]);
  await drag(page, [250, 230], [580, 400]);
  await expect
    .poll(
      async () =>
        ((await readCells())['layer-a'] as NodeCell<{ memberIds: string[] }>)
          .data!.memberIds,
    )
    .toEqual([]);
  const saved = await readCells();
  expect((saved['layer-a'] as NodeCell).geometry.x).toBe(140);
  expect((saved['module-a'] as NodeCell).geometry.x).toBe(530);
  return saved;
}

/** Existing architecture scenarios now place tools instead of creating on toolbar click. */
export async function placeArchitectureTool(
  page: Page,
  label: string,
  layerIndex = 0,
) {
  await page.getByRole('button', { name: label, exact: true }).click();
  if (label === '添加层') {
    const bounds = (await canvas(page).boundingBox())!;
    await page.mouse.click(
      bounds.x + bounds.width * 0.65,
      bounds.y + bounds.height * 0.7,
    );
  } else {
    const layer = canvas(page)
      .locator('[data-cell-kind="architecture-layer"]')
      .nth(layerIndex);
    const at = await layer.evaluate((element) => {
      const outline = element.querySelector(
        '[data-frame-node-outline]',
      ) as SVGGraphicsElement;
      const box = outline.getBBox(),
        matrix = outline.getScreenCTM()!;
      const x = box.x + 24,
        y = box.y + 48;
      return {
        x: x * matrix.a + y * matrix.c + matrix.e,
        y: x * matrix.b + y * matrix.d + matrix.f,
      };
    });
    await page.mouse.click(at.x, at.y);
  }
  await page.getByRole('button', { name: '选择', exact: true }).click();
}
