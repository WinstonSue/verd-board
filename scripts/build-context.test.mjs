import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildInContext } from './build-context.mjs';

test('same-run service build is reused only while source and every output byte match', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'verd-build-context-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'dist');
  const marker = path.join(root, 'context.json');
  let source = 'first';
  let builds = 0;
  const options = {
    marker,
    directory,
    inputs: async () => source,
    build: async () => {
      builds++;
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(path.join(directory, 'main.mjs'), source);
    },
  };
  await buildInContext(options);
  await buildInContext(options);
  assert.equal(builds, 1);
  await fs.writeFile(path.join(directory, 'main.mjs'), 'corrupt');
  await buildInContext(options);
  assert.equal(builds, 2);
  source = 'new version';
  await buildInContext(options);
  assert.equal(builds, 3);
  await fs.rm(path.join(directory, 'main.mjs'));
  await buildInContext(options);
  assert.equal(builds, 4);
  await buildInContext({ ...options, marker: undefined });
  assert.equal(builds, 5);
  await assert.rejects(
    buildInContext({
      ...options,
      marker: undefined,
      build: async () => {
        source = 'mutation';
      },
    }),
    /Source changed/,
  );
});
