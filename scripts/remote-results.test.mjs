import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  readInstallerChecksums,
  summaryExitCode,
  waitForTask,
  summarizeResults,
} from './remote-results.mjs';

test('terminal success requires current complete gate evidence and actual package delivery', () => {
  const passed = {
    task: 'ci',
    status: 'passed',
    currentSource: true,
    diagnosticsComplete: true,
    gateStatus: 'passed',
  };
  assert.equal(summaryExitCode(passed), 0);
  assert.equal(summaryExitCode({ ...passed, currentSource: false }), 2);
  assert.equal(summaryExitCode({ ...passed, diagnosticsComplete: false }), 2);
  assert.equal(
    summaryExitCode({
      ...passed,
      task: 'package',
      packageStatus: 'passed',
      deliveryStatus: 'failed',
    }),
    1,
  );
  assert.equal(
    summaryExitCode({
      ...passed,
      task: 'package',
      packageStatus: 'passed',
      deliveryStatus: 'delivered',
    }),
    0,
  );
});

test('a locked GUI is reported as an environment blocker with the concrete recovery action', async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'verd-gui-summary-'),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  for (const [name, value] of Object.entries({
    'manifest.json': { id: 'locked-task', task: 'ci' },
    'status.json': { state: 'failed', error: 'prepare exited 1' },
    'source/.quality/gui-session.json': {
      ready: false,
      error:
        'Remote Mac is locked; unlock the test desktop before GUI validation.',
    },
  })) {
    await fs.mkdir(path.dirname(path.join(directory, name)), {
      recursive: true,
    });
    await fs.writeFile(path.join(directory, name), JSON.stringify(value));
  }
  const result = await summarizeResults(directory);
  assert.equal(result.gateStatus, 'unavailable');
  assert.equal(result.gui.ready, false);
  assert.match(result.error, /unlock the test desktop/);
});

test('waiting resumes the same task, fetches once at terminal state, and timeout never cancels', async () => {
  let time = 0,
    calls = 0,
    fetched = 0;
  const summary = await waitForTask('original-id', {
    status: async (id) => {
      assert.equal(id, 'original-id');
      return { state: ++calls === 2 ? 'failed' : 'running' };
    },
    fetch: async (id) => {
      assert.equal(id, 'original-id');
      fetched++;
    },
    summarize: async () => ({ status: 'failed', failedTests: ['regression'] }),
    now: () => time,
    sleep: async (ms) => {
      time += ms;
    },
  });
  assert.equal(summary.status, 'failed');
  assert.equal(fetched, 1);
  const timeout = await waitForTask('original-id', {
    timeout: 0,
    status: async () => ({ state: 'running' }),
    fetch: async () => assert.fail('Cannot fetch an unfinished task'),
    summarize: async () => assert.fail('Cannot summarize an unfinished task'),
  });
  assert.equal(timeout.timedOut, true);
  assert.equal(timeout.taskId, 'original-id');
});

test('summary keeps gate, package, retrieval evidence and delivery statuses separate', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'verd-summary-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const write = async (name, value) => {
    await fs.mkdir(path.dirname(path.join(directory, name)), {
      recursive: true,
    });
    await fs.writeFile(path.join(directory, name), JSON.stringify(value));
  };
  await write('manifest.json', { id: 'same-id', task: 'package' });
  await write('status.json', {
    state: 'failed',
    exitCode: 1,
    error: 'task exited 1',
  });
  await write('local-comparison.json', { current: false });
  await write('artifacts.json', { complete: true });
  await write('source/.quality/release.json', {
    status: 'passed',
    steps: [{ id: 'unit', status: 'passed' }],
    verification: {
      units: [{ id: 'core', action: 'reuse', evidence: { digest: 'proof' } }],
    },
  });
  await write('source/.quality/package.json', {
    status: 'failed',
    error: 'packaged E2E failed',
  });
  const checksumFile = path.join(
    directory,
    'source/apps/desktop/release/SHA256SUMS',
  );
  const checksum = 'a'.repeat(64);
  await fs.mkdir(path.dirname(checksumFile), { recursive: true });
  await fs.writeFile(checksumFile, checksum + '  VerdBoard.dmg\n');
  const summary = await summarizeResults(directory);
  assert.equal(summary.gateStatus, 'passed');
  assert.equal(summary.packageStatus, 'failed');
  assert.equal(summary.currentSource, false);
  assert.equal(summary.deliveryStatus, 'not-promoted');
  assert.deepEqual(summary.scope.reused, [{ id: 'core', proof: 'proof' }]);
  assert.equal(summary.error, 'packaged E2E failed');
  assert.deepEqual(summary.checksums, { 'VerdBoard.dmg': checksum });
  await fs.writeFile(checksumFile, (checksum + '  VerdBoard.dmg\n').repeat(2));
  await assert.rejects(
    readInstallerChecksums(path.dirname(checksumFile)),
    /SHA256SUMS/,
  );
  const malformed = await summarizeResults(directory);
  assert.equal(malformed.packageStatus, 'failed');
  assert.match(malformed.checksumError, /SHA256SUMS/);
  await fs.writeFile(checksumFile, 'not-a-checksum  VerdBoard.dmg\n');
  await assert.rejects(
    readInstallerChecksums(path.dirname(checksumFile)),
    /SHA256SUMS/,
  );
  for (const name of [
    'bad\u0000.dmg',
    'bad\u001f.dmg',
    '../bad.dmg',
    'bad\\name.dmg',
  ]) {
    await fs.writeFile(checksumFile, checksum + '  ' + name + '\n');
    await assert.rejects(
      readInstallerChecksums(path.dirname(checksumFile)),
      /SHA256SUMS/,
    );
  }
});

test('explicitly withdrawn tasks finish adapter observation without waiting again', async () => {
  let fetched = 0;
  const result = await waitForTask('withdrawn-task', {
    status: async () => ({ state: 'withdrawn' }),
    fetch: async () => {
      fetched++;
    },
    summarize: async () => ({ taskId: 'withdrawn-task', status: 'withdrawn' }),
    sleep: async () => {
      throw new Error('withdrawn task must be terminal');
    },
  });
  assert.equal(result.status, 'withdrawn');
  assert.equal(fetched, 1);
});
