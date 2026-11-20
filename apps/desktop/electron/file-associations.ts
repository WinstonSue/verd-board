import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
export const supportedDesktopFile = (filename: string) =>
  /\.(md|markdown|verd(?:\.json)?)$/i.test(filename);

/** argv may contain local file URLs on Linux and relative paths on Windows. */
export function launchFiles(argv: readonly string[], cwd: string) {
  return argv
    .filter((value) => !value.startsWith('-'))
    .flatMap((value) => {
      try {
        const filename = value.startsWith('file:')
          ? fileURLToPath(value)
          : path.resolve(cwd, value);
        return supportedDesktopFile(filename) ? [filename] : [];
      } catch {
        return [];
      }
    });
}

export async function setDefaultFileApplications(options: {
  platform: NodeJS.Platform;
  executable: string;
  resources: string;
  home: string;
  openSettings(url: string): Promise<void>;
}) {
  if (options.platform === 'win32') {
    await options.openSettings('ms-settings:defaultapps');
  } else if (options.platform === 'darwin') {
    await exec(path.join(options.resources, 'default-file-handler'), [
      path.resolve(path.dirname(options.executable), '../..'),
    ]);
  } else if (options.platform === 'linux') {
    const data =
      process.env['XDG_DATA_HOME'] || path.join(options.home, '.local/share');
    const applications = path.join(data, 'applications');
    const mime = path.join(data, 'mime', 'packages');
    await fs.mkdir(applications, { recursive: true });
    await fs.mkdir(mime, { recursive: true });
    const desktopId = 'verdboard.desktop';
    const icons = path.join(data, 'icons', 'hicolor', '256x256', 'apps');
    await fs.mkdir(icons, { recursive: true });
    await fs.writeFile(
      path.join(icons, 'com.verdboard.desktop.png'),
      await fs.readFile(
        path.join(options.resources, 'app.asar', 'build', 'icon.png'),
      ),
    );
    const executable = process.env['APPIMAGE'] || options.executable;
    const quoted =
      '"' + executable.replace(/[\\"`$]/g, '\\$&').replace(/%/g, '%%') + '"';
    await fs.writeFile(
      path.join(applications, desktopId),
      `[Desktop Entry]\nType=Application\nName=VerdBoard\nExec=${quoted} %F\nIcon=com.verdboard.desktop\nTerminal=false\nMimeType=text/markdown;text/x-markdown;application/vnd.verdscrolls+json;\n`,
    );
    await fs.writeFile(
      path.join(mime, 'verdboard.xml'),
      '<?xml version="1.0"?><mime-info xmlns="http://www.freedesktop.org/standards/shared-mime-info"><mime-type type="text/markdown"><comment>Markdown</comment><glob pattern="*.md"/><glob pattern="*.markdown"/></mime-type><mime-type type="application/vnd.verdscrolls+json"><comment>VerdBoard canvas</comment><sub-class-of type="application/json"/><glob pattern="*.verd"/></mime-type></mime-info>',
    );
    await exec('update-mime-database', [path.dirname(mime)]);
    await exec('update-desktop-database', [applications]);
    await exec('xdg-icon-resource', [
      'install',
      '--mode',
      'user',
      '--context',
      'mimetypes',
      '--size',
      '256',
      path.join(icons, 'com.verdboard.desktop.png'),
      'application-vnd.verdscrolls+json',
    ]);
    await exec('xdg-mime', [
      'default',
      desktopId,
      'text/markdown',
      'text/x-markdown',
      'application/vnd.verdscrolls+json',
    ]);
    for (const type of ['text/markdown', 'application/vnd.verdscrolls+json']) {
      if (
        (await exec('xdg-mime', ['query', 'default', type])).stdout.trim() !==
        desktopId
      )
        throw new Error('系统尚未确认默认应用，请在系统设置中选择 VerdBoard');
    }
  }
}
