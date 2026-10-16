import { expect, test, type Page } from '@playwright/test';
import { openSettings } from './app-actions';
import { expandPropertyGroup } from './property-group';
import { persistedWorkspace } from './workspace-nav';

const canvas = (page: Page) =>
  page.locator('svg[aria-label="Frame canvas"][data-surface="root"]:visible');
const node = (page: Page, label: string) =>
  canvas(page)
    .locator('[data-cell-kind="geometry"]')
    .filter({ hasText: label });
const panel = async (page: Page) => {
  await expandPropertyGroup(page);
  return page
    .getByRole('complementary')
    .locator('visible=true')
    .getByTestId('frame-arrangement');
};
const fixture = () => {
  const root = {
    id: 'root',
    kind: 'frame',
    cellType: 'frame',
    geometry: { x: 0, y: 0, width: 960, height: 640 },
    children: ['a', 'b', 'c', 'shell'],
    groups: [],
  };
  const nodes = [
    ['a', 'A', 0, 100, 60],
    ['b', 'B', 180, 180, 100],
    ['c', 'C', 450, 120, 80],
  ].map(([id, label, x, y, width]) => ({
    id,
    kind: 'geometry',
    cellType: 'node',
    geometry: { x, y, width, height: 40, outline: 'rectangle' },
    content: { label },
  }));
  return {
    store: {
      rootId: 'root',
      cells: {
        root,
        ...Object.fromEntries(nodes.map((cell) => [cell.id, cell])),
        shell: {
          ...root,
          id: 'shell',
          geometry: { x: 600, y: 300, width: 240, height: 160 },
          content: { label: 'Nested' },
          children: ['inside'],
        },
        inside: {
          id: 'inside',
          kind: 'geometry',
          cellType: 'node',
          geometry: { x: 7, y: 13, width: 60, height: 40 },
          content: { label: 'Inside' },
        },
      },
    },
  };
};

async function openFixture(page: Page, snapshot = fixture()) {
  await page.goto('/');
  await page
    .locator('input[type="file"][accept^="application/json"]')
    .nth(1)
    .setInputFiles({
      name: 'arrangement.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(snapshot)),
    });
  await expect(
    canvas(page).locator('[data-cell-kind]').filter({ hasText: 'A' }).first(),
  ).toBeVisible();
  await expect(page.getByTestId('save-status')).toHaveAttribute(
    'data-save-state',
    'saved',
  );
}

async function saved(page: Page): Promise<Record<string, any>> {
  const data = await persistedWorkspace(page);
  return Object.assign(
    {},
    ...Object.values(data?.records ?? {}).map((record: any) => ({
      ...record.cells,
      [record.frame.id]: record.frame,
    })),
  );
}
const byLabel = (cells: Record<string, any>, label: string) =>
  Object.values(cells).find((cell) => cell?.content?.label === label);

test('localized alignment, distribution and partial/all layouts save exact scopes and preserve Frame contents', async ({
  page,
}) => {
  await openFixture(page);
  const original = await saved(page);
  await node(page, 'A').click();
  await node(page, 'B').click({ modifiers: ['Shift'] });
  await node(page, 'C').click({ modifiers: ['Shift'] });
  await (
    await panel(page)
  )
    .getByRole('button', { name: '水平等距分布', exact: true })
    .click();
  await expect
    .poll(async () => byLabel(await saved(page), 'B').geometry.x)
    .toBe(205);
  await (
    await panel(page)
  )
    .getByRole('button', { name: '顶对齐', exact: true })
    .click();
  await expect
    .poll(async () => byLabel(await saved(page), 'B').geometry.y)
    .toBe(100);
  await expect
    .poll(async () => byLabel(await saved(page), 'C').geometry.y)
    .toBe(100);
  await canvas(page).press('Escape');
  await node(page, 'A').click();
  await node(page, 'B').click({ modifiers: ['Shift'] });
  const before = await saved(page);
  await (
    await panel(page)
  )
    .getByLabel('自动排列样式', { exact: true })
    .selectOption('vertical');
  await (
    await panel(page)
  )
    .getByRole('button', { name: '自动排列', exact: true })
    .click();
  await expect
    .poll(async () => byLabel(await saved(page), 'B').geometry.y)
    .toBe(172);
  expect(byLabel(await saved(page), 'C')).toEqual(byLabel(before, 'C'));
  expect(byLabel(await saved(page), 'Inside')).toEqual(
    byLabel(original, 'Inside'),
  );
  await canvas(page).press('Escape');
  await (
    await panel(page)
  )
    .getByLabel('自动排列样式', { exact: true })
    .selectOption('grid');
  await (
    await panel(page)
  )
    .getByRole('button', { name: '自动排列', exact: true })
    .click();
  await expect
    .poll(async () => byLabel(await saved(page), 'Nested').geometry)
    .not.toEqual(byLabel(before, 'Nested').geometry);
  expect(byLabel(await saved(page), 'Inside')).toEqual(
    byLabel(original, 'Inside'),
  );
  const arranged = await saved(page);
  await page.reload();
  await expect(node(page, 'A')).toBeVisible();
  expect(byLabel(await saved(page), 'B').geometry).toEqual(
    byLabel(arranged, 'B').geometry,
  );
});

test('keyboard groups remain rigid in layouts, allow drill-down and independently lock/unlock', async ({
  page,
}) => {
  await openFixture(page);
  await node(page, 'A').click();
  await node(page, 'B').click({ modifiers: ['Shift'] });
  await canvas(page).press('ControlOrMeta+g');
  await expect
    .poll(
      async () =>
        Object.values(await saved(page)).filter(
          (cell) => cell.cellType === 'group',
        ).length,
    )
    .toBe(1);
  const grouped = await saved(page);
  const delta = [
    byLabel(grouped, 'B').geometry.x - byLabel(grouped, 'A').geometry.x,
    byLabel(grouped, 'B').geometry.y - byLabel(grouped, 'A').geometry.y,
  ];
  await node(page, 'C').click({ modifiers: ['Shift'] });
  await (
    await panel(page)
  )
    .getByLabel('自动排列样式', { exact: true })
    .selectOption('vertical');
  await (
    await panel(page)
  )
    .getByRole('button', { name: '自动排列', exact: true })
    .click();
  const after = await saved(page);
  expect([
    byLabel(after, 'B').geometry.x - byLabel(after, 'A').geometry.x,
    byLabel(after, 'B').geometry.y - byLabel(after, 'A').geometry.y,
  ]).toEqual(delta);
  await node(page, 'A').click();
  await (
    await panel(page)
  )
    .getByRole('button', { name: '锁定', exact: true })
    .click();
  await expect(
    (await panel(page)).getByRole('button', { name: '取消分组', exact: true }),
  ).toBeDisabled();
  await node(page, 'A').dblclick();
  await expect(canvas(page).locator('[data-frame-text-editor]')).toHaveCount(0);
  await (
    await panel(page)
  )
    .getByRole('button', { name: '解锁', exact: true })
    .click();
  await node(page, 'A').dblclick();
  await expect(
    (await panel(page)).getByRole('button', { name: '取消分组', exact: true }),
  ).toBeDisabled();
  await canvas(page).press('Escape');
  await expect(
    (await panel(page)).getByRole('button', { name: '取消分组', exact: true }),
  ).toBeEnabled();
  await canvas(page).press('ControlOrMeta+Shift+g');
  await expect
    .poll(
      async () =>
        Object.values(await saved(page)).filter(
          (cell) => cell.cellType === 'group',
        ).length,
    )
    .toBe(0);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect
    .poll(
      async () =>
        Object.values(await saved(page)).filter(
          (cell) => cell.cellType === 'group',
        ).length,
    )
    .toBe(1);
  await page.reload();
  await node(page, 'A').click();
  await expect(
    (await panel(page)).getByRole('button', { name: '取消分组', exact: true }),
  ).toBeEnabled();
});

test('real drag guides snap the final position and the local setting disables them', async ({
  page,
}) => {
  await openFixture(page);
  const dragNearB = async () => {
    await node(page, 'A').click();
    const data = await saved(page),
      a = byLabel(data, 'A').geometry,
      b = byLabel(data, 'B').geometry;
    const box = (await node(page, 'A').locator('path').first().boundingBox())!;
    const scale = box.width / a.width;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + (b.x - a.x - 2) * scale,
      box.y + box.height / 2 + (b.y - a.y + 1) * scale,
      { steps: 6 },
    );
  };
  await dragNearB();
  await expect(canvas(page).locator('[data-alignment-guides]')).toBeVisible();
  await page.mouse.up();
  await expect
    .poll(async () => byLabel(await saved(page), 'A').geometry.x)
    .toBe(180);
  await expect
    .poll(async () => byLabel(await saved(page), 'A').geometry.y)
    .toBe(180);
  await expect(canvas(page).locator('[data-alignment-guides]')).toHaveCount(0);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect
    .poll(async () => byLabel(await saved(page), 'A').geometry.x)
    .toBe(0);
  const settings = await openSettings(page);
  await settings.getByTestId('settings-smart-guides').uncheck();
  await settings.getByTestId('settings-back').click();
  await dragNearB();
  await expect(canvas(page).locator('[data-alignment-guides]')).toHaveCount(0);
  await page.mouse.up();
  await expect
    .poll(async () => byLabel(await saved(page), 'A').geometry.x)
    .toBe(178);
  await page.reload();
  await openSettings(page);
  await expect(page.getByTestId('settings-smart-guides')).not.toBeChecked();
});

test('the context menu shares grouping and arrangement availability', async ({
  page,
}) => {
  await openFixture(page);
  await node(page, 'A').click();
  await node(page, 'B').click({ modifiers: ['Shift'] });
  await node(page, 'A').click({ button: 'right' });
  const menu = page.getByRole('dialog', { name: 'Selection actions' });
  await expect(
    menu.getByRole('button', { name: '左对齐', exact: true }),
  ).toBeEnabled();
  await expect(
    menu.getByRole('button', { name: '水平等距分布', exact: true }),
  ).toBeDisabled();
  await menu.getByRole('button', { name: '分组', exact: true }).click();
  await expect
    .poll(
      async () =>
        Object.values(await saved(page)).filter(
          (cell) => cell.cellType === 'group',
        ).length,
    )
    .toBe(1);
  await expect(menu).toBeHidden();
  await node(page, 'A').click({ button: 'right' });
  await expect(
    menu.getByRole('button', { name: '取消分组', exact: true }),
  ).toBeEnabled();
});

for (const scene of ['workflow', 'architecture'] as const) {
  test(`${scene} node groups preserve domain ownership and expose safe layout choices`, async ({
    page,
  }) => {
    const snapshot: any = fixture();
    const root = snapshot.store.cells.root;
    delete snapshot.store.cells.shell;
    delete snapshot.store.cells.inside;
    const ports = [
      { id: 'left', side: 'left', direction: 'input' },
      { id: 'right', side: 'right', direction: 'output' },
    ];
    for (const id of ['a', 'b', 'c']) {
      const cell = snapshot.store.cells[id];
      cell.kind =
        scene === 'workflow' ? 'workflow-task' : 'architecture-module';
      cell.geometry.derived = false;
      cell.ports = ports;
      if (scene === 'architecture') cell.data = { shape: 'box', placed: true };
    }
    if (scene === 'workflow') {
      const start = {
        id: 'start',
        kind: 'workflow-start',
        cellType: 'node',
        geometry: { x: 0, y: 0, width: 120, height: 40 },
        ports,
        content: { label: 'Start' },
        data: {
          origin: [0, 0],
          graphMode: 'dag',
          memberIds: ['start', 'a', 'b', 'c'],
        },
      };
      snapshot.store.cells.start = start;
      for (const [id, source, target] of [
        ['ab', 'a', 'b'],
        ['bc', 'b', 'c'],
      ])
        snapshot.store.cells[id] = {
          id,
          kind: 'workflow-edge',
          cellType: 'edge',
          source: { cellId: source, portId: 'right' },
          target: { cellId: target, portId: 'left' },
          route: { mode: 'auto' },
        };
      root.children = ['start', 'a', 'b', 'c', 'ab', 'bc'];
    } else {
      for (const [id, order, members] of [
        ['layer1', '0000', ['a', 'b']],
        ['layer2', '0001', ['c']],
      ])
        snapshot.store.cells[id as string] = {
          id,
          kind: 'architecture-layer',
          cellType: 'node',
          geometry: { x: 0, y: 0, width: 600, height: 200, derived: true },
          content: { label: id },
          data: { order, memberIds: members },
        };
      root.children = ['layer1', 'layer2', 'a', 'b', 'c'];
    }
    await openFixture(page, snapshot);
    const kind = scene === 'workflow' ? 'workflow-task' : 'architecture-module';
    const item = (label: string) =>
      canvas(page)
        .locator(`[data-cell-kind="${kind}"]`)
        .filter({ hasText: label });
    await item('A').click();
    await item('C').click({ modifiers: ['Shift'] });
    await canvas(page).press('ControlOrMeta+g');
    await expect
      .poll(
        async () =>
          Object.values(await saved(page)).filter(
            (cell) => cell.cellType === 'group',
          ).length,
      )
      .toBe(1);
    await item('B').click({ modifiers: ['Shift'] });
    const blocked = scene === 'workflow' ? 'flow' : 'layers';
    await expect(
      (await panel(page))
        .getByLabel('自动排列样式', { exact: true })
        .locator(`option[value="${blocked}"]`),
    ).toHaveAttribute('disabled', '');
    await (
      await panel(page)
    )
      .getByLabel('自动排列样式', { exact: true })
      .selectOption('horizontal');
    await (
      await panel(page)
    )
      .getByRole('button', { name: '自动排列', exact: true })
      .click();
    const data = await saved(page);
    const owners = Object.values(data).filter((cell) =>
      scene === 'workflow'
        ? cell.kind === 'workflow-start'
        : cell.kind === 'architecture-layer',
    );
    const a = byLabel(data, 'A'),
      c = byLabel(data, 'C');
    expect(
      owners.filter((owner) => owner.data.memberIds.includes(a.id)),
    ).toHaveLength(1);
    expect(
      owners.filter((owner) => owner.data.memberIds.includes(c.id)),
    ).toHaveLength(1);
    if (scene === 'architecture') {
      await item('A').click();
      await canvas(page).press('ControlOrMeta+x');
      await expect(item('A')).toHaveCount(0);
      await canvas(page).press('ControlOrMeta+v');
      await expect(item('A')).toHaveCount(1);
      await expect(item('C')).toHaveCount(1);
      const pasted = await saved(page);
      expect(
        Object.values(pasted).find((cell) => cell.content?.label === 'layer1')
          .data.memberIds,
      ).toContain(byLabel(pasted, 'A').id);
      expect(
        Object.values(pasted).find((cell) => cell.content?.label === 'layer2')
          .data.memberIds,
      ).toContain(byLabel(pasted, 'C').id);
    }
  });
}
