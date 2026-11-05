import { _electron, type ElectronApplication } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

export const desktopMode =
  process.env['VERDBOARD_E2E_MODE'] === 'prod' ? 'prod' : 'dev';
export const desktopDevUrl =
  process.env['VERDBOARD_E2E_URL'] ?? 'http://127.0.0.1:7310';
const root = path.resolve(__dirname, '../../..');
type DesktopLaunchOptions = Omit<
  NonNullable<Parameters<typeof _electron.launch>[0]>,
  'env'
> & { env?: NodeJS.ProcessEnv };

/** Every launch, including restarts, must use the test's own data directory. */
export async function writeDesktopLauncher(launcher: string, userData: string) {
  const main = path.join(
    root,
    'apps/desktop',
    desktopMode === 'prod' ? 'dist-electron' : 'dist-electron-e2e',
    'main.js',
  );
  await writeFile(
    launcher,
    [
      "const {app} = require('electron');",
      `process.env.VERDBOARD_USER_DATA_PATH = ${JSON.stringify(userData)};`,
      `app.setPath('userData', ${JSON.stringify(userData)});`,
      // Keep automation windows usable without adding an application to the Dock.
      "if (process.platform === 'darwin') app.setActivationPolicy('accessory');",
      // Also covers a worker being killed before its finally/teardown can run.
      `const ownerPid = ${process.pid};`,
      'setInterval(() => {',
      '  try { process.kill(ownerPid, 0); } catch { app.exit(0); }',
      '}, 1000).unref();',
      `require(${JSON.stringify(main)});`,
    ].join('\n'),
  );
}

let active: ElectronApplication | undefined;
let launching = false;

/** Vite owns the compiler; Playwright owns only the Electron children it launches. */
export const electron = {
  async launch(options: DesktopLaunchOptions): Promise<ElectronApplication> {
    if (launching || active) {
      throw new Error(
        'Close the previous test Electron instance before launching another.',
      );
    }
    launching = true;
    // Respect callers that deliberately removed inherited workspace overrides.
    const env = Object.fromEntries(
      Object.entries(options.env ?? process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    );
    delete env.ELECTRON_RUN_AS_NODE;
    if (desktopMode === 'dev') env.VITE_DEV_SERVER_URL = desktopDevUrl;
    else delete env.VITE_DEV_SERVER_URL;
    try {
      const desktop = await _electron.launch({ ...options, env });
      const child = desktop.process();
      active = desktop;
      const killOwnedChild = () => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
        }
      };
      const released = () => {
        process.removeListener('exit', killOwnedChild);
        if (active === desktop) active = undefined;
      };
      process.once('exit', killOwnedChild);
      child.once('exit', released);
      if (child.exitCode !== null || child.signalCode !== null) released();

      const close = desktop.close.bind(desktop);
      let closing: Promise<void> | undefined;
      desktop.close = () => {
        closing ??= (async () => {
          // Temporary test data only: a broken flush must not leave a GUI process.
          const deadline = setTimeout(killOwnedChild, 10_000);
          try {
            await close();
          } finally {
            clearTimeout(deadline);
            killOwnedChild();
          }
        })();
        return closing;
      };
      return desktop;
    } finally {
      launching = false;
    }
  },
};
