import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { runCommand } from './quality-gate.mjs';
import { testConcurrency, vitestArguments } from './test-concurrency.mjs';
import { collectStages, assertStagesPassed } from './gate-runner.mjs';
import { publicPackages } from './pack-public.mjs';

export async function unitManifests() {
  const root = path.resolve(import.meta.dirname, '..');
  const packages = JSON.parse(
    execFileSync('pnpm', ['list', '--recursive', '--depth=-1', '--json'], {
      cwd: root,
      encoding: 'utf8',
    }),
  );
  return Promise.all(
    packages
      .filter((pkg) => path.resolve(pkg.path) !== root)
      .map(async (pkg) =>
        JSON.parse(
          await fs.readFile(path.join(pkg.path, 'package.json'), 'utf8'),
        ),
      ),
  );
}

export function packageTestCommands(manifests, settings) {
  const groups = [
    [
      'vitest',
      manifests.filter((pkg) =>
        /^vitest(?:\s|$)/.test(pkg.scripts?.test ?? ''),
      ),
    ],
    [
      'other',
      manifests.filter(
        (pkg) => pkg.scripts?.test && !/^vitest(?:\s|$)/.test(pkg.scripts.test),
      ),
    ],
  ];
  return groups
    .filter(([, packages]) => packages.length)
    .map(([id, packages]) => ({
      id,
      args: [
        'exec',
        'turbo',
        'run',
        'test',
        '--concurrency=' + settings.packages,
        '--continue=dependencies-successful',
        '--only',
        ...packages.map((pkg) => '--filter=' + pkg.name),
        ...(id === 'vitest' ? ['--', ...vitestArguments(settings)] : []),
      ],
    }));
}

export async function testPackageUnits({
  execute = runCommand,
  env = process.env,
  manifests,
} = {}) {
  const commands = packageTestCommands(
    manifests ?? (await unitManifests()),
    testConcurrency(env),
  );
  if (!commands.length) throw new Error('No workspace unit commands found');
  const result = await collectStages(
    commands.map(({ id, args }) => ({
      id,
      run: () => execute('pnpm', args, { env }),
    })),
  );
  assertStagesPassed(result);
}

export async function testUnits({
  execute = runCommand,
  env = process.env,
  manifests,
} = {}) {
  const result = await collectStages([
    {
      id: 'public-build',
      run: () =>
        execute(
          'pnpm',
          [
            'exec',
            'turbo',
            'run',
            'build',
            ...publicPackages.map(({ pkg }) => '--filter=' + pkg.name),
            '--continue=dependencies-successful',
          ],
          { env },
        ),
    },
    {
      id: 'unit-packages',
      dependsOn: ['public-build'],
      run: () => testPackageUnits({ execute, env, manifests }),
    },
    {
      id: 'unit-scripts',
      run: () =>
        execute(process.execPath, ['scripts/test-scripts.mjs'], { env }),
    },
  ]);
  assertStagesPassed(result);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  if (process.argv.slice(2).join(' ') === '--packages-only --prebuilt')
    await testPackageUnits();
  else if (process.argv.length === 2) await testUnits();
  else throw new Error('Use test-units.mjs [--packages-only --prebuilt]');
