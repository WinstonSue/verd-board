import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const launch = vi.hoisted(() => vi.fn());
vi.mock('@playwright/test', () => ({ _electron: { launch } }));

beforeEach(() => {
  vi.resetModules();
  launch.mockReset();
});
afterEach(() => vi.useRealTimers());

function application(blockClose = false) {
  const child = Object.assign(new EventEmitter(), {
    exitCode: null as number | null,
    signalCode: null as string | null,
    kill: vi.fn((_signal: string) => {
      child.signalCode = 'SIGKILL';
      child.emit('exit');
      resolveClose();
      return true;
    }),
  });
  let resolveClose = () => {};
  const closed = new Promise<void>((resolve) => {
    resolveClose = resolve;
  });
  const close = vi.fn(async () => {
    if (blockClose) return closed;
    child.exitCode = 0;
    child.emit('exit');
  });
  return { child, close, desktop: { process: () => child, close } };
}

it('allows a restart only after the previous owned process exits', async () => {
  const { electron } =
    await import('../../../tests/desktop-e2e/src/desktop-launcher');
  const first = application();
  const second = application();
  launch
    .mockResolvedValueOnce(first.desktop)
    .mockResolvedValueOnce(second.desktop);
  const listeners = process.listenerCount('exit');
  const desktop = await electron.launch({ args: ['test.cjs'] });
  await expect(electron.launch({ args: ['test.cjs'] })).rejects.toThrow(
    'Close the previous',
  );
  expect(launch).toHaveBeenCalledTimes(1);
  await desktop.close();
  await desktop.close();
  expect(first.close).toHaveBeenCalledTimes(1);
  expect(first.child.kill).not.toHaveBeenCalled();
  expect(process.listenerCount('exit')).toBe(listeners);
  await (await electron.launch({ args: ['test.cjs'] })).close();
});

it('rejects overlapping launches and permits retry after a launch failure', async () => {
  const { electron } =
    await import('../../../tests/desktop-e2e/src/desktop-launcher');
  let fail = (_error: Error) => {};
  launch.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  );
  const pending = electron.launch({ args: ['test.cjs'] });
  const failed = expect(pending).rejects.toThrow('startup failed');
  await expect(electron.launch({ args: ['test.cjs'] })).rejects.toThrow(
    'Close the previous',
  );
  fail(new Error('startup failed'));
  await failed;
  launch.mockResolvedValueOnce(application().desktop);
  await (await electron.launch({ args: ['test.cjs'] })).close();
});

it('reaps its own child if graceful close stalls', async () => {
  vi.useFakeTimers();
  const { electron } =
    await import('../../../tests/desktop-e2e/src/desktop-launcher');
  const instance = application(true);
  launch.mockResolvedValueOnce(instance.desktop);
  const listeners = process.listenerCount('exit');
  const desktop = await electron.launch({ args: ['test.cjs'] });
  const closing = desktop.close();
  await vi.advanceTimersByTimeAsync(10_000);
  await closing;
  expect(instance.child.kill).toHaveBeenCalledExactlyOnceWith('SIGKILL');
  expect(process.listenerCount('exit')).toBe(listeners);
});

it('keeps test windows out of the Dock and exits if their owner disappears', async () => {
  const { writeDesktopLauncher } =
    await import('../../../tests/desktop-e2e/src/desktop-launcher');
  const directory = await mkdtemp(path.join(tmpdir(), 'verd-launcher-unit-'));
  try {
    const launcher = path.join(directory, 'launch.cjs');
    const userData = path.join(directory, 'user-data');
    await writeDesktopLauncher(launcher, userData);
    const app = {
      setPath: vi.fn(),
      setActivationPolicy: vi.fn(),
      exit: vi.fn(),
    };
    const kill = vi.fn();
    let checkOwner = () => {};
    const env: Record<string, string> = {};
    runInNewContext(await readFile(launcher, 'utf8'), {
      require: (name: string) => (name === 'electron' ? { app } : {}),
      process: { platform: 'darwin', env, kill },
      setInterval: (callback: () => void) => {
        checkOwner = callback;
        return { unref() {} };
      },
    });
    expect(app.setActivationPolicy).toHaveBeenCalledWith('accessory');
    expect(app.setPath).toHaveBeenCalledWith('userData', userData);
    checkOwner();
    expect(kill).toHaveBeenCalledWith(process.pid, 0);
    expect(app.exit).not.toHaveBeenCalled();
    kill.mockImplementation(() => {
      throw new Error('ESRCH');
    });
    checkOwner();
    expect(app.exit).toHaveBeenCalledWith(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
