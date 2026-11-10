import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from './service-fixture';
import { openActiveFile } from './app-actions';
import { clearWorkspaceStorage, persistedWorkspace } from './workspace-nav';
import {
  exercisePortInteractions,
  exerciseWorkflowEndpoints,
  exerciseWaypointRemoval,
  portCanvas,
  portFixture,
  waypointFixture,
} from './port-interactions';

for (const reverse of [false, true])
  test(`ports keep selection ownership and stable geometry (reverse=${reverse})`, async ({
    page,
  }) => {
    const saved = await openFixture(page, portFixture(reverse));
    if (reverse) {
      await page.getByTestId('canvas-zoom-out').click();
      await page.getByTestId('canvas-zoom-out').click();
    }
    await exercisePortInteractions(page, saved);
    await page.reload();
    await openActiveFile(page);
    await expect(portCanvas(page).locator('[data-edge-hit]')).toHaveCount(5);
    expect((await saved()).e2.target.cellId).toBe('d');
    expect((await saved()).e3.route.points).toHaveLength(4);
  });

async function openFixture(
  page: Page,
  fixture: ReturnType<typeof portFixture>,
) {
  await page.goto('/');
  await openActiveFile(page);
  await expect(page.getByTestId('save-status')).toHaveAttribute(
    'data-save-state',
    'saved',
  );
  await page.evaluate(async (file) => {
    const records: [string, unknown][] = [];
    const store = {
      put(value: unknown, key: string) {
        records.push([key, value]);
      },
    };
    const key = 'frames/port-fixture/current';
    store.put({ ...file, version: 1 }, key);
    store.put(
      {
        format: 'verd-workspace',
        version: 2,
        rootId: file.frame.id,
        frames: { [file.frame.id]: key },
        detachedFrameIds: [],
      },
      'main_board_content',
    );
    await (window as any).__verdSeedLegacy(records);
  }, fixture);
  await clearWorkspaceStorage(page);
  await page.reload();
  await openActiveFile(page);
  const saved = async () => {
    const cells = Object.assign(
      {},
      ...Object.values((await persistedWorkspace(page))?.records ?? {}).map(
        (record: any) => record.cells,
      ),
    );
    // Legacy fixtures are written to the native host on their first edit.
    return Object.keys(cells).length ? cells : fixture.cells;
  };

  return saved;
}

test('orthogonal U corners flatten and preserve bindings after reload', async ({
  page,
}) => {
  const saved = await openFixture(page, waypointFixture());
  await exerciseWaypointRemoval(page, saved);
  const flattened = await saved();
  await page.reload();
  await openActiveFile(page);
  await expect(
    portCanvas(page).locator('[data-edge-hit="bend"]'),
  ).toHaveAttribute('d', 'M150 440 L650 440');
  expect(await saved()).toEqual(flattened);
});

test('selected Workflow endpoints follow actual bindings and remain independent of viewport clipping', async ({
  page,
}) => {
  const fixture = JSON.parse(
    readFileSync(
      path.resolve(
        __dirname,
        '../../fixtures/diagrams/workflow-selected-endpoints.verd.json',
      ),
      'utf8',
    ),
  );
  const saved = await openFixture(page, fixture);
  await exerciseWorkflowEndpoints(page, saved);
  await portCanvas(page).screenshot({
    path: test.info().outputPath('workflow-ports.png'),
  });
});
