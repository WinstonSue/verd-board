import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  parseCli,
  main,
  captureProof,
  verifyProof,
  deriveConfiguration,
  developmentProfile,
  verifyPackageRecord,
} from './remote-test.mjs';
import { artifactFiles, releaseInputs } from './release-proof.mjs';
import { releaseProofFixture } from '../tests/fixtures/release-proof.mjs';

test('pure package and consumer contracts need no GUI regardless of architecture layer', () => {
  const units = [
    { action: 'run', layer: 'product', runner: 'vitest' },
    { action: 'run', layer: 'contract', runner: 'vitest' },
  ];
  assert.equal(developmentProfile({ units }, 'project'), 'project-units');
  assert.equal(
    developmentProfile(
      { units: [...units, { action: 'outside', runtime: 'production' }] },
      'project',
    ),
    'project-units',
  );
  assert.equal(
    developmentProfile(
      {
        units: [
          ...units,
          { action: 'run', runtime: 'production', host: 'desktop' },
        ],
      },
      'project',
    ),
    'project-dev',
  );
  assert.equal(
    developmentProfile(
      { units: [{ action: 'run', runtime: 'production', host: 'web' }] },
      'project',
    ),
    'project-web',
  );
});

test('GUI tasks own their display assertion while headless profiles keep independent preparation', () => {
  const original = {
    version: 1,
    hosts: { host: { ssh: 'host', cacheDir: '~/cache' } },
    projects: {
      fixture: {
        root: '/fixture',
        host: 'host',
        requiresGui: true,
        prepare: [
          ['pnpm', 'install'],
          ['node', 'scripts/install-electron.mjs'],
          ['pnpm', 'exec', 'playwright', 'install'],
        ],
      },
    },
  };
  const before = structuredClone(original);
  const { project, config } = deriveConfiguration(original, '/fixture');
  assert.deepEqual(project.tasks.package.command, [
    'node',
    'scripts/remote-gui-session.mjs',
    'pnpm',
    'package:desktop',
  ]);
  assert.deepEqual(project.prepare[0], [
    'node',
    'scripts/remote-gui-session.mjs',
    '--check',
  ]);
  assert.deepEqual(config.projects['fixture-dev'].tasks.dev.command, [
    'node',
    'scripts/remote-gui-session.mjs',
    'pnpm',
    'check:dev',
  ]);
  assert.equal(config.projects['fixture-web'].requiresGui, false);
  assert.deepEqual(config.projects['fixture-web'].prepare, [
    ['pnpm', 'install'],
    ['pnpm', 'exec', 'playwright', 'install'],
  ]);
  assert.deepEqual(config.projects['fixture-units'].prepare, [
    ['pnpm', 'install'],
  ]);
  assert.deepEqual(config.projects['fixture-units'].tasks.dev.command, [
    'pnpm',
    'check:dev',
  ]);
  assert.deepEqual(original, before);
});

test('package evidence rejects failed, partial or changed installers', async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'verd-package-proof-'),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(
    path.join(directory, 'VerdBoard.dmg'),
    'validated installer',
  );
  const sha256 = createHash('sha256')
    .update('validated installer')
    .digest('hex');
  const checksumFile = path.join(directory, 'SHA256SUMS');
  await fs.writeFile(checksumFile, sha256 + '  VerdBoard.dmg\n');
  const manifest = {
    id: 'same-task',
    transportDigest: 'same-source',
    profileDigest: 'profile',
    proof: { releaseInputDigest: 'source', sourceDigest: 'business' },
  };
  const release = releaseProofFixture(
    {
      releaseInputDigest: 'source',
      versions: { desktop: '2.1.2' },
      reviewDigest: 'review',
      environmentDigest: 'environment',
      platform: 'darwin',
      arch: 'arm64',
      toolchain: { node: 'v24', pnpm: '11', electron: '44' },
      concurrency: { budget: 4 },
      remote: {
        id: manifest.id,
        transportDigest: manifest.transportDigest,
        profileDigest: manifest.profileDigest,
      },
    },
    { sourceDigest: 'business' },
  );
  const record = {
    format: 'verd-desktop-package',
    version: 1,
    status: 'passed',
    release,
    validations: { application: 'passed', installer: 'passed', e2e: 'passed' },
    diagnostics: [{ index: 'diagnostics/package/index.json', complete: true }],
    files: await artifactFiles(directory),
  };
  await verifyPackageRecord(record, directory, manifest);
  await fs.rm(checksumFile);
  await assert.rejects(
    verifyPackageRecord(
      { ...record, files: await artifactFiles(directory) },
      directory,
      manifest,
    ),
    /checksum/i,
  );
  await fs.writeFile(checksumFile, '0'.repeat(64) + '  VerdBoard.dmg\n');
  await assert.rejects(
    verifyPackageRecord(
      { ...record, files: await artifactFiles(directory) },
      directory,
      manifest,
    ),
    /checksum/i,
  );
  await fs.writeFile(checksumFile, sha256 + '  VerdBoard.dmg\n');
  await assert.rejects(
    verifyPackageRecord({ ...record, diagnostics: [] }, directory, manifest),
    /evidence/,
  );
  await assert.rejects(
    verifyPackageRecord({ ...record, status: 'failed' }, directory, manifest),
    /evidence/,
  );
  await assert.rejects(
    verifyPackageRecord(
      { ...record, validations: { application: 'passed' } },
      directory,
      manifest,
    ),
    /evidence/,
  );
  await fs.writeFile(
    path.join(directory, 'VerdBoard.dmg'),
    'different installer',
  );
  await assert.rejects(
    verifyPackageRecord(record, directory, manifest),
    /bytes/,
  );
});

test('repository adapter preserves full gate and development selection requirements', () => {
  assert.deepEqual(parseCli([]), ['submit', '--json', 'ci', '--']);
  const args = [
    '--unit',
    'scripts/remote-test.test.mjs',
    '--desktop-e2e',
    'tests/desktop-e2e/src/dev-runtime.spec.ts',
  ];
  assert.deepEqual(parseCli(['dev', ...args]), [
    'submit',
    '--json',
    'dev',
    '--',
    ...args,
  ]);
  assert.throws(() => parseCli(['ci', ...args]));
  assert.deepEqual(
    parseCli(['dev', '--unit', 'scripts/remote-test.test.mjs']),
    ['submit', '--json', 'dev', '--', '--unit', 'scripts/remote-test.test.mjs'],
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
  const root = path.resolve(new URL('../', import.meta.url).pathname);
  const code = await main(['doctor'], {
    root,
    configuration: {
      version: 1,
      hosts: { test: { ssh: 'test', cacheDir: '~/cache' } },
      projects: {
        fixture: {
          root,
          host: 'test',
          tasks: { ci: { command: ['pnpm', 'check:ci'] } },
        },
      },
    },
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
  const { execFileSync } = await import('node:child_process');
  execFileSync('git', ['init', '-q', root]);
  await fs.mkdir(path.join(root, 'scripts'));
  await fs.mkdir(path.join(root, '.quality'));
  await fs.writeFile(
    path.join(root, 'scripts/release-review.mjs'),
    'export const sourceInventory = async () => ["current"]; export const hash = values => values.join(":");',
  );
  const proof = await captureProof(root);
  const file = path.join(root, '.quality/manifest.json');
  await fs.writeFile(file, JSON.stringify({ task: 'dev', proof }));
  const quality = path.join(root, '.quality/dev.json');
  await fs.writeFile(
    quality,
    JSON.stringify({
      mode: 'dev',
      status: 'passed',
      sourceDigest: 'current',
      identity: proof,
    }),
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
  const { execFileSync } = await import('node:child_process');
  execFileSync('git', ['init', '-q', root]);
  await fs.mkdir(path.join(root, 'scripts'));
  await fs.mkdir(path.join(root, '.quality'));
  await fs.writeFile(
    path.join(root, 'scripts/release-review.mjs'),
    'export const sourceInventory = async () => ["current"]; export const hash = () => "current";',
  );
  const file = path.join(root, '.quality/manifest.json');
  await fs.writeFile(
    file,
    JSON.stringify({ task: 'dev', proof: await captureProof(root) }),
  );
  await fs.writeFile(
    path.join(root, '.quality/dev.json'),
    JSON.stringify({ mode: 'dev', status: 'failed', sourceDigest: 'current' }),
  );
  await assert.rejects(verifyProof(file, root), /captured source/);
});

test('derived release profiles are stable, preserve user configuration, and recover by the same project identity', () => {
  const original = {
    version: 1,
    hosts: { host: { ssh: 'host', cacheDir: '~/cache' } },
    projects: {
      fixture: {
        root: '/fixture',
        host: 'host',
        prepare: [['pnpm', 'install']],
        tasks: { ci: { command: ['pnpm', 'check:ci'] } },
        records: ['.quality'],
        artifacts: { requireReport: true },
      },
    },
  };
  const before = structuredClone(original);
  const first = deriveConfiguration(original, '/fixture');
  assert.deepEqual(original, before);
  assert.deepEqual(first, deriveConfiguration(original, '/fixture'));
  assert.deepEqual(first.project.tasks.package.command, [
    'pnpm',
    'package:desktop',
  ]);
  assert.equal(first.project.artifacts.requireReport, true);
  assert.equal(first.config.projects['fixture-units'].requiresGui, false);
  assert.equal(first.config.projects['fixture-scripts'].requiresGui, false);
  assert.equal(
    first.config.projects['fixture-dev'].artifacts.requireReport,
    false,
  );
  assert.equal(
    first.config.projects['fixture-units'].env.ELECTRON_SKIP_BINARY_DOWNLOAD,
    '1',
  );
  assert.deepEqual(parseCli(['wait', 'fixture-123', '--timeout', '0']), [
    'wait',
    'fixture-123',
    '--timeout',
    '0',
  ]);
  assert.deepEqual(parseCli(['summary', 'fixture-123', '--json']), [
    'summary',
    'fixture-123',
    '--json',
  ]);
  assert.equal(
    first.config.projects['fixture-scripts'].artifacts.requireReport,
    false,
  );
  assert.deepEqual(parseCli(['release']), [
    'submit',
    '--json',
    'release',
    '--',
  ]);
  assert.deepEqual(parseCli(['package', '--with-zip']), [
    'submit',
    '--json',
    'package',
    '--',
    '--with-zip',
  ]);
  assert.throws(() => parseCli(['package', '--skip-gate']));
  assert.throws(() =>
    parseCli(['release', '--unit', 'scripts/remote-test.test.mjs']),
  );
});

test('paused submit and wait never fetch, then resume the same ID through package verification and delivery', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'verd-resume-adapter-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const { execFileSync } = await import('node:child_process');
  execFileSync('git', ['init', '-q'], { cwd: root });
  await fs.writeFile(
    path.join(root, '.gitignore'),
    '.quality/\ntest-results/\napps/desktop/release/\napps/desktop/release-history/\n',
  );
  const write = async (file, value) => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(value));
  };
  const configuration = {
    version: 2,
    hosts: { test: { ssh: 'test', cacheDir: '~/cache' } },
    projects: { fixture: { root, host: 'test' } },
  };
  let id,
    phase = 'paused';
  const commands = [];
  const execute = async (_binary, argv) => {
    const [action, taskId] = argv;
    commands.push(action);
    if (action === 'submit') {
      id = argv[argv.indexOf('--id') + 1];
      assert.ok(argv.includes('--full'));
      return {
        code: 75,
        output: JSON.stringify({
          id,
          state: 'upload-paused',
          confirmedBytes: 1024,
          totalBytes: 2048,
        }),
      };
    }
    assert.equal(taskId, id);
    if (action === 'resume')
      return { code: 0, output: JSON.stringify({ id, accepted: true }) };
    const state =
      phase === 'paused'
        ? 'upload-paused'
        : phase === 'gate'
          ? 'failed'
          : 'passed';
    if (action === 'status') {
      return {
        code: state === 'failed' ? 1 : 0,
        output: JSON.stringify({
          id,
          state,
          confirmedBytes: 1024,
          totalBytes: 2048,
        }),
      };
    }

    assert.equal(action, 'fetch');
    assert.deepEqual(argv, ['fetch', id, '--json']);
    if (phase === 'retrieval')
      return {
        code: 3,
        output: JSON.stringify({
          id,
          download: { state: 'failed', error: 'Disconnected' },
        }),
      };
    const results = path.join(root, 'test-results/original-target', id);
    const { releaseInputDigest } = await releaseInputs(root);
    const manifest = {
      id,
      task: 'package',
      transportDigest: 'snapshot',
      profileDigest: 'profile',
      proof: { releaseInputDigest, sourceDigest: 'business' },
    };
    const release =
      phase === 'gate'
        ? { status: 'failed' }
        : releaseProofFixture(
            {
              releaseInputDigest,
              versions: { desktop: '0.1.0' },
              reviewDigest: 'review',
              environmentDigest: 'environment',
              platform: 'darwin',
              arch: 'arm64',
              toolchain: { node: 'v24', pnpm: '11', electron: '44' },
              concurrency: { budget: 4 },
              remote: {
                id,
                transportDigest: manifest.transportDigest,
                profileDigest: manifest.profileDigest,
              },
            },
            { sourceDigest: 'business' },
          );
    await write(path.join(results, 'manifest.json'), manifest);
    await write(path.join(results, 'status.json'), { state });
    await write(path.join(results, 'local-comparison.json'), { current: true });
    await write(path.join(results, 'artifacts.json'), { complete: true });
    await write(path.join(results, 'source/.quality/release.json'), release);
    if (phase !== 'gate') {
      const installers = path.join(results, 'source/apps/desktop/release');
      await fs.mkdir(installers, { recursive: true });
      const bytes = 'verified installer';
      const checksum = createHash('sha256').update(bytes).digest('hex');
      await fs.writeFile(path.join(installers, 'VerdBoard.dmg'), bytes);
      await fs.writeFile(
        path.join(installers, 'SHA256SUMS'),
        checksum + '  VerdBoard.dmg\n',
      );
      await write(path.join(results, 'source/.quality/package.json'), {
        format: 'verd-desktop-package',
        version: 1,
        status: 'passed',
        release,
        validations: {
          application: 'passed',
          installer: 'passed',
          e2e: 'passed',
        },
        diagnostics: [
          { index: 'diagnostics/package/index.json', complete: true },
        ],
        files: await artifactFiles(installers),
      });
      if (phase === 'tampered')
        await fs.appendFile(path.join(installers, 'VerdBoard.dmg'), '!');
    }
    return {
      code: state === 'failed' ? 1 : 0,
      output: JSON.stringify({
        id,
        download: { state: 'complete', directory: results },
        execution: { state },
      }),
    };
  };
  const run = (...args) => main(args, { root, configuration, execute });
  const restore = console.log;
  const output = [];
  console.log = (value) => output.push(value);
  try {
    assert.equal(await run('package', '--full'), 75);
    assert.deepEqual(commands.splice(0), ['submit']);
    assert.equal(JSON.parse(output.at(-1)).confirmedBytes, 1024);
    assert.equal(await run('wait', id), 75);
    assert.deepEqual(commands.splice(0), ['status']);
    phase = 'gate';
    assert.equal(await run('resume', id, '--timeout', '0'), 1);
    assert.deepEqual(commands.splice(0), ['resume', 'status', 'fetch']);
    assert.equal(JSON.parse(output.at(-1)).gateStatus, 'failed');
    phase = 'retrieval';
    assert.equal(await run('wait', id), 1);
    assert.equal(JSON.parse(output.at(-1)).status, 'retrieval-failed');
    assert.equal(JSON.parse(output.at(-1)).execution.state, 'passed');
    phase = 'tampered';
    assert.equal(await run('resume', id), 1);
    assert.equal(JSON.parse(output.at(-1)).deliveryStatus, 'failed');
    phase = 'valid';
    assert.equal(await run('resume', id), 0);
    assert.equal(JSON.parse(output.at(-1)).deliveryStatus, 'delivered');
    assert.equal(
      await fs.readFile(
        path.join(root, 'apps/desktop/release/VerdBoard.dmg'),
        'utf8',
      ),
      'verified installer',
    );
  } finally {
    console.log = restore;
  }
});
