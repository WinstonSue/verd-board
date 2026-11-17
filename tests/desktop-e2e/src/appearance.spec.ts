import {
  expectSettingValue,
  selectSetting,
} from '../../helpers/settings-controls';
import { electron, writeDesktopLauncher } from './desktop-launcher';
import {
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { roleTone } from '../../web-e2e/src/theme-role-values';
import { workspaceDigest } from './workspace-disk';
import { readable } from '../../web-e2e/src/text-color-checks';

async function close(desktop: ElectronApplication, page: Page) {
  const closed = page.waitForEvent('close');
  await desktop.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].close(),
  );
  await closed;
  await desktop.close();
}

test('Desktop follows system, remembers manual appearance after restart, and leaves workspace files unchanged', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'verd-appearance-e2e-'));
  const userData = path.join(directory, 'user-data');
  const workspace = path.join(userData, 'workspaces', 'default');
  await mkdir(workspace, { recursive: true });
  const doc = {
    format: 'verd-document',
    version: 1,
    id: 'desktop-appearance-doc',
    title: 'Desktop appearance',
    text: {
      schemaVersion: 1,
      id: 'desktop-appearance-doc',
      kind: 'block',
      align: 'left',
      plainText: 'Original body',
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'Original body',
                marks: [{ type: 'textStyle', attrs: { color: '#24354b' } }],
              },
            ],
          },
        ],
      },
    },
  };
  const nodes = [false, true].map((custom, i) => ({
    id: custom ? 'custom-shape' : 'legacy-shape',
    kind: 'geometry',
    cellType: 'node',
    geometry: {
      x: 30 + i * 220,
      y: 30,
      width: 180,
      height: 80,
      outline: 'rectangle',
    },
    appearance: {
      fill: custom ? '#fff' : '#ff00ff',
      strokeColor: custom ? '#64748b' : '#00ff00',
      ...(custom
        ? { colorSources: { fill: 'custom', strokeColor: 'custom' } }
        : {}),
    },
    content: {
      label: custom ? 'Fixed white' : 'Adaptive shape',
      text: {
        schemaVersion: 1,
        id: `desktop-theme-text-${i}`,
        kind: 'inline',
        plainText: custom ? 'Fixed white' : 'Adaptive shape',
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: custom ? 'Fixed white' : 'Adaptive shape',
                  marks: [{ type: 'textStyle', attrs: { color: '#24354b' } }],
                },
              ],
            },
          ],
        },
      },
    },
  }));
  const embedded = {
    id: 'embedded-document',
    kind: 'document-frame',
    cellType: 'node',
    geometry: { x: 30, y: 150, width: 430, height: 130 },
    data: { targetDocumentId: doc.id },
  };
  const boardNodes = [...nodes, embedded];
  const board = {
    format: 'verd-frame',
    version: 2,
    frame: {
      id: 'desktop-appearance-board',
      name: 'Desktop theme board',
      kind: 'frame',
      cellType: 'frame',
      geometry: { x: 0, y: 0, width: 500, height: 300 },
      view: {
        theme: { themeColorMode: 'default', boardBackground: '#f8fafc' },
      },
      children: boardNodes.map((node) => node.id),
      groups: [],
    },
    cells: Object.fromEntries(boardNodes.map((node) => [node.id, node])),
  };
  const boardPath = path.join(workspace, 'Board.verd.json');
  const boardBytes = JSON.stringify(board);
  await writeFile(boardPath, boardBytes);
  const docPath = path.join(workspace, 'Appearance.verd-doc.json');
  await writeFile(docPath, JSON.stringify(doc));
  for (const fixture of ['uml-sequence', 'workflow-process']) {
    const file = JSON.parse(
      await readFile(
        path.resolve(
          __dirname,
          `../../fixtures/ai-canvas/${fixture}.verd.json`,
        ),
        'utf8',
      ),
    );
    file.frame.name = `Theme ${fixture}`;
    file.frame.view = {
      ...file.frame.view,
      theme: { themeColorMode: 'default', backgroundMode: 'theme' },
    };
    await writeFile(
      path.join(workspace, `${fixture}.verd.json`),
      JSON.stringify(file),
    );
  }
  const launcher = path.join(directory, 'launch.cjs');
  await writeDesktopLauncher(launcher, userData);
  const env = { ...process.env, VERDBOARD_WORKSPACE_PATH: workspace };

  let desktop = await electron.launch({ args: [launcher], env });
  try {
    let page = await desktop.firstWindow();
    await expect(page.locator('.workspace-shell')).toBeVisible();
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveAttribute(
      'data-verd-appearance',
      'dark',
    );
    // Sidebar settings work independently of the active editor.
    await page.locator('.workspace-sidebar-footer button').click();
    await expectSettingValue(page.getByTestId('settings-appearance'), 'system');
    expect(
      await page
        .getByTestId('my-page')
        .evaluate(
          (element) => getComputedStyle(element, '::backdrop').backgroundColor,
        ),
    ).toBe('rgba(0, 0, 0, 0.6)');
    await selectSetting(page.getByTestId('settings-appearance'), 'light');
    expect(
      await page
        .getByTestId('my-page')
        .evaluate(
          (element) => getComputedStyle(element, '::backdrop').backgroundColor,
        ),
    ).toBe('rgba(0, 0, 0, 0.32)');
    await page.getByTestId('my-back').click();
    await page
      .locator('.file-tree-name')
      .filter({ hasText: /^Desktop appearance$/ })
      .click();
    await expect(
      page.locator('.workspace-pane.is-active .document-page'),
    ).toBeVisible();
    await expect(page.getByText('Original body', { exact: true })).toHaveCSS(
      'color',
      'rgb(37, 37, 37)',
    );
    const content = await readFile(docPath, 'utf8');
    const canvases = await workspaceDigest(userData);
    await page.locator('.workspace-sidebar-footer button').click();
    await selectSetting(page.getByTestId('settings-appearance'), 'dark');
    await page.getByTestId('my-back').click();
    await expect(page.getByText('Original body', { exact: true })).toHaveCSS(
      'color',
      'rgb(230, 230, 230)',
    );
    await close(desktop, page);
    desktop = await electron.launch({ args: [launcher], env });
    page = await desktop.firstWindow();
    await expect(page.locator('.workspace-shell'))
      .toBeVisible({ timeout: 20000 })
      .catch(async (error) => {
        console.log('STARTUP BODY', await page.locator('body').innerText());
        throw error;
      });
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).toHaveAttribute(
      'data-verd-appearance',
      'dark',
    );
    await page.locator('.workspace-sidebar-footer button').click();
    await expectSettingValue(page.getByTestId('settings-appearance'), 'dark');
    await page.getByTestId('my-back').click();
    await page
      .locator('.file-tree-name')
      .filter({ hasText: /^Desktop theme board$/ })
      .click();
    const canvas = page.locator(
      '.workspace-pane.is-active svg[data-surface="root"]',
    );
    await expect(canvas).toHaveAttribute('data-board-appearance', 'dark');
    const verifyEmbeddedTitle = async () => {
      const card = canvas.locator('[data-cell-id="embedded-document"]');
      await card.getByText('Original body', { exact: true }).dblclick();
      await expect(card.locator('.ProseMirror')).toBeVisible();
      await readable(card);
      await card.locator('.ProseMirror').press('Escape');
      await readable(card);
    };

    await expect(
      canvas.locator('[data-cell-id="legacy-shape"]'),
    ).toHaveAttribute('fill', (await roleTone(page, 'default', 'dark')).fill);
    await expect(
      canvas.locator('[data-cell-id="legacy-shape"]'),
    ).toHaveAttribute(
      'stroke',
      (await roleTone(page, 'default', 'dark')).strokeColor,
    );
    await expect(
      canvas.locator('[data-cell-id="custom-shape"]'),
    ).toHaveAttribute('fill', '#fff');
    await expect(canvas.getByText('Adaptive shape', { exact: true })).toHaveCSS(
      'color',
      'rgb(228, 231, 236)',
    );
    await expect(canvas.getByText('Fixed white', { exact: true })).toHaveCSS(
      'color',
      'rgb(15, 23, 42)',
    );
    await verifyEmbeddedTitle();
    for (const fixture of ['uml-sequence', 'workflow-process']) {
      await page
        .locator('.file-tree-name')
        .filter({ hasText: new RegExp(`^Theme ${fixture}$`) })
        .click();
      const parts = page.locator(
        '.workspace-pane.is-active [data-uml-lifeline] > rect, .workspace-pane.is-active [data-cell-kind="workflow-task"]',
      );
      await expect.poll(() => parts.count()).toBeGreaterThan(0);
      const sequence =
        fixture === 'uml-sequence'
          ? JSON.parse(
              await readFile(
                path.resolve(
                  __dirname,
                  '../../fixtures/ai-canvas/uml-sequence.verd.json',
                ),
                'utf8',
              ),
            )
          : undefined;
      const participants: string[] = sequence
        ? (Object.values<any>(sequence.cells).find(
            (cell) => cell.kind === 'uml-sequence-root',
          )?.data.participantIds ?? [])
        : [];
      if (!sequence) {
        const fills = await parts.evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute('fill')),
        );
        expect(new Set(fills).size).toBe(1);
        continue;
      }
      for (const part of await parts.all()) {
        const ownerId = await part.evaluate((element) =>
          element.closest('[data-cell-id]')?.getAttribute('data-cell-id'),
        );
        const tone = await roleTone(
          page,
          'default',
          'dark',
          sequence ? participants.indexOf(ownerId!) : 'primary',
        );
        await expect(part).toHaveAttribute('fill', tone.fill);
        await expect(part).toHaveAttribute('stroke', tone.strokeColor);
      }
    }
    await page
      .locator('.file-tree-name')
      .filter({ hasText: /^Desktop theme board$/ })
      .click();
    await page.locator('.workspace-sidebar-footer button').click();
    await selectSetting(page.getByTestId('settings-appearance'), 'system');
    await expect(page.locator('html')).toHaveAttribute(
      'data-verd-appearance',
      'light',
    );
    await expect(
      canvas.locator('[data-cell-id="legacy-shape"]'),
    ).toHaveAttribute('fill', (await roleTone(page, 'default', 'light')).fill);
    await page.getByTestId('my-back').click();
    await expect(page.getByTestId('my-page')).not.toBeVisible();
    await verifyEmbeddedTitle();
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveAttribute(
      'data-verd-appearance',
      'dark',
    );
    expect(await readFile(docPath, 'utf8')).toBe(content);
    expect(await readFile(boardPath, 'utf8')).toBe(boardBytes);
    expect(await workspaceDigest(userData)).toBe(canvases);
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
