import { setAppLanguage } from './app-actions';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { selectDrawingTool } from './drawing-tools';
import { persistedWorkspace } from './workspace-nav';

const toolbar = (page: Page) =>
  page.getByRole('toolbar', { name: 'Drawing tools' });
const canvas = (page: Page) =>
  page.locator('svg[aria-label="Frame canvas"][data-surface="root"]:visible');
const cells = (page: Page, kind: string) =>
  canvas(page).locator(`[data-cell-kind="${kind}"]`);

const expectMenuWithinViewport = async (page: Page, menu: Locator) => {
  await expect(menu).toBeInViewport({ ratio: 1 });
  const bounds = (await menu.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
  for (const item of await menu.getByRole('menuitemradio').all())
    await expect(item).toBeInViewport({ ratio: 1 });
};

const savedCells = async (page: Page) =>
  Object.values((await persistedWorkspace(page))?.records ?? {}).flatMap(
    (record: any) => Object.values(record.cells) as any[],
  );

for (const locale of [
  {
    language: 'zh',
    diagrams: '图表',
    connectors: '连线',
    shape: '形状',
    polyline: '折线',
    domainTools: ['思维导图', '流程图', '架构图', 'UML 类图', 'UML 时序图'],
    edgeTools: ['箭头', '直线', '曲线'],
  },
  {
    language: 'en',
    diagrams: 'Diagrams',
    connectors: 'Connectors',
    shape: 'Shape',
    polyline: 'Polyline',
    domainTools: [
      'Mind Map',
      'Flowchart',
      'Architecture',
      'UML Class Diagram',
      'UML Sequence Diagram',
    ],
    edgeTools: ['Arrow', 'Line', 'Curve'],
  },
] as const) {
  test(`drawing toolbar groups domain and connector tools in ${locale.language}`, async ({
    page,
  }) => {
    await page.goto('/');
    await setAppLanguage(page, locale.language);
    const diagrams = toolbar(page).getByRole('button', {
      name: locale.diagrams,
      exact: true,
    });
    const connectors = toolbar(page).getByRole('button', {
      name: locale.connectors,
      exact: true,
    });
    await expect(diagrams).toBeVisible();
    await expect(connectors).toBeVisible();
    await expect(
      toolbar(page).getByRole('button', { name: locale.shape, exact: true }),
    ).toBeVisible();
    for (const label of [
      ...locale.domainTools,
      ...locale.edgeTools,
      locale.polyline,
    ])
      await expect(
        toolbar(page).getByRole('button', { name: label, exact: true }),
      ).toHaveCount(0);

    await diagrams.click();
    const diagramMenu = page.getByRole('menu', {
      name: locale.diagrams,
      exact: true,
    });
    await expect(diagramMenu.getByRole('menuitemradio')).toHaveCount(
      locale.domainTools.length,
    );
    for (const label of locale.domainTools)
      await expect(
        diagramMenu.getByRole('menuitemradio', { name: label, exact: true }),
      ).toBeVisible();
    await selectDrawingTool(page, locale.domainTools[2]);
    await expect(diagramMenu).toHaveCount(0);
    await expect(diagrams).toHaveAttribute('aria-pressed', 'true');
    await diagrams.click();
    await expect(
      diagramMenu.getByRole('menuitemradio', {
        name: locale.domainTools[2],
        exact: true,
      }),
    ).toHaveAttribute('aria-checked', 'true');

    await connectors.click();
    await expect(diagramMenu).toHaveCount(0);
    const connectorMenu = page.getByRole('menu', {
      name: locale.connectors,
      exact: true,
    });
    await expect(connectorMenu.getByRole('menuitemradio')).toHaveCount(4);
    for (const label of locale.edgeTools)
      await expect(
        connectorMenu.getByRole('menuitemradio', { name: label, exact: true }),
      ).toBeVisible();
    await selectDrawingTool(page, locale.edgeTools[1]);
    await expect(connectorMenu).toHaveCount(0);
    await expect(connectors).toHaveAttribute('aria-pressed', 'true');
    await connectors.click();
    await expect(
      connectorMenu.getByRole('menuitemradio', {
        name: locale.edgeTools[1],
        exact: true,
      }),
    ).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    await expect(connectorMenu).toHaveCount(0);
    await expect(connectors).toBeFocused();
    await expect(cells(page, 'frame')).toHaveCount(0);
    await expect(cells(page, 'arrow')).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(connectors).toHaveAttribute('aria-pressed', 'true');
    await diagrams.click();
    await expect(connectors).toHaveAttribute('aria-pressed', 'true');
    await expectMenuWithinViewport(page, diagramMenu);
    await selectDrawingTool(page, locale.domainTools[1]);
    await expect(diagramMenu).toHaveCount(0);
    await expect(diagrams).toHaveAttribute('aria-pressed', 'true');
    await connectors.click();
    await expect(diagrams).toHaveAttribute('aria-pressed', 'true');
    await expectMenuWithinViewport(page, connectorMenu);
    await selectDrawingTool(page, locale.edgeTools[2]);
    await expect(connectorMenu).toHaveCount(0);
    await expect(connectors).toHaveAttribute('aria-pressed', 'true');
  });
}

test('drawing menus support keyboard navigation, selection, Escape and outside dismissal', async ({
  page,
}) => {
  await page.goto('/');
  const diagrams = toolbar(page).getByRole('button', {
    name: '图表',
    exact: true,
  });
  const connectors = toolbar(page).getByRole('button', {
    name: '连线',
    exact: true,
  });
  const menu = page.getByRole('menu', { name: '图表', exact: true });
  await diagrams.click();
  await expect(
    menu.getByRole('menuitemradio', { name: '思维导图', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(
    menu.getByRole('menuitemradio', { name: '流程图', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('End');
  await expect(
    menu.getByRole('menuitemradio', { name: 'UML 时序图', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  await expect(menu).toHaveCount(0);
  await expect(diagrams).toHaveAttribute('aria-pressed', 'true');
  await expect(diagrams).toBeFocused();

  await connectors.click();
  await expect(connectors).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(connectors).toBeFocused();
  await expect(connectors).toHaveAttribute('aria-expanded', 'false');
  await expect(diagrams).toHaveAttribute('aria-pressed', 'true');

  await diagrams.click();
  await page.getByTestId('save-status').click();
  await expect(menu).toHaveCount(0);
  await expect(diagrams).toHaveAttribute('aria-expanded', 'false');
  await expect(diagrams).toHaveAttribute('aria-pressed', 'true');
  await expect(cells(page, 'frame')).toHaveCount(0);
});

test('shape polylines persist as nodes and connectors retain edge kinds with appropriate markers', async ({
  page,
}) => {
  await page.goto('/');
  await selectDrawingTool(page, '折线');
  await expect(
    toolbar(page).getByRole('button', { name: '形状', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  const box = (await canvas(page).boundingBox())!;
  await page.mouse.click(box.x + 140, box.y + 120);
  await page.mouse.click(box.x + 280, box.y + 120);
  await page.mouse.click(box.x + 280, box.y + 200);
  await canvas(page).press('Enter');
  await expect(cells(page, 'vector-line')).toHaveCount(1);

  for (const [index, label] of ['直线', '曲线', '箭头'].entries()) {
    await selectDrawingTool(page, label);
    await page.mouse.move(box.x + 380, box.y + 120 + index * 150);
    await page.mouse.down();
    await page.mouse.move(box.x + 610, box.y + 170 + index * 150, { steps: 5 });
    await page.mouse.up();
    await expect(cells(page, 'arrow')).toHaveCount(index + 1);
  }
  await page.getByRole('button', { name: '选择', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await savedCells(page)).filter((cell) => cell.cellType === 'edge')
          .length,
    )
    .toBe(3);
  const saved = await savedCells(page);
  expect(saved.find((cell) => cell.kind === 'vector-line')).toMatchObject({
    cellType: 'node',
  });
  expect(saved.filter((cell) => cell.cellType === 'edge')).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: 'arrow',
        route: { mode: 'straight' },
        data: { sourceMarker: 'none', targetMarker: 'none' },
      }),
      expect.objectContaining({
        kind: 'arrow',
        route: expect.objectContaining({
          mode: 'curve',
          points: expect.any(Array),
        }),
        data: { sourceMarker: 'none', targetMarker: 'none' },
      }),
      expect.objectContaining({
        kind: 'arrow',
        route: { mode: 'straight' },
        data: { sourceMarker: 'none', targetMarker: 'arrow' },
      }),
    ]),
  );
  await expect(
    cells(page, 'arrow').nth(0).locator('[data-arrow-marker]'),
  ).toHaveCount(0);
  await expect(
    cells(page, 'arrow').nth(1).locator('[data-arrow-marker]'),
  ).toHaveCount(0);
  await expect(
    cells(page, 'arrow').nth(2).locator('[data-arrow-marker="target"]'),
  ).toHaveCount(1);
  await page.reload();
  await expect(cells(page, 'vector-line')).toHaveCount(1);
  await expect(cells(page, 'arrow')).toHaveCount(3);
  await expect(cells(page, 'arrow').locator('[data-arrow-marker]')).toHaveCount(
    1,
  );
});
