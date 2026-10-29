import { electron, writeDesktopLauncher } from './desktop-launcher';
import { test, expect, type ElectronApplication } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setAppLanguage } from '../../web-e2e/src/app-actions';

const root = path.resolve(__dirname, '../../..');
test('Desktop previews documents in every canvas, adopts external edits and preserves source bytes while reading', async ({
  browserName,
}, info) => {
  test.setTimeout(120_000);
  const directory = await mkdtemp(
    path.join(tmpdir(), 'verd-document-reference-'),
  );
  const workspace = path.join(directory, 'workspace');
  const userData = path.join(directory, 'user-data');
  let desktop: ElectronApplication | undefined;
  try {
    await mkdir(workspace);
    await mkdir(userData);
    const originals = new Map<string, string>();
    const frames: { frame: { id: string; name: string } }[] = [];
    for (const name of [
      'whiteboard-basic',
      'mind-map',
      'workflow-dag',
      'architecture',
    ]) {
      const frame = JSON.parse(
        await readFile(
          path.join(root, 'tests/fixtures/ai-canvas', name + '.verd.json'),
          'utf8',
        ),
      );
      frame.frame.name = `Desktop ${name}`;
      const id = `desktop-document-${name}`;
      frame.frame.children.push(id);
      frame.cells[id] = {
        id,
        kind: 'document-reference',
        cellType: 'node',
        geometry: { x: 100, y: 700, width: 680, height: 400 },
        data: { targetDocumentId: 'desktop-reference-doc' },
      };
      if (name === 'whiteboard-basic') {
        const editableId = 'desktop-editable-document';
        frame.frame.children.push(editableId);
        frame.cells[editableId] = {
          id: editableId,
          kind: 'document-frame',
          cellType: 'node',
          geometry: { x: 900, y: 700, width: 680, height: 400 },
          data: { targetDocumentId: 'desktop-reference-doc' },
        };
      }
      const filePath = path.join(workspace, name + '.verd.json');
      const bytes = JSON.stringify(frame, null, 2);
      originals.set(filePath, bytes);
      await writeFile(filePath, bytes);
      frames.push(frame);
    }
    const paragraph = (text: string) => ({
      type: 'paragraph',
      content: [{ type: 'text', text }],
    });
    const doc = {
      format: 'verd-document',
      version: 1,
      id: 'desktop-reference-doc',
      title: 'Desktop reference source',
      text: {
        schemaVersion: 1,
        id: 'desktop-reference-doc',
        kind: 'block',
        plainText: 'Desktop reference source',
        content: {
          type: 'doc',
          content: [
            paragraph('Desktop source body'),
            ...Array.from({ length: 40 }, (_, i) =>
              paragraph(`Long desktop paragraph ${i}`),
            ),
            {
              type: 'frameReference',
              attrs: { targetFrameId: frames[0].frame.id },
            },
          ],
        },
      },
    };
    const docPath = path.join(workspace, 'Reference.verd-doc.json');
    const docBytes = JSON.stringify(doc, null, 2);
    await writeFile(docPath, docBytes);
    const launcher = path.join(directory, 'launch.cjs');
    await writeDesktopLauncher(launcher, userData);
    const env = { ...process.env, VERDBOARD_WORKSPACE_PATH: workspace };

    desktop = await electron.launch({ args: [launcher], env });
    const page = await desktop.firstWindow();
    await desktop.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1600, 1000),
    );
    await expect(page.locator('.workspace-shell')).toBeVisible();
    const active = page.locator('.workspace-pane.is-active');
    for (const [index, frame] of frames.entries()) {
      await page
        .locator('.file-tree-name')
        .filter({ hasText: new RegExp(`^${frame.frame.name}$`) })
        .click();
      if (index === 0) await setAppLanguage(page, 'zh');
      await active.getByTestId('canvas-status-fit').press('Enter');
      const reader = active.locator('[data-document-preview-scroll]').first();
      await expect(
        reader.locator('.board-document-content').first(),
      ).toHaveAttribute('contenteditable', 'false');
      await expect(reader.locator('.ProseMirror')).toHaveCount(0);
      await expect(reader).toContainText('Desktop source body');
      await reader.hover();
      await page.mouse.wheel(0, 400);
      await expect
        .poll(() => reader.evaluate((el) => el.scrollTop))
        .toBeGreaterThan(0);
    }
    await page.screenshot({
      path: info.outputPath(`desktop-document-card-${browserName}.png`),
    });
    for (const [file, bytes] of originals)
      expect(await readFile(file, 'utf8')).toBe(bytes);
    expect(await readFile(docPath, 'utf8')).toBe(docBytes);
    doc.text.content.content.unshift(paragraph('External source update'));
    doc.text.plainText = 'External source update';
    await writeFile(docPath, JSON.stringify(doc, null, 2));
    await expect(
      active.locator('[data-document-preview-scroll]').first(),
    ).toContainText('External source update');
    await active
      .getByRole('button', { name: '打开详情', exact: true })
      .first()
      .click();
    await expect(active.locator('.document-page__title')).toHaveValue(
      doc.title,
    );
    await expect(
      active.locator('.board-document-content').first(),
    ).toContainText('External source update');
    await page
      .locator('.file-tree-name')
      .filter({ hasText: /^Desktop whiteboard-basic$/ })
      .click();
    await active.getByTestId('canvas-status-fit').press('Enter');
    const editable = active
      .locator('[data-cell-kind="document-frame"]')
      .first();
    await editable.getByText('Desktop source body', { exact: true }).dblclick();
    const editor = editable.locator(
      '[data-document-editing] .ProseMirror[contenteditable="true"]',
    );
    await expect(editor).toBeVisible();
    await editor.locator('p').first().click();
    await page.keyboard.insertText(' Saved through Frame');
    await expect(
      active.locator('[data-cell-kind="document-reference"]').first(),
    ).toContainText('Saved through Frame');
    await editor.press('Escape');
    await expect(editable.locator('[data-document-editing]')).toHaveCount(0);
    await expect
      .poll(async () =>
        (await readFile(docPath, 'utf8')).includes('Saved through Frame'),
      )
      .toBe(true);
    await desktop.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].close(),
    );
    await desktop.close();
    desktop = undefined;
    for (const [file, bytes] of originals)
      expect(await readFile(file, 'utf8')).toBe(bytes);
  } catch (error) {
    if (desktop) {
      const page = await desktop.firstWindow();
      await page.screenshot({ path: info.outputPath('document-failure.png') });
      await info.attach('document-viewports', {
        contentType: 'application/json',
        body: JSON.stringify(
          await page.evaluate(() => ({
            title: document.querySelector(
              '.workspace-pane.is-active .workspace-file-navigation-title',
            )?.textContent,
            world: document
              .querySelector('.workspace-pane.is-active [data-frame-world]')
              ?.getAttribute('transform'),
            readers: [
              ...document.querySelectorAll(
                '.workspace-pane.is-active [data-document-preview-scroll]',
              ),
            ].map((el) => ({
              rect: el.getBoundingClientRect().toJSON(),
              html: el.outerHTML.slice(0, 500),
              ancestors: [
                ...(function* (node: Element | null) {
                  while (node) {
                    yield node;
                    node = node.parentElement;
                  }
                })(el),
              ].map((n) => ({
                tag: n.tagName,
                cls: n.getAttribute('class'),
                style: n.getAttribute('style'),
              })),
            })),
          })),
          null,
          2,
        ),
      });
    }
    throw error;
  } finally {
    await desktop?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
