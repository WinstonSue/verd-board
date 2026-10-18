import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  FrameCell,
  FrameSnapshot,
} from '../../../packages/engine/core/src/cell/types';
import { selectDrawingTool } from './drawing-tools';
import {
  clearWorkspaceStorage,
  persistedWorkspace,
  waitForWorkspacePersisted,
} from './workspace-nav';

test.use({ actionTimeout: 6000 });

const canvasSelector =
  'svg[aria-label="Frame canvas"][data-surface="root"]:visible';
const editorCanvas = (page: Page) =>
  page.locator('.workspace-pane.is-active').locator(canvasSelector);
const mode = (page: Page) => page.getByTestId('presentation-mode');
const lectureCanvas = (page: Page) => mode(page).locator(canvasSelector);
const world = (canvas: Locator) => canvas.locator('> [data-frame-world]');
const geometries = (canvas: Locator) =>
  canvas.locator('[data-cell-kind="geometry"]');
const action = (page: Page, name: string) =>
  page.locator('.frame-app-toolbar:visible').getByRole('button', {
    name,
    exact: true,
  });

async function ready(page: Page) {
  await expect(editorCanvas(page)).toBeVisible();
  const skip = page.getByRole('button', { name: '跳过', exact: true });
  if (await skip.isVisible()) await skip.click();
}

async function camera(canvas: Locator) {
  return (await world(canvas).getAttribute('transform'))!
    .match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/g)!
    .map(Number);
}

async function settledCamera(canvas: Locator) {
  // Camera fits animate with rAF; sample only after successive painted frames
  // agree, rather than sleeping for a particular animation duration.
  await world(canvas).evaluate(async (element) => {
    let previous = element.getAttribute('transform');
    let stable = 0;
    while (stable < 3) {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      const current = element.getAttribute('transform');
      stable = current === previous ? stable + 1 : 0;
      previous = current;
    }
  });
  return camera(canvas);
}

async function expectCamera(canvas: Locator, expected: number[]) {
  await expect
    .poll(() => camera(canvas))
    .toEqual(expected.map((value) => expect.closeTo(value, 2)));
}

// Use a real hit inside the rendered node, clear of ports and name labels.
async function pointIn(cell: Locator) {
  return cell.evaluate((element) => {
    const box = element.getBoundingClientRect();
    for (let y = box.top + 8; y < box.bottom - 8; y += 8)
      for (let x = box.left + 8; x < box.right - 8; x += 8) {
        const hit = document.elementFromPoint(x, y);
        if (
          hit &&
          hit.closest('[data-cell-id]') === element &&
          !hit.closest(
            '[data-port-id], [data-selection-handles], [data-mind-fold]',
          )
        )
          return { x, y };
      }
    throw new Error(
      `No visible hit point for ${element.getAttribute('data-cell-id')}`,
    );
  });
}

async function clickBlank(page: Page) {
  const point = await lectureCanvas(page).evaluate((svg) => {
    const box = svg.getBoundingClientRect();
    for (const y of [0.03, 0.15, 0.85])
      for (const x of [0.03, 0.97, 0.5]) {
        const clientX = box.left + box.width * x;
        const clientY = box.top + box.height * y;
        const hit = document.elementFromPoint(clientX, clientY);
        if (
          hit &&
          svg.contains(hit) &&
          !hit.closest('[data-cell-id], [data-frame-title-id]')
        )
          return { x: clientX, y: clientY };
      }
    throw new Error('No blank lecture canvas point');
  });
  await page.mouse.click(point.x, point.y);
}

async function expectLecture(page: Page, structural = false) {
  await expect(mode(page)).toBeVisible();
  await expect(lectureCanvas(page)).toBeVisible();
  await expect(page.getByTestId('presentation-hud')).toBeVisible();
  await expect
    .poll(() =>
      mode(page).evaluate((overlay) => {
        const buttons = [
          ...document.querySelectorAll(
            '.workspace-pane.is-active .frame-app-toolbar button',
          ),
        ];
        return (
          buttons.length > 0 &&
          buttons.every((button) => {
            const box = button.getBoundingClientRect();
            const hit = document.elementFromPoint(
              box.left + box.width / 2,
              box.top + box.height / 2,
            );
            return !!hit && overlay.contains(hit);
          })
        );
      }),
    )
    .toBe(true);
  await expect(mode(page).locator('[contenteditable="true"]')).toHaveCount(0);
  await expect(
    lectureCanvas(page).locator('[data-selection-handles]'),
  ).toHaveCount(0);
  const hud = page.getByTestId('presentation-hud');
  for (const name of ['总览', '激光笔', '退出'])
    await expect(hud.getByRole('button', { name, exact: true })).toBeVisible();
  if (structural)
    await expect(page.getByTestId('presentation-step')).toBeVisible();
  else {
    await expect(page.getByTestId('presentation-step')).toHaveCount(0);
    for (const name of ['上一步', '下一步'])
      await expect(hud.getByRole('button', { name, exact: true })).toHaveCount(
        0,
      );
  }
  await expect(page.locator('.presentation-panel')).toHaveCount(0);
}

test('refused fullscreen still lectures read-only, focuses on click and restores editor state and history', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Element.prototype.requestFullscreen = function () {
      document.documentElement.dataset.fullscreenRequests = String(
        Number(document.documentElement.dataset.fullscreenRequests ?? 0) + 1,
      );
      return Promise.reject(
        new DOMException('Fullscreen refused', 'NotAllowedError'),
      );
    };
  });
  await page.goto('/');
  await ready(page);
  const bounds = (await editorCanvas(page).boundingBox())!;
  for (const [x, y] of [
    [0.25, 0.35],
    [0.7, 0.55],
    [0.5, 0.7],
  ]) {
    await selectDrawingTool(page, '形状');
    await page.getByTestId('shape-rectangle').click();
    await page.mouse.click(
      bounds.x + bounds.width * x,
      bounds.y + bounds.height * y,
    );
  }
  await expect(geometries(editorCanvas(page))).toHaveCount(3);
  // Leave both undo and redo populated before entering the lecture.
  await action(page, '撤销').click();
  await expect(geometries(editorCanvas(page))).toHaveCount(2);
  await selectDrawingTool(page, '选择');
  const selectedId = (await geometries(editorCanvas(page))
    .first()
    .getAttribute('data-cell-id'))!;
  const selected = editorCanvas(page).locator(`[data-cell-id="${selectedId}"]`);
  const selectedPoint = await pointIn(selected);
  await page.mouse.click(selectedPoint.x, selectedPoint.y);
  const inspector = page.locator('.frame-inspector:visible');
  await expect(inspector).toHaveAttribute('data-selected-cell-id', selectedId);
  await selectDrawingTool(page, '手型');
  await page.getByTestId('canvas-zoom-in').locator('visible=true').click();
  await expect(
    page.getByTestId('save-status').locator('visible=true'),
  ).toHaveAttribute('data-save-state', 'saved');
  await expect
    .poll(
      async () =>
        Object.values((await persistedWorkspace(page))?.records ?? {}).flatMap(
          (record) =>
            Object.values(record.cells).filter(
              (cell: any) => cell.kind === 'geometry',
            ),
        ).length,
    )
    .toBe(2);
  const before = await persistedWorkspace(page);
  const editorCamera = await camera(editorCanvas(page));
  const selection = await editorCanvas(page)
    .locator('[data-selection-handles]')
    .count();
  expect(selection).toBeGreaterThan(0);
  await editorCanvas(page).evaluate((svg) =>
    svg.setAttribute('data-lecture-editor-instance', 'original'),
  );

  await action(page, '演示').click();
  await expectLecture(page);
  await expect(page.locator('html')).toHaveAttribute(
    'data-fullscreen-requests',
    '1',
  );
  expect(await page.evaluate(() => document.fullscreenElement === null)).toBe(
    true,
  );
  const fallbackBounds = await mode(page).evaluate((element) => {
    const box = element.getBoundingClientRect();
    const pane = element.closest('.verd-frame')!.getBoundingClientRect();
    return [
      box.left - pane.left,
      box.top - pane.top,
      box.width - pane.width,
      box.height - pane.height,
    ];
  });

  const overview = await settledCamera(lectureCanvas(page));
  const target = lectureCanvas(page).locator(`[data-cell-id="${selectedId}"]`);
  const point = await pointIn(target);
  await page.mouse.click(point.x, point.y);
  await expect.poll(() => camera(lectureCanvas(page))).not.toEqual(overview);
  await clickBlank(page);
  await expectCamera(lectureCanvas(page), overview);
  await page.keyboard.press('l');
  await expect(mode(page)).toHaveClass(/\bis-laser\b/);
  await expect(
    page
      .getByTestId('presentation-hud')
      .getByRole('button', { name: '激光笔', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.move(point.x, point.y);
  await page.keyboard.press('l');
  await expect(mode(page)).not.toHaveClass(/\bis-laser\b/);
  await expect(
    page
      .getByTestId('presentation-hud')
      .getByRole('button', { name: '激光笔', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false');

  const dragPoint = await pointIn(target);
  await page.mouse.move(dragPoint.x, dragPoint.y);
  await page.mouse.down();
  await page.mouse.move(dragPoint.x + 80, dragPoint.y + 45, { steps: 5 });
  await page.mouse.up();
  await clickBlank(page);
  // Double-click and common editing/clipboard/history shortcuts must neither
  // edit the lecture nor reach the still-mounted editor underneath it.
  const doublePoint = await pointIn(target);
  await page.mouse.dblclick(doublePoint.x, doublePoint.y);
  for (const key of [
    'Enter',
    'Tab',
    'Delete',
    'Backspace',
    'v',
    'h',
    'r',
    't',
    'ControlOrMeta+a',
    'ControlOrMeta+x',
    'ControlOrMeta+v',
    'ControlOrMeta+z',
    'ControlOrMeta+Shift+z',
  ]) {
    await page.keyboard.press(key);
  }
  await lectureCanvas(page).evaluate((svg) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData(
      'text/plain',
      'Must not be inserted during a lecture',
    );
    svg.dispatchEvent(
      new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData,
      }),
    );
  });
  await expectLecture(page);
  await expect(geometries(lectureCanvas(page))).toHaveCount(2);

  await page.keyboard.press('Escape');
  await expect(mode(page)).toHaveCount(0);
  await expect(page.getByTestId('presentation-hud')).toHaveCount(0);
  await expect(editorCanvas(page)).toHaveAttribute(
    'data-lecture-editor-instance',
    'original',
  );
  await expectCamera(editorCanvas(page), editorCamera);
  await expect(
    editorCanvas(page).locator('[data-selection-handles]'),
  ).toHaveCount(selection);
  await expect(inspector).toHaveAttribute('data-selected-cell-id', selectedId);
  await expect(
    page
      .getByRole('toolbar', { name: 'Drawing tools' })
      .getByRole('button', { name: '手型', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.getByTestId('save-status').locator('visible=true'),
  ).toHaveAttribute('data-save-state', 'saved');
  expect((await persistedWorkspace(page))?.records).toEqual(before?.records);
  // Redo still inserts the third shape; undo then reaches the original edits.
  await action(page, '重做').click();
  await expect(geometries(editorCanvas(page))).toHaveCount(3);
  await action(page, '撤销').click();
  await expect(geometries(editorCanvas(page))).toHaveCount(2);
  await action(page, '撤销').click();
  await expect(geometries(editorCanvas(page))).toHaveCount(1);
  expect(fallbackBounds, 'CSS fallback covers the current pane').toEqual(
    [0, 0, 0, 0].map((value) => expect.closeTo(value, 0)),
  );
});

async function seedMultiRootMind(page: Page) {
  const snapshot: FrameSnapshot = JSON.parse(
    readFileSync(
      path.resolve(__dirname, '../../fixtures/diagrams/embedded-mind.json'),
      'utf8',
    ),
  );
  await page.goto('/');
  await ready(page);
  await waitForWorkspacePersisted(page);
  // Match the existing diagram fixture seeding path so IDs survive migration.
  await page.evaluate(async (snapshot) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('VerdBoard');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('verdboard_store', 'readwrite');
      const saved = transaction.objectStore('verdboard_store');
      saved.clear();
      const frames: Record<string, string> = {};
      for (const cell of Object.values(snapshot.store.cells)) {
        if (cell.cellType !== 'frame') continue;
        const frame = cell as FrameCell;
        const key = `frames/${frame.id}/fixture`;
        frames[frame.id] = key;
        const cells = Object.fromEntries(
          [...frame.children, ...frame.groups]
            .filter((id) => snapshot.store.cells[id]?.cellType !== 'frame')
            .map((id) => [id, snapshot.store.cells[id]]),
        );
        saved.put({ format: 'verd-frame', version: 1, frame, cells }, key);
      }
      saved.put(
        {
          format: 'verd-workspace',
          version: 2,
          rootId: snapshot.store.rootId,
          frames,
          detachedFrameIds: [],
        },
        'main_board_content',
      );
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  }, snapshot);
  await clearWorkspaceStorage(page);
  await page.reload();
  await ready(page);
}

test('one Escape leaves native fullscreen and restores the editor', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const events: unknown[] = [];
    (window as any).lectureFullscreenEvents = events;
    const record = (event: string, detail?: unknown) => {
      events.push({
        event,
        detail,
        at: performance.now(),
        owner: document.fullscreenElement?.getAttribute('class') ?? null,
      });
    };
    document.addEventListener('fullscreenchange', () =>
      record('fullscreenchange'),
    );
    document.addEventListener('fullscreenerror', () =>
      record('fullscreenerror'),
    );
    const request = Element.prototype.requestFullscreen;
    Element.prototype.requestFullscreen = function (options) {
      record('requestFullscreen', this.getAttribute('class'));
      return request.call(this, options).then(
        () => record('request resolved'),
        (error) => {
          record('request rejected', {
            name: error.name,
            message: error.message,
          });
          throw error;
        },
      );
    };
    const exit = Document.prototype.exitFullscreen;
    Document.prototype.exitFullscreen = function () {
      record('exitFullscreen', new Error().stack);
      return exit.call(this).then(
        () => record('exit resolved'),
        (error) => {
          record('exit rejected', { name: error.name, message: error.message });
          throw error;
        },
      );
    };
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await ready(page);
  await selectDrawingTool(page, '形状');
  await page.getByTestId('shape-rectangle').click();
  const box = (await editorCanvas(page).boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.45);
  await expect(geometries(editorCanvas(page))).toHaveCount(1);
  const originalCamera = await settledCamera(editorCanvas(page));
  try {
    await action(page, '演示').click();
    await expectLecture(page);
    await expect
      .poll(() =>
        mode(page).evaluate(
          (element) => !!document.fullscreenElement?.contains(element),
        ),
      )
      .toBe(true);
    await page.keyboard.press('Escape');
    await expect(mode(page)).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => document.fullscreenElement === null))
      .toBe(true);
    await expectCamera(editorCanvas(page), originalCamera);
  } finally {
    const diagnostics = test.info().outputPath('fullscreen-events.json');
    await writeFile(
      diagnostics,
      JSON.stringify(
        {
          errors,
          events: await page.evaluate(
            () => (window as any).lectureFullscreenEvents,
          ),
        },
        null,
        2,
      ),
    );
    await test.info().attach('fullscreen-events', {
      path: diagnostics,
      contentType: 'application/json',
    });
  }
});

test('fullscreen uses the active second tab and steps through the branches of every mind root', async ({
  page,
}) => {
  await seedMultiRootMind(page);
  await editorCanvas(page)
    .locator('[data-cell-id="frame-ref:mind"] [data-frame-title-id]')
    .click();
  await page.getByTestId('frame-open').locator('visible=true').click();
  const tabs = page.getByRole('tab');
  await expect(tabs).toHaveCount(2);
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(
    editorCanvas(page).locator('[data-cell-kind="mind-root"]'),
  ).toHaveCount(2);
  const editorCamera = await camera(editorCanvas(page));
  await action(page, '演示').click();
  await expectLecture(page, true);
  await expect
    .poll(() =>
      mode(page).evaluate(
        (element) => !!document.fullscreenElement?.contains(element),
      ),
    )
    .toBe(true);
  await expect(
    lectureCanvas(page).locator('[data-cell-kind="mind-root"]'),
  ).toHaveCount(2);
  const overview = await settledCamera(lectureCanvas(page));
  const hud = page.getByTestId('presentation-hud');
  await page.screenshot({ path: test.info().outputPath('lecture.png') });
  const index = page.getByTestId('presentation-step');
  await expect(index).toHaveText('总览');
  await expect(
    hud.getByRole('button', { name: '上一步', exact: true }),
  ).toBeDisabled();
  const steps = [
    'first-child-0',
    'first-child-1',
    'second-child-0',
    'second-child-1',
  ];
  const fits: Record<string, number[]> = {};
  // Clicking each subtree independently gives the expected fit for keyboard
  // navigation without coupling the test to viewport size or fit constants.
  for (const id of ['first', 'second', ...steps]) {
    const point = await pointIn(
      lectureCanvas(page).locator(`[data-cell-id="${id}"]`),
    );
    await page.mouse.click(point.x, point.y);
    await expect.poll(() => camera(lectureCanvas(page))).not.toEqual(overview);
    fits[id] = await settledCamera(lectureCanvas(page));
    await clickBlank(page);
    await expectCamera(lectureCanvas(page), overview);
  }
  const focused = steps.map((id) => fits[id]);
  for (const [at, expected] of focused.entries()) {
    await page.keyboard.press('ArrowRight');
    await expect(index).toHaveText(`${at + 1} / ${steps.length}`);
    await expectCamera(lectureCanvas(page), expected);
  }
  await expect(
    hud.getByRole('button', { name: '下一步', exact: true }),
  ).toBeDisabled();
  await page.keyboard.press('ArrowRight');
  await expectCamera(lectureCanvas(page), focused.at(-1)!);
  await page.keyboard.press('Home');
  await expectCamera(lectureCanvas(page), overview);
  await page.keyboard.press('ArrowLeft');
  await expectCamera(lectureCanvas(page), overview);
  await hud.getByRole('button', { name: '下一步', exact: true }).click();
  await expect(index).toHaveText(`1 / ${steps.length}`);
  await expectCamera(lectureCanvas(page), focused[0]);
  await hud.getByRole('button', { name: '上一步', exact: true }).click();
  await expect(index).toHaveText('总览');
  await expectCamera(lectureCanvas(page), overview);
  for (let at = 0; at < steps.length; at++) {
    await page.keyboard.press('ArrowRight');
    await expect(index).toHaveText(`${at + 1} / ${steps.length}`);
  }
  await expectCamera(lectureCanvas(page), focused.at(-1)!);
  await page.keyboard.press('ArrowLeft');
  await expectCamera(lectureCanvas(page), focused.at(-2)!);
  // One Esc must leave both fullscreen and the lecture, even on a non-first tab.
  await page.keyboard.press('Escape');
  await expect(mode(page)).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement === null))
    .toBe(true);
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expectCamera(editorCanvas(page), editorCamera);
});
