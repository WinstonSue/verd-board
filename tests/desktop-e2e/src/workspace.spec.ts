import {
  createFolder,
  directoryRow,
  folderAction,
  trashFolder,
} from '../../web-e2e/src/workspace-file-actions';
import {
  openSettings,
  openTrash,
  setAppLanguage,
} from '../../web-e2e/src/app-actions';
import {
  _electron as electron,
  test,
  expect,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { selectDrawingTool } from '../../web-e2e/src/drawing-tools';
import {
  canvasFiles as readCanvasFiles,
  committedCells as readCommittedCells,
  fileWithFrame as readFileWithFrame,
  workspaceDigest as readWorkspaceDigest,
} from './workspace-disk';

const root = path.resolve(__dirname, '../../..');
let directory: string;
let desktop: ElectronApplication | undefined;
let launcher: string;
let storageFile: string;
let userData: string;
const canvas = (page: Page) =>
  page.locator(
    '.workspace-pane.is-active svg[aria-label="Frame canvas"][data-surface="root"]',
  );
const cells = (page: Page, kind: string) =>
  canvas(page).locator(`[data-cell-kind="${kind}"]`);
const workspaceDir = () => path.join(userData, 'workspaces', 'default');
const canvasFiles = () => readCanvasFiles(userData);
const committedCells = () => readCommittedCells(userData);
const fileWithFrame = (frameId: string) => readFileWithFrame(userData, frameId);
const workspaceDigest = () => readWorkspaceDigest(userData);
const launch = async () => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VITE_DEV_SERVER_URL;
  // Legacy fixtures exercise the default migration path; ordinary lifecycle
  // tests request an isolated empty folder instead of the built-in content.
  const hasLegacy = await readFile(storageFile, 'utf8').then(
    (text) => text !== '{}',
    () => false,
  );
  if (!hasLegacy) env.VERDBOARD_WORKSPACE_PATH = workspaceDir();
  else delete env.VERDBOARD_WORKSPACE_PATH;
  desktop = await electron.launch({ args: [launcher], env });
  const page = await desktop.firstWindow();
  await expect(canvas(page)).toBeVisible();
  await setAppLanguage(page, 'zh');
  const skip = page.getByRole('button', { name: '跳过', exact: true });
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await expect(
    page.getByTestId('save-status').locator('visible=true'),
  ).toHaveAttribute('data-save-state', /^(saved|idle)$/);
  await expect
    .poll(async () => Object.keys(await canvasFiles()).length)
    .toBeGreaterThan(0);
  return page;
};
const closeWindow = async (page: Page) => {
  const closed = page.waitForEvent('close');
  await desktop!.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].close(),
  );
  await closed;
  await desktop!.close();
  desktop = undefined;
};

test('Desktop trashes complete folders, restores on disk and permanently deletes across restart', async () => {
  let page = await launch();
  await createFolder(page, '待归档');
  await createFolder(page, '空子目录', '待归档');
  await folderAction(page, '待归档', '在此新建画布');
  await expect
    .poll(async () =>
      Object.keys(await canvasFiles()).some((file) =>
        file.startsWith('待归档/'),
      ),
    )
    .toBe(true);
  await trashFolder(page, '待归档');
  await expect
    .poll(async () =>
      Object.keys(await canvasFiles()).some((file) =>
        file.startsWith('待归档/'),
      ),
    )
    .toBe(false);
  await closeWindow(page);
  page = await launch();
  await openTrash(page);
  await page.getByRole('button', { name: '还原 待归档', exact: true }).click();
  await page.getByTestId('workspace-settings-back').click();
  await expect(directoryRow(page, '空子目录')).toBeVisible();
  await expect
    .poll(async () =>
      Object.keys(await canvasFiles()).some((file) =>
        file.startsWith('待归档/'),
      ),
    )
    .toBe(true);
  await trashFolder(page, '待归档');
  await openTrash(page);
  await page.getByRole('button', { name: '清空回收站', exact: true }).click();
  await page
    .getByTestId('workspace-action-confirmation')
    .getByRole('button', { name: '确定', exact: true })
    .click();
  await expect(page.getByTestId('workspace-trash')).toContainText('回收站为空');
  await page.getByTestId('workspace-settings-back').click();
  await closeWindow(page);
  page = await launch();
  await openTrash(page);
  await expect(page.getByTestId('workspace-trash')).toContainText('回收站为空');
  await page.getByTestId('workspace-settings-back').click();
  await expect(directoryRow(page, '待归档')).toHaveCount(0);
  await closeWindow(page);
});

test('Desktop preserves embedded Mind placement without replacing the enclosing Frame geometry', async () => {
  const snapshot = JSON.parse(
    await readFile(
      path.join(root, 'tests/fixtures/diagrams/embedded-mind.json'),
      'utf8',
    ),
  );
  const records: Record<string, any> = {};
  const frames: Record<string, string> = {};
  for (const cell of Object.values(snapshot.store.cells) as any[]) {
    if (cell.cellType !== 'frame') continue;
    const key = `frames/${cell.id}/fixture`;
    frames[cell.id] = key;
    records[key] = {
      format: 'verd-frame',
      version: 1,
      frame: cell,
      cells: Object.fromEntries(
        [...cell.children, ...cell.groups]
          .filter((id) => snapshot.store.cells[id].cellType !== 'frame')
          .map((id) => [id, snapshot.store.cells[id]]),
      ),
    };
  }
  records.main_board_content = {
    format: 'verd-workspace',
    version: 2,
    rootId: snapshot.store.rootId,
    frames,
    detachedFrameIds: [],
  };
  await writeFile(storageFile, JSON.stringify(records));
  let page = await launch();
  const shape = () =>
    canvas(page).locator('[data-cell-id="first"] path').first();
  const bounds = (await shape().boundingBox())!;
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width / 2 + 35,
    bounds.y + bounds.height / 2 + 20,
    { steps: 6 },
  );
  await page.mouse.up();
  const expectedPath = await shape().getAttribute('d');
  await closeWindow(page);
  // The legacy manifest migrates: 'mind' becomes its own file and the board
  // keeps a frame-reference shell. Per-occurrence placement lives on the
  // shell's mindOffsets, the target file's cells are untouched.
  const board = await fileWithFrame('board');
  const mind = await fileWithFrame('mind');
  expect(board).toBeTruthy();
  expect(mind).toBeTruthy();
  const ref = Object.values(board.cells).find(
    (cell: any) => cell.kind === 'frame-reference',
  ) as any;
  expect(ref.data.targetFrameId).toBe('mind');
  expect(ref.data.mindOffsets.first[0]).toBeGreaterThan(0);
  expect(ref.geometry).toEqual(snapshot.store.cells.mind.geometry);
  expect(mind.frame).toEqual(snapshot.store.cells.mind);
  expect(mind.cells.first).toEqual(snapshot.store.cells.first);
  expect(mind.cells.second).toEqual(snapshot.store.cells.second);
  const digest = await workspaceDigest();
  page = await launch();
  await expect(shape()).toHaveAttribute('d', expectedPath!);
  await closeWindow(page);
  expect(await workspaceDigest()).toBe(digest);
});

test('Desktop preserves device interaction preferences across a restart without changing workspace data', async () => {
  let page = await launch();
  const before = await workspaceDigest();
  await openSettings(page);
  await page.getByTestId('settings-zoomSensitivity').press('Home');
  await page.getByTestId('settings-dragPanSpeed').press('End');
  await expect(page.getByTestId('settings-zoomSensitivity')).toHaveValue(
    '0.25',
  );
  await expect(page.getByTestId('settings-dragPanSpeed')).toHaveValue('3');

  await page.getByTestId('my-back').click();
  await closeWindow(page);
  expect(await workspaceDigest()).toBe(before);
  page = await launch();
  await openSettings(page);
  await expect(page.getByTestId('settings-zoomSensitivity')).toHaveValue(
    '0.25',
  );
  await expect(page.getByTestId('settings-dragPanSpeed')).toHaveValue('3');
});

test.beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'verd-desktop-e2e-'));
  userData = path.join(directory, 'user-data');
  await mkdir(userData);
  storageFile = path.join(userData, 'verdboard-data.json');
  launcher = path.join(directory, 'launch.cjs');
  await writeFile(
    launcher,
    `const {app} = require('electron');\napp.setPath('userData', ${JSON.stringify(userData)});\nrequire(${JSON.stringify(path.join(root, 'apps/desktop/dist-electron/main.js'))});\n`,
  );
});
test.afterEach(async () => {
  await desktop?.close();
  desktop = undefined;
  await rm(directory, { recursive: true, force: true });
});

test('production Desktop saves pending drawing and a focused mind note before close, then restores both on restart', async () => {
  let page = await launch();
  await page.getByRole('button', { name: '形状', exact: true }).click();
  await page.getByTestId('shape-rectangle').click();
  let box = (await canvas(page).boundingBox())!;
  await page.mouse.click(box.x + 180, box.y + 150);
  await expect(cells(page, 'geometry')).toHaveCount(1);
  await closeWindow(page);
  expect(
    (await committedCells()).filter((cell) => cell.kind === 'geometry'),
  ).toHaveLength(1);

  page = await launch();
  await expect(cells(page, 'geometry')).toHaveCount(1);
  await selectDrawingTool(page, '思维导图');
  box = (await canvas(page).boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.4);
  await expect(cells(page, 'frame-reference')).toHaveCount(1);
  await page.getByRole('button', { name: '选择', exact: true }).click();
  await expect(page.getByTestId('frame-open')).toBeVisible();
  await page.getByTestId('frame-open').click();
  // The reference opens its target file in a dedicated tab.
  await cells(page, 'mind-root').click();
  await canvas(page).press('Tab');
  await expect(cells(page, 'mind-child')).toHaveCount(1);
  await page.getByTitle('添加笔记').click();
  await page
    .getByRole('region', { name: 'Mind note' })
    .locator('[contenteditable="true"]')
    .fill('Final desktop keystroke');
  await closeWindow(page);
  expect(
    (await committedCells()).find((cell) => cell.kind === 'mind-child').data
      .note.plainText,
  ).toBe('Final desktop keystroke');

  page = await launch();
  // Restart restores the persisted tabs; activate the board file.
  await page
    .locator('.file-tree-name')
    .filter({ hasNotText: '思维导图' })
    .first()
    .click();
  await expect(cells(page, 'geometry')).toHaveCount(1);
  await cells(page, 'frame-reference')
    .locator(':scope > [data-frame-header] > rect')
    .first()
    .click({ position: { x: 12, y: 12 } });
  await page.getByTestId('frame-open').click();
  await expect(
    cells(page, 'mind-child').locator('[data-mind-note]'),
  ).toContainText('Final desktop keystroke');
});

test('production Desktop reports corrupt storage without replacing it with an empty workspace', async () => {
  const corrupt = '{ broken storage';
  await writeFile(storageFile, corrupt);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VITE_DEV_SERVER_URL;
  // Legacy fixtures exercise the default migration path; ordinary lifecycle
  // tests request an isolated empty folder instead of the built-in content.
  const hasLegacy = await readFile(storageFile, 'utf8').then(
    (text) => text !== '{}',
    () => false,
  );
  if (!hasLegacy) env.VERDBOARD_WORKSPACE_PATH = workspaceDir();
  else delete env.VERDBOARD_WORKSPACE_PATH;
  desktop = await electron.launch({ args: [launcher], env });
  const page = await desktop.firstWindow();
  await expect(page.getByRole('alert')).toContainText('Corrupt storage file');
  await expect(canvas(page)).toHaveCount(0);
  await page.getByRole('button', { name: '重新加载' }).click();
  await expect(page.getByRole('alert')).toContainText('Corrupt storage file');
  await closeWindow(page);
  expect(await readFile(storageFile, 'utf8')).toBe(corrupt);
  expect(await readFile(`${storageFile}.bak`, 'utf8')).toBe(corrupt);
});

test('Desktop surfaces an external file conflict and keep-local resolves it', async () => {
  const page = await launch();
  await page.getByRole('button', { name: '形状', exact: true }).click();
  await page.getByTestId('shape-rectangle').click();
  const box = (await canvas(page).boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await expect(cells(page, 'geometry')).toHaveCount(1);
  await expect(
    page.getByTestId('save-status').locator('visible=true'),
  ).toHaveAttribute('data-save-state', 'saved');
  // An external writer replaces the canvas file while the app holds local
  // edits: the conflict surfaces instead of a silent overwrite.
  const [boardPath] = Object.keys(await canvasFiles());
  const damaged = JSON.stringify({
    format: 'verd-frame',
    version: 2,
    frame: {
      id: 'external-edit',
      kind: 'frame',
      cellType: 'frame',
      geometry: { x: 0, y: 0, width: 9, height: 9 },
      children: [],
      groups: [],
    },
    cells: {},
  });
  await selectDrawingTool(page, '形状');
  await page.getByTestId('shape-rectangle').click();
  // Make the session dirty first, then let the external writer race its
  // pending conditional commit. A clean session would correctly adopt disk.
  await page.mouse.click(box.x + box.width * 0.65, box.y + box.height * 0.6);
  await expect(cells(page, 'geometry')).toHaveCount(2);
  await writeFile(path.join(workspaceDir(), boardPath), damaged);
  await expect
    .poll(async () => {
      const banner = await page
        .locator('.workspace-conflict-banner')
        .count()
        .catch(() => 0);
      const flagged = await page
        .locator('.file-tree-row.is-conflicted')
        .count()
        .catch(() => 0);
      return banner + flagged;
    })
    .toBeGreaterThan(0);
  // keep-local writes the session's version back over the external one.
  const keepLocal = page.getByRole('button', { name: /保留本地|Keep local/ });
  if (await keepLocal.isVisible().catch(() => false)) await keepLocal.click();
  await expect(
    page.getByTestId('save-status').locator('visible=true'),
  ).toHaveAttribute('data-save-state', 'saved');
  await closeWindow(page);
  const board = Object.values(await canvasFiles()).find((file) =>
    Object.values(file.cells ?? {}).some(
      (cell: any) => cell.kind === 'geometry',
    ),
  );
  expect(
    Object.values(board.cells).filter((cell: any) => cell.kind === 'geometry'),
  ).toHaveLength(2);
  const restarted = await launch();
  await expect(cells(restarted, 'geometry')).toHaveCount(2);
});

test('Desktop migrates a legacy file, preserves its backup and restarts without migrating again', async () => {
  const legacy = JSON.parse(
    await readFile(
      path.join(root, 'tests/fixtures/legacy/drawnix-v1.json'),
      'utf8',
    ),
  );
  await writeFile(storageFile, JSON.stringify({ main_board_content: legacy }));
  const page = await launch();
  await expect(cells(page, 'mind-child')).toContainText('Legacy topic');
  // Migration produced real workspace files; the legacy record keeps a backup.
  const files = await canvasFiles();
  expect(Object.keys(files).length).toBeGreaterThan(0);
  const mindFile = Object.values(files).find((file) =>
    Object.values(file.cells ?? {}).some(
      (cell: any) => cell.kind === 'mind-child',
    ),
  );
  expect(mindFile).toBeTruthy();
  const legacyRecord = JSON.parse(await readFile(storageFile, 'utf8'));
  expect(legacyRecord.legacy_workspace_backup.main_board_content).toEqual(
    legacy,
  );
  const digest = await workspaceDigest();
  await closeWindow(page);
  const restarted = await launch();
  await expect(cells(restarted, 'mind-child')).toContainText('Legacy topic');
  // Second launch reads workspace files; legacy storage is untouched.
  expect(await workspaceDigest()).toBe(digest);
});

test('Desktop camera navigation leaves a 156-cell workspace untouched and reopens fitted', async () => {
  const makeFrame = (id: string, children: string[], x = 0) => ({
    id,
    kind: 'frame',
    cellType: 'frame',
    geometry: { x, y: 0, width: 230, height: 200 },
    children,
    groups: [],
  });
  const ids = Array.from({ length: 5 }, (_, i) => `f${i}`);
  const rootFrame = makeFrame('root', ids);
  const frames: Record<string, string> = { root: 'frames/root/perf' };
  const record: Record<string, any> = {
    'frames/root/perf': {
      format: 'verd-frame',
      version: 1,
      frame: rootFrame,
      cells: {},
    },
  };
  for (const [index, id] of ids.entries()) {
    const cells = Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => {
        const cellId = `${id}-n${i}`;
        return [
          cellId,
          {
            id: cellId,
            kind: 'geometry',
            cellType: 'node',
            geometry: {
              x: (i % 5) * 42,
              y: Math.floor(i / 5) * 30,
              width: 32,
              height: 22,
              outline: 'rectangle',
            },
            content: { label: `${i}` },
          },
        ];
      }),
    );
    frames[id] = `frames/${id}/perf`;
    record[frames[id]] = {
      format: 'verd-frame',
      version: 1,
      frame: makeFrame(id, Object.keys(cells), index * 260),
      cells,
    };
  }
  record.main_board_content = {
    format: 'verd-workspace',
    version: 2,
    rootId: 'root',
    frames,
    detachedFrameIds: [],
  };
  await writeFile(storageFile, JSON.stringify(record));
  const page = await launch(),
    errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await expect(cells(page, 'geometry')).toHaveCount(150);
  const initial = await canvas(page)
    .locator(':scope > [data-frame-world]')
    .getAttribute('transform');
  const before = await workspaceDigest();
  const undoWasDisabled = await page
    .getByRole('button', { name: '撤销', exact: true })
    .isDisabled();
  const tasks: number[] = [];
  await page.evaluate(() => {
    (window as any).cameraLongTasks = [];
    new PerformanceObserver((list) =>
      (window as any).cameraLongTasks.push(
        ...list.getEntries().map((entry) => entry.duration),
      ),
    ).observe({ type: 'longtask', buffered: false });
  });
  const box = (await canvas(page).boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.6);
  const start = Date.now();
  await page.keyboard.down('Control');
  for (let i = 0; i < 60; i++) await page.mouse.wheel(0, i % 2 ? 20 : -20);
  await page.keyboard.up('Control');
  await page.getByRole('button', { name: '手型', exact: true }).click();
  await page.mouse.move(box.x + 400, box.y + 350);
  await page.mouse.down();
  await page.mouse.move(box.x + 560, box.y + 400, { steps: 100 });
  await page.mouse.up();
  const elapsed = Date.now() - start;
  tasks.push(...(await page.evaluate(() => (window as any).cameraLongTasks)));
  expect(
    await page.getByRole('button', { name: '撤销', exact: true }).isDisabled(),
  ).toBe(undoWasDisabled);
  await expect.poll(async () => await workspaceDigest()).toBe(before);
  console.log(
    JSON.stringify({
      cameraPerformance: {
        cells: 156,
        wheelEvents: 60,
        pointerMoves: 100,
        elapsedMs: elapsed,
        longTasks: tasks.length,
        longestTaskMs: Math.max(0, ...tasks),
      },
    }),
  );
  await closeWindow(page);
  expect(await workspaceDigest()).toBe(before);
  const reopened = await launch();
  await expect(
    canvas(reopened).locator(':scope > [data-frame-world]'),
  ).toHaveAttribute('transform', initial!);
  expect(errors).toEqual([]);
});

test('Desktop previews real shapes and curves, cancels drafts and persists only completed cells', async () => {
  let page = await launch();
  await selectDrawingTool(page, '形状');
  await page.getByTestId('shape-ellipse').click();
  let box = (await canvas(page).boundingBox())!;
  await page.mouse.move(box.x + 320, box.y + 170);
  await page.mouse.down();
  await page.mouse.move(box.x + 530, box.y + 300, { steps: 10 });
  const draft = canvas(page).locator('[data-drawing-preview="true"]');
  await expect(draft).toBeVisible();
  await expect(cells(page, 'geometry')).toHaveCount(0);
  const id = await draft
    .locator('[data-draft-cell-id]')
    .first()
    .getAttribute('data-draft-cell-id');
  const contour = await draft
    .locator('path')
    .evaluateAll((paths) => paths.map((path) => path.getAttribute('d')));
  await page.mouse.up();
  await expect(draft).toHaveCount(0);
  expect(
    await canvas(page)
      .locator(`[data-cell-id="${id}"] path`)
      .evaluateAll((paths) =>
        paths
          .filter((path) => !path.closest('[data-selection-handles]'))
          .map((path) => path.getAttribute('d')),
      ),
  ).toEqual(contour);

  await selectDrawingTool(page, '曲线');
  await page.mouse.move(box.x + 320, box.y + 430);
  await page.mouse.down();
  await page.mouse.move(box.x + 560, box.y + 430, { steps: 10 });
  await expect(draft).toBeVisible();
  await expect(draft.locator('path').first()).toHaveAttribute('d', / C/);
  await expect(draft.locator('[data-arrow-marker]')).toHaveCount(0);
  await page.mouse.up();
  await expect(cells(page, 'arrow')).toHaveCount(1);

  await selectDrawingTool(page, '形状');
  await page.getByTestId('shape-rectangle').click();
  await page.mouse.move(box.x + 600, box.y + 170);
  await page.mouse.down();
  await page.mouse.move(box.x + 800, box.y + 300, { steps: 8 });
  await expect(draft).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(cells(page, 'geometry')).toHaveCount(1);
  await expect(draft).toHaveCount(0);
  await closeWindow(page);
  const saved = await committedCells();
  expect(saved.filter((cell) => cell.kind === 'geometry')).toHaveLength(1);
  expect(saved.find((cell) => cell.kind === 'arrow').route.points).toHaveLength(
    3,
  );
  page = await launch();
  await expect(cells(page, 'geometry')).toHaveCount(1);
  await expect(cells(page, 'arrow')).toHaveCount(1);
  await expect(cells(page, 'arrow').locator('path').first()).toHaveAttribute(
    'd',
    / C/,
  );
});
