import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';

const dir = path.resolve(__dirname, '../../../doc/examples/ai-canvas');
// Each open tab mounts its own VerdFrame; only the active tab is visible.
const canvas = (page: Page) =>
  page.locator('svg[aria-label="Frame canvas"][data-surface="root"]:visible');
const cells = (page: Page, kind: string) =>
  canvas(page).locator(
    kind === 'frame'
      ? '[data-cell-kind="frame"],[data-cell-kind="frame-reference"]'
      : `[data-cell-kind="${kind}"]`,
  );
const fileRow = (page: Page, name: string) =>
  page.locator('.file-tree-name', { hasText: name });
const workspaceImport = (page: Page, file: string) =>
  page
    .locator('input[accept=".json,.verd.json,.verd-doc.json,.md,.markdown"]')
    .setInputFiles(path.join(dir, file));
// The active tab pane; hidden inputs live inside it.
const activeHost = (page: Page) => page.locator('.workspace-pane.is-active');
const canvasInput = (page: Page, index: 0 | 1, file: string) =>
  activeHost(page)
    .locator('input[accept="application/json,.md,.markdown,.mmd,.mermaid"]')
    .nth(index)
    .setInputFiles(path.join(dir, file));
// nth(0) is「导入」(insert into the frame), nth(1) is「打开」(replace the frame).
const canvasImport = (page: Page, file: string) => canvasInput(page, 0, file);
const canvasOpen = (page: Page, file: string) => canvasInput(page, 1, file);

test.describe('ai-canvas examples through the documented import paths', () => {
  test('FrameFileV2 examples import via the file tree and render', async ({
    page,
  }) => {
    await page.goto('/');
    const cases: [string, string, string[], [string, number]][] = [
      [
        'whiteboard-basic.verd.json',
        '基础白板',
        ['geometry', 'arrow'],
        ['geometry', 4],
      ],
      [
        'whiteboard-advanced.verd.json',
        '进阶白板',
        ['image', 'table', 'swimlane', 'freehand', 'vector-line', 'geometry'],
        ['table', 1],
      ],
      [
        'mind-map.verd.json',
        '思维导图',
        ['mind-root', 'mind-child', 'mind-summary', 'mind-branch'],
        ['mind-root', 1],
      ],
      [
        'workflow-dag.verd.json',
        'DAG 流程',
        [
          'workflow-start',
          'workflow-task',
          'workflow-decision',
          'workflow-edge',
        ],
        ['workflow-start', 1],
      ],
      [
        'workflow-process.verd.json',
        '流程(允许回环)',
        [
          'workflow-start',
          'workflow-task',
          'workflow-decision',
          'workflow-edge',
        ],
        ['workflow-decision', 1],
      ],
      [
        'architecture.verd.json',
        '分层架构',
        ['architecture-layer', 'architecture-module', 'architecture-edge'],
        ['architecture-layer', 3],
      ],
    ];
    for (const [file, name, kinds, count] of cases) {
      await workspaceImport(page, file);
      await fileRow(page, name).click();
      for (const kind of kinds)
        await expect(cells(page, kind).first()).toBeVisible();
      await expect(cells(page, count[0])).toHaveCount(count[1]);
    }
  });

  test('bundle imports both canvases and resolves the frame reference', async ({
    page,
  }) => {
    await page.goto('/');
    await workspaceImport(page, 'bundle-multi-canvas.verd.json');
    await expect(fileRow(page, '总览')).toBeVisible();
    await expect(fileRow(page, '订单详情')).toBeVisible();
    await fileRow(page, '总览').click();
    await expect(cells(page, 'frame-reference')).toHaveCount(1);
    await fileRow(page, '订单详情').click();
    await expect(cells(page, 'geometry')).toHaveCount(3);
    await expect(cells(page, 'arrow')).toHaveCount(1);
  });

  test('FrameSnapshot opens on a canvas with the nested frame preserved', async ({
    page,
  }) => {
    await page.goto('/');
    await workspaceImport(page, 'whiteboard-basic.verd.json');
    await fileRow(page, '基础白板').click();
    await canvasOpen(page, 'snapshot-nested-frames.frame.json');
    // The root frame draws no shell; only the nested frame renders one.
    await expect(cells(page, 'frame')).toHaveCount(1);
    await expect(cells(page, 'geometry')).toHaveCount(4);
    await expect(cells(page, 'arrow')).toHaveCount(1);
  });

  test('markdown opens as a mind frame through the canvas menu', async ({
    page,
  }) => {
    await page.goto('/');
    await canvasOpen(page, 'mind-map.md');
    await expect(cells(page, 'mind-root')).toHaveCount(1);
    await expect(cells(page, 'mind-child').first()).toBeVisible();
    await expect(cells(page, 'mind-branch').first()).toBeVisible();
  });

  // Canvas「打开」replaces content and cannot delete a workflow start, so the
  // mermaid workflow example goes through「导入」(insert), which appends a
  // second graph;「打开」works on the architecture scene where anchors match by kind.
  test('mermaid imports workflow cells and opens architecture cells on matching scenes', async ({
    page,
  }) => {
    await page.goto('/');
    await workspaceImport(page, 'workflow-dag.verd.json');
    await fileRow(page, 'DAG 流程').click();
    await canvasImport(page, 'workflow-dag.mmd');
    // The imported mermaid graph joins the existing one as a second start.
    await expect(cells(page, 'workflow-start')).toHaveCount(2);
    await expect(cells(page, 'workflow-task')).toHaveCount(7);
    await expect(cells(page, 'workflow-decision')).toHaveCount(2);
    await expect(cells(page, 'workflow-edge')).toHaveCount(10);

    await workspaceImport(page, 'architecture.verd.json');
    await fileRow(page, '分层架构').click();
    await canvasOpen(page, 'architecture.mmd');
    await expect(cells(page, 'architecture-layer')).toHaveCount(3);
    await expect(cells(page, 'architecture-module')).toHaveCount(4);
    await expect(cells(page, 'architecture-edge')).toHaveCount(3);
    // Open replaces content: the authored layer ids are remapped away.
    await expect(
      canvas(page).locator('[data-cell-id="layer-access"]'),
    ).toHaveCount(0);
  });

  test('imported canvases persist across reload', async ({ page }) => {
    await page.goto('/');
    await workspaceImport(page, 'whiteboard-basic.verd.json');
    await expect(fileRow(page, '基础白板')).toBeVisible();
    await expect(activeHost(page).getByTestId('save-status')).toHaveAttribute(
      'data-save-state',
      'saved',
    );
    await page.reload();
    await fileRow(page, '基础白板').click();
    await expect(cells(page, 'geometry')).toHaveCount(4);
    await expect(cells(page, 'arrow')).toHaveCount(2);
  });
});
