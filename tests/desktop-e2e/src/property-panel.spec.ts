import {
  _electron as electron,
  test,
  expect,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { committedCells } from './workspace-disk';
import { setAppLanguage } from '../../web-e2e/src/app-actions';

test.use({ actionTimeout: 6000 });

const root = path.resolve(__dirname, '../../..');
const pane = (page: Page) => page.locator('.workspace-pane.is-active');
const canvas = (page: Page) =>
  pane(page).locator('svg[aria-label="Frame canvas"]');
const panel = (page: Page) => pane(page).locator('.frame-inspector');
const x = (page: Page) => panel(page).getByLabel('x', { exact: true });
async function ready(page: Page) {
  await expect(canvas(page)).toBeVisible();
  await setAppLanguage(page, 'zh');
  const skip = page.getByRole('button', { name: '跳过', exact: true });
  if (await skip.isVisible()) await skip.click();
}
async function close(desktop: ElectronApplication, page: Page) {
  const closed = page.waitForEvent('close');
  await desktop.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].close(),
  );
  await closed;
  await desktop.close();
}

test('Desktop numeric inspector commits one history step, cancels locked drafts and persists after restart', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'verd-properties-e2e-'));
  const userData = path.join(directory, 'user-data');
  await mkdir(userData);
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
  let desktop = await electron.launch({ args: [launcher], env });
  try {
    let page = await desktop.firstWindow();
    await desktop.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1440, 900),
    );
    await ready(page);
    await pane(page).getByRole('button', { name: '形状', exact: true }).click();
    await page.getByTestId('shape-rectangle').click();
    const box = (await canvas(page).boundingBox())!;
    await page.mouse.click(box.x + 320, box.y + 240);
    const node = canvas(page).locator('[data-cell-kind="geometry"]');
    await expect(node).toHaveCount(1);
    await pane(page).getByRole('button', { name: '选择', exact: true }).click();
    await node.click();
    const original = await x(page).inputValue();
    await x(page).fill('123');
    await expect
      .poll(
        async () =>
          (await committedCells(userData)).find(
            (cell) => cell.kind === 'geometry',
          )?.geometry.x,
      )
      .toBe(Number(original));
    await x(page).press('Enter');
    await panel(page).getByTestId('inspector-name').focus();
    await pane(page).getByRole('button', { name: '撤销', exact: true }).click();
    await expect(x(page)).toHaveValue(original);
    await pane(page).getByRole('button', { name: '重做', exact: true }).click();
    await expect(x(page)).toHaveValue('123');
    await panel(page)
      .locator('[data-property-group="arrangement"] > button')
      .click();
    await panel(page)
      .getByRole('checkbox', { name: '锁定', exact: true })
      .check();
    await expect(x(page)).toBeDisabled();
    await panel(page)
      .getByRole('checkbox', { name: '锁定', exact: true })
      .uncheck();
    await x(page).fill('456');
    await x(page).press('Escape');
    await expect(x(page)).toHaveValue('123');
    await expect
      .poll(
        async () =>
          (await committedCells(userData)).find(
            (cell) => cell.kind === 'geometry',
          )?.geometry.x,
      )
      .toBe(123);
    await close(desktop, page);
    desktop = await electron.launch({ args: [launcher], env });
    page = await desktop.firstWindow();
    await ready(page);
    await canvas(page).locator('[data-cell-kind="geometry"]').click();
    await expect(x(page)).toHaveValue('123');
  } finally {
    await desktop
      .evaluate(({ BrowserWindow, app }) => {
        for (const window of BrowserWindow.getAllWindows()) window.destroy();
        app.exit(0);
      })
      .catch(() => undefined);
    await desktop.close().catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
});
