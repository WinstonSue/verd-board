#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseSelection } from './quality-gate.mjs';
import {
  releaseInputs,
  assertFullRelease,
  artifactFiles,
} from './release-proof.mjs';
import { hash } from './release-review.mjs';
import { replaceReleaseDirectory } from './package-output.mjs';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export function parseCli(input) {
  const args = input[0] === '--' ? input.slice(1) : [...input];
  const action = args.shift() ?? 'ci';
  if (
    ['ci', 'dev', 'release', 'package', 'scripts', 'benchmark'].includes(action)
  ) {
    if (['ci', 'release'].includes(action) && args.length)
      throw new Error('Full CI does not accept test filters');
    if (action === 'dev') parseSelection(args);
    if (action === 'package' && args.some((arg) => arg !== '--with-zip'))
      throw new Error('Use package [--with-zip]');
    if (
      action === 'scripts' &&
      (!args.length ||
        args.some((arg) => !/^scripts\/[\w.-]+\.test\.mjs$/.test(arg)))
    )
      throw new Error('Select repository script test files');
    if (action === 'benchmark' && args.length)
      throw new Error('Benchmark uses its fixed comparison suite');
    return ['run', action, '--', ...args];
  }
  if (action === 'doctor' && !args.length) return [action];
  if (['status', 'logs', 'fetch', 'cancel', 'artifacts'].includes(action)) {
    const id = args.shift();
    if (
      id &&
      /^[a-zA-Z0-9][a-zA-Z0-9-]{5,90}$/.test(id) &&
      (!args.length ||
        (action === 'fetch' && args.length === 1 && args[0] === '--raw'))
    )
      return [action, id, ...args];
  }
  throw new Error(
    'Use pnpm test:remote [ci|dev <selectors>|release|package [--with-zip]|scripts <test-files>|benchmark|doctor|status/logs/artifacts/fetch/cancel <ID> [--raw]]',
  );
}
export async function captureProof(root = ROOT) {
  const { hash, sourceInventory } = await import(
    pathToFileURL(path.join(root, 'scripts/release-review.mjs')).href
  );
  return {
    sourceDigest: hash(await sourceInventory(root)),
    ...(await releaseInputs(root)),
  };
}
export async function verifyProof(
  manifestFile = process.env.REMOTE_TEST_MANIFEST,
  root = ROOT,
) {
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
  const mode = manifest.task === 'package' ? 'release' : manifest.task;
  const quality = JSON.parse(
    await fs.readFile(path.join(root, '.quality', mode + '.json'), 'utf8'),
  );
  if (
    quality.status !== 'passed' ||
    quality.mode !== mode ||
    quality.sourceDigest !== manifest.proof?.sourceDigest ||
    (await captureProof(root)).sourceDigest !== manifest.proof?.sourceDigest ||
    quality.identity?.releaseInputDigest !==
      manifest.proof?.releaseInputDigest ||
    (await releaseInputs(root)).releaseInputDigest !==
      manifest.proof?.releaseInputDigest
  )
    throw new Error('Gate did not validate the captured source');
  if (['release', 'package'].includes(manifest.task))
    assertFullRelease(quality);
  if (manifest.task === 'package') {
    const record = JSON.parse(
      await fs.readFile(path.join(root, '.quality/package.json'), 'utf8'),
    );
    await verifyPackageRecord(
      record,
      path.join(root, 'apps/desktop/release'),
      manifest,
    );
    if (hash(record.release) !== hash(quality))
      throw new Error(
        'Package and release proofs belong to different gate results',
      );
  }
}

export async function verifyPackageRecord(record, directory, manifest) {
  assertFullRelease(record.release);
  const expected =
    record.release.identity.platform === 'darwin' ? 'passed' : 'not-applicable';
  if (
    record.format !== 'verd-desktop-package' ||
    record.version !== 1 ||
    record.status !== 'passed' ||
    ['application', 'installer', 'e2e'].some(
      (key) => record.validations?.[key] !== expected,
    ) ||
    record.release.identity.remote?.id !== manifest.id ||
    record.release.identity.remote?.transportDigest !==
      manifest.transportDigest ||
    record.release.identity.remote?.profileDigest !== manifest.profileDigest ||
    record.release.identity.releaseInputDigest !==
      manifest.proof?.releaseInputDigest ||
    record.release.sourceDigest !== manifest.proof?.sourceDigest ||
    !record.files ||
    hash(await artifactFiles(directory)) !== hash(record.files)
  )
    throw new Error(
      'Package evidence or installer bytes do not match the validated task',
    );
}

/** Stable task definitions; credentials and connection settings remain user-owned. */
export function deriveConfiguration(configuration, root, env = process.env) {
  const config = structuredClone(configuration);
  const match = Object.entries(config.projects).find(
    ([, project]) =>
      path.resolve(project.root.replace(/^~(?=\/)/, os.homedir())) ===
      path.resolve(root),
  );
  if (!match)
    throw new Error(
      'Project is not registered in the remote-test configuration',
    );
  const [id, project] = match;
  project.env = { ...project.env };
  for (const name of [
    'VERD_UNIT_TEST_PACKAGES',
    'VERD_UNIT_TEST_WORKERS',
    'VERD_WEB_E2E_WORKERS',
  ])
    if (env[name] !== undefined) project.env[name] = env[name];
  project.tasks = {
    ...project.tasks,
    release: { command: ['pnpm', 'check:release'] },
    package: { command: ['pnpm', 'package:desktop'] },
    benchmark: { command: ['node', 'scripts/benchmark-tests.mjs'] },
  };
  project.records = [
    ...new Set([
      ...(project.records ?? []),
      '.quality',
      'apps/desktop/release',
    ]),
  ];
  project.proof = {
    capture: ['node', 'scripts/remote-test.mjs', '--capture-proof'],
    verify: ['node', 'scripts/remote-test.mjs', '--verify-proof'],
  };
  config.projects[id + '-scripts'] = {
    ...structuredClone(project),
    tasks: { scripts: { command: ['node', 'scripts/validate-scripts.mjs'] } },
    artifacts: { ...project.artifacts, requireReport: false },
  };
  return { config, id, project };
}

export async function promotePackage(results, root = ROOT) {
  const manifest = JSON.parse(
    await fs.readFile(path.join(results, 'manifest.json'), 'utf8'),
  );
  if (manifest.task !== 'package') return;
  const state = JSON.parse(
    await fs.readFile(path.join(results, 'status.json'), 'utf8'),
  );
  const comparison = JSON.parse(
    await fs.readFile(path.join(results, 'local-comparison.json'), 'utf8'),
  );
  const evidence = JSON.parse(
    await fs.readFile(path.join(results, 'artifacts.json'), 'utf8'),
  );
  if (state.state !== 'passed' || !comparison.current || !evidence.complete)
    throw new Error(
      'Only complete, current, passed package results can be promoted',
    );
  const source = path.join(results, 'source/apps/desktop/release');
  const record = JSON.parse(
    await fs.readFile(
      path.join(results, 'source/.quality/package.json'),
      'utf8',
    ),
  );
  await verifyPackageRecord(record, source, manifest);
  const release = JSON.parse(
    await fs.readFile(
      path.join(results, 'source/.quality/release.json'),
      'utf8',
    ),
  );
  if (hash(record.release) !== hash(release))
    throw new Error(
      'Package and release proofs belong to different gate results',
    );
  const output = path.join(root, 'apps/desktop/release');
  await replaceReleaseDirectory(
    source,
    output,
    path.join(
      root,
      'apps/desktop/release-history',
      'remote-' + manifest.id + '-' + Date.now(),
    ),
    (directory) => verifyPackageRecord(record, directory, manifest),
  );
  console.log('Verified installers: ' + output);
}
export async function main(args, { execute, root = ROOT, configuration } = {}) {
  if (args[0] === '--') args = args.slice(1);
  if (args[0] === '--capture-proof') {
    console.log(JSON.stringify(await captureProof(root)));
    return 0;
  }
  if (args[0] === '--verify-proof') {
    await verifyProof(undefined, root);
    return 0;
  }
  const forwarded = parseCli(args);
  if (args[0] === 'scripts')
    for (const file of args.slice(1)) {
      if (!(await fs.stat(path.join(root, file)).catch(() => null))?.isFile())
        throw new Error('Missing script test: ' + file);
    }
  const binary = path.join(os.homedir(), '.local', 'bin', 'remote-test');
  const original =
    configuration ??
    JSON.parse(
      await fs.readFile(
        process.env.REMOTE_TEST_CONFIG ??
          path.join(os.homedir(), '.config/remote-test/config.json'),
        'utf8',
      ),
    );
  const { config, id, project } = deriveConfiguration(original, root);
  if (args[0] === 'scripts') forwarded.unshift('--project', id + '-scripts');
  const temporary = await fs.mkdtemp(
    path.join(os.tmpdir(), 'verd-remote-profile-'),
  );
  const profile = path.join(temporary, 'config.json');
  await fs.writeFile(profile, JSON.stringify(config), { mode: 0o600 });
  const options = {
    cwd: root,
    env: { ...process.env, REMOTE_TEST_CONFIG: profile },
  };
  try {
    if (execute) return await execute(binary, forwarded, options);
    await fs.access(binary).catch(() => {
      throw new Error(
        'Install the user-level remote-test tool; configuration: ~/.config/remote-test/config.json',
      );
    });
    let output = '';
    const code = await new Promise((resolve, reject) => {
      const child = spawn(binary, forwarded, {
        cwd: root,
        stdio: ['inherit', 'pipe', 'inherit'],
        env: options.env,
      });
      child.stdout.on('data', (chunk) => {
        process.stdout.write(chunk);
        output += chunk;
      });
      child.once('error', reject);
      child.once('exit', (code) => resolve(code ?? 1));
    });
    const taskId =
      forwarded[0] === 'fetch'
        ? forwarded[1]
        : output.match(/任务：([a-zA-Z0-9-]+)/)?.[1];
    if (
      code === 0 &&
      taskId &&
      (args[0] === 'package' || args[0] === 'fetch')
    ) {
      const resultsRoot = path.isAbsolute(project.resultsDir ?? '')
        ? project.resultsDir
        : path.join(root, project.resultsDir ?? 'test-results/remote');
      await promotePackage(
        path.join(
          resultsRoot,
          taskId,
          ...(args.includes('--raw') ? ['raw'] : []),
        ),
        root,
      );
    }
    return code;
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(error.stack);
    process.exitCode = 1;
  }
}
