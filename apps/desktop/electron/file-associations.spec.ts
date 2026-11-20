import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  launchFiles,
  supportedDesktopFile,
  setDefaultFileApplications,
} from './file-associations';
import manifest from '../package.json';

const commands = vi.hoisted(() => ({
  calls: [] as { command: string; args: string[] }[],
  defaultApplication: 'verdboard.desktop',
}));
vi.mock('node:child_process', () => {
  const execFile = Object.assign(vi.fn(), {
    [Symbol.for('nodejs.util.promisify.custom')]: async (
      command: string,
      args: string[],
    ) => {
      commands.calls.push({ command, args });
      return {
        stdout:
          command === 'xdg-mime' && args[0] === 'query'
            ? commands.defaultApplication + '\n'
            : '',
        stderr: '',
      };
    },
  });
  return { execFile };
});
const temporary: string[] = [];
beforeEach(() => {
  commands.calls.length = 0;
  commands.defaultApplication = 'verdboard.desktop';
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    temporary
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe('desktop document associations', () => {
  it.each([
    'a.md',
    'a.markdown',
    '画布.verd',
    'old.verd.json',
    'UPPER.MD',
    'UPPER.VERD',
  ])('recognizes %s', (value) =>
    expect(supportedDesktopFile(value)).toBe(true),
  );
  it.each(['a.json', 'a.verd-doc.json', 'a.md.exe'])(
    'does not associate %s',
    (value) => expect(supportedDesktopFile(value)).toBe(false),
  );
  it('parses file URLs, relative paths and repeated activation arguments without treating switches as files', () => {
    const filename = path.resolve('/tmp', '中文 空格.md');
    expect(
      launchFiles(
        [
          '--inspect',
          'app.js',
          pathToFileURL(filename).href,
          'board.verd',
          '--profile=x.md',
        ],
        '/tmp',
      ),
    ).toEqual([filename, path.resolve('/tmp/board.verd')]);
  });
  it('registers only the supported public extensions', () => {
    expect(manifest.build.fileAssociations.flatMap((item) => item.ext)).toEqual(
      ['md', 'markdown', 'verd'],
    );
    expect(manifest.build.appId).toBe('com.verdboard.desktop');
    expect(
      manifest.build.mac.extendInfo.UTExportedTypeDeclarations[0]
        .UTTypeTagSpecification['public.filename-extension'],
    ).toEqual(['verd']);
  });

  it('opens Windows system settings without programmatically replacing UserChoice', async () => {
    const openSettings = vi.fn(async () => {});
    await setDefaultFileApplications({
      platform: 'win32',
      executable: 'C:\\VerdBoard.exe',
      resources: '',
      home: '',
      openSettings,
    });
    expect(openSettings).toHaveBeenCalledWith('ms-settings:defaultapps');
    expect(commands.calls).toEqual([]);
  });

  it('invokes the bundled macOS helper with the installed application URL', async () => {
    await setDefaultFileApplications({
      platform: 'darwin',
      executable: '/Applications/青编.app/Contents/MacOS/VerdBoard',
      resources: '/Applications/青编.app/Contents/Resources',
      home: '',
      openSettings: async () => {},
    });
    expect(commands.calls).toEqual([
      {
        command:
          '/Applications/青编.app/Contents/Resources/default-file-handler',
        args: ['/Applications/青编.app'],
      },
    ]);
  });

  it('integrates an AppImage and verifies Linux MIME defaults for the current user', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'verd-mime-'));
    temporary.push(directory);
    const resources = path.join(directory, 'resources');
    await fs.mkdir(path.join(resources, 'app.asar/build'), { recursive: true });
    await fs.writeFile(path.join(resources, 'app.asar/build/icon.png'), 'icon');
    const data = path.join(directory, 'data');
    vi.stubEnv('XDG_DATA_HOME', data);
    vi.stubEnv('APPIMAGE', '/Applications/中文 软件.AppImage');
    await setDefaultFileApplications({
      platform: 'linux',
      executable: '/tmp/mounted/verdboard',
      resources,
      home: directory,
      openSettings: async () => {},
    });
    const desktop = await fs.readFile(
      path.join(data, 'applications/verdboard.desktop'),
      'utf8',
    );
    const mime = await fs.readFile(
      path.join(data, 'mime/packages/verdboard.xml'),
      'utf8',
    );
    expect(mime).toContain('<glob pattern="*.md"/>');
    expect(mime).toContain('<glob pattern="*.markdown"/>');
    expect(mime).toContain('<glob pattern="*.verd"/>');
    expect(desktop).toContain('Exec="/Applications/中文 软件.AppImage" %F');
    expect(desktop).toContain(
      'MimeType=text/markdown;text/x-markdown;application/vnd.verdscrolls+json;',
    );
    expect(commands.calls).toContainEqual({
      command: 'xdg-icon-resource',
      args: [
        'install',
        '--mode',
        'user',
        '--context',
        'mimetypes',
        '--size',
        '256',
        path.join(data, 'icons/hicolor/256x256/apps/com.verdboard.desktop.png'),
        'application-vnd.verdscrolls+json',
      ],
    });
    expect(commands.calls).toContainEqual({
      command: 'xdg-mime',
      args: [
        'default',
        'verdboard.desktop',
        'text/markdown',
        'text/x-markdown',
        'application/vnd.verdscrolls+json',
      ],
    });
    expect(
      commands.calls.filter(
        (call) => call.command === 'xdg-mime' && call.args[0] === 'query',
      ),
    ).toHaveLength(2);
  });
});
