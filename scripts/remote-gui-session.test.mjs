import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { assertGuiReady, runGuiCommand } from './remote-gui-session.mjs';

test('locked Mac sessions fail before starting a GUI command', async () => {
  await assert.rejects(
    runGuiCommand(['pnpm', 'check:ci'], {
      platform: 'darwin',
      inspect: () => '"CGSSessionScreenIsLocked" = Yes',
      launch: () => assert.fail('Cannot launch a locked session'),
    }),
    { code: 'GUI_LOCKED' },
  );
  assert.doesNotThrow(() =>
    assertGuiReady({
      platform: 'darwin',
      inspect: () => '"kCGSSessionScreenIsLocked" = No',
    }),
  );
  assert.doesNotThrow(() =>
    assertGuiReady({
      platform: 'linux',
      inspect: () => assert.fail('No macOS inspection on Linux'),
    }),
  );
});

test('display wake assertion belongs to the command lifetime and preserves failures', async () => {
  const calls = [];
  let released = false;
  const code = await runGuiCommand(['pnpm', 'check:ci', '--full'], {
    platform: 'darwin',
    inspect: () => '',
    launch(program, args) {
      calls.push([program, args]);
      const child = new EventEmitter();
      child.kill = () => {
        released = true;
      };
      queueMicrotask(() =>
        child.emit(program.endsWith('caffeinate') ? 'spawn' : 'close', 7),
      );
      return child;
    },
  });
  assert.equal(code, 7);
  assert.deepEqual(calls[0], [
    '/usr/bin/caffeinate',
    ['-d', '-i', '-w', String(process.pid)],
  ]);
  assert.deepEqual(calls[1], ['pnpm', ['check:ci', '--full']]);
  assert.equal(released, true);
});
