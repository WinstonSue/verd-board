import {
  _electron as electron,
  test,
  expect,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createUmlDiagram,
  importUmlText,
  umlCanvas,
} from '../../web-e2e/src/uml-actions';
import { setAppLanguage } from '../../web-e2e/src/app-actions';
import { committedCells } from './workspace-disk';
test('Desktop UML domains persist editable class members and structured sequence events across restart', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'verd-uml-e2e-')),
    userData = path.join(directory, 'user-data');
  await mkdir(userData);
  const launcher = path.join(directory, 'launch.cjs');
  await writeFile(
    launcher,
    'const {app}=require("electron");\napp.setPath("userData",' +
      JSON.stringify(userData) +
      ');\nrequire(' +
      JSON.stringify(
        path.resolve(__dirname, '../../../apps/desktop/dist-electron/main.js'),
      ) +
      ');\n',
  );
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VITE_DEV_SERVER_URL;
  env.VERDBOARD_WORKSPACE_PATH = path.join(userData, 'workspaces', 'default');
  let desktop = await electron.launch({ args: [launcher], env });
  const close = async (app: ElectronApplication, page: Page) => {
    const closed = page.waitForEvent('close');
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].close(),
    );
    await closed;
    await app.close();
  };
  try {
    let page = await desktop.firstWindow();
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
