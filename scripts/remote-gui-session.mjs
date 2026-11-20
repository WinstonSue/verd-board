import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const GUI_SESSION_SCRIPT = 'scripts/remote-gui-session.mjs';

export function assertGuiReady({
  platform = process.platform,
  inspect = () =>
    execFileSync('/usr/sbin/ioreg', ['-n', 'Root', '-d1', '-l'], {
      encoding: 'utf8',
    }),
} = {}) {
  if (platform !== 'darwin') return;
  if (/"(?:k)?CGSSessionScreenIsLocked"\s*=\s*(?:Yes|true)/.test(inspect()))
    throw Object.assign(
      new Error(
        'Remote Mac is locked; unlock the test desktop before GUI validation.',
      ),
      { code: 'GUI_LOCKED' },
    );
}

export async function runGuiCommand(
  args,
  { platform = process.platform, inspect, launch = spawn } = {},
) {
  if (!args.length || (args[0] === '--check' && args.length !== 1))
    throw new Error('Use remote-gui-session --check or <command> [arguments]');
  assertGuiReady({ platform, inspect });
  if (args[0] === '--check') return 0;
  const awake =
    platform === 'darwin'
      ? launch('/usr/bin/caffeinate', ['-d', '-i', '-w', String(process.pid)], {
          stdio: 'ignore',
        })
      : null;
  try {
    if (awake)
      await new Promise((resolve, reject) => {
        awake.once('spawn', resolve);
        awake.once('error', reject);
      });
    const child = launch(args[0], args.slice(1), {
      stdio: 'inherit',
      shell: platform === 'win32' && args[0] === 'pnpm',
    });
    const signals = ['SIGINT', 'SIGTERM'].map((signal) => {
      const forward = () => child.kill(signal);
      process.on(signal, forward);
      return [signal, forward];
    });
    try {
      return await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code, signal) =>
          resolve(
            code ??
              (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1),
          ),
        );
      });
    } finally {
      for (const [signal, forward] of signals) process.off(signal, forward);
    }
  } finally {
    awake?.kill();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  if (!process.env.REMOTE_TEST_JOB_DIR)
    throw new Error('GUI session commands require the remote-test worker');
  const record = {
    checkedAt: new Date().toISOString(),
    ready: true,
    error: null,
  };
  try {
    assertGuiReady();
    await fs.mkdir('.quality', { recursive: true });
    await fs.writeFile(
      '.quality/gui-session.json',
      JSON.stringify(record) + '\n',
    );
    process.exitCode = await runGuiCommand(process.argv.slice(2));
  } catch (error) {
    await fs.mkdir('.quality', { recursive: true });
    await fs.writeFile(
      '.quality/gui-session.json',
      JSON.stringify({ ...record, ready: false, error: error.message }) + '\n',
    );
    console.error(error.message);
    process.exitCode = 1;
  }
}
