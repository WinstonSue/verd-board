import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseCli, main, captureProof, verifyProof } from './remote-test.mjs';

test('repository adapter preserves full gate and development selection requirements', () => {
  assert.deepEqual(parseCli([]), ['run', 'ci', '--']);
  const args = [
    '--unit',
    'scripts/remote-test.test.mjs',
    '--desktop-e2e',
    'tests/desktop-e2e/src/dev-runtime.spec.ts',
  ];
  assert.deepEqual(parseCli(['dev', ...args]), ['run', 'dev', '--', ...args]);
  assert.throws(() => parseCli(['ci', ...args]));
  assert.throws(() =>
    parseCli(['dev', '--unit', 'scripts/remote-test.test.mjs']),
  );
  assert.deepEqual(parseCli(['fetch', 'fixture-123', '--raw']), [
    'fetch',
    'fixture-123',
    '--raw',
  ]);
  assert.deepEqual(parseCli(['artifacts', 'fixture-123']), [
    'artifacts',
    'fixture-123',
  ]);
  assert.throws(() => parseCli(['cancel', '../escape']));
});
test('repository entry forwards to user-level tool and preserves its exit code', async () => {
  let call;
  const code = await main(['doctor'], {
    execute: async (...args) => {
      call = args;
      return 9;
    },
  });
  assert.equal(code, 9);
  assert.ok(call[0].endsWith('/.local/bin/remote-test'));
  assert.deepEqual(call[1], ['doctor']);
});
test('project proof binds quality record to source and task', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'verd-remote-proof-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'scripts'));
  await fs.mkdir(path.join(root, '.quality'));
  await fs.writeFile(
    path.join(root, 'scripts/release-review.mjs'),
    'export const sourceInventory = async () => ["current"]; export const hash = values => values.join(":");',
  );
  const proof = await captureProof(root);
  const file = path.join(root, 'manifest.json');
  await fs.writeFile(file, JSON.stringify({ task: 'dev', proof }));
  const quality = path.join(root, '.quality/dev.json');
  await fs.writeFile(
    quality,
    JSON.stringify({ mode: 'dev', sourceDigest: 'current' }),
  );
  await verifyProof(file, root);
  await fs.writeFile(
    quality,
    JSON.stringify({ mode: 'ci', sourceDigest: 'current' }),
  );
  await assert.rejects(verifyProof(file, root), /captured source/);
  await fs.writeFile(
    quality,
    JSON.stringify({ mode: 'dev', sourceDigest: 'old' }),
  );
  await assert.rejects(verifyProof(file, root), /captured source/);
});

test('failed gate records can never serve as source proof', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'verd-failed-proof-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'scripts'));
  await fs.mkdir(path.join(root, '.quality'));
  await fs.writeFile(
    path.join(root, 'scripts/release-review.mjs'),
    'export const sourceInventory = async () => ["current"]; export const hash = () => "current";',
  );
  const file = path.join(root, 'manifest.json');
  await fs.writeFile(
    file,
    JSON.stringify({ task: 'dev', proof: { sourceDigest: 'current' } }),
  );
  await fs.writeFile(
    path.join(root, '.quality/dev.json'),
    JSON.stringify({ mode: 'dev', status: 'failed', sourceDigest: 'current' }),
  );
  await assert.rejects(verifyProof(file, root), /captured source/);
});
