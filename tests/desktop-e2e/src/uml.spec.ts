import { electron, writeDesktopLauncher } from './desktop-launcher';
import {
  test,
  expect,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createUmlDiagram,
  importUmlText,
  umlCanvas,
} from '../../web-e2e/src/uml-actions';
import { openActiveFile, setAppLanguage } from '../../web-e2e/src/app-actions';
import { committedCells, seedEmptyCanvas } from './workspace-disk';
test('Desktop UML domains persist editable class members and structured sequence events across restart', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'verd-uml-e2e-')),
    userData = path.join(directory, 'user-data');
  await mkdir(userData);
  const launcher = path.join(directory, 'launch.cjs');
  await writeDesktopLauncher(launcher, userData);
  const env = { ...process.env };

  env.VERDBOARD_WORKSPACE_PATH = path.join(userData, 'workspaces', 'default');
  await seedEmptyCanvas(env.VERDBOARD_WORKSPACE_PATH);
  let desktop = await electron.launch({ args: [launcher], env });
  const close = async (app: ElectronApplication, page: Page) => {
    const closed = page.waitForEvent('close');
    await app
      .evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
      .catch((error: unknown) => {
        // A completed close may dispose the context before its reply arrives.
        if (!String(error).includes('Execution context was destroyed'))
          throw error;
      });
    await closed;
    await app.close();
  };
  try {
    let page = await desktop.firstWindow();
    await expect(page.locator('.workspace-shell')).toBeVisible();
    await openActiveFile(page);
    await desktop.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1440, 900),
    );
    await expect(umlCanvas(page)).toBeVisible();
    await setAppLanguage(page, 'zh');
    await createUmlDiagram(page, 'class');
    await importUmlText(
      page,
      await readFile(
        path.resolve(__dirname, '../../fixtures/ai-canvas/uml-class.mmd'),
        'utf8',
      ),
    );
    await expect(
      umlCanvas(page).locator('[data-cell-kind="uml-class"]'),
    ).toHaveCount(2);
    await expect
      .poll(
        async () =>
          (await committedCells(userData)).filter((c) => c.kind === 'uml-class')
            .length,
      )
      .toBe(2);
    const tabs = page.getByRole('tab');
    await tabs.first().click({ position: { x: 8, y: 8 } });
    await createUmlDiagram(page, 'sequence');
    await importUmlText(
      page,
      await readFile(
        path.resolve(__dirname, '../../fixtures/ai-canvas/uml-sequence.mmd'),
        'utf8',
      ),
    );
    await expect(umlCanvas(page).locator('[data-uml-activation]')).toHaveCount(
      1,
    );
    await expect
      .poll(
        async () =>
          (await committedCells(userData)).filter(
            (c) => c.kind === 'uml-message',
          ).length,
      )
      .toBe(3);
    await close(desktop, page);
    desktop = await electron.launch({ args: [launcher], env });
    page = await desktop.firstWindow();
    await expect(
      umlCanvas(page).locator('[data-cell-kind="uml-message"]'),
    ).toHaveCount(3);
    await expect(umlCanvas(page).locator('[data-uml-activation]')).toHaveCount(
      1,
    );
    const classes = (await committedCells(userData)).filter(
      (c) => c.kind === 'uml-class',
    );
    expect(classes).toHaveLength(2);
    expect(
      classes.find((c) => c.content?.label === 'Order')?.data.attributes,
    ).toEqual(['+id: string']);
    await close(desktop, page);
  } finally {
    await desktop.close().catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
});
