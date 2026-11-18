import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { stageReleaseResources } from './package-resources.mjs';
import { artifactFiles } from './release-proof.mjs';

test('packaging copies the accepted bundle and rejects proof or target mismatch before overwriting', async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'verd-stage-resources-'),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'accepted');
  const destination = path.join(root, 'output');
  await fs.mkdir(source);
  await fs.mkdir(destination);
  await fs.writeFile(path.join(source, 'runtime'), 'accepted bytes', {
    mode: 0o755,
  });
  await fs.writeFile(path.join(destination, 'runtime'), 'previous');
  const context = {
    proof: { identity: { platform: 'darwin', arch: 'arm64' } },
    artifacts: {
      agent: { path: source, files: await artifactFiles(source) },
      builtin: { path: 'accepted-builtin' },
    },
  };
  const options = {
    platform: 'darwin',
    arch: 'arm64',
    destination,
    builtinDestination: 'builtin-output',
  };
  let copies = 0;
  const hooks = {
    validate: async () => {},
    copyBuiltin: async (from, to) => {
      assert.equal(from, 'accepted-builtin');
      assert.equal(to, 'builtin-output');
      copies++;
    },
  };
  await assert.rejects(
    stageReleaseResources(context, options, {
      ...hooks,
      validate: async () => {
        throw new Error('failed release proof');
      },
    }),
    /failed release/,
  );
  await assert.rejects(
    stageReleaseResources(context, { ...options, arch: 'x64' }, hooks),
    /target differs/,
  );
  assert.equal(
    await fs.readFile(path.join(destination, 'runtime'), 'utf8'),
    'previous',
  );
  assert.equal(copies, 0);
  await stageReleaseResources(context, options, hooks);
  assert.equal(copies, 1);
  assert.equal(
    await fs.readFile(path.join(destination, 'runtime'), 'utf8'),
    'accepted bytes',
  );
  assert.equal(
    (await fs.stat(path.join(destination, 'runtime'))).mode & 0o111,
    0o111,
  );
});
