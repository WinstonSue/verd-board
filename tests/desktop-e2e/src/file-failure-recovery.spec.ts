import { electron, writeDesktopLauncher } from './desktop-launcher';
import { expect, test, type ElectronApplication } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(__dirname, '../../..');

test('Desktop isolates broken generated files, keeps editing available and recovers after external repair', async ({
  browserName,
}, info) => {
  test.setTimeout(120_000);
  const directory = await mkdtemp(path.join(tmpdir(), 'verd-file-recovery-'));
  const workspace = path.join(directory, 'workspace');
  const userData = path.join(directory, 'user-data');
  let desktop: ElectronApplication | undefined;
  try {
    await mkdir(workspace);
    await mkdir(userData);
    const valid = JSON.parse(
      await readFile(
        path.join(root, 'tests/fixtures/ai-canvas/workflow-process.verd.json'),
        'utf8',
      ),
    );
    valid.frame.name = 'Generated flow';
    const broken = structuredClone(valid);
    broken.cells['task-fill'].data = broken.cells['pay-start'].data;
    delete broken.cells['pay-start'].data;
    const flowPath = path.join(workspace, 'flow.verd.json');
    const badBytes = JSON.stringify(broken);
    await writeFile(flowPath, badBytes);
    const unknownPath = path.join(workspace, 'unfinished.verd-doc.json');
    await writeFile(unknownPath, '{ still writing');
    const doc = {
      format: 'verd-document',
      version: 1,
      id: 'healthy',
      title: 'Healthy document',
      text: {
        schemaVersion: 1,
        id: 'healthy',
        kind: 'block',
        align: 'left',
        plainText: 'Keep working',
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Keep working' }],
            },
            {
              type: 'frameReference',
              attrs: {
                targetFrameId: valid.frame.id,
                instanceId: 'embedded-flow',
              },
            },
          ],
        },
      },
    };
    const docPath = path.join(workspace, 'healthy.verd-doc.json');
    await writeFile(docPath, JSON.stringify(doc));
    const launcher = path.join(directory, 'launch.cjs');
    await writeDesktopLauncher(launcher, userData);
    const env = { ...process.env, VERDBOARD_WORKSPACE_PATH: workspace };

    desktop = await electron.launch({ args: [launcher], env });
    const page = await desktop.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await expect(page.locator('.workspace-shell')).toBeVisible();
    const active = page.locator('.workspace-pane.is-active');
    await page.locator('[data-failed-path="flow.verd.json"] button').click();
    await expect(active.getByTestId('workspace-file-error')).toContainText(
      'Invalid workflow anchor',
    );
    await expect(page.locator('.file-tree')).toBeVisible();
    await page
      .locator('.file-tree-name[title="healthy.verd-doc.json"]')
      .click();
    await expect(active.locator('.document-page')).toBeVisible();
    await expect(active.getByTestId('workspace-file-error')).toContainText(
      'flow.verd.json',
    );
    const editor = active
      .locator('.ProseMirror[contenteditable="true"]')
      .first();
    await editor.click();
    await page.keyboard.press('ControlOrMeta+Home');
    await page.keyboard.type('Saved while the diagram was broken. ');
    await expect
      .poll(async () =>
        (await readFile(docPath, 'utf8')).includes(
          'Saved while the diagram was broken.',
        ),
      )
      .toBe(true);
    expect(await readFile(flowPath, 'utf8')).toBe(badBytes);
    expect(await readFile(unknownPath, 'utf8')).toBe('{ still writing');
    await page
      .locator('[data-failed-path="unfinished.verd-doc.json"] button')
      .click();
    await expect(
      page.locator('.workspace-content > [data-testid="workspace-file-error"]'),
    ).toContainText('unfinished.verd-doc.json');
    const repaired = {
      ...doc,
      id: 'repaired',
      title: 'Repaired document',
      text: { ...doc.text, id: 'repaired' },
    };
    await writeFile(unknownPath, JSON.stringify(repaired));
    await expect(active.locator('.document-page__content')).toHaveAttribute(
      'aria-label',
      'Repaired document',
    );
    await writeFile(flowPath, JSON.stringify(valid));
    await expect(
      page.locator('[data-failed-path="flow.verd.json"]'),
    ).toHaveCount(0);
    await page.locator('.file-tree-name[title="flow.verd.json"]').click();
    await expect(
      active.locator('svg[aria-label="Frame canvas"][data-surface="root"]'),
    ).toBeVisible();
    // A later external failure replaces the current pane and leaves the app usable.
    await writeFile(flowPath, badBytes);
    await expect(active.getByTestId('workspace-file-error')).toBeVisible();
    await active.getByRole('button', { name: '重试', exact: true }).click();
    await expect(active.getByTestId('workspace-file-error')).toBeVisible();
    expect(await readFile(flowPath, 'utf8')).toBe(badBytes);
    await page.screenshot({
      path: info.outputPath(`isolated-file-error-${browserName}.png`),
    });
    await writeFile(flowPath, JSON.stringify(valid));
    await expect(
      active.locator('svg[aria-label="Frame canvas"][data-surface="root"]'),
    ).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await desktop?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
