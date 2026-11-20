import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createTestPlan, parseGateOptions } from './test-plan.mjs';
import {
  changedFiles,
  digest,
  lockSections,
  lockClosure,
  loadCatalog,
  verificationIdentity,
} from './test-catalog.mjs';
import { saveVerification } from './verification-cache.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'verd-layer-plan-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const write = async (name, content) => {
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.writeFile(
      path.join(root, name),
      typeof content === 'string' ? content : JSON.stringify(content),
    );
  };
  await write('package.json', { packageManager: 'pnpm@11.18.0' });
  await write('.gitignore', '.quality/\n');
  await write(
    'pnpm-lock.yaml',
    'lockfileVersion: 9\nimporters:\n  .: {}\npackages: {}\nsnapshots: {}\n',
  );
  const units = [];
  for (const [name, layer, dependencies] of [
    ['kernel', 'foundation', {}],
    ['business', 'product', { kernel: 'workspace:*' }],
  ]) {
    const directory =
      name === 'kernel' ? 'packages/engine/core' : 'packages/product/ui';
    await write(directory + '/package.json', {
      name,
      version: '1.0.0',
      dependencies,
    });
    await write(directory + '/src/index.ts', 'export const value = 1;');
    const testFile = directory + '/src/index.spec.ts';
    await write(testFile, "import { value } from './index'; void value;");
    units.push({
      id: name,
      layer,
      directory,
      packages: [name],
      runner: 'vitest',
      tests: [testFile],
    });
  }
  await write('tests/catalog.json', { version: 1, units });
  for (const file of [
    'test-catalog',
    'test-plan',
    'verification-cache',
    'gate-runner',
    'quality-gate',
  ])
    await write('scripts/' + file + '.mjs', '// fixture ' + file);
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.test',
      'commit',
      '-qm',
      'baseline',
    ],
    { cwd: root },
  );
  return { root, write, units };
}

test('downstream source changes reuse the verified kernel; kernel changes invalidate consumers', async (t) => {
  const { root, write } = await fixture(t);
  const baseline = await createTestPlan({ root, env: {}, mode: 'ci' });
  for (const unit of baseline.units)
    await saveVerification(
      path.join(root, '.quality/verification-cache'),
      unit,
      'baseline',
      [{ id: unit.id, status: 'passed' }],
      {},
    );
  await write('packages/product/ui/src/index.ts', 'export const value = 2;');
  const downstream = await createTestPlan({ root, env: {}, mode: 'release' });
  assert.deepEqual(
    downstream.units.map(({ id, action }) => [id, action]),
    [
      ['kernel', 'reuse'],
      ['business', 'run'],
    ],
  );
  await write('packages/engine/core/src/index.ts', 'export const value = 3;');
  const upstream = await createTestPlan({ root, env: {}, mode: 'release' });
  assert.deepEqual(
    upstream.units.map((unit) => unit.action),
    ['run', 'run'],
  );
  const impact = await createTestPlan({
    root,
    env: {},
    options: { base: 'HEAD' },
  });
  assert.ok(
    impact.units[1].impactPaths.some(
      (chain) =>
        JSON.stringify(chain) ===
        JSON.stringify([
          'packages/engine/core/src/index.ts',
          'kernel',
          'business',
          'business',
        ]),
    ),
  );
});

test('versions do not invalidate pure logic; test changes and shared helpers do', async (t) => {
  const { root, write, units } = await fixture(t);
  const identity = async () =>
    verificationIdentity(units[0], await loadCatalog(root), root);
  const before = await identity();
  await write('packages/engine/core/package.json', {
    name: 'kernel',
    version: '1.0.1',
    dependencies: {},
  });
  assert.equal((await identity()).digest, before.digest);
  const plan = await createTestPlan({
    root,
    env: {},
    options: { base: 'HEAD' },
  });
  assert.deepEqual(
    plan.units.map((unit) => unit.action),
    ['outside', 'outside'],
  );
  units[0].versionSensitive = true;
  await write('tests/catalog.json', { version: 1, units });
  const sensitive = await createTestPlan({
    root,
    env: {},
    options: { base: 'HEAD' },
  });
  assert.equal(sensitive.units[0].action, 'run');
  await write(
    'packages/engine/core/src/index.spec.ts',
    "import { value } from './index'; import '../../../fixtures/helper'; void value;",
  );
  await write('packages/fixtures/helper.ts', 'export const helper = 1;');
  const withHelper = await identity();
  await write('packages/fixtures/helper.ts', 'export const helper = 2;');
  assert.notEqual((await identity()).digest, withHelper.digest);
});

test('fixture families and root-based reads invalidate their consumers without a repository-wide fixture dependency', async (t) => {
  const { root, write } = await fixture(t);
  await write('tests/fixtures/kernel/a.json', { value: 1 });
  await write('tests/fixtures/business.json', { value: 1 });
  await write(
    'packages/engine/core/src/index.spec.ts',
    'const fixture = `../../../../tests/fixtures/kernel/${name}.json`; void fixture;',
  );
  await write(
    'packages/product/ui/src/index.spec.ts',
    "const fixture = 'tests/fixtures/business.json'; void fixture;",
  );
  const baseline = await createTestPlan({ root, env: {}, mode: 'ci' });
  for (const unit of baseline.units)
    await saveVerification(
      path.join(root, '.quality/verification-cache'),
      unit,
      'fixtures',
      [{ id: unit.id, status: 'passed' }],
      {},
    );
  await write('tests/fixtures/kernel/a.json', { value: 2 });
  const changed = await createTestPlan({ root, env: {}, mode: 'ci' });
  assert.deepEqual(
    changed.units.map(({ action }) => action),
    ['run', 'reuse'],
  );
  await write('tests/fixtures/business.json', { value: 2 });
  const both = await createTestPlan({ root, env: {}, mode: 'ci' });
  assert.deepEqual(
    both.units.map(({ action }) => action),
    ['run', 'run'],
  );
  await write('tests/fixtures/unowned.json', {});
  await assert.rejects(
    createTestPlan({ root, env: {}, options: { base: 'HEAD' } }),
    /Unmapped changed inputs/,
  );
  await fs.rm(path.join(root, 'tests/fixtures/unowned.json'));
  await write('tests/fixtures/unowned.png', 'unclassified-resource');
  await assert.rejects(
    createTestPlan({ root, env: {}, options: { base: 'HEAD' } }),
    /Unmapped changed inputs/,
  );
});

test('host configuration and runtime catalog selection invalidate only their consumers', async (t) => {
  const { root, write, units } = await fixture(t);
  await write(
    'scripts/select-runtime.mjs',
    "export const input = '../tests/catalog.json';",
  );
  for (const host of ['web', 'desktop']) {
    const file = `tests/${host}-e2e/src/smoke.spec.ts`;
    await write(file, "import '../../../scripts/select-runtime.mjs';");
    await write(
      `tests/${host}-e2e/playwright.prod.config.ts`,
      'export default {};',
    );
    units.push({
      id: host,
      host,
      runtime: 'production',
      runner: 'playwright',
      packages: ['business'],
      tests: [file],
    });
  }
  await write('tests/catalog.json', { version: 1, units });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.test',
      'commit',
      '-qm',
      'runtime baseline',
    ],
    { cwd: root },
  );
  const baseline = await createTestPlan({ root, env: {}, mode: 'ci' });
  for (const unit of baseline.units)
    await saveVerification(
      path.join(root, '.quality/verification-cache'),
      unit,
      'runtimes',
      [{ id: unit.id, status: 'passed' }],
      {},
    );
  await write(
    'tests/web-e2e/playwright.prod.config.ts',
    'export default { workers: 2 };',
  );
  const changed = await createTestPlan({ root, env: {}, mode: 'ci' });
  assert.deepEqual(
    changed.units.map((unit) => unit.action),
    ['reuse', 'reuse', 'run', 'reuse'],
  );
  await write('tests/web-e2e/playwright.prod.config.ts', 'export default {};');
  units[0].feature = 'new-kernel-test-classification';
  await write('tests/catalog.json', { version: 1, units });
  const catalogChange = await createTestPlan({ root, env: {}, mode: 'ci' });
  assert.deepEqual(
    catalogChange.units.map((unit) => unit.action),
    ['run', 'reuse', 'reuse', 'reuse'],
  );
  const daily = await createTestPlan({
    root,
    env: {},
    options: { base: 'HEAD' },
  });
  assert.deepEqual(
    daily.units.map((unit) => unit.action),
    ['run', 'outside', 'outside', 'outside'],
  );
});

test('change capture includes committed, staged, unstaged, renamed, deleted and untracked inputs', async (t) => {
  const { root, write } = await fixture(t);
  await write('committed.txt', 'committed');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.test',
      'commit',
      '-qm',
      'change',
    ],
    { cwd: root },
  );
  await write('staged.txt', 'staged');
  execFileSync('git', ['add', 'staged.txt'], { cwd: root });
  await fs.rename(
    path.join(root, 'packages/engine/core/src/index.ts'),
    path.join(root, 'packages/engine/core/src/renamed.ts'),
  );
  await write('untracked.txt', 'new');
  const change = await changedFiles('HEAD~1', root);
  for (const name of [
    'committed.txt',
    'staged.txt',
    'untracked.txt',
    'packages/engine/core/src/index.ts',
    'packages/engine/core/src/renamed.ts',
  ])
    assert.ok(change.files.includes(name), name);
});

test('binary fixture bytes and symlink targets participate in verification identity', async (t) => {
  const { root, units } = await fixture(t);
  const binary = path.join(root, 'packages/engine/core/src/fixture.bin');
  await fs.writeFile(binary, Buffer.from([0x80]));
  const before = await verificationIdentity(
    units[0],
    await loadCatalog(root),
    root,
    {},
  );
  await fs.writeFile(binary, Buffer.from([0x81]));
  const after = await verificationIdentity(
    units[0],
    await loadCatalog(root),
    root,
    {},
  );
  assert.notEqual(before.digest, after.digest);
  const linked = path.join(root, 'tests/fixture.bin');
  await fs.writeFile(linked, Buffer.from([1]));
  await fs.symlink(
    '../../../../tests/fixture.bin',
    path.join(root, 'packages/engine/core/src/linked.bin'),
  );
  const first = await verificationIdentity(
    units[0],
    await loadCatalog(root),
    root,
    {},
  );
  await fs.writeFile(linked, Buffer.from([2]));
  const second = await verificationIdentity(
    units[0],
    await loadCatalog(root),
    root,
    {},
  );
  assert.notEqual(first.digest, second.digest);
});

test('unregistered tests fail closed and pure-unit selection does not invent E2E', async (t) => {
  const { root, write, units } = await fixture(t);
  const options = parseGateOptions(['--unit', units[0].tests[0]]);
  const plan = await createTestPlan({ root, env: {}, options });
  assert.deepEqual(
    plan.units.map((unit) => unit.action),
    ['run', 'outside'],
  );
  await write('packages/engine/core/src/missed.spec.ts', 'void 0;');
  await assert.rejects(createTestPlan({ root, env: {} }), /Unclassified test/);
  assert.throws(() => parseGateOptions(['--full', '--base', 'HEAD']));
});

test('lock resolution fingerprints include transitive dependencies but exclude unrelated UI tools', () => {
  const lock = lockSections(`importers:
  .:
    devDependencies:
      vitest:
        specifier: ^3
        version: 3.0.0
      electron:
        specifier: 44
        version: 44.0.0
packages:
  vitest@3.0.0:
    resolution: {integrity: one}
  tiny@1.0.0:
    resolution: {integrity: two}
  electron@44.0.0:
    resolution: {integrity: unrelated}
snapshots:
  vitest@3.0.0:
    dependencies:
      tiny: 1.0.0
  tiny@1.0.0: {}
  electron@44.0.0: {}
`);
  const selected = lockClosure(lock, ['.'], ['vitest']);
  assert.deepEqual(Object.keys(selected), ['tiny@1.0.0', 'vitest@3.0.0']);
  assert.notEqual(digest(selected), digest({ ...selected, 'tiny@1.0.0': {} }));
});
