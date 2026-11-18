import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { collectStages, assertStagesPassed } from './gate-runner.mjs';
import { createGatePlan, gateDiagnostics } from './quality-gate.mjs';
import { fullStageIds } from './release-proof.mjs';
import { testConcurrency } from './test-concurrency.mjs';
import {
  testUnits,
  packageTestCommands,
  unitManifests,
} from './test-units.mjs';

test('the public unit command still executes script tests after a package failure', async () => {
  const calls = [];
  await assert.rejects(
    testUnits({
      env: {},
      manifests: [{ name: 'vitest-fixture', scripts: { test: 'vitest run' } }],
      execute: async (program, args) => {
        calls.push({ program, args });
        if (program === 'pnpm' && args.includes('test'))
          throw new Error('fixture package failure');
      },
    }),
    /fixture package failure/,
  );
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[2].args, ['scripts/test-scripts.mjs']);
});

test('the standalone unit entry does not retry failed dependency builds through another runner', async () => {
  const calls = [];
  await assert.rejects(
    testUnits({
      env: {},
      manifests: [{ name: 'fixture', scripts: { test: 'vitest run' } }],
      execute: async (program, args) => {
        calls.push({ program, args });
        if (args.includes('build')) throw new Error('fixture build failure');
      },
    }),
    /fixture build failure/,
  );
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].args, ['scripts/test-scripts.mjs']);
});

test('full gate collects independent failures and blocks only dependent suites', async () => {
  const invoked = [];
  const plan = await createGatePlan({
    selection: null,
    env: {},
    unitEnv: {},
    resources: '/fixture/resources',
    settings: testConcurrency(
      { VERD_UNIT_TEST_PACKAGES: '2', VERD_UNIT_TEST_WORKERS: '2' },
      8,
    ),
    execute: async (program, args) => {
      const command = program + ' ' + args.join(' ');
      invoked.push(command);
      if (args.includes('eslint') || args.includes('test:e2e'))
        throw new Error('injected independent failure');
    },
  });
  assert.deepEqual(
    plan.map((node) => node.id),
    fullStageIds,
  );
  // Filesystem probe validation is covered by its own fixture contract.
  plan.find((node) => node.id === 'web-production-clean').run = async () => {};
  const result = await collectStages(plan);
  assert.throws(() => assertStagesPassed(result), /lint: failed/);
  assert.equal(
    result.stages.find((stage) => stage.id === 'web-dev').status,
    'failed',
  );
  for (const id of ['unit-scripts', 'desktop-dev', 'web-prod', 'desktop-prod'])
    assert.equal(
      result.stages.find((stage) => stage.id === id).status,
      'passed',
    );
  assert.ok(
    invoked.some((command) =>
      command.includes('scripts/test-units.mjs --packages-only --prebuilt'),
    ),
  );
  assert.ok(
    invoked.some((command) =>
      command.includes('--continue=dependencies-successful'),
    ),
  );
  assert.equal(
    invoked.filter((command) =>
      command.includes('--filter consumer-vite build'),
    ).length,
    1,
  );
  assert.equal(
    invoked.filter((command) => command.includes('scripts/test-consumer.mjs'))
      .length,
    1,
  );
});

test('every workspace unit command runs with runner-specific arguments and prebuilt gates cannot rebuild dependencies', async () => {
  const manifests = await unitManifests();
  const settings = testConcurrency(
    { VERD_UNIT_TEST_PACKAGES: '2', VERD_UNIT_TEST_WORKERS: '2' },
    8,
  );
  const commands = packageTestCommands(manifests, settings);
  const selected = commands
    .flatMap(({ args }) =>
      args
        .filter((arg) => arg.startsWith('--filter='))
        .map((arg) => arg.slice('--filter='.length)),
    )
    .sort();
  assert.deepEqual(
    selected,
    manifests
      .filter((pkg) => pkg.scripts?.test)
      .map((pkg) => pkg.name)
      .sort(),
  );
  for (const { id, args } of commands) {
    assert.ok(args.includes('--only'));
    assert.ok(args.includes('--concurrency=2'));
    assert.equal(args.includes('--maxWorkers=2'), id === 'vitest');
  }
  const other = commands.find(({ id }) => id === 'other');
  assert.ok(other.args.includes('--filter=consumer-vite'));
  const graph = JSON.parse(
    execFileSync('pnpm', [...other.args, '--dry=json'], {
      cwd: path.resolve(import.meta.dirname, '..'),
      encoding: 'utf8',
    }),
  );
  assert.deepEqual(
    graph.tasks.map((task) => task.taskId),
    ['consumer-vite#test'],
  );
  execFileSync('pnpm', other.args, {
    cwd: path.resolve(import.meta.dirname, '..'),
    stdio: 'pipe',
  });
});

test('failed public build does not retry through unit tests, but script and static checks still run', async () => {
  const plan = await createGatePlan({
    selection: null,
    env: {},
    unitEnv: {},
    resources: '/fixture/resources',
    settings: testConcurrency(
      { VERD_UNIT_TEST_PACKAGES: '2', VERD_UNIT_TEST_WORKERS: '2' },
      8,
    ),
    execute: async (_program, args) => {
      if (args.includes('--force')) throw new Error('public build failed');
    },
  });
  const result = await collectStages(plan);
  assert.equal(
    result.stages.find((stage) => stage.id === 'unit-scripts').status,
    'passed',
  );
  for (const id of [
    'unit-packages',
    'agent-resources',
    'web-dev',
    'desktop-prod',
  ])
    assert.equal(
      result.stages.find((stage) => stage.id === id).status,
      'blocked',
    );
  assert.throws(() => assertStagesPassed(result), /Prerequisites did not pass/);
});

test('resource validation failure preserves independent unit/consumer/build results', async () => {
  const plan = await createGatePlan({
    selection: null,
    env: {},
    unitEnv: {},
    resources: '/fixture/resources',
    settings: testConcurrency(
      { VERD_UNIT_TEST_PACKAGES: '2', VERD_UNIT_TEST_WORKERS: '2' },
      8,
    ),
    execute: async (_program, args) => {
      if (args.includes('scripts/test-agent-resources.mjs'))
        throw new Error('resource acceptance failed');
    },
  });
  plan.find((node) => node.id === 'web-production-clean').run = async () => {};
  const result = await collectStages(plan);
  for (const id of ['web-dev', 'desktop-dev', 'web-prod', 'desktop-prod'])
    assert.equal(
      result.stages.find((stage) => stage.id === id).status,
      'blocked',
    );
  for (const id of ['unit-packages', 'consumer', 'web-build', 'desktop-build'])
    assert.equal(
      result.stages.find((stage) => stage.id === id).status,
      'passed',
    );
});

test('source mutation and environment termination stop the remaining graph without retries', async () => {
  let calls = 0;
  const plan = ['first', 'second'].map((id) => ({
    id,
    run: async () => {
      calls++;
    },
  }));
  const result = await collectStages(plan, {
    checkpoint: async () => {
      throw new Error('source changed');
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(
    result.stages.map((stage) => stage.status),
    ['failed', 'blocked'],
  );
  await assert.rejects(
    collectStages([{ id: 'bad', dependsOn: ['missing'], run() {} }]),
    /dependency/,
  );
});

test('invalid graph is rejected before any command and corrupt diagnostics cannot look complete', async (t) => {
  let executed = false;
  await assert.rejects(
    collectStages([
      {
        id: 'first',
        run: () => {
          executed = true;
        },
      },
      { id: 'invalid', dependsOn: ['absent'], run() {} },
    ]),
    /dependency/,
  );
  assert.equal(executed, false);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'verd-diagnostics-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'diagnostics/report'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'diagnostics/report/index.json'),
    '{broken',
  );
  const reports = await gateDiagnostics({ REMOTE_TEST_JOB_DIR: root });
  assert.equal(reports.length, 1);
  assert.equal(reports[0].complete, false);
});

test('failure summaries retain Turbo-prefixed Vitest titles and Node test failures', async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'verd-failure-log-'),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const plan = await createGatePlan({
    selection: null,
    env: {},
    unitEnv: {},
    resources: '/fixture/resources',
    settings: testConcurrency({}, 8),
    logDirectory: directory,
    execute: async (_program, _args, { logFile }) => {
      await fs.writeFile(
        logFile,
        '@sue/fixture:test:  FAIL src/example.spec.ts > useful failure\n✖ another useful failure (12ms)\n',
      );
      throw new Error('fixture test failure');
    },
  });
  const record = {};
  await assert.rejects(
    plan.find((stage) => stage.id === 'unit-packages').run(record),
    /fixture test failure/,
  );
  assert.deepEqual(record.failures, [
    'src/example.spec.ts > useful failure',
    'another useful failure (12ms)',
  ]);
});
