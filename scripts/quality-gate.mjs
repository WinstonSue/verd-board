import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  ROOT,
  hash,
  sourceInventory,
  checkReleaseReview,
} from './release-review.mjs';
import { publicPackages } from './pack-public.mjs';

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
  if (
    selected &&
    (!selection.unit.length ||
      !(selection.web.length || selection.desktop.length))
  )
    throw new Error(
      'Feature development requires both unit tests and E2E tests',
    );
  return selected ? selection : null;
}

export async function runCommand(
  program,
  args,
  { env = process.env, cwd = ROOT } = {},
) {
  console.log(`\n[gate] ${program} ${args.join(' ')}`);
  await new Promise((resolve, reject) => {
    const child = spawn(program, args, {
      cwd,
      env,
      stdio: 'inherit',
      shell: process.platform === 'win32' && program === 'pnpm',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) =>
      code === 0
        ? resolve()
        : reject(
            Object.assign(new Error(`${program} exited ${code ?? signal}`), {
              exitCode: code ?? 1,
            }),
          ),
    );
  });
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
  if (['dev', 'ci'].includes(mode) && !localTestExecutionAllowed(env)) {
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
        !file.startsWith('scripts/')
      )
        throw new Error('Unsupported unit test: ' + file);
      if (!(await fs.stat(path.join(ROOT, file))).isFile())
        throw new Error('Missing test: ' + file);
    }
}

/** One fixed full suite serves CI and publishing; development may select feature tests. */
export async function runGate(mode, args = []) {
  if (!['dev', 'ci', 'release'].includes(mode))
    throw new Error('Unknown gate: ' + mode);
  if (mode !== 'dev' && args.length)
    throw new Error('Full CI/release gates do not accept test filters');
  if (mode !== 'release' && !localTestExecutionAllowed())
    throw new Error(
      'Development validation runs on the test host. Use pnpm check:dev, pnpm check:ci or pnpm test:remote. Explicit user-requested local debugging requires VERD_TEST_EXECUTION=local.',
    );
  const selection = mode === 'dev' ? parseSelection(args) : null;
  await validateSelection(selection);
  if (mode === 'release') await checkReleaseReview();
  const before = hash(await sourceInventory());
  const steps = [];
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'verd-quality-'));
  const resources = path.join(scratch, 'agent-resources');
  const env = {
    ...process.env,
    VERD_TEST_EXECUTION:
      mode === 'release'
        ? 'release'
        : (process.env.VERD_TEST_EXECUTION ?? 'ci'),
    VERD_AGENT_RESOURCES: resources,
    VERD_AGENT_RESOURCE_TEST_PATH: resources,
  };
  // Unit and standalone consumer tests provide their own fixtures/packages.
  // Injecting the shared bundle would alter their workspace initialization.
  const unitEnv = {
    ...process.env,
    VERD_TEST_EXECUTION: env.VERD_TEST_EXECUTION,
  };
  delete unitEnv.VERD_AGENT_RESOURCES;
  delete unitEnv.VERD_AGENT_RESOURCE_TEST_PATH;
  const run = async (program, argv, options) => {
    await runCommand(program, argv, options);
    steps.push({ program, args: argv, exitCode: 0 });
  };
  const pnpm = (...argv) => run('pnpm', argv, { env });
  const e2e = (...argv) =>
    process.platform === 'linux'
      ? run('xvfb-run', ['-a', 'pnpm', ...argv], { env })
      : pnpm(...argv);
  try {
    await pnpm('lint');
    await pnpm('format:check');
    await pnpm('typecheck');
    await pnpm('check:plugins');
    await pnpm('workspace:check');
    // Force a fresh dependency build and test execution; cached success is not a release proof.
    await pnpm(
      'exec',
      'turbo',
      'run',
      'build',
      ...publicPackages.map(({ pkg }) => '--filter=' + pkg.name),
      '--force',
    );
    await pnpm('prepare:agent-resources', resources);
    await run(
      process.execPath,
      ['scripts/test-agent-resources.mjs', resources],
      { env },
    );
    if (!selection)
      await pnpm('exec', 'turbo', 'run', 'build', '--filter=!desktop');
    if (selection) {
      for (const file of selection.unit) {
        if (file.startsWith('scripts/'))
          await run(process.execPath, ['--test', file], { env: unitEnv });
        else {
          let directory = path.dirname(path.join(ROOT, file));
          while (
            !(await fs
              .stat(path.join(directory, 'package.json'))
              .catch(() => null))
          )
            directory = path.dirname(directory);
          await run(
            'pnpm',
            [
              'exec',
              'vitest',
              'run',
              '--passWithNoTests=false',
              path.relative(directory, path.join(ROOT, file)),
            ],
            { cwd: directory, env: unitEnv },
          );
        }
      }
    } else {
      await run('pnpm', ['test'], { env: unitEnv });
      await pnpm('pack:dry');
      await run('pnpm', ['test:consumer'], { env: unitEnv });
      await run('pnpm', ['test:plugin-consumers'], { env: unitEnv });
      await run('pnpm', ['test:agent-consumer'], { env: unitEnv });
    }
    if (!selection || selection.web.length)
      await pnpm(
        'test:e2e',
        ...(selection?.web.map((file) => file.replace('tests/web-e2e/', '')) ??
          []),
      );
    if (!selection || selection.desktop.length)
      await e2e('test:e2e:desktop', ...(selection?.desktop ?? []));
    if (!selection) {
      await pnpm('build:web');
      await assertProductionWeb();
      await pnpm('build:web:e2e');
      await pnpm('test:e2e:prod');
      await pnpm('--filter', 'desktop', 'build');
      await e2e('test:e2e:desktop:prod');
    }
    if (hash(await sourceInventory()) !== before)
      throw new Error(
        'Source changed during validation; rerun the gate against the final source',
      );
    if (mode === 'release') await checkReleaseReview();
    await fs.mkdir(path.join(ROOT, '.quality'), { recursive: true });
    await fs.writeFile(
      path.join(ROOT, '.quality', mode + '.json'),
      JSON.stringify(
        {
          mode,
          sourceDigest: before,
          platform: process.platform,
          node: process.version,
          selection,
          steps,
        },
        null,
        2,
      ) + '\n',
    );
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
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
