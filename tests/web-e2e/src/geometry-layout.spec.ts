import { test, expect } from './service-fixture';
import {
  geometryFixture,
  exerciseJointLayout,
  assertPaintedGap,
} from '../../helpers/geometry-layout';
import { openActiveFile } from './app-actions';
import { clearWorkspaceStorage, persistedWorkspace } from './workspace-nav';

test('joint layout gives eight shared-port edges safe painted gaps and survives undo and reload', async ({
  page,
}) => {
  await page.goto('/');
  await openActiveFile(page);
  await expect(page.getByTestId('save-status')).toHaveAttribute(
    'data-save-state',
    'saved',
  );
  await page.evaluate(async (file) => {
    const records: [string, unknown][] = [];
    const saved = {
      put(value: unknown, key: string) {
        records.push([key, value]);
      },
    };
    const key = 'frames/geometry-fixture/current';
    saved.put({ ...file, version: 1 }, key);
    saved.put(
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
  }, geometryFixture());
  await clearWorkspaceStorage(page);
  await page.reload();
  await openActiveFile(page);
  const saved = async () =>
    Object.assign(
      {},
      ...Object.values((await persistedWorkspace(page))?.records ?? {}).map(
        (record: any) => record.cells,
      ),
    );
  const arranged = await exerciseJointLayout(page, saved);
  await page.reload();
  await openActiveFile(page);
  await expect(page.locator('[data-edge-hit]')).toHaveCount(8);
  expect(await saved()).toEqual(arranged);
  assertPaintedGap(await saved());
});
