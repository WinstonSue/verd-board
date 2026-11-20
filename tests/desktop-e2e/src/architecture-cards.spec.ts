import { test, expect, type ElectronApplication } from '@playwright/test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { electron, writeDesktopLauncher } from './desktop-launcher';
import { openActiveFile } from '../../web-e2e/src/app-actions';
import {
  architectureCardsFixture,
  exerciseArchitectureCards,
  cardSceneFixtures,
  exerciseCardEntrypoint,
  exerciseSceneTextPaste,
  openCardScene,
} from '../../helpers/architecture-cards';

// eslint-disable-next-line no-empty-pattern -- Electron owns its window.
test('Desktop architecture layers and text cards persist after a real restart', async ({}) => {
  const directory = await mkdtemp(
    path.join(tmpdir(), 'verd-architecture-cards-'),
  );
  let desktop: ElectronApplication | undefined;
  try {
    const project = path.join(directory, 'project'),
      userData = path.join(directory, 'profile');
    await mkdir(project);
    await mkdir(userData);
    const file = path.join(project, 'architecture-cards.verd'),
      launcher = path.join(directory, 'launch.cjs');
    await writeFile(file, JSON.stringify(architectureCardsFixture()));
    for (const item of cardSceneFixtures())
      await writeFile(
        path.join(project, item.name + '.verd'),
        JSON.stringify(item.file),
      );
    await writeDesktopLauncher(launcher, userData);
    const launch = async () => {
      desktop = await electron.launch({
        args: [launcher],
        env: { ...process.env, VERDBOARD_WORKSPACE_PATH: project },
      });
      const page = await desktop.firstWindow();
      await desktop.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setSize(1600, 1000),
      );
      await expect(page.locator('.workspace-shell')).toBeVisible();
      const skip = page.getByRole('button', { name: '跳过', exact: true });
      if (await skip.isVisible()) await skip.click();
      await openActiveFile(page);
      await openCardScene(page, 'architecture-cards');
      return page;
    };
    const page = await launch();
    const readCells = async () => {
      await expect(
        page.locator('.workspace-pane.is-active').getByTestId('save-status'),
      ).toHaveAttribute('data-save-state', 'saved');
      return JSON.parse(await readFile(file, 'utf8')).cells;
    };
    const saved = await exerciseArchitectureCards(page, readCells);
    for (const { name, file: source } of cardSceneFixtures()) {
      await openCardScene(page, source.frame.id);
      await exerciseSceneTextPaste(page, name);
      await exerciseCardEntrypoint(page, name === 'board');
      await expect(
        page.locator('.workspace-pane.is-active').getByTestId('save-status'),
      ).toHaveAttribute('data-save-state', 'saved');
      const written = JSON.parse(
        await readFile(path.join(project, name + '.verd'), 'utf8'),
      );
      expect(
        Object.values(written.cells).some(
          (cell: any) =>
            cell.kind === 'card' &&
            cell.content.text.plainText.includes('Independent explanation.'),
        ),
      ).toBe(true);
    }
    await desktop!.close();
    desktop = undefined;
    const restarted = await launch();
    await expect(
      restarted.locator('[data-cell-kind="card"]:visible'),
    ).toContainText('Responsibilities');
    expect(JSON.parse(await readFile(file, 'utf8')).cells).toEqual(saved);
  } finally {
    await desktop?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
