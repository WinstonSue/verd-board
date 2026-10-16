import {
  _electron as electron,
  test,
  expect,
  type ElectronApplication,
} from '@playwright/test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setAppLanguage } from '../../web-e2e/src/app-actions';
import { fileWithCell } from './workspace-disk';

const root = path.resolve(__dirname, '../../..');
const topicIds = [
  'board/20:architecture-layered',
  'board/22:architecture-data-flow',
  'board/5:Ybbcn',
  'demo:workspace-load',
  'board/5:wfArc',
  'demo:save-close',
  'demo:import-export',
  'detached/25:mind/mind-mudf73s2-9hi9x8',
];

test('demo opens eight editable topics, returns to their shells, and restores an edit after restart', async ({
  browserName,
}, info) => {
  test.setTimeout(120_000);
  const directory = await mkdtemp(path.join(tmpdir(), 'verd-demo-e2e-'));
  let desktop: ElectronApplication | undefined;
  try {
    const userData = path.join(directory, 'user-data');
    await mkdir(userData);
    const storageFile = path.join(userData, 'verdboard-data.json');
    await writeFile(
      storageFile,
      await readFile(
        path.join(root, 'apps/desktop/verdboard-data.json'),
        'utf8',
      ),
    );
    const launcher = path.join(directory, 'launch.cjs');
    await writeFile(
      launcher,
      'const {app} = require("electron");\napp.setPath("userData", ' +
        JSON.stringify(userData) +
        ');\nrequire(' +
        JSON.stringify(path.join(root, 'apps/desktop/dist-electron/main.js')) +
        ');\n',
    );
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.VITE_DEV_SERVER_URL;
    const launch = async () => {
      desktop = await electron.launch({ args: [launcher], env });
      const page = await desktop.firstWindow();
      await desktop.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setSize(1600, 1100),
      );
      await expect(
        page.locator('svg[aria-label="Frame canvas"]'),
      ).toBeVisible();
      await setAppLanguage(page, 'zh');
      const skip = page.getByRole('button', { name: '跳过', exact: true });
      if (await skip.isVisible().catch(() => false)) await skip.click();
      return page;
    };
    const close = async () => {
      const page = await desktop!.firstWindow();
      const closed = page.waitForEvent('close');
      await desktop!.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].close(),
      );
      await closed;
      await desktop!.close();
      desktop = undefined;
    };
    let page = await launch();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const canvas = () => page.locator('svg[aria-label="Frame canvas"]');
    // The eight topic files migrate into frame-reference shells on the board.
    const refs = () => canvas().locator('[data-cell-kind="frame-reference"]');
    // The board file's tab is the first tab opened by first-launch migration.
    const boardTab = () => page.locator('ylib-tabs .tab').first();
    await expect(refs()).toHaveCount(8);
    await expect(canvas().locator('[data-cell-id="r:title"]')).toContainText(
      '青编 VerdBoard',
    );
    await page.screenshot({ path: info.outputPath('demo-overview.png') });
    const before = await readFile(storageFile, 'utf8');
    for (const [index, id] of topicIds.entries()) {
      const refId = `frame-ref:${id}`;
      await page.getByTestId('canvas-status-fit').click();
      const shell = canvas().locator(
        '[data-cell-id="' + refId + '"] > rect[data-frame-shell]',
      );
      await expect(shell).toBeVisible();
      await canvas()
        .locator('[data-frame-title-id="' + refId + '"] rect')
        .click();
      await page.getByTestId('frame-open').click();
      // frame-open mounts the reference's target file in its own tab.
      await expect(refs()).toHaveCount(0);
      await expect(canvas().locator('foreignObject').first()).toBeVisible();
      if (index === 2 || index === 7) {
        const clipped = await canvas()
          .locator('[data-cell-kind="mind-child"] foreignObject')
          .evaluateAll((objects) =>
            objects.flatMap((object) => {
              const text = object.querySelector('.board-text-content');
              if (!text) return [];
              const range = document.createRange();
              range.selectNodeContents(text);
              const glyphs = range.getBoundingClientRect();
              const box = object.getBoundingClientRect();
              return glyphs.left < box.left - 3 ||
                glyphs.right > box.right + 3 ||
                glyphs.top < box.top - 3 ||
                glyphs.bottom > box.bottom + 3
                ? [text.textContent]
                : [];
            }),
          );
        expect(clipped).toEqual([]);
      }
      await page.screenshot({
        path: info.outputPath('demo-topic-' + (index + 1) + '.png'),
      });
      await boardTab().click();
      await expect(refs()).toHaveCount(8);
      const shellBounds = (await shell.boundingBox())!;
      const viewport = (await canvas().boundingBox())!;

      expect(shellBounds.x + shellBounds.width / 2).toBeGreaterThan(viewport.x);
      expect(shellBounds.x + shellBounds.width / 2).toBeLessThan(
        viewport.x + viewport.width,
      );
      expect(shellBounds.y + shellBounds.height / 2).toBeGreaterThan(
        viewport.y,
      );
      expect(shellBounds.y + shellBounds.height / 2).toBeLessThan(
        viewport.y + viewport.height,
      );
      await expect(refs()).toHaveCount(8);
      if (index === 0) {
        const plate = canvas().locator(
          '[data-cell-id="' + refId + '"] [data-frame-content-plate]',
        );
        const box = (await plate.boundingBox())!;
        await plate.dblclick({
          position: { x: box.width - 4, y: box.height - 4 },
        });
        // Double-click on a reference opens its target file tab too.
        await expect(refs()).toHaveCount(0);
        await boardTab().click();
        await expect(refs()).toHaveCount(8);
      }
    }
    expect(await readFile(storageFile, 'utf8')).toBe(before);
    // Move one native homepage cell; close must flush its actual transaction.
    await page.getByTestId('canvas-status-fit').click();
    const title = canvas().locator('[data-cell-id="r:title"]');
    const bounds = (await title.boundingBox())!;
    await page.mouse.move(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      bounds.x + bounds.width / 2 + 24,
      bounds.y + bounds.height / 2 + 14,
      { steps: 6 },
    );
    await page.mouse.up();
    await close();
    const savedTitle = (await fileWithCell(userData, 'r:title'))!.cells[
      'r:title'
    ];
    const legacyBefore = JSON.parse(before);
    const legacyTitle =
      legacyBefore[
        legacyBefore.main_board_content.frames[
          legacyBefore.main_board_content.rootId
        ]
      ].cells['r:title'];
    expect(savedTitle.geometry).not.toEqual(legacyTitle.geometry);
    page = await launch();
    await expect(refs()).toHaveCount(8);
    await close();
    const restarted = (await fileWithCell(userData, 'r:title'))!.cells[
      'r:title'
    ];
    expect(restarted).toEqual(savedTitle);
    expect(errors).toEqual([]);
  } finally {
    await desktop?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
