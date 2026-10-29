import * as path from 'path';

interface DesktopApplication {
  isPackaged: boolean;
  getPath(name: 'appData' | 'userData'): string;
  setPath(name: 'userData', value: string): void;
  setName(name: string): void;
}

/** Run before creating hosts or Chromium sessions. Test overrides stay isolated. */
export function configureApplicationIdentity(
  app: DesktopApplication,
  environment: NodeJS.ProcessEnv = process.env,
): { legacyUserDataRoot?: string } {
  const appData = app.getPath('appData');
  const initial = app.getPath('userData');
  const override = environment['VERDBOARD_USER_DATA_PATH'];
  const userData = override
    ? path.resolve(override)
    : path.join(appData, app.isPackaged ? 'VerdBoard' : 'VerdBoard Dev');
  app.setName(app.isPackaged ? 'VerdBoard' : 'VerdBoard Dev');
  // Unpackaged E2E launchers can set their own path before loading main.js.
  if (
    app.isPackaged ||
    override ||
    initial === path.join(appData, 'VerdBoard') ||
    initial === path.join(appData, 'desktop') ||
    initial === path.join(appData, 'VerdBoard Dev') ||
    initial === path.join(appData, 'Electron')
  )
    app.setPath('userData', userData);
  return app.isPackaged
    ? { legacyUserDataRoot: path.join(path.dirname(userData), 'desktop') }
    : {};
}
