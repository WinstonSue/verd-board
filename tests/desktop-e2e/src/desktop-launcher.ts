import { _electron, test, type ElectronApplication } from '@playwright/test';
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
let traceSequence = 0;

/** Vite owns the compiler; Playwright owns only the Electron children it launches. */
export const electron = {
  async launch(options: DesktopLaunchOptions): Promise<ElectronApplication> {
    if (
      !['remote', 'ci', 'local', 'release'].includes(
        process.env['VERD_TEST_EXECUTION'] ?? '',
      ) &&
      process.env['GITHUB_ACTIONS'] !== 'true'
    ) {
      throw new Error(
        'Desktop E2E is disabled on the development computer. Use pnpm test:remote or pnpm check:dev. Only explicit user-requested local debugging may set VERD_TEST_EXECUTION=local.',
      );
    }
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
      // Compare runtimes using the same isolated data and source-based tests.
      const executablePath =
        options.executablePath ??
        process.env['VERDBOARD_E2E_ELECTRON_EXECUTABLE'];
      const desktop = await _electron.launch({
        ...options,
        ...(executablePath ? { executablePath } : {}),
        env,
      });
      const child = desktop.process();
      active = desktop;
      const info = test.info();
      const traceName = `electron-${++traceSequence}`;
      await desktop.context().tracing.start({
        screenshots: true,
        snapshots: true,
        sources: true,
      });
      const errors: string[] = [];
      const observe = (page: import('@playwright/test').Page) => {
        page.on('pageerror', (error) =>
          errors.push(error.stack ?? error.message),
        );
        page.on('console', (message) => {
          if (message.type() === 'error') errors.push(message.text());
        });
      };
      desktop.context().pages().forEach(observe);
      desktop.context().on('page', observe);
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
            const failed =
              info.errors.length > 0 || info.status !== info.expectedStatus;
            try {
              await desktop
                .context()
                .tracing.stop(
                  failed ? { path: info.outputPath(`${traceName}.zip`) } : {},
                );
              if (failed) {
                await info.attach(traceName, {
                  path: info.outputPath(`${traceName}.zip`),
                  contentType: 'application/zip',
                });
                await info.attach(`${traceName}-console`, {
                  body: errors.join('\n'),
                  contentType: 'text/plain',
                });
              }
            } catch {
              // An already closed/crashed Electron context cannot export a trace.
            }
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
