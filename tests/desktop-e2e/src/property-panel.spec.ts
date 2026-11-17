import {
  expectPropertyPopupAnchored,
  expectPropertyValue,
  propertySelectRoot,
  selectPropertyValue,
} from '../../helpers/property-select';
import { selectHistoryAction } from '../../web-e2e/src/app-actions';
import { electron, writeDesktopLauncher } from './desktop-launcher';
import {
  test,
  expect,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { committedCells, seedEmptyCanvas } from './workspace-disk';
import { openActiveFile, setAppLanguage } from '../../web-e2e/src/app-actions';
import { cellBodyPoint } from '../../helpers/port-controls';

test.use({ actionTimeout: 6000 });

const pane = (page: Page) => page.locator('.workspace-pane.is-active');
const canvas = (page: Page) =>
  pane(page).locator('svg[aria-label="Frame canvas"]');
const panel = (page: Page) => pane(page).locator('.frame-inspector');
const x = (page: Page) => panel(page).getByLabel('x', { exact: true });
async function ready(page: Page) {
  await expect(page.locator('.workspace-shell')).toBeVisible();
  await openActiveFile(page);
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
  await writeDesktopLauncher(launcher, userData);
  const env = { ...process.env };

  env.VERDBOARD_WORKSPACE_PATH = path.join(userData, 'workspaces', 'default');
  await seedEmptyCanvas(env.VERDBOARD_WORKSPACE_PATH);
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
    await selectHistoryAction(page, '撤销');
    await expect(x(page)).toHaveValue(original);
    await selectHistoryAction(page, '重做');
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
    const contextPoint = await cellBodyPoint(node);
    await page.mouse.click(contextPoint.x, contextPoint.y, { button: 'right' });
    const contextMenu = page.getByRole('menu', {
      name: '画布编辑',
      exact: true,
    });
    await expect(contextMenu.locator('input, select, textarea')).toHaveCount(0);
    const layers = contextMenu.getByRole('menuitem', {
      name: '图层',
      exact: true,
    });
    await layers.focus();
    await page.keyboard.press('ArrowRight');
    await expect(
      page
        .getByRole('menu', { name: '图层', exact: true })
        .getByRole('menuitem')
        .first(),
    ).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(layers).toBeFocused();
    await contextMenu
      .getByRole('menuitem', { name: '复制副本', exact: true })
      .click();
    await expect(node).toHaveCount(2);
    await expect(contextMenu).toHaveCount(0);
    await selectHistoryAction(page, '撤销');
    await expect(node).toHaveCount(1);
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

test('Desktop inspector dropdowns remain anchored after window movement, resize and zoom', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'verd-dropdown-e2e-'));
  const userData = path.join(directory, 'user-data');
  await mkdir(userData);
  const launcher = path.join(directory, 'launch.cjs');
  await writeDesktopLauncher(launcher, userData);
  const workspace = path.join(userData, 'workspaces', 'default');
  await seedEmptyCanvas(workspace);
  const desktop = await electron.launch({
    args: [launcher],
    env: { ...process.env, VERDBOARD_WORKSPACE_PATH: workspace },
  });
  try {
    const page = await desktop.firstWindow();
    await desktop.evaluate(({ BrowserWindow, screen }) => {
      const { x, y } = screen.getPrimaryDisplay().workArea;
      BrowserWindow.getAllWindows()[0].setBounds({
        x: x + 20,
        y: y + 30,
        width: 1200,
        height: 800,
      });
    });
    await ready(page);
    const theme = panel(page).getByLabel('Theme', { exact: true });
    const combo = propertySelectRoot(theme).getByRole('combobox');
    await expect(panel(page).locator('select')).toHaveCount(0);
    let popup = await expectPropertyPopupAnchored(theme);
    await desktop.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      const bounds = window.getBounds();
      window.setBounds({
        ...bounds,
        x: bounds.x + 40,
        y: bounds.y + 20,
        width: 1000,
        height: 720,
      });
      window.webContents.setZoomFactor(1.25);
    });
    await expectPropertyPopupAnchored(theme);
    await page.screenshot({
      path: test.info().outputPath('desktop-inspector-dropdown.png'),
    });
    await combo.press('Escape');
    await expect(popup).not.toBeVisible();
    await expect(combo).toBeFocused();
    await selectPropertyValue(theme, 'retro');
    await expectPropertyValue(theme, 'retro');
    await selectHistoryAction(page, '撤销');
    await expectPropertyValue(theme, 'default');
    await selectHistoryAction(page, '重做');
    await expectPropertyValue(theme, 'retro');
    popup = await expectPropertyPopupAnchored(theme);
    await page.getByTestId('inspector-collapse').click();
    await expect(popup).not.toBeVisible();
    await expect(pane(page).getByTestId('save-status')).toHaveAttribute(
      'data-save-state',
      'saved',
    );
    await page.getByTestId('inspector-expand').click();
    await page.reload();
    await expectPropertyValue(theme, 'retro');
    expect(
      await desktop.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
      ),
    ).toBe(1);
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
