import { editBody } from './body-editor';
import { test, expect, type Page } from '@playwright/test';
import { selectDrawingTool } from './drawing-tools';
import {
  activateBoardTab,
  backToPreviousCanvas,
  persistedWorkspace,
} from './workspace-nav';
import { expandPropertyGroup } from './property-group';

type Workspace = 'board' | 'mind' | 'workflow' | 'architecture';
const pane = (page: Page, workspace: Workspace = 'board') =>
  page.locator(`.verd-frame[data-testid="verd-${workspace}"]:visible`);
const canvas = (page: Page) =>
  page.locator('svg[aria-label="Frame canvas"][data-surface="root"]:visible');
const cells = (page: Page, kind: string) =>
  canvas(page).locator(
    kind === 'frame'
      ? '[data-cell-kind="frame"],[data-cell-kind="frame-reference"]'
      : `[data-cell-kind="${kind}"]`,
  );
const board = (page: Page) => pane(page);
const stored = persistedWorkspace;
const savedCells = async (page: Page) =>
  Object.values((await stored(page))?.records ?? {}).flatMap(
    (record: any) => Object.values(record.cells) as any[],
  );
const savedKind = async (page: Page, kind: string) =>
  (await savedCells(page)).filter((cell) => cell.kind === kind);
const createAt = async (page: Page, tool: string, x = 0.28, y = 0.32) => {
  await selectDrawingTool(page, tool);
  if (tool === '形状') await page.getByTestId('shape-rectangle').click();
  const box = (await canvas(page).boundingBox())!;
  await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
  await page.getByRole('button', { name: '选择', exact: true }).click();
};
const selectFrame = async (page: Page, index = 0) => {
  // The embedded preview paints over the frame body, so the shell's only
  // always-clickable chrome is the title strip.
  await cells(page, 'frame')
    .nth(index)
    .locator('[data-frame-title-id]')
    .click({ position: { x: 24, y: 12 }, force: true });
  await expect(pane(page).getByTestId('frame-open')).toBeVisible();
};
const openFrame = async (
  page: Page,
  workspace: Exclude<Workspace, 'board'>,
  index = 0,
) => {
  await selectFrame(page, index);
  await pane(page).getByTestId('frame-open').click();
  await expect(pane(page, workspace)).toBeVisible();
};
const newWorkflow = async (page: Page) => {
  await createAt(page, '流程图');
  await openFrame(page, 'workflow');
};
const addMindChild = async (page: Page) => {
  await cells(page, 'mind-root').first().click();
  await canvas(page).press('Tab');
};
const zoomLabel = (page: Page, workspace: Workspace) =>
  pane(page, workspace).getByTestId('canvas-zoom-label');
const zoomBy = async (page: Page, workspace: Workspace, count: number) => {
  for (let index = 0; index < count; index++)
    await pane(page, workspace).getByTestId('canvas-zoom-in').click();
  await expect(zoomLabel(page, workspace)).toHaveText(`${100 + count * 10}%`);
};

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(board(page)).toBeVisible();
});

test('loads the web whiteboard', async ({ page }) => {
  await expect(page).toHaveTitle('青编');
  await expect(page.locator('[data-runtime="cells"]')).toBeVisible();
});

test('creates a mind node and restores it after reload', async ({ page }) => {
  await createAt(page, '思维导图');
  await expect(cells(page, 'mind-root')).toHaveCount(1);
  await expect
    .poll(async () => (await savedKind(page, 'mind-root')).length)
    .toBe(1);
  await page.reload();
  await expect(board(page)).toBeVisible();
  await expect(cells(page, 'mind-root')).toHaveCount(1);
});

test('edits names in the header and keeps them after reload', async ({
  page,
}) => {
  await createAt(page, '思维导图');
  // Embedded previews are inert — inner cells are edited inside the frame's
  // own detail view, which shares the same persisted file.
  await openFrame(page, 'mind');
  const mindPane = pane(page, 'mind');
  await cells(page, 'mind-root').click();
  const header = mindPane.locator('.frame-inspector__header');
  const label = mindPane.getByTestId('inspector-name');
  await expect(header.locator('[data-testid="inspector-name"]')).toBeVisible();
  const originalName = await label.inputValue();
  await label.fill('新的中心主题名称');
  await mindPane.getByTestId('save-status').click();
  await expect(label).toHaveValue('新的中心主题名称');
  await expect(mindPane.getByTestId('save-status')).toHaveAttribute(
    'data-save-state',
    'saved',
  );
  await expect(mindPane.getByTestId('save-status')).toHaveAttribute(
    'title',
    /最后一次成功保存/,
  );
  await mindPane.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(label).toHaveValue(originalName!);
  await mindPane.getByRole('button', { name: '重做', exact: true }).click();
  await expect(label).toHaveValue('新的中心主题名称');
  await expect(mindPane.getByTestId('save-status')).toHaveAttribute(
    'data-save-state',
    'saved',
  );
  await page.reload();
  // The workspace session restores the last-active tab — the mind detail
  // view reopens directly.
  await expect(pane(page, 'mind')).toBeVisible();
  await cells(page, 'mind-root').click();
  await expect(pane(page, 'mind').getByTestId('inspector-name')).toHaveValue(
    '新的中心主题名称',
  );
});

test('keeps a long header name and save status within a narrow viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 844 });
  await createAt(page, '形状', 0.65, 0.35);
  await cells(page, 'geometry').click();
  await page
    .getByTestId('inspector-name')
    .fill('这是一个保持单行的很长的对象名称用于验证属性面板顶部的显示效果');
  await page.getByTestId('save-status').click();
  await expect(page.getByTestId('save-status')).toHaveAttribute(
    'data-save-state',
    'saved',
  );
  const header = page.locator('.frame-inspector__header');
  expect(
    await header.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  const toolbar = (await page.locator('.frame-app-toolbar').boundingBox())!;
  expect(toolbar.x + toolbar.width).toBeLessThanOrEqual(500);
  await page.screenshot({ path: '/tmp/verd-frame-narrow.png' });
});

test('uses a 1px default Frame content border and honors explicit no stroke', async ({
  page,
}) => {
  await createAt(page, '思维导图');
  await selectFrame(page);
  await expect(page.getByLabel('Stroke width', { exact: true })).toHaveValue(
    '1',
  );
  await expect(page.getByLabel('描边', { exact: true })).toHaveValue('#cbd5e1');
  await canvas(page).press('Escape');
  const plate = cells(page, 'frame').locator('[data-frame-outline]');
  await expect(plate).toHaveAttribute('stroke-width', '1');
  await expect(plate).toHaveAttribute('stroke', '#cbd5e1');
  await selectFrame(page);
  await page.getByRole('button', { name: '无描边', exact: true }).click();
  await canvas(page).press('Escape');
  await expect(plate).toHaveAttribute('stroke', 'none');
});

test('a restored workspace renders a clean save status without stale timestamps', async ({
  page,
}) => {
  await page.reload();
  await expect(board(page)).toBeVisible();
  const status = page.getByTestId('save-status');
  await expect(status).toHaveAttribute('data-save-state', /idle|saved/);
  await expect(status).not.toHaveAttribute('title', /./);
});

test('keeps the previous save time visible after a save failure on a narrow screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 844 });
  const status = page.getByTestId('save-status');
  await createAt(page, '形状', 0.5, 0.3);
  await expect(status).toHaveAttribute('data-save-state', 'saved');
  const savedTime = ((await status.textContent()) ?? '').split('·')[1]?.trim();
  expect(savedTime).toBeTruthy();
  await page.evaluate(() => {
    const state = window as unknown as { failedCommit?: boolean };
    const openTransaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (
      ...args: Parameters<typeof openTransaction>
    ) {
      const stores = args[0];
      if (
        !state.failedCommit &&
        this.name === 'verdboard-host' &&
        Array.isArray(stores) &&
        stores.includes('receipts')
      ) {
        state.failedCommit = true;
        throw new DOMException('disk full', 'QuotaExceededError');
      }
      return openTransaction.apply(this, args);
    } as typeof IDBDatabase.prototype.transaction;
  });
  await createAt(page, '形状', 0.65, 0.35);
  await expect(status).toHaveAttribute('data-save-state', 'error');
  await expect(status).toContainText(savedTime!);
  await expect
    .poll(async () => {
      const toolbar = (await page.locator('.frame-app-toolbar').boundingBox())!;
      const tools = (await page.locator('.frame-tools').boundingBox())!;
      return toolbar.y + toolbar.height <= tools.y;
    })
    .toBe(true);
  // A transient failure replays the same commit on the next flush and recovers.
  await createAt(page, '形状', 0.8, 0.5);
  await expect
    .poll(() => status.getAttribute('data-save-state'), { timeout: 20000 })
    .toBe('saved');
});

test('opens a board mind in exclusive edit and writes children back', async ({
  page,
}) => {
  await createAt(page, '思维导图');
  await openFrame(page, 'mind');
  await addMindChild(page);
  await expect(cells(page, 'mind-child')).toHaveCount(1);
  await backToPreviousCanvas(page);
  await expect(board(page)).toBeVisible();
  await expect(cells(page, 'mind-child')).toHaveCount(1);
  await expect
    .poll(async () => {
      const data = await stored(page);
      return [
        data?.records[data.manifest.rootId].frame.children.length,
        Object.keys(data?.manifest.frames ?? {}).length,
        (await savedKind(page, 'mind-child')).length,
      ];
    })
    .toEqual([1, 2, 1]);
});

test('switches theme scheme and restores it after reload', async ({ page }) => {
  await page.getByLabel('Theme', { exact: true }).selectOption('dark');
  await expect(canvas(page)).toHaveCSS('background-color', 'rgb(20, 20, 20)');
  await expect
    .poll(async () => {
      const data = await stored(page);
      return data?.records[data.manifest.rootId]?.frame.view?.theme
        ?.themeColorMode;
    })
    .toBe('dark');
  await page.reload();
  await expect(page.getByLabel('Theme', { exact: true })).toHaveValue('dark');
  await expect(canvas(page)).toHaveCSS('background-color', 'rgb(20, 20, 20)');
});

test('draws and erases freehand without page errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('button', { name: '画笔', exact: true }).click();
  const box = (await canvas(page).boundingBox())!;
  const draw = async () => {
    await page.mouse.move(box.x + 240, box.y + 170);
    await page.mouse.down();
    await page.mouse.move(box.x + 460, box.y + 290, { steps: 16 });
    await page.mouse.up();
  };
  await draw();
  await expect(cells(page, 'freehand')).toHaveCount(1);
  await page.getByRole('button', { name: '橡皮擦', exact: true }).click();
  await draw();
  await expect(cells(page, 'freehand')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('shows node config on a mind node and frame config on the shell', async ({
  page,
}) => {
  await createAt(page, '思维导图');
  // Embedded previews are inert — node editing happens in the detail view.
  await openFrame(page, 'mind');
  const mindPane = pane(page, 'mind');
  await cells(page, 'mind-root').click();
  await expect(
    mindPane.getByRole('toolbar', { name: 'Mind tree layout' }),
  ).toBeVisible();
  await expect(mindPane.getByTitle('添加笔记')).toBeVisible();
  await expect(
    mindPane.getByRole('heading', { name: /Central topic/ }),
  ).toBeVisible();
  await backToPreviousCanvas(page);
  await selectFrame(page);
  await expect(
    pane(page).getByRole('toolbar', { name: 'Mind tree layout' }),
  ).toHaveCount(0);
  await expect(pane(page).getByTitle('添加笔记')).toHaveCount(0);
});

test('starts on the board and hides top-level workspace tabs', async ({
  page,
}) => {
  for (const workspace of ['board', 'mind', 'workflow'])
    await expect(page.getByTestId(`workspace-${workspace}`)).toHaveCount(0);
});

test('opens a workflow component, adds a task, and restores it after reload', async ({
  page,
}) => {
  await newWorkflow(page);
  await pane(page, 'workflow').getByTestId('palette-task').click();
  await expect(cells(page, 'workflow-task')).toHaveCount(1);
  await expect
    .poll(async () => (await savedKind(page, 'workflow-task')).length)
    .toBe(1);
  await page.reload();
  await activateBoardTab(page);
  await openFrame(page, 'workflow');
  await expect(cells(page, 'workflow-task')).toHaveCount(1);
});

test('edits workflow node properties and restores them after reload', async ({
  page,
}) => {
  await newWorkflow(page);
  await pane(page, 'workflow').getByTestId('palette-task').click();
  await cells(page, 'workflow-task').click();
  await expect(
    pane(page, 'workflow').getByTestId('inspector-name'),
  ).toHaveValue('Task');
  await editBody(page, 'Build');
  await expect
    .poll(
      async () => (await savedKind(page, 'workflow-task'))[0]?.content.label,
    )
    .toBe('Build');
  await page.reload();
  await activateBoardTab(page);
  await openFrame(page, 'workflow');
  await cells(page, 'workflow-task').click();
  await expect(
    pane(page, 'workflow').getByTestId('inspector-name'),
  ).toHaveValue('Task');
});

test('renders flowchart shapes, directional ports, and viewport controls', async ({
  page,
}) => {
  await newWorkflow(page);
  await pane(page, 'workflow').getByTestId('palette-task').click();
  await pane(page, 'workflow').getByTestId('palette-decision').click();
  for (const [kind, shape, ports] of [
    ['workflow-start', 'terminal', 4],
    ['workflow-task', 'roundRectangle', 4],
    ['workflow-decision', 'diamond', 4],
  ] as const) {
    await expect(cells(page, kind)).toHaveAttribute('data-node-shape', shape);
    await cells(page, kind).hover();
    await expect(cells(page, kind).locator('[data-port-id]')).toHaveCount(
      ports,
    );
    await expect(
      cells(page, kind).locator('[data-shape-part]').first(),
    ).toBeVisible();
  }
  await expect(
    pane(page, 'workflow').getByTestId('canvas-status-bar'),
  ).toBeVisible();
  await expect
    .poll(async () =>
      (await savedKind(page, 'workflow-start'))[0]?.ports.map(
        (port: any) => port.direction,
      ),
    )
    .toEqual(['output', 'output', 'output', 'output']);
  await expect(
    pane(page, 'workflow').getByTestId('canvas-status-fit'),
  ).toBeVisible();
});

test('keeps board and workflow documents isolated', async ({ page }) => {
  await createAt(page, '思维导图', 0.12, 0.2);
  await expect
    .poll(async () => (await savedKind(page, 'mind-root')).length)
    .toBe(1);
  await createAt(page, '流程图', 0.6, 0.55);
  await openFrame(page, 'workflow', 1);
  await expect(board(page)).toHaveCount(0);
  await expect(cells(page, 'mind-root')).toHaveCount(0);
  await pane(page, 'workflow').getByTestId('palette-decision').click();
  await expect
    .poll(async () => (await savedKind(page, 'workflow-decision')).length)
    .toBe(1);
  await backToPreviousCanvas(page);
  await expect(board(page)).toBeVisible();
  await expect(cells(page, 'mind-root')).toHaveCount(1);
  await expect(cells(page, 'workflow-decision')).toHaveCount(1);
});

test('opens a board mind in exclusive edit from the living component', async ({
  page,
}) => {
  await createAt(page, '思维导图');
  await openFrame(page, 'mind');
  await cells(page, 'mind-root').click();
  await canvas(page).press('Tab');
  await expect(cells(page, 'mind-child')).toHaveCount(1);
  await addMindChild(page);
  await backToPreviousCanvas(page);
  await expect(cells(page, 'mind-child')).toHaveCount(2);
  await expect(cells(page, 'mind-branch')).toHaveCount(2);
});

test('persists workflow graph mode after reload', async ({ page }) => {
  await newWorkflow(page);
  await cells(page, 'workflow-start').click();
  await expect(page.getByTestId('workflow-graph-mode')).toHaveValue('dag');
  await page.getByTestId('workflow-graph-mode').selectOption('process');
  await expect
    .poll(
      async () => (await savedKind(page, 'workflow-start'))[0]?.data.graphMode,
    )
    .toBe('process');
  await page.reload();
  await activateBoardTab(page);
  await openFrame(page, 'workflow');
  await cells(page, 'workflow-start').click();
  await expect(
    pane(page, 'workflow').getByTestId('workflow-graph-mode'),
  ).toHaveValue('process');
});

test('inserts a workflow component, renames a node, and opens exclusive edit', async ({
  page,
}) => {
  await createAt(page, '流程图');
  const start = cells(page, 'workflow-start');
  // Embedded previews are inert — node editing happens in the detail view.
  await start.click({ force: true });
  await expect(start.locator('[contenteditable="true"]')).toHaveCount(0);
  await openFrame(page, 'workflow');
  await start.click();
  await expect(
    pane(page, 'workflow').getByTestId('inspector-name'),
  ).toHaveValue('Start');
  await expect(start.locator('[contenteditable="true"]')).toHaveCount(0);
  await start.dblclick();
  await start.locator('[contenteditable="true"]').fill('Kickoff2');
  await page.keyboard.press('Enter');
  await backToPreviousCanvas(page);
  await expect(start).toContainText('Kickoff2');
  await expect
    .poll(
      async () => (await savedKind(page, 'workflow-start'))[0]?.content.label,
    )
    .toBe('Kickoff2');
});

for (const [workspace, tool] of [
  ['mind', '思维导图'],
  ['workflow', '流程图'],
] as const) {
  test(`fits ${workspace} on entry and preserves each tab's camera`, async ({
    page,
  }) => {
    await createAt(page, tool, 0.12, 0.2);
    await createAt(page, tool, 0.6, 0.55);
    await expect(cells(page, 'frame')).toHaveCount(2);
    await zoomBy(page, 'board', 1);
    const boardZoom = (await zoomLabel(page, 'board').textContent())!;
    await openFrame(page, workspace, 0);
    await expect(zoomLabel(page, workspace)).toHaveText('100%');
    await zoomBy(page, workspace, 1);
    // Tabs keep their own view state — returning restores the board camera,
    // and reopening the detail tab restores its camera too.
    await backToPreviousCanvas(page);
    await expect(zoomLabel(page, 'board')).toHaveText(boardZoom);
    await openFrame(page, workspace, 0);
    await expect(zoomLabel(page, workspace)).toHaveText('110%');
    await backToPreviousCanvas(page);
    await openFrame(page, workspace, 1);
    await expect(zoomLabel(page, workspace)).toHaveText('100%');
  });
}

test('opens an architecture frame and focuses its shell on return', async ({
  page,
}) => {
  await createAt(page, '架构图');
  await expect(cells(page, 'architecture-layer')).toHaveCount(1);
  await zoomBy(page, 'board', 1);
  await openFrame(page, 'architecture');
  await expect(
    pane(page, 'architecture').getByTestId('canvas-status-bar'),
  ).toBeVisible();
  await expect(
    pane(page, 'architecture').getByRole('button', {
      name: '文本',
      exact: true,
    }),
  ).toHaveCount(0);
  await backToPreviousCanvas(page);
  // The board tab keeps its own camera across tab switches.
  await expect(zoomLabel(page, 'board')).toHaveText('110%');
  await expect(cells(page, 'frame')).toHaveCount(1);
  await expect(cells(page, 'architecture-layer')).toHaveCount(1);
  await expect(canvas(page).locator('[board-data-id]')).toHaveCount(0);
});

test('workflow auto layout restores manual positions and keeps another graph isolated through undo and refresh', async ({
  page,
}) => {
  await page.goto('/');
  await newWorkflow(page);
  const workflowPane = pane(page, 'workflow');
  await workflowPane.getByTestId('palette-task').click();
  const task = cells(page, 'workflow-task');
  const taskId = (await task.getAttribute('data-cell-id'))!;
  await workflowPane
    .getByRole('button', { name: '适配画布', exact: true })
    .click();
  const box = (await task.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 100,
    box.y + box.height / 2 + 70,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect
    .poll(
      async () => (await savedKind(page, 'workflow-task'))[0]?.geometry.derived,
    )
    .toBe(false);
  const manual = (await savedKind(page, 'workflow-task'))[0].geometry;
  await workflowPane
    .getByRole('button', { name: '添加流程图', exact: true })
    .click();
  await expect(cells(page, 'workflow-start')).toHaveCount(2);
  await expect
    .poll(async () => (await savedKind(page, 'workflow-start')).length)
    .toBe(2);
  const otherId = (await cells(page, 'workflow-start')
    .nth(1)
    .getAttribute('data-cell-id'))!;
  const other = (await savedKind(page, 'workflow-start')).find(
    (cell) => cell.id === otherId,
  );
  await task.click();
  await cells(page, 'workflow-start')
    .first()
    .click({ modifiers: ['Shift'] });
  await workflowPane.getByTestId('workflow-auto-layout').click();
  await expect
    .poll(async () => (await savedKind(page, 'workflow-task'))[0]?.geometry)
    .not.toEqual(manual);
  const layout = (await savedKind(page, 'workflow-task'))[0].geometry;
  expect(
    (await savedKind(page, 'workflow-start')).find(
      (cell) => cell.id === otherId,
    ),
  ).toEqual(other);
  await workflowPane.getByRole('button', { name: '撤销', exact: true }).click();
  await expect
    .poll(async () => (await savedKind(page, 'workflow-task'))[0]?.geometry)
    .toEqual(manual);
  await workflowPane.getByRole('button', { name: '重做', exact: true }).click();
  await expect
    .poll(async () => (await savedKind(page, 'workflow-task'))[0]?.geometry)
    .toEqual(layout);
  await page.reload();
  await activateBoardTab(page);
  await openFrame(page, 'workflow');
  await expect(cells(page, 'workflow-start')).toHaveCount(2);
  await expect(task).toHaveAttribute('data-cell-id', taskId);
  expect((await savedKind(page, 'workflow-task'))[0].geometry).toEqual(layout);
});

test('architecture layer sorting and module ownership changes survive undo, cascade deletion and refresh', async ({
  page,
}) => {
  await page.goto('/');
  await createAt(page, '架构图');
  await openFrame(page, 'architecture');
  const archPane = pane(page, 'architecture');
  await archPane.getByRole('button', { name: '模块', exact: true }).click();
  const module = cells(page, 'architecture-module');
  const moduleId = (await module.getAttribute('data-cell-id'))!;
  const firstId = (await cells(page, 'architecture-layer')
    .first()
    .getAttribute('data-cell-id'))!;
  await archPane.getByRole('button', { name: '添加层', exact: true }).click();
  await expect(cells(page, 'architecture-layer')).toHaveCount(2);
  const secondId = (await cells(page, 'architecture-layer')
    .filter({ has: page.locator('path') })
    .evaluateAll(
      (elements, sourceId) =>
        elements
          .find((element) => element.getAttribute('data-cell-id') !== sourceId)!
          .getAttribute('data-cell-id'),
      firstId,
    ))!;
  await module.click();
  await expect(
    archPane.getByLabel('Architecture layer', { exact: true }),
  ).toHaveValue(firstId);
  await archPane
    .getByLabel('Architecture layer', { exact: true })
    .selectOption(secondId);
  await expect
    .poll(
      async () =>
        (await savedKind(page, 'architecture-layer')).find(
          (cell) => cell.id === secondId,
        )?.data.memberIds,
    )
    .toEqual([moduleId]);
  await archPane.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(
    archPane.getByLabel('Architecture layer', { exact: true }),
  ).toHaveValue(firstId);
  await archPane.getByRole('button', { name: '重做', exact: true }).click();
  await expect(
    archPane.getByLabel('Architecture layer', { exact: true }),
  ).toHaveValue(secondId);
  await archPane.getByRole('button', { name: '适配画布', exact: true }).click();
  const layer = canvas(page).locator(`[data-cell-id="${secondId}"]`);
  await layer.click({ position: { x: 15, y: 15 } });
  await expandPropertyGroup(archPane);
  await archPane
    .getByRole('button', { name: 'Move layer up', exact: true })
    .click();
  await expect
    .poll(async () =>
      (await savedKind(page, 'architecture-layer'))
        .sort((a, b) => a.data.order.localeCompare(b.data.order))
        .map((cell) => cell.id),
    )
    .toEqual([secondId, firstId]);
  await archPane
    .getByRole('complementary')
    .getByRole('button', { name: '删除', exact: true })
    .click();
  await expect(module).toHaveCount(0);
  await archPane.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(module).toHaveCount(1);
  await expect
    .poll(async () => (await savedKind(page, 'architecture-module')).length)
    .toBe(1);
  await page.reload();
  await activateBoardTab(page);
  await openFrame(page, 'architecture');
  await expect(module).toHaveCount(1);
  await module.click();
  await expect(
    archPane.getByLabel('Architecture layer', { exact: true }),
  ).toHaveValue(secondId);
});

test('workflow start coordinate properties move its graph origin and fixed members in one undo step', async ({
  page,
}) => {
  await page.goto('/');
  await newWorkflow(page);
  const workflowPane = pane(page, 'workflow');
  await workflowPane.getByTestId('palette-task').click();
  const task = cells(page, 'workflow-task');
  await task.click();
  await workflowPane.getByLabel('x', { exact: true }).fill('300');
  await workflowPane.getByLabel('x', { exact: true }).press('Enter');
  await workflowPane.getByLabel('y', { exact: true }).fill('200');
  await workflowPane.getByLabel('y', { exact: true }).press('Enter');
  await expect
    .poll(async () => (await savedKind(page, 'workflow-task'))[0]?.geometry)
    .toMatchObject({ x: 300, y: 200, derived: false });
  await cells(page, 'workflow-start').click();
  await workflowPane.getByLabel('x', { exact: true }).fill('140');
  await workflowPane.getByLabel('x', { exact: true }).press('Enter');
  await expect
    .poll(async () => (await savedKind(page, 'workflow-start'))[0]?.data.origin)
    .toEqual([140, 80]);
  await expect
    .poll(async () => (await savedKind(page, 'workflow-task'))[0]?.geometry)
    .toMatchObject({ x: 400, y: 200 });
  await workflowPane.getByRole('button', { name: '撤销', exact: true }).click();
  await expect
    .poll(async () => (await savedKind(page, 'workflow-task'))[0]?.geometry)
    .toMatchObject({ x: 300, y: 200 });
  await expect
    .poll(async () => (await savedKind(page, 'workflow-start'))[0]?.data.origin)
    .toEqual([40, 80]);
});
