import { test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  desktopDevUrl,
  electron,
  writeDesktopLauncher,
} from './desktop-launcher';
import { exerciseFindBars } from '../../helpers/find-bar';

test('Desktop shares canvas and document find controls and preserves replacement history', async () => {
  const info = test.info();
  const directory = await mkdtemp(path.join(tmpdir(), 'verd-find-'));
  let desktop: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    const launcher = path.join(directory, 'launch.cjs');
    await writeDesktopLauncher(launcher, path.join(directory, 'user-data'));
    desktop = await electron.launch({
      args: [launcher],
      env: {
        ...process.env,
        VERDBOARD_WORKSPACE_PATH: path.join(directory, 'workspace'),
      },
    });
    const page = await desktop.firstWindow();
    await exerciseFindBars(
      page,
      (name) => info.outputPath(name),
      'dark',
      desktopDevUrl,
    );
  } finally {
    await desktop?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
