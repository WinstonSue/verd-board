import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { replaceReleaseDirectory } from './package-output.mjs';

test('failed verification preserves the previous release; passing bytes replace it atomically', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'verd-package-output-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const output = path.join(root, 'release');
  const archive = path.join(root, 'history/previous');
  await fs.mkdir(source);
  await fs.mkdir(output);
  await fs.writeFile(path.join(source, 'installer'), 'new');
  await fs.writeFile(path.join(output, 'installer'), 'previous');
  await assert.rejects(
    replaceReleaseDirectory(source, output, archive, async () => {
      throw new Error('bad package');
    }),
    /bad package/,
  );
  assert.equal(
    await fs.readFile(path.join(output, 'installer'), 'utf8'),
    'previous',
  );
  await assert.rejects(fs.stat(archive), { code: 'ENOENT' });
  await replaceReleaseDirectory(source, output, archive, async (staging) => {
    assert.equal(
      await fs.readFile(path.join(staging, 'installer'), 'utf8'),
      'new',
    );
  });
  assert.equal(
    await fs.readFile(path.join(output, 'installer'), 'utf8'),
    'new',
  );
  assert.equal(
    await fs.readFile(path.join(archive, 'installer'), 'utf8'),
    'previous',
  );
});
