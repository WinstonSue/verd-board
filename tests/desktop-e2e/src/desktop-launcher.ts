import { _electron, type ElectronApplication } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

export const desktopMode =
  process.env['VERDBOARD_E2E_MODE'] === 'prod' ? 'prod' : 'dev';
export const desktopDevUrl = 'http://127.0.0.1:7310';
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
      `require(${JSON.stringify(main)});`,
    ].join('\n'),
  );
}

/** Vite owns the compiler; Playwright owns only the Electron children it launches. */
export const electron = {
  async launch(options: DesktopLaunchOptions): Promise<ElectronApplication> {
    // Respect callers that deliberately removed inherited workspace overrides.
    const env = Object.fromEntries(
      Object.entries(options.env ?? process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    );
    delete env.ELECTRON_RUN_AS_NODE;
    if (desktopMode === 'dev') env.VITE_DEV_SERVER_URL = desktopDevUrl;
    else delete env.VITE_DEV_SERVER_URL;
    return _electron.launch({ ...options, env });
  },
};
