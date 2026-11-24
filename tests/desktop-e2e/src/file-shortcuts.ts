import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { electron, writeDesktopLauncher } from './desktop-launcher';

export async function checkFileShortcuts() {
  const directory = await mkdtemp(path.join(tmpdir(), 'verd-file-shortcuts-'));
  let desktop: ElectronApplication | undefined;
  try {
    const source = path.join(directory, 'Shortcut test.md');
    await writeFile(source, '# Test document\n');
    const launcher = path.join(directory, 'launch.cjs');
    await writeDesktopLauncher(launcher, path.join(directory, 'user-data'));
    const application = (desktop = await electron.launch({
      args: [launcher, source],
    }));
    const document = await application.firstWindow();
    await expect(document.getByTestId('external-file-editor')).toBeVisible();
    const canvasWindow = application.waitForEvent('window');
    await application.evaluate(({ BrowserWindow, Menu }) => {
      const item = Menu.getApplicationMenu()!.getMenuItemById('new-canvas')!;
      const window = BrowserWindow.getFocusedWindow();
      item.click({}, window, window?.webContents);
    });
    const board = await canvasWindow;
    const calls = await application.evaluateHandle(({ app, dialog }) => {
      // A macOS accessory app has no active menu bar for native shortcuts.
      if (process.platform === 'darwin') app.setActivationPolicy('regular');
      app.focus({ steal: true });
      const parents: number[] = [];
      dialog.showOpenDialog = async (...args) => {
        const [parent] = args;
        parents.push('id' in parent ? Number(parent.id) : -1);
        return { canceled: true, filePaths: [] };
      };
      return parents;
    });
    const expectedParents: number[] = [];
    const check = async (page: Page, focus: () => Promise<void>) => {
      const window = await application.browserWindow(page);
      const id = await window.evaluate((native) => {
        native.focus();
        native.webContents.setZoomFactor(1.25);
        return native.id;
      });
      await focus();
      const press = (keyCode: 'O' | '0') =>
        window.evaluate((native, keyCode) => {
          const modifiers = [
            process.platform === 'darwin' ? 'meta' : 'control',
          ] as Electron.KeyboardInputEvent['modifiers'];
          native.webContents.sendInputEvent({
            type: 'keyDown',
            keyCode,
            modifiers,
          });
          native.webContents.sendInputEvent({
            type: 'keyUp',
            keyCode,
            modifiers,
          });
        }, keyCode);
      await press('O');
      expectedParents.push(id);
      await expect.poll(() => calls.jsonValue()).toEqual(expectedParents);
      await press('0');
      await expect
        .poll(() =>
          window.evaluate((native) => native.webContents.getZoomFactor()),
        )
        .toBe(1);
      expect(await calls.jsonValue()).toEqual(expectedParents);
      await press('O');
      expectedParents.push(id);
      await expect.poll(() => calls.jsonValue()).toEqual(expectedParents);
      await window.dispose();
    };
    await check(document, () =>
      document.locator('[contenteditable="true"]').first().click(),
    );
    await check(board, () =>
      board.locator('svg[aria-label="Frame canvas"]').click(),
    );
    await calls.dispose();
  } finally {
    await desktop?.close();
    await rm(directory, { recursive: true, force: true });
  }
}
