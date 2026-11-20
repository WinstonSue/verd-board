import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  releaseInputs,
  assertFullRelease,
  assertReleaseContext,
  captureArtifacts,
} from './release-proof.mjs';
import { hash } from './release-review.mjs';
import { releaseProofFixture } from '../tests/fixtures/release-proof.mjs';

test('release inputs bind versions, packaged changelogs, file mode and deletion', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'verd-inputs-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', root]);
  await fs.writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'fixture', version: '1.0.0' }),
  );
  await fs.writeFile(path.join(root, 'CHANGELOG.md'), 'first');
  const original = await releaseInputs(root);
  await fs.writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'fixture', version: '1.0.1' }),
  );
  const version = await releaseInputs(root);
  assert.notEqual(original.releaseInputDigest, version.releaseInputDigest);
  await fs.writeFile(path.join(root, 'CHANGELOG.md'), 'updated');
  const prose = await releaseInputs(root);
  assert.notEqual(version.releaseInputDigest, prose.releaseInputDigest);
  await fs.chmod(path.join(root, 'CHANGELOG.md'), 0o755);
  assert.notEqual(
    prose.releaseInputDigest,
    (await releaseInputs(root)).releaseInputDigest,
  );
  await fs.rm(path.join(root, 'CHANGELOG.md'));
  assert.notEqual(
    prose.releaseInputDigest,
    (await releaseInputs(root)).releaseInputDigest,
  );
});

test('only one complete release proof can authorize unchanged artifacts in the same run', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'verd-proof-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directories = {};
  for (const name of ['agent', 'builtin', 'desktop', 'electron']) {
    directories[name] = path.join(root, name);
    await fs.mkdir(directories[name]);
    await fs.writeFile(path.join(directories[name], 'asset'), name, {
      mode: 0o755,
    });
  }
  const identity = {
    releaseInputDigest: 'source',
    versions: { fixture: '1.0.0' },
    reviewDigest: 'review',
    environmentDigest: 'environment',
    platform: 'darwin',
    arch: 'arm64',
    toolchain: { node: 'v24', pnpm: '11', electron: '44' },
    concurrency: { budget: 4, packages: 2, workers: 2, web: 2, desktop: 1 },
  };
  const proof = releaseProofFixture(identity);
  const artifacts = await captureArtifacts(directories);
  const context = {
    format: 'verd-release-context',
    version: 1,
    proof,
    artifacts,
    digest: hash({ proof, artifacts }),
  };
  const options = {
    root,
    runId: 'same-run',
    identity: async () => identity,
    verifyUnits: async () => {},
  };
  await assertReleaseContext(context, options);
  for (const altered of [
    { ...proof, mode: 'dev' },
    { ...proof, status: 'failed' },
    { ...proof, selection: {} },
    { ...proof, steps: proof.steps.slice(1) },
  ])
    assert.throws(() => assertFullRelease(altered), /complete/);
  await assert.rejects(
    assertReleaseContext(context, { ...options, runId: 'another-run' }),
    /another run/,
  );
  await assert.rejects(
    assertReleaseContext(context, {
      ...options,
      identity: async () => ({ ...identity, versions: { fixture: '1.0.1' } }),
    }),
    /changed/,
  );
  await fs.writeFile(path.join(directories.agent, 'extra'), 'unexpected');
  await assert.rejects(
    assertReleaseContext(context, options),
    /artifact changed/,
  );
  await fs.rm(path.join(directories.agent, 'extra'));
  await fs.chmod(path.join(directories.agent, 'asset'), 0o644);
  await assert.rejects(
    assertReleaseContext(context, options),
    /artifact changed/,
  );
  await fs.rm(path.join(directories.agent, 'asset'));
  await assert.rejects(assertReleaseContext(context, options));
});
