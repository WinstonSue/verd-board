import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import SerializedRemoteReporter from './remote-playwright-reporter.cjs';

test('concurrent reporter callbacks flush all attachments before the terminal index', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'verd-reporter-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  class Reporter {
    entries = [];
    async onBegin() {
      await fs.writeFile(path.join(root, 'started'), 'yes');
    }
    async onTestEnd(value) {
      assert.equal(
        await fs.readFile(path.join(root, 'started'), 'utf8'),
        'yes',
      );
      const temporary = path.join(root, 'index.json.tmp');
      this.entries.push(value);
      await fs.writeFile(temporary, JSON.stringify(this.entries));
      await new Promise((resolve) => setTimeout(resolve, 1));
      await fs.rename(temporary, path.join(root, 'index.json'));
    }
    async onEnd() {
      assert.equal(this.entries.length, 20);
      return { status: 'passed' };
    }
  }
  const reporter = new SerializedRemoteReporter({}, Reporter);
  reporter.onBegin();
  const pending = Array.from({ length: 20 }, (_, index) =>
    reporter.onTestEnd(index),
  );
  assert.deepEqual(await reporter.onEnd(), { status: 'passed' });
  await Promise.all(pending);
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(root, 'index.json'), 'utf8')),
    Array.from({ length: 20 }, (_, index) => index),
  );
});

test('attachment failures cannot produce a successful terminal callback or an automatic retry', async () => {
  let attempts = 0;
  class Reporter {
    onTestEnd() {
      attempts++;
      throw new Error('attachment unavailable');
    }
    onEnd() {
      assert.fail('Cannot finalize incomplete diagnostics');
    }
  }
  const reporter = new SerializedRemoteReporter({}, Reporter);
  await assert.rejects(reporter.onTestEnd(), /attachment unavailable/);
  await assert.rejects(reporter.onEnd(), /attachment unavailable/);
  assert.equal(attempts, 1);
});
