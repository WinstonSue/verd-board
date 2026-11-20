import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { finished } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import { randomUUID } from 'node:crypto';
import {
  collectStages,
  assertStagesPassed,
  writeRecord,
} from './gate-runner.mjs';
import { testConcurrency, vitestArguments } from './test-concurrency.mjs';
import {
  releaseInputs,
  releaseIdentity,
  captureArtifacts,
} from './release-proof.mjs';
import {
  ROOT,
  hash,
  sourceInventory,
  checkReleaseReview,
} from './release-review.mjs';
import { publicPackages } from './pack-public.mjs';
import { createTestPlan, parseGateOptions } from './test-plan.mjs';
import { digest, verificationIdentity, loadCatalog } from './test-catalog.mjs';
import { verificationCache, saveVerification } from './verification-cache.mjs';

export function parseSelection(args) {
  const selection = { unit: [], web: [], desktop: [] };
  for (let index = 0; index < args.length; index += 2) {
    const key = {
      '--unit': 'unit',
      '--web-e2e': 'web',
      '--desktop-e2e': 'desktop',
    }[args[index]];
    const value = args[index + 1];
    if (!key || !value || value.startsWith('-'))
      throw new Error(
        'Use --unit <test-file> --web-e2e <test-file> --desktop-e2e <test-file>; repeat selectors as needed',
      );
    if (
      path.isAbsolute(value) ||
      value.split(/[\\/]/).includes('..') ||
      !/\.(?:spec|test)\.(?:[cm]?js|tsx?)$/.test(value)
    )
      throw new Error('Expected a repository-relative test file: ' + value);
    selection[key].push(value);
  }
  const selected = Object.values(selection).some((files) => files.length);
  return selected ? selection : null;
}

export async function runCommand(
  program,
  args,
  { env = process.env, cwd = ROOT, logFile, onSpawn } = {},
) {
  console.log(`\n[gate] ${program} ${args.join(' ')}`);
  if (logFile) await fs.mkdir(path.dirname(logFile), { recursive: true });
  const log = logFile ? createWriteStream(logFile) : null;
  log?.on('error', () => {});
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(program, args, {
        cwd,
        env,
        stdio: log ? ['inherit', 'pipe', 'pipe'] : 'inherit',
        shell: process.platform === 'win32' && program === 'pnpm',
      });
      onSpawn?.(child);
      if (log) {
        child.stdout.on('data', (chunk) => {
          process.stdout.write(chunk);
          log.write(chunk);
        });
        child.stderr.on('data', (chunk) => {
          process.stderr.write(chunk);
          log.write(chunk);
        });
      }
      child.once('error', (error) =>
        reject(Object.assign(error, { fatal: true })),
      );
      child.once('close', (code, signal) =>
        code === 0
          ? resolve()
          : reject(
              Object.assign(new Error(`${program} exited ${code ?? signal}`), {
                exitCode: code ?? 1,
                signal,
              }),
            ),
      );
    });
  } finally {
    if (log) {
      log.end();
      await finished(log);
    }
  }
}

export function localTestExecutionAllowed(env = process.env) {
  return (
    ['remote', 'ci', 'local', 'release'].includes(
      env.VERD_TEST_EXECUTION ?? '',
    ) || env.GITHUB_ACTIONS === 'true'
  );
}

/** Old development commands also default to the remote test host. */
export async function runQualityCli(
  mode,
  args = [],
  { env = process.env, execute = runCommand, gate = runGate } = {},
) {
  if (
    ['dev', 'ci', 'release'].includes(mode) &&
    !localTestExecutionAllowed(env)
  ) {
    try {
      await execute(
        process.execPath,
        [path.join(ROOT, 'scripts/remote-test.mjs'), mode, ...args],
        { env },
      );
      return 0;
    } catch (error) {
      if (Number.isInteger(error.exitCode)) return error.exitCode;
      throw error;
    }
  }
  await gate(mode, args);
  return 0;
}

async function validateSelection(selection) {
  if (!selection) return;
  for (const [kind, files] of Object.entries(selection))
    for (const file of files) {
      const prefix =
        kind === 'web'
          ? 'tests/web-e2e/src/'
          : kind === 'desktop'
            ? 'tests/desktop-e2e/src/'
            : '';
      if (prefix && !file.startsWith(prefix))
        throw new Error('Test is outside its E2E suite: ' + file);
      if (
        !prefix &&
        !file.startsWith('packages/') &&
        !file.startsWith('apps/') &&
        !file.startsWith('tests/contracts/') &&
        !file.startsWith('scripts/')
      )
        throw new Error('Unsupported unit test: ' + file);
      if (!(await fs.stat(path.join(ROOT, file))).isFile())
        throw new Error('Missing test: ' + file);
    }
}

export async function groupUnitTests(files, root = ROOT) {
  const groups = new Map();
  for (const file of new Set(files)) {
    const script = file.startsWith('scripts/');
    let directory = script ? root : path.dirname(path.join(root, file));
    while (
      !(await fs.stat(path.join(directory, 'package.json')).catch(() => null))
    ) {
      const parent = path.dirname(directory);
      if (parent === directory)
        throw new Error('No package for unit test: ' + file);
      directory = parent;
    }
    const key = (script ? 'node:' : 'vitest:') + directory;
    if (!groups.has(key))
      groups.set(key, {
        program: script ? process.execPath : 'pnpm',
        args: script
          ? ['--test']
          : ['exec', 'vitest', 'run', '--passWithNoTests=false'],
        cwd: directory,
      });
    groups.get(key).args.push(path.relative(directory, path.join(root, file)));
  }
  return [...groups.values()];
}

export async function recordStep(
  steps,
  program,
  args,
  options,
  execute = runCommand,
) {
  const start = performance.now();
  const step = {
    program,
    args,
    ...(options?.cwd ? { cwd: options.cwd } : {}),
    startedAt: new Date().toISOString(),
  };
  steps.push(step);
  try {
    await execute(program, args, options);
    step.exitCode = 0;
  } catch (error) {
    step.exitCode = error.exitCode ?? 1;
    step.error = error.message;
    throw error;
  } finally {
    step.finishedAt = new Date().toISOString();
    step.durationMs = Math.round(performance.now() - start);
    console.log(
      `[gate:done] ${program} ${args.join(' ')} (${step.durationMs}ms, exit ${step.exitCode})`,
    );
  }
}

export async function gateDiagnostics(env = process.env) {
  if (!env.REMOTE_TEST_JOB_DIR) return [];
  const directory = path.join(env.REMOTE_TEST_JOB_DIR, 'diagnostics');
  const reports = [];
  for (const name of await fs.readdir(directory).catch(() => [])) {
    const file = path.join(directory, name, 'index.json');
    const report = await fs
      .readFile(file, 'utf8')
      .then(JSON.parse)
      .catch((error) =>
        error.code === 'ENOENT'
          ? null
          : { complete: false, issues: [error.message], tests: [] },
      );
    if (report)
      reports.push({
        index: path.relative(env.REMOTE_TEST_JOB_DIR, file),
        complete: report.complete,
        issues: report.issues,
        failedTests: (report.tests ?? [])
          .filter(
            (test) =>
              test.failure ||
              test.status === 'interrupted' ||
              test.status !== test.expectedStatus,
          )
          .map((test) => ({
            title: test.title,
            status: test.status,
            attachments: test.attachments,
          })),
      });
  }
  return reports;
}

/** The dependency graph is shared by full CI and release control. */
async function createLegacyGatePlan({
  selection,
  env,
  unitEnv,
  resources,
  settings,
  logDirectory,
  execute = runCommand,
}) {
  const plan = [];
  const command = (id, dependencies, program, argv, options = { env }) => {
    plan.push({
      id,
      dependsOn: dependencies,
      run: async (stage) => {
        Object.assign(stage, {
          program,
          args: argv,
          ...(options.cwd ? { cwd: options.cwd } : {}),
        });
        const logFile = logDirectory
          ? path.join(logDirectory, id + '.log')
          : undefined;
        if (logFile) stage.log = path.relative(ROOT, logFile);
        try {
          await execute(program, argv, { ...options, logFile });
        } finally {
          if (logFile) {
            const output = stripVTControlCharacters(
              await fs.readFile(logFile, 'utf8').catch(() => ''),
            );
            stage.failures = [
              ...output.matchAll(
                /^(?:[^\n]*?:test:\s*)?(?:\s*FAIL\s+|not ok \d+ - |✖\s+)(.+)$/gm,
              ),
            ].map((match) => match[1]);
          }
        }
      },
    });
  };
  const pnpm = (id, dependencies, ...argv) =>
    command(id, dependencies, 'pnpm', argv);
  const desktop = (id, dependencies, ...argv) =>
    process.platform === 'linux'
      ? command(id, dependencies, 'xvfb-run', ['-a', 'pnpm', ...argv])
      : pnpm(id, dependencies, ...argv);
  pnpm('lint', [], 'exec', 'eslint', '.');
  command('ui-styles', [], process.execPath, ['scripts/check-ui-styles.mjs']);
  pnpm('format', [], 'format:check');
  pnpm('typecheck', [], 'typecheck');
  pnpm('plugins', [], 'check:plugins');
  pnpm('workspace', [], 'workspace:check');
  pnpm(
    'public-build',
    [],
    'exec',
    'turbo',
    'run',
    'build',
    ...publicPackages.map(({ pkg }) => '--filter=' + pkg.name),
    '--force',
    '--continue=dependencies-successful',
  );
  command(
    'builtin-workspaces',
    ['public-build', 'workspace'],
    process.execPath,
    ['scripts/prepare-builtin-workspaces.mjs'],
  );
  pnpm(
    'agent-resources',
    ['public-build'],
    'prepare:agent-resources',
    resources,
  );
  command('agent-resources-check', ['agent-resources'], process.execPath, [
    'scripts/test-agent-resources.mjs',
    resources,
  ]);
  if (!selection)
    pnpm(
      'application-build',
      ['public-build'],
      '--filter',
      'consumer-vite',
      'build',
    );
  if (selection) {
    for (const [index, group] of (
      await groupUnitTests(selection.unit)
    ).entries()) {
      const node = group.program === process.execPath;
      command(
        'unit-' + index,
        node ? [] : ['public-build'],
        group.program,
        [
          ...group.args.slice(0, node ? 1 : 4),
          ...(node
            ? ['--test-concurrency=' + settings.scripts]
            : vitestArguments(settings)),
          ...group.args.slice(node ? 1 : 4),
        ],
        { cwd: group.cwd, env: unitEnv },
      );
    }
  } else {
    command(
      'unit-packages',
      ['public-build'],
      process.execPath,
      ['scripts/test-units.mjs', '--packages-only', '--prebuilt'],
      {
        env: {
          ...unitEnv,
          VERD_UNIT_TEST_PACKAGES: String(settings.packages),
          VERD_UNIT_TEST_WORKERS: String(settings.workers),
        },
      },
    );
    command(
      'unit-scripts',
      [],
      process.execPath,
      ['scripts/test-scripts.mjs'],
      { env: unitEnv },
    );
    pnpm('pack', ['public-build'], 'pack:dry');
    command(
      'consumer',
      ['public-build', 'pack', 'application-build'],
      process.execPath,
      ['scripts/test-consumer.mjs'],
      { env: unitEnv },
    );
    for (const [id, script] of [
      ['plugin-consumers', 'test:plugin-consumers'],
      ['agent-consumer', 'test:agent-consumer'],
    ])
      command(id, ['public-build', 'pack'], 'pnpm', [script], { env: unitEnv });
  }
  const runtime = [
    'public-build',
    'agent-resources-check',
    'builtin-workspaces',
  ];
  if (!selection || selection.web.length)
    pnpm(
      'web-dev',
      runtime,
      'test:e2e',
      ...(selection?.web.map((file) => file.replace('tests/web-e2e/', '')) ??
        []),
    );
  if (!selection || selection.desktop.length)
    desktop(
      'desktop-dev',
      runtime,
      'test:e2e:desktop',
      ...(selection?.desktop ?? []),
    );
  if (!selection) {
    pnpm(
      'web-build',
      ['public-build', 'agent-resources', 'builtin-workspaces'],
      'build:web',
    );
    plan.push({
      id: 'web-production-clean',
      dependsOn: ['web-build'],
      run: () => assertProductionWeb(),
    });
    pnpm('web-e2e-build', ['web-build'], 'build:web:e2e');
    pnpm(
      'web-prod',
      [...runtime, 'web-production-clean', 'web-e2e-build'],
      'test:e2e:prod',
    );
    pnpm('desktop-build', ['public-build'], '--filter', 'desktop', 'build');
    desktop(
      'desktop-prod',
      [...runtime, 'desktop-build'],
      'test:e2e:desktop:prod',
    );
  }
  return plan;
}

/** Test ownership and the execution graph are separate: building a dependency never selects its tests. */
export async function createGatePlan(options) {
  if (!options.verification) return createLegacyGatePlan(options);
  const {
    verification,
    env,
    unitEnv,
    settings,
    logDirectory,
    execute = runCommand,
  } = options;
  const units = verification.units.filter((unit) => unit.action === 'run');
  const runtimeUnits = units.filter((unit) => unit.runtime);
  const isolated =
    verification.mode === 'dev' &&
    units.every(
      (unit) => unit.runner === 'node' || unit.layer === 'foundation',
    );
  const legacy = await createLegacyGatePlan({ ...options, selection: null });
  const plan = legacy.filter(
    (stage) =>
      ![
        'unit-packages',
        'unit-scripts',
        'web-dev',
        'desktop-dev',
        'web-prod',
        'desktop-prod',
      ].includes(stage.id),
  );
  const add = (id, dependsOn, program, args, execution, ownedUnits) => {
    plan.push({
      id,
      dependsOn,
      units: ownedUnits.map((unit) => unit.id),
      run: async (stage) => {
        Object.assign(stage, {
          program,
          args,
          units: ownedUnits.map((unit) => unit.id),
          cwd: execution.cwd ?? ROOT,
        });
        const logFile = path.join(
          logDirectory,
          id.replaceAll(':', '_') + '.log',
        );
        stage.log = path.relative(ROOT, logFile);
        try {
          await execute(program, args, { ...execution, logFile });
        } finally {
          const output = stripVTControlCharacters(
            await fs.readFile(logFile, 'utf8').catch(() => ''),
          );
          stage.failures = [
            ...output.matchAll(
              /^(?:[^\n]*?:test:\s*)?(?:\s*FAIL\s+|not ok \d+ - |✖\s+)(.+)$/gm,
            ),
          ].map((match) => match[1]);
        }
      },
    });
  };
  for (const unit of units.filter((unit) => !unit.runtime)) {
    const [group] = await groupUnitTests(unit.tests);
    const node = group.program === process.execPath;
    add(
      unit.id,
      node || isolated || unit.layer === 'foundation' ? [] : ['public-build'],
      group.program,
      [
        ...group.args.slice(0, node ? 1 : 4),
        ...(node
          ? ['--test-concurrency=' + settings.scripts]
          : vitestArguments(settings)),
        ...group.args.slice(node ? 1 : 4),
      ],
      { cwd: group.cwd, env: unitEnv },
      [unit],
    );
    Object.assign(plan.at(-1), {
      pool: node ? 'script-files' : 'unit-packages',
      concurrency: node ? settings.scripts : settings.packages,
    });
  }
  const runtime = [
    'public-build',
    'agent-resources-check',
    'builtin-workspaces',
  ];
  for (const [id, host, state, command] of [
    ['web-dev', 'web', 'development', 'test:e2e'],
    ['desktop-dev', 'desktop', 'development', 'test:e2e:desktop'],
    ['web-prod', 'web', 'production', 'test:e2e:prod'],
    ['desktop-prod', 'desktop', 'production', 'test:e2e:desktop:prod'],
  ]) {
    const selected = runtimeUnits.filter(
      (unit) => unit.host === host && unit.runtime === state,
    );
    if (!selected.length) continue;
    const files = selected
      .flatMap((unit) => unit.tests)
      .map((file) =>
        host === 'web' ? file.replace('tests/web-e2e/', '') : file,
      );
    const deps = [
      ...runtime,
      ...(id === 'web-prod'
        ? ['web-production-clean', 'web-e2e-build']
        : id === 'desktop-prod'
          ? ['desktop-build']
          : []),
    ];
    const headless = host === 'desktop' && process.platform === 'linux';
    add(
      id,
      deps,
      headless ? 'xvfb-run' : 'pnpm',
      [...(headless ? ['-a', 'pnpm'] : []), command, ...files],
      { env },
      selected,
    );
  }
  if (verification.mode === 'dev' && !runtimeUnits.length) {
    const unnecessary = new Set([
      'builtin-workspaces',
      'agent-resources',
      'agent-resources-check',
      'application-build',
      'pack',
      'consumer',
      'plugin-consumers',
      'agent-consumer',
      'web-build',
      'web-production-clean',
      'web-e2e-build',
      'desktop-build',
    ]);
    if (isolated) {
      unnecessary.add('public-build');
      unnecessary.add('typecheck');
      for (const unit of units.filter((unit) => unit.layer === 'foundation')) {
        const config = path.join(
          path.dirname(options.resources),
          unit.id.replaceAll(':', '_').replaceAll('/', '_') + '.tsconfig.json',
        );
        plan.push({
          id: 'typecheck:' + unit.id,
          units: [unit.id],
          dependsOn: [],
          run: async (stage) => {
            await fs.mkdir(path.dirname(config), { recursive: true });
            await fs.writeFile(
              config,
              JSON.stringify({
                extends: path.join(ROOT, 'tsconfig.base.json'),
                compilerOptions: { noEmit: true },
                include: [path.join(ROOT, unit.directory, 'src/**/*.ts')],
                exclude: [
                  path.join(ROOT, unit.directory, '**/*.spec.ts'),
                  path.join(ROOT, unit.directory, '**/*.test.ts'),
                ],
              }),
            );
            const args = ['exec', 'tsc', '--project', config];
            const logFile = path.join(
              logDirectory,
              'typecheck-' + path.basename(config) + '.log',
            );
            Object.assign(stage, {
              program: 'pnpm',
              args,
              cwd: ROOT,
              log: path.relative(ROOT, logFile),
            });
            await execute('pnpm', args, { env, logFile });
          },
        });
      }
    }
    return plan.filter((stage) => !unnecessary.has(stage.id));
  }
  return plan;
}

/** Execute selected complete units; reuse only matching verification evidence. */
export async function runGate(mode, args = [], { consume } = {}) {
  if (!['dev', 'ci', 'release'].includes(mode))
    throw new Error('Unknown gate: ' + mode);
  const options = parseGateOptions(args);
  if (mode !== 'dev' && options.selectors.length)
    throw new Error(
      'Release and CI accept --full, not individual test filters',
    );
  if (mode !== 'release' && !localTestExecutionAllowed())
    throw new Error(
      'Validation runs on the test host; use pnpm check:dev, pnpm check:ci or pnpm check:release.',
    );
  const selection = mode === 'dev' ? parseSelection(options.selectors) : null;
  const verification = await createTestPlan({ mode, options });
  await validateSelection(selection);
  if (mode === 'release') await checkReleaseReview();
  const before = hash(await sourceInventory());
  const identity = await releaseIdentity();
  const settings = testConcurrency();
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'verd-quality-'));
  const resources = path.join(scratch, 'agent-resources');
  const builtin = path.join(ROOT, 'apps/desktop/build/builtin-workspaces');
  const webBuild = path.join(
    ROOT,
    'apps/service',
    'dist-e2e-' + path.basename(scratch),
  );
  const env = {
    ...process.env,
    VERD_TEST_EXECUTION:
      process.env.VERD_TEST_EXECUTION ??
      (mode === 'release' ? 'release' : 'ci'),
    VERD_AGENT_RESOURCES: resources,
    VERD_AGENT_RESOURCE_TEST_PATH: resources,
    VERD_WEB_E2E_BUILD: webBuild,
    VERD_BUILTIN_WORKSPACES: builtin,
    VERD_WEB_BUILD_CONTEXT: path.join(scratch, 'service-build.json'),
  };
  const unitEnv = {
    ...process.env,
    VERD_TEST_EXECUTION: env.VERD_TEST_EXECUTION,
  };
  delete unitEnv.VERD_AGENT_RESOURCES;
  delete unitEnv.VERD_AGENT_RESOURCE_TEST_PATH;
  delete unitEnv.VERD_BUILTIN_WORKSPACES;
  const record = {
    format: 'verd-quality',
    version: 3,
    runId: randomUUID(),
    mode,
    status: 'running',
    sourceDigest: before,
    identity,
    verification,
    planDigest: verification.digest,
    platform: process.platform,
    executionConcurrency: {
      packages: settings.packages,
      unitWorkers: settings.workers,
      scriptFiles: settings.scripts,
      webWorkers: identity.concurrency.web,
      desktopWorkers: 1,
    },
    node: process.version,
    selection,
    startedAt: new Date().toISOString(),
    steps: [],
  };
  const file = path.join(ROOT, '.quality', mode + '.json');
  const started = performance.now();
  let gatePassed = false;
  try {
    const plan = await createGatePlan({
      selection,
      verification,
      env,
      unitEnv,
      resources,
      settings,
      logDirectory: path.join(ROOT, '.quality/logs', record.runId),
    });
    record.requiredStages = plan.map((node) => node.id);
    record.stageUnits = Object.fromEntries(
      plan.filter((node) => node.units).map((node) => [node.id, node.units]),
    );
    const result = await collectStages(plan, {
      update: async (stages) => {
        record.steps = stages;
        await writeRecord(file, record);
      },
      checkpoint: async () => {
        if (
          (await releaseInputs()).releaseInputDigest !==
          identity.releaseInputDigest
        )
          throw new Error(
            'Source changed during validation; return the final source for a new gate',
          );
      },
    });
    Object.assign(record, result, { steps: result.stages });
    delete record.stages;
    record.diagnostics = await gateDiagnostics();
    const expectedReports = plan.filter((stage) =>
      ['web-dev', 'desktop-dev', 'web-prod', 'desktop-prod'].includes(stage.id),
    ).length;
    const diagnosticsComplete =
      !process.env.REMOTE_TEST_JOB_DIR ||
      (record.diagnostics.length >= expectedReports &&
        record.diagnostics.every((report) => report.complete));
    if (
      (await releaseInputs()).releaseInputDigest !== identity.releaseInputDigest
    )
      throw new Error('Source changed before recording verification');
    record.unitResults = {};
    const catalog = await loadCatalog();
    for (const unit of verification.units) {
      const actual = await verificationIdentity(
        catalog.units.find((entry) => entry.id === unit.id),
        catalog,
      );
      if (actual.digest !== unit.fingerprint)
        throw new Error('Verification inputs changed: ' + unit.id);
      if (unit.action === 'run' && (!unit.runtime || diagnosticsComplete)) {
        const stages = result.stages.filter((stage) =>
          record.stageUnits[stage.id]?.includes(unit.id),
        );
        if (!stages.length || stages.some((stage) => stage.status !== 'passed'))
          continue;
        const evidence = await saveVerification(
          verificationCache(ROOT),
          unit,
          record.runId,
          stages,
        );
        if (evidence) record.unitResults[unit.id] = evidence;
      }
    }
    if (digest({ ...verification, digest: undefined }) !== verification.digest)
      throw new Error('Verification plan changed');
    assertStagesPassed(result);
    if (!diagnosticsComplete)
      throw new Error('Test diagnostics are incomplete; release is blocked');
    if (mode === 'release') await checkReleaseReview();
    record.finishedAt = new Date().toISOString();
    record.durationMs = Math.round(performance.now() - started);
    await writeRecord(file, record);
    gatePassed = true;
    if (consume) {
      if (mode !== 'release' || selection)
        throw new Error(
          'Only a complete release plan can produce packaging context',
        );
      const artifacts = await captureArtifacts({
        agent: resources,
        builtin,
        desktop: path.join(ROOT, 'apps/desktop/dist'),
        electron: path.join(ROOT, 'apps/desktop/dist-electron'),
        web: path.join(ROOT, 'apps/web/dist'),
        webE2E: path.join(ROOT, 'apps/web/dist-e2e'),
        ...Object.fromEntries(
          publicPackages.map(({ pkg, directory }) => [
            pkg.name,
            path.join(directory, 'dist'),
          ]),
        ),
      });
      const context = {
        format: 'verd-release-context',
        version: 1,
        proof: record,
        artifacts,
      };
      context.digest = hash({ proof: record, artifacts });
      const contextFile = path.join(scratch, 'release-context.json');
      await writeRecord(contextFile, context);
      return await consume({
        context,
        contextFile,
        env: {
          ...env,
          VERD_RELEASE_CONTEXT: contextFile,
          VERD_RELEASE_RUN_ID: record.runId,
        },
      });
    }
    return record;
  } catch (error) {
    if (!gatePassed) {
      record.status = 'failed';
      record.error = error.message;
    }
    throw error;
  } finally {
    record.diagnostics ??= await gateDiagnostics();
    record.finishedAt ??= new Date().toISOString();
    record.durationMs ??= Math.round(performance.now() - started);
    await writeRecord(file, record);
    await fs.rm(scratch, { recursive: true, force: true });
    await fs.rm(webBuild, { recursive: true, force: true });
  }
}

export async function assertProductionWeb(
  directory = path.join(ROOT, 'apps/web/dist'),
) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await assertProductionWeb(file);
    else if (
      /\.(?:js|html)$/.test(entry.name) &&
      /__verd(?:ForceDocumentError|NavigationGate|ReadyGate)|__VERD_E2E|__VERDBOARD_E2E|test-support\/workspace-host/.test(
        await fs.readFile(file, 'utf8'),
      )
    )
      throw new Error('Test probes found in production web output: ' + file);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  process.exitCode = await runQualityCli(
    process.argv[2],
    process.argv.slice(3).filter((arg) => arg !== '--'),
  );
