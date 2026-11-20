import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { ROOT, hash, sourceInventory } from './release-review.mjs';
import { releaseIdentity, releaseInputs } from './release-proof.mjs';
import {
  runCommand,
  groupUnitTests,
  localTestExecutionAllowed,
  assertProductionWeb,
} from './quality-gate.mjs';
import { writeRecord } from './gate-runner.mjs';
import { publicPackages } from './pack-public.mjs';
import { webE2EOptions } from './web-e2e-runtime.mjs';
import { reporterPath } from './remote-playwright-reporter.cjs';

const executeFile = promisify(execFile);
const unitFiles = [
  'packages/engine/core/src/cell/clear.spec.ts',
  'packages/engine/core/src/cell/geometry-plan.spec.ts',
  'packages/react/board/src/frame-camera.spec.tsx',
  'packages/react/board/src/frame-connection-drag.spec.ts',
  'packages/react/text/src/components/document/document-table.spec.ts',
  'packages/product/app/src/workspace-app.spec.tsx',
];
const webFiles = [
  'cell-product.spec.ts',
  'document-table.spec.ts',
  'diagram-colors.spec.ts',
  'reference-navigation.spec.ts',
];

export function benchmarkWebFiles(mode) {
  if (mode === 'dev') return ['dev-runtime.spec.ts'];
  if (mode === 'prod') return [...webFiles];
  throw new Error('Unknown Web benchmark runtime: ' + mode);
}

export function chooseComparison(baseline, candidate) {
  const healthyMemory = (result) =>
    result.memoryPressure?.samples >= 2 &&
    result.memoryPressure.peakLevel === 1 &&
    result.memoryPressure.pageoutsDelta === 0 &&
    result.memoryPressure.swapoutsDelta === 0 &&
    result.memoryPressure.errors.length === 0;
  return (
    baseline.status === 'passed' &&
    candidate.status === 'passed' &&
    baseline.cases.length > 0 &&
    baseline.peakRssBytes > 0 &&
    candidate.peakRssBytes > 0 &&
    healthyMemory(baseline) &&
    healthyMemory(candidate) &&
    hash(baseline.cases) === hash(candidate.cases) &&
    candidate.durationMs <= baseline.durationMs * 0.9 &&
    candidate.peakRssBytes <= baseline.peakRssBytes &&
    candidate.peakRssBytes <= os.totalmem() * 0.75
  );
}

async function measured(commands, parallelism) {
  const active = new Set();
  let peakRssBytes = 0;
  let sampling = Promise.resolve();
  const memoryPressure = { samples: 0, peakLevel: 0, errors: [] };
  let firstMemory;
  const sample = () => {
    sampling = sampling.then(async () => {
      try {
        if (process.platform !== 'darwin')
          throw new Error(
            'Memory pressure measurement requires the macOS test host',
          );
        const [level, counters] = await Promise.all([
          executeFile('/usr/sbin/sysctl', [
            '-n',
            'kern.memorystatus_vm_pressure_level',
          ]),
          executeFile('/usr/bin/vm_stat', []),
        ]);
        const current = {
          level: Number(level.stdout.trim()),
          pageouts: Number(counters.stdout.match(/^Pageouts:\s+(\d+)/m)?.[1]),
          swapouts: Number(counters.stdout.match(/^Swapouts:\s+(\d+)/m)?.[1]),
        };
        if (Object.values(current).some((value) => !Number.isFinite(value)))
          throw new Error('Incomplete memory pressure counters');
        firstMemory ??= current;
        memoryPressure.samples++;
        memoryPressure.peakLevel = Math.max(
          memoryPressure.peakLevel,
          current.level,
        );
        memoryPressure.pageoutsDelta = current.pageouts - firstMemory.pageouts;
        memoryPressure.swapoutsDelta = current.swapouts - firstMemory.swapouts;
      } catch (error) {
        if (!memoryPressure.errors.includes(error.message))
          memoryPressure.errors.push(error.message);
      }
      try {
        if (!active.size) return;
        const { stdout } = await executeFile('ps', ['-axo', 'pid=,ppid=,rss=']);
        const rows = stdout
          .trim()
          .split('\n')
          .map((line) => line.trim().split(/\s+/).map(Number));
        const owned = new Set(active);
        let previous;
        do {
          previous = owned.size;
          for (const [pid, parent] of rows)
            if (owned.has(parent)) owned.add(pid);
        } while (previous !== owned.size);
        peakRssBytes = Math.max(
          peakRssBytes,
          rows
            .filter(([pid]) => owned.has(pid))
            .reduce((sum, row) => sum + row[2] * 1024, 0),
        );
      } catch (error) {
        if (!memoryPressure.errors.includes(error.message))
          memoryPressure.errors.push(error.message);
      }
    });
    return sampling;
  };
  await sample();
  const timer = setInterval(() => {
    void sample();
  }, 1000);
  const errors = [];
  let next = 0;
  const started = performance.now();
  try {
    await Promise.all(
      Array.from(
        { length: Math.min(parallelism, commands.length) },
        async () => {
          while (next < commands.length) {
            const command = commands[next++];
            try {
              await runCommand(command.program, command.args, {
                ...command.options,
                onSpawn: (child) => {
                  active.add(child.pid);
                  child.once('close', () => active.delete(child.pid));
                },
              });
            } catch (error) {
              errors.push(error.message);
            }
          }
        },
      ),
    );
  } finally {
    clearInterval(timer);
    await sample();
  }
  return {
    status: errors.length ? 'failed' : 'passed',
    durationMs: Math.round(performance.now() - started),
    peakRssBytes,
    memoryPressure,
    errors,
  };
}

function playwrightCases(report) {
  const cases = [];
  function visit(suite) {
    for (const spec of suite.specs ?? [])
      for (const test of spec.tests) {
        cases.push(
          `${spec.file}:${spec.line}:${test.projectName}:${spec.title}`,
        );
        if (
          test.results.length !== 1 ||
          test.results[0].status !== test.expectedStatus
        )
          throw new Error(
            'Comparison contains a skipped, retried or failed Web case',
          );
      }
    for (const child of suite.suites ?? []) visit(child);
  }
  for (const suite of report.suites) visit(suite);
  return cases.sort();
}

export async function benchmarkTests() {
  if (!localTestExecutionAllowed())
    throw new Error('Concurrency comparisons run on the test host');
  if (webE2EOptions().fixed || os.availableParallelism() < 4)
    throw new Error(
      'Concurrency comparisons require dynamic ports and at least four available CPUs',
    );
  const identity = await releaseIdentity();
  await fs.mkdir(path.join(ROOT, '.quality'), { recursive: true });
  const directory = await fs.mkdtemp(path.join(ROOT, '.quality/benchmark-'));
  const scratch = await fs.mkdtemp(
    path.join(os.tmpdir(), 'verd-test-comparison-'),
  );
  const resources = path.join(scratch, 'agent-resources');
  const env = {
    ...process.env,
    VERD_AGENT_RESOURCES: resources,
    VERD_AGENT_RESOURCE_TEST_PATH: resources,
    VERD_BUILTIN_WORKSPACES: path.join(
      ROOT,
      'apps/desktop/build/builtin-workspaces',
    ),
    VERD_WEB_E2E_BUILD: path.join(ROOT, 'apps/service/dist-e2e-benchmark'),
    VERD_WEB_BUILD_CONTEXT: path.join(scratch, 'service-build.json'),
  };
  const record = {
    mode: 'benchmark',
    status: 'failed',
    identity,
    sourceDigest: hash(await sourceInventory()),
    selection: {
      unit: unitFiles,
      web: { dev: benchmarkWebFiles('dev'), prod: benchmarkWebFiles('prod') },
    },
    comparisons: [],
    hardware: { cpus: os.availableParallelism(), memoryBytes: os.totalmem() },
  };
  try {
    await runCommand(process.execPath, [
      'scripts/validate-scripts.mjs',
      ...[
        'gate-runner',
        'release-proof',
        'test-concurrency',
        'quality-gate',
        'remote-test',
        'package-output',
        'package-resources',
        'benchmark-tests',
        'build-context',
        'builtin-package',
        'web-e2e-runtime',
      ].map((name) => 'scripts/' + name + '.test.mjs'),
    ]);
    await runCommand('pnpm', [
      'exec',
      'turbo',
      'run',
      'build',
      ...publicPackages.map(({ pkg }) => '--filter=' + pkg.name),
      '--force',
    ]);
    await runCommand(
      process.execPath,
      ['scripts/prepare-builtin-workspaces.mjs'],
      { env },
    );
    await runCommand('pnpm', ['prepare:agent-resources', resources], { env });
    await runCommand(
      process.execPath,
      ['scripts/test-agent-resources.mjs', resources],
      { env },
    );
    await runCommand('pnpm', ['build:web'], { env });
    await assertProductionWeb();
    await runCommand('pnpm', ['build:web:e2e'], { env });
    await runCommand(process.execPath, ['scripts/web-e2e.mjs', 'prepare'], {
      env,
    });
    await runCommand(
      process.execPath,
      [
        'packages/agent/runtime/dist/cli.js',
        'preview',
        'project-doc:development/README',
        '--workspace',
        'workspace',
        '--out',
        path.join(ROOT, '.quality/development-guide.png'),
        '--json',
      ],
      { env },
    );
    for (const [packages, workers] of [
      [2, 2],
      [4, 1],
    ]) {
      const reports = [];
      const commands = (await groupUnitTests(unitFiles)).map((group, index) => {
        const report = path.join(directory, `unit-${packages}-${index}.json`);
        reports.push(report);
        return {
          program: group.program,
          args: [
            ...group.args,
            '--maxWorkers=' + workers,
            '--minWorkers=1',
            '--reporter=default',
            '--reporter=json',
            '--outputFile=' + report,
          ],
          options: {
            cwd: group.cwd,
            env: {
              ...process.env,
              VERD_UNIT_TEST_PACKAGES: String(packages),
              VERD_UNIT_TEST_WORKERS: String(workers),
            },
          },
        };
      });
      const result = await measured(commands, packages);
      result.cases = [];
      for (const report of reports) {
        try {
          const output = JSON.parse(await fs.readFile(report, 'utf8'));
          if (
            !output.success ||
            !output.numTotalTests ||
            output.numPendingTests
          )
            throw new Error('Unit comparison did not pass every selected case');
          for (const file of output.testResults)
            for (const assertion of file.assertionResults)
              result.cases.push(file.name + ':' + assertion.fullName);
        } catch (error) {
          result.status = 'failed';
          result.errors.push(error.message);
        }
      }
      result.cases.sort();
      record.comparisons.push({ kind: 'unit', packages, workers, ...result });
      await writeRecord(path.join(ROOT, '.quality/benchmark.json'), record);
    }
    for (const mode of ['dev', 'prod'])
      for (const workers of [2, 4]) {
        const output = path.join(directory, `web-${mode}-${workers}.json`);
        const reporters = [
          'dot',
          'json',
          ...(process.env.REMOTE_TEST_REPORTER ? [reporterPath] : []),
        ].join(',');
        const result = await measured(
          [
            {
              program: 'pnpm',
              args: [
                'exec',
                'playwright',
                'test',
                '--config',
                `tests/web-e2e/playwright${mode === 'prod' ? '.prod' : ''}.config.ts`,
                '--reporter=' + reporters,
                ...benchmarkWebFiles(mode),
              ],
              options: {
                env: {
                  ...env,
                  VERD_WEB_E2E_WORKERS: String(workers),
                  PLAYWRIGHT_JSON_OUTPUT_FILE: output,
                  VERDBOARD_E2E_OUTPUT: path.join(
                    ROOT,
                    'test-results/concurrency-comparison',
                    `web-${mode}-${workers}`,
                  ),
                },
              },
            },
          ],
          1,
        );
        try {
          result.cases = playwrightCases(
            JSON.parse(await fs.readFile(output, 'utf8')),
          );
        } catch (error) {
          result.status = 'failed';
          result.errors.push(error.message);
          result.cases = [];
        }
        record.comparisons.push({ kind: 'web-' + mode, workers, ...result });
        await writeRecord(path.join(ROOT, '.quality/benchmark.json'), record);
      }
    const pair = (kind) =>
      record.comparisons.filter((comparison) => comparison.kind === kind);
    record.recommended = {
      unitPackages: chooseComparison(...pair('unit')) ? 4 : 2,
      unitWorkers: chooseComparison(...pair('unit')) ? 1 : 2,
      webWorkers: ['web-dev', 'web-prod'].every((kind) =>
        chooseComparison(...pair(kind)),
      )
        ? 4
        : 2,
    };
    if (
      (await releaseInputs()).releaseInputDigest !== identity.releaseInputDigest
    )
      throw new Error('Source changed during comparison');
    record.status = record.comparisons.every(
      (comparison) => comparison.status === 'passed',
    )
      ? 'passed'
      : 'failed';
  } catch (error) {
    record.error = error.message;
  } finally {
    await writeRecord(path.join(ROOT, '.quality/benchmark.json'), record);
    await fs.rm(scratch, { recursive: true, force: true });
  }
  if (record.status !== 'passed')
    throw new Error(
      'Concurrency comparison has failures; see .quality/benchmark.json',
    );
  return record;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  await benchmarkTests();
