import { test, expect } from './service-fixture';
import { openActiveFile, selectAppAction } from './app-actions';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { persistedWorkspace } from './workspace-nav';
import {
  architectureCardsFixture,
  exerciseArchitectureCards,
  cardSceneFixtures,
  exerciseCardEntrypoint,
  exerciseSceneTextPaste,
  openCardScene,
} from '../../helpers/architecture-cards';
import type { Cell } from '../../../packages/engine/core/src/cell/types';

for (const { name, file } of cardSceneFixtures()) {
  test(`${name} exposes an independent card with editable block content`, async ({
    page,
    localService,
  }) => {
    await writeFile(
      path.join(localService.workspace, name + '.verd'),
      JSON.stringify(file),
    );
    await localService.restart();
    await page.goto('/');
    await openActiveFile(page);
    await openCardScene(page, file.frame.id);
    await exerciseSceneTextPaste(page, name);
    await exerciseCardEntrypoint(page, name === 'board');
    await expect(
      page.locator('.workspace-pane.is-active').getByTestId('save-status'),
    ).toHaveAttribute('data-save-state', 'saved');
    const data = await persistedWorkspace(page);
    const card = Object.values(
      data?.records?.[file.frame.id]?.cells ?? {},
    ).find((cell: any) => cell.kind === 'card') as any;
    expect(card?.content?.text?.plainText).toContain(
      'Independent explanation.',
    );
    expect(
      card.content.text.content.content.map(
        (block: { type: string }) => block.type,
      ),
    ).toEqual(['heading', 'paragraph']);
  });
}

test('architecture placement, independent cards and movable layers persist with exact undo', async ({
  page,
  localService,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const file = architectureCardsFixture();
  await writeFile(
    path.join(localService.workspace, 'architecture-cards.verd'),
    JSON.stringify(file),
  );
  await localService.restart();
  await page.goto('/');
  await openActiveFile(page);
  await openCardScene(page, file.frame.id);
  const readCells = async () => {
    await expect(
      page.locator('.workspace-pane.is-active').getByTestId('save-status'),
    ).toHaveAttribute('data-save-state', 'saved');
    const workspace = await persistedWorkspace(page);
    return workspace!.records[file.frame.id].cells as Record<string, Cell>;
  };
  const saved = await exerciseArchitectureCards(page, readCells);
  await page.reload();
  await openActiveFile(page);
  await openCardScene(page, file.frame.id);
  await expect(page.locator('[data-cell-kind="card"]:visible')).toContainText(
    'Responsibilities',
  );
  expect(await readCells()).toEqual(saved);
  await page.screenshot({
    path: test.info().outputPath('architecture-cards.png'),
  });
  await selectAppAction(page, '图像导出');
  const dialog = page.getByRole('dialog', { name: '图像导出', exact: true });
  await dialog.getByLabel('Image format').selectOption('svg');
  const download = page.waitForEvent('download');
  await dialog.getByTestId('image-export-button').click();
  const image = await download;
  const svg = await readFile((await image.path())!, 'utf8');
  expect(svg).toContain('Responsibilities');
  expect(svg).toContain('Validation belongs to each boundary.');
  expect(svg).toContain('data-cell-kind="card"');
});
