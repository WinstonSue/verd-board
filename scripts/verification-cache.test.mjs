import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  readVerification,
  saveVerification,
  validVerification,
} from './verification-cache.mjs';

test('only complete matching immutable evidence can be reused; PRs cannot publish trusted baselines', async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'verd-unit-proof-'),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const unit = {
    id: 'core',
    fingerprint: 'current-inputs',
    tests: ['src/core.spec.ts'],
  };
  assert.equal(await readVerification(directory, unit), null);
  await assert.rejects(
    saveVerification(directory, unit, 'run', [{ status: 'failed' }], {}),
  );
  assert.equal(
    await saveVerification(directory, unit, 'pr', [{ status: 'passed' }], {
      GITHUB_ACTIONS: 'true',
    }),
    undefined,
  );
  const proof = await saveVerification(
    directory,
    unit,
    'baseline',
    [{ id: 'core', status: 'passed', exitCode: 0 }],
    {},
  );
  assert.equal(validVerification(proof, unit), true);
  assert.equal(validVerification({ ...proof, status: 'failed' }, unit), false);
  assert.equal(
    validVerification(proof, { ...unit, fingerprint: 'different' }),
    false,
  );
  assert.equal(validVerification({ ...proof, tests: [] }, unit), false);
  assert.deepEqual(await readVerification(directory, unit), proof);
});
