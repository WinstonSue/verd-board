import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  parseSelection,
  assertProductionWeb,
  runCommand,
  runQualityCli,
  localTestExecutionAllowed,
} from './quality-gate.mjs';
import {
  assertReview,
  businessText,
  hash,
  initializeBaseline,
  draftReview,
  snapshot,
  readCurrentReview,
  checkReleaseReview,
} from './release-review.mjs';

test('ordinary development gate commands delegate remotely without invoking a local gate', async () => {
  const args = [
    '--unit',
    'scripts/remote-test.test.mjs',
    '--desktop-e2e',
    'tests/desktop-e2e/src/dev-runtime.spec.ts',
  ];
  const calls = [];
  for (const mode of ['dev', 'ci']) {
    const selection = mode === 'dev' ? args : [];
    assert.equal(
      await runQualityCli(mode, selection, {
        env: { CI: '1' },
        execute: async (program, argv, options) =>
          calls.push({ program, argv, options }),
        gate: async () =>
          assert.fail(
            'Must not run lint/build/Electron on the development machine',
          ),
      }),
      0,
    );
    const call = calls.at(-1);
    assert.equal(call.program, process.execPath);
    assert.ok(call.argv[0].endsWith('/scripts/remote-test.mjs'));
    assert.deepEqual(call.argv.slice(1), [mode, ...selection]);
  }
  assert.equal(
    await runQualityCli('ci', [], {
      env: {},
      execute: async () => {
        throw Object.assign(new Error('stale source'), { exitCode: 2 });
      },
    }),
    2,
  );
});

test('test workers, CI, explicit local debugging and publishing retain direct gates', async () => {
  for (const env of [
    { VERD_TEST_EXECUTION: 'remote' },
    { GITHUB_ACTIONS: 'true' },
    { VERD_TEST_EXECUTION: 'local' },
    { VERD_TEST_EXECUTION: 'ci' },
  ]) {
    assert.equal(localTestExecutionAllowed(env), true);
    let executed = false;
    await runQualityCli('ci', [], {
      env,
      execute: async () =>
        assert.fail('Must not recursively SSH from a worker'),
      gate: async (mode, args) => {
        assert.equal(mode, 'ci');
        assert.deepEqual(args, []);
        executed = true;
      },
    });
    assert.equal(executed, true);
  }
  assert.equal(localTestExecutionAllowed({ CI: 'true' }), false);
  let release = false;
  await runQualityCli('release', [], {
    env: {},
    execute: async () =>
      assert.fail('Publishing must retain its existing local gate'),
    gate: async () => {
      release = true;
    },
  });
  assert.equal(release, true);
});

test('feature filters require existing repository-relative unit and E2E selections without accepting full-gate flags', () => {
  assert.equal(parseSelection([]), null);
  assert.deepEqual(
    parseSelection([
      '--unit',
      'scripts/quality-gate.test.mjs',
      '--web-e2e',
      'tests/web-e2e/src/app.spec.ts',
    ]),
    {
      unit: ['scripts/quality-gate.test.mjs'],
      web: ['tests/web-e2e/src/app.spec.ts'],
      desktop: [],
    },
  );
  for (const args of [
    ['--unit', 'scripts/x.test.mjs'],
    ['--web-e2e', 'tests/web-e2e/src/a.spec.ts'],
    ['--unit', '../x.test.mjs'],
    ['--skip-checks'],
    ['--unit', ''],
  ])
    assert.throws(() => parseSelection(args));
});

test('failed checks propagate and production output rejects actual regression probes', async () => {
  await assert.rejects(
    runCommand(process.execPath, ['-e', 'process.exit(9)']),
    (error) => error.exitCode === 9 && /exited 9/.test(error.message),
  );
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'verd-probe-check-'));
  try {
    await fs.writeFile(path.join(root, 'index.js'), 'const production = true;');
    await assertProductionWeb(root);
    await fs.writeFile(
      path.join(root, 'index.js'),
      'globalThis.__verdReadyGate = {};',
    );
    await assert.rejects(assertProductionWeb(root), /Test probes/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('system introduction comparisons ignore dates, version-only changes, caches and formatting', () => {
  const document = (version, date, body = 'Current business behavior') => ({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: `最后更新：${date}` }],
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: `Release ${version}: ${body}` }],
      },
    ],
  });
  assert.deepEqual(
    businessText(document('2.0.1', '2026-11-10')),
    businessText(document('2.0.2', '2026-11-11')),
  );
  assert.notDeepEqual(
    businessText(document('2.0.1', '2026-11-10')),
    businessText(
      document('2.0.2', '2026-11-11', 'Updated failure recovery behavior'),
    ),
  );
  const plain = {
    type: 'paragraph',
    content: [{ type: 'text', text: 'Current business behavior' }],
  };
  const styled = {
    type: 'paragraph',
    content: [
      { type: 'text', text: 'Current ' },
      { type: 'text', text: 'business', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' behavior' },
    ],
  };
  assert.deepEqual(businessText(plain), businessText(styled));
  const linked = (version) => ({
    type: 'paragraph',
    content: [
      {
        type: 'text',
        text: 'Release guide',
        marks: [
          {
            type: 'link',
            attrs: { href: `https://example.test/${version}/guide` },
          },
        ],
      },
    ],
  });
  assert.deepEqual(
    businessText(linked('2.0.1')),
    businessText(linked('2.0.2')),
  );
});

test('every release including SDK-only releases requires current, complete business reviews and changed introduction evidence', () => {
  const previous = {
    versions: { sdk: '1.0.0', product: '2.0.1' },
    introduction: { intro: 'old' },
  };
  const current = {
    sourceDigest: 'current',
    versions: { sdk: '1.0.1', product: '2.0.1' },
    introduction: { intro: 'new' },
  };
  const record = {
    format: 'verd-release-review',
    version: 1,
    previousDigest: hash(previous),
    ...current,
    targets: [{ name: 'sdk', version: '1.0.1' }],
    reviews: Object.fromEntries(
      ['agent', 'recommendations', 'introduction'].map((key) => [
        key,
        {
          status: key === 'introduction' ? 'updated' : 'reviewed',
          reason: 'Compared behavior with this release',
          files: ['evidence'],
        },
      ]),
    ),
  };
  assert.doesNotThrow(() => assertReview(record, previous, current));
  assert.throws(
    () => assertReview({ ...record, sourceDigest: 'stale' }, previous, current),
    /stale/,
  );
  assert.throws(
    () =>
      assertReview({ ...record, previousDigest: 'wrong' }, previous, current),
    /baseline/,
  );
  assert.throws(
    () =>
      assertReview(record, previous, {
        ...current,
        introduction: previous.introduction,
      }),
    /real system introduction/,
  );
  assert.throws(
    () =>
      assertReview(record, previous, current, {
        targets: [{ name: 'sdk', version: '1.0.2' }],
      }),
    /release plan/,
  );
  const pending = structuredClone(record);
  pending.reviews.agent.status = 'pending';
  assert.throws(
    () => assertReview(pending, previous, current),
    /Missing business review/,
  );
  const missing = structuredClone(record);
  missing.targets = [{ name: 'product', version: '2.0.1' }];
  assert.throws(
    () => assertReview(missing, previous, current),
    /missing from release targets/,
  );
});

test('baseline initialization is create-only, drafts never claim approval, and source changes invalidate completed reviews', async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'verd-review-contract-'),
  );
  const write = async (file, body) => {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(
      path.join(root, file),
      typeof body === 'string' ? body : JSON.stringify(body),
    );
  };
  const doc = (text) => ({
    format: 'verd-document',
    id: 'intro',
    text: {
      content: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
      },
      plainText: text,
    },
  });
  try {
    execFileSync('git', ['init', '-q', root]);
    await write('package.json', { name: 'sdk', version: '1.0.1' });
    await write('workspace/intro.verd-doc.json', doc('Previous behavior'));
    await write(
      'packages/agent/runtime/src/cli.ts',
      'export const ready = true;',
    );
    await write(
      'packages/agent/patterns/workspace/recommendation.verd-doc.json',
      doc('User advice'),
    );
    await write('packages/agent/patterns/catalog.json', []);
    await write('pnpm-lock.yaml', 'lockfileVersion: 9');
    await initializeBaseline(root);
    await assert.rejects(initializeBaseline(root), /EEXIST/);
    await assert.rejects(checkReleaseReview(root), /Missing release review/);
    await write(
      'workspace/intro.verd-doc.json',
      doc('Updated business behavior'),
    );
    await draftReview(root, [{ name: 'sdk', version: '1.0.1' }]);
    await assert.rejects(checkReleaseReview(root), /Missing business review/);
    const { record, file } = await readCurrentReview(root);
    record.reviews = {
      agent: {
        status: 'reviewed',
        reason: 'The CLI contract is unchanged',
        files: [
          'packages/agent/runtime/src/cli.ts',
          'packages/agent/patterns/catalog.json',
        ],
      },
      recommendations: {
        status: 'reviewed',
        reason: 'The advice already covers the behavior',
        files: [
          'packages/agent/patterns/workspace/recommendation.verd-doc.json',
        ],
      },
      introduction: {
        status: 'updated',
        reason: 'Describe updated behavior',
        files: ['workspace/intro.verd-doc.json'],
      },
    };
    await fs.writeFile(file, JSON.stringify(record));
    await checkReleaseReview(root);
    assert.equal((await snapshot(root)).sourceDigest, record.sourceDigest);
    await write('pnpm-lock.yaml', 'lockfileVersion: 9\nchanged: true');
    await assert.rejects(checkReleaseReview(root), /stale/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
