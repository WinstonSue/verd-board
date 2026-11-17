import { expect, type Page } from '@playwright/test';
import { createCellRuntime } from '../../packages/engine/core/src/cell/runtime';
import type {
  Cell,
  EdgeCell,
  FrameCell,
} from '../../packages/engine/core/src/cell/types';
import {
  addMindChild,
  createMindChildCell,
  createMindFrameSnapshot,
  createMindSummary,
} from '../../packages/engine/mind/src/cell-commands';
import type { MindSummaryData } from '../../packages/engine/mind/src/types';
import { createTestCellRegistry } from '../fixtures/plugins/registry';
import { selectHistoryAction } from '../web-e2e/src/app-actions';
import { cellBodyPoint } from './port-controls';

export function mindSummaryFixture() {
  const runtime = createCellRuntime(
    createMindFrameSnapshot('summary-frame', 'summary-root'),
    createTestCellRegistry(),
  );
  for (const id of ['topic-a', 'topic-b', 'topic-c'])
    runtime.transact({
      id,
      operations: addMindChild(
        runtime.store,
        'summary-root',
        { ...createMindChildCell(id), content: { label: id } },
        `branch-${id}`,
      ),
    });
  runtime.transact({
    id: 'summary',
    operations: createMindSummary(
      runtime.store,
      'summary-root',
      'topic-a',
      'topic-c',
      'summary-title',
      'summary-range',
    ),
  });
  return {
    format: 'verd-frame' as const,
    version: 2 as const,
    frame: runtime.store.cells['summary-frame'] as FrameCell,
    cells: Object.fromEntries(
      Object.entries(runtime.store.cells).filter(
        ([id]) => id !== 'summary-frame',
      ),
    ),
  };
}

export async function exerciseMindSummaryRange(
  page: Page,
  readCells: () => Promise<Record<string, Cell>>,
) {
  const canvas = page.locator(
    '.workspace-pane.is-active svg[aria-label="Frame canvas"][data-surface="root"]',
  );
  const start = async () =>
    (await readCells())['summary-range'] as EdgeCell<MindSummaryData>;
  await expect
    .poll(async () => (await start()).data!.startSiblingId)
    .toBe('topic-a');
  const summary = canvas.locator('[data-cell-id="summary-title"]');
  const point = await cellBodyPoint(summary);
  await page.mouse.click(point.x, point.y);
  const handle = canvas.locator('[data-summary-handle="start"]');
  await expect(handle).toBeVisible();
  const from = (await handle.boundingBox())!;
  const target = (await canvas
    .locator('[data-cell-id="topic-b"]')
    .boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    target.x + target.width / 2,
    target.y + target.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect
    .poll(async () => (await start()).data!.startSiblingId)
    .toBe('topic-b');
  await selectHistoryAction(page, '撤销');
  await expect
    .poll(async () => (await start()).data!.startSiblingId)
    .toBe('topic-a');
  await selectHistoryAction(page, '重做');
  await expect
    .poll(async () => (await start()).data!.startSiblingId)
    .toBe('topic-b');
}
