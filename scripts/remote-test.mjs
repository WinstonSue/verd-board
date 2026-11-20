#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { finished } from 'node:stream/promises';
import { createTestPlan, parseGateOptions } from './test-plan.mjs';
import { changedFiles } from './test-catalog.mjs';
import { GUI_SESSION_SCRIPT } from './remote-gui-session.mjs';
import {
  readInstallerChecksums,
  summaryExitCode,
  summarizeResults,
  waitForTask,
} from './remote-results.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseSelection } from './quality-gate.mjs';
import {
  releaseInputs,
  assertFullRelease,
  verifyReleaseUnits,
  artifactFiles,
} from './release-proof.mjs';
import { hash } from './release-review.mjs';
import { replaceReleaseDirectory } from './package-output.mjs';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export function developmentProfile(plan, id) {
  const runtime = plan.units.filter(
    (unit) => unit.action === 'run' && unit.runtime,
  );
  return (
    id +
    (runtime.some((unit) => unit.host === 'desktop')
      ? '-dev'
      : runtime.length
        ? '-web'
        : '-units')
  );
}
export function parseCli(input) {
  const args = input[0] === '--' ? input.slice(1) : [...input];
  const action = args.shift() ?? 'ci';
  if (
    ['ci', 'dev', 'release', 'package', 'scripts', 'benchmark'].includes(action)
  ) {
    if (['ci', 'dev', 'release'].includes(action)) {
      const options = parseGateOptions(args);
      if (action !== 'dev' && options.selectors.length)
        throw new Error('CI/release do not accept individual test filters');
      if (action === 'dev') parseSelection(options.selectors);
    }
    if (
      action === 'package' &&
      args.some((arg) => !['--with-zip', '--full'].includes(arg))
    )
      throw new Error('Use package [--with-zip] [--full]');
    if (
      action === 'scripts' &&
      (!args.length ||
        args.some((arg) => !/^scripts\/[\w.-]+\.test\.mjs$/.test(arg)))
    )
      throw new Error('Select repository script test files');
    if (action === 'benchmark' && args.length)
      throw new Error('Benchmark uses its fixed comparison suite');
    return ['submit', '--json', action, '--', ...args];
  }
  if (action === 'doctor' && !args.length) return [action];
  if (
    [
      'wait',
      'resume',
      'summary',
      'status',
      'logs',
      'fetch',
      'cancel',
      'artifacts',
    ].includes(action)
  ) {
    const id = args.shift();
    if (
      id &&
      /^[a-zA-Z0-9][a-zA-Z0-9-]{5,90}$/.test(id) &&
      (!args.length ||
        (action === 'fetch' && args.length === 1 && args[0] === '--raw') ||
        (action === 'summary' && args.length === 1 && args[0] === '--json') ||
        (['wait', 'resume'].includes(action) &&
          args.length === 2 &&
          args[0] === '--timeout' &&
          /^\d+(?:\.\d+)?$/.test(args[1]) &&
          Number.isFinite(Number(args[1]))))
    )
      return [action, id, ...args];
  }
  throw new Error(
    'Use pnpm test:remote [ci|dev <selectors>|release|package [--with-zip]|scripts <test-files>|benchmark|doctor|wait/resume <ID> [--timeout <seconds>]|status/logs/artifacts/fetch/cancel <ID> [--raw]]',
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
    await verifyReleaseUnits(quality, root);
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
    (expected === 'passed' &&
      (record.diagnostics?.length !== 1 ||
        record.diagnostics.some((report) => !report.complete))) ||
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
  const checksums = await readInstallerChecksums(directory);
  const installers = Object.keys(record.files).filter((file) =>
    /\.(?:dmg|zip|exe|AppImage|deb)$/.test(file),
  );
  if (
    !record.files.SHA256SUMS ||
    !checksums ||
    !installers.length ||
    hash(Object.keys(checksums).sort()) !== hash([...installers].sort())
  )
    throw new Error('Installer checksum manifest is missing or incomplete');
  for (const file of installers) {
    const checksum = createHash('sha256');
    for await (const chunk of createReadStream(path.join(directory, file)))
      checksum.update(chunk);
    if (checksum.digest('hex') !== checksums[file])
      throw new Error('Installer SHA-256 checksum mismatch: ' + file);
  }
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
  project.env = {
    ...project.env,
    VERD_VERIFICATION_CACHE:
      config.hosts[project.host].cacheDir.replace(/\/$/, '') +
      '/verd-verification/' +
      id,
  };
  for (const name of [
    'VERD_UNIT_TEST_PACKAGES',
    'VERD_UNIT_TEST_WORKERS',
    'VERD_WEB_E2E_WORKERS',
  ])
    if (env[name] !== undefined) project.env[name] = env[name];
  project.tasks = {
    ...project.tasks,
    ci: { command: ['pnpm', 'check:ci'] },
    dev: { command: ['pnpm', 'check:dev'] },
    release: { command: ['pnpm', 'check:release'] },
    package: { command: ['pnpm', 'package:desktop'] },
    benchmark: { command: ['node', 'scripts/benchmark-tests.mjs'] },
  };
  const originalPrepare = project.prepare ?? [];
  if (project.requiresGui) {
    project.prepare = [
      ['node', GUI_SESSION_SCRIPT, '--check'],
      ...originalPrepare,
    ];
    for (const name of ['ci', 'dev', 'release', 'package', 'benchmark'])
      project.tasks[name].command = [
        'node',
        GUI_SESSION_SCRIPT,
        ...project.tasks[name].command,
      ];
  }
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
  const isolated = {
    ...structuredClone(project),
    requiresGui: false,
    env: { ...project.env, ELECTRON_SKIP_BINARY_DOWNLOAD: '1' },
    prepare: originalPrepare.filter(
      (argv) =>
        !argv.some((arg) =>
          /playwright|install-electron|electron-smoke/.test(arg),
        ),
    ),
    artifacts: { ...project.artifacts, requireReport: false },
  };
  config.projects[id + '-scripts'] = {
    ...structuredClone(isolated),
    tasks: { scripts: { command: ['node', 'scripts/validate-scripts.mjs'] } },
  };
  config.projects[id + '-units'] = {
    ...structuredClone(isolated),
    tasks: { dev: { command: ['pnpm', 'check:dev'] } },
  };
  config.projects[id + '-dev'] = {
    ...structuredClone(project),
    tasks: { dev: project.tasks.dev },
    artifacts: { ...project.artifacts, requireReport: false },
  };
  config.projects[id + '-web'] = {
    ...structuredClone(project),
    requiresGui: false,
    env: { ...project.env, ELECTRON_SKIP_BINARY_DOWNLOAD: '1' },
    prepare: originalPrepare.filter(
      (argv) =>
        !argv.some((arg) => /install-electron|electron-smoke/.test(arg)),
    ),
    tasks: { dev: { command: ['pnpm', 'check:dev'] } },
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
  if (
    (await releaseInputs(root)).releaseInputDigest !==
    manifest.proof?.releaseInputDigest
  )
    throw new Error('Local release inputs changed before delivery');
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
  const alreadyDelivered = await verifyPackageRecord(
    record,
    output,
    manifest,
  ).then(
    () => true,
    () => false,
  );
  if (alreadyDelivered) return;
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
  const verbose = args.includes('--verbose');
  args = args.filter((arg) => arg !== '--verbose');
  const forwarded = parseCli(args);
  const baseIndex = forwarded.indexOf('--base');
  if (baseIndex >= 0) {
    const changes = await changedFiles(forwarded[baseIndex + 1], root);
    changes.sourceDigest = (await releaseInputs(root)).releaseInputDigest;
    forwarded.splice(
      baseIndex,
      2,
      '--changes',
      Buffer.from(JSON.stringify(changes)).toString('base64url'),
    );
  }
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
  if (args[0] === 'dev') {
    const plan = await createTestPlan({
      root,
      mode: 'dev',
      options: parseGateOptions(forwarded.slice(forwarded.indexOf('--') + 1)),
    });
    forwarded.unshift('--project', developmentProfile(plan, id));
  }
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
    if (!execute)
      await fs.access(binary).catch(() => {
        throw new Error(
          'Install the user-level remote-test tool; configuration: ~/.config/remote-test/config.json',
        );
      });
    const resultsRoot = path.isAbsolute(project.resultsDir ?? '')
      ? project.resultsDir
      : path.join(root, project.resultsDir ?? 'test-results/remote');
    const logDirectory = path.join(root, '.quality/remote-logs');
    if (!execute) await fs.mkdir(logDirectory, { recursive: true });
    const processLog = path.join(logDirectory, Date.now() + '.log');
    const command = async (argv, { capture = false, stream = false } = {}) => {
      if (execute) return await execute(binary, argv, options);
      let output = '',
        tail = '';
      const log = createWriteStream(processLog, { flags: 'a' });
      try {
        const code = await new Promise((resolve, reject) => {
          const child = spawn(binary, argv, {
            cwd: root,
            env: options.env,
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          child.stdout.setEncoding('utf8');
          child.stderr.setEncoding('utf8');
          child.stdout.on('data', (value) => {
            log.write(value);
            if (stream || verbose) process.stdout.write(value);
            if (capture) {
              output += value;
              if (output.length > 2_000_000) child.kill();
            }
            tail = (tail + value).slice(-8192);
          });
          child.stderr.on('data', (value) => {
            log.write(value);
            if (stream || verbose) process.stderr.write(value);
            tail = (tail + value).slice(-8192);
          });
          child.once('error', reject);
          child.once('close', (code) => resolve(code ?? 1));
        });
        return { code, output, tail };
      } finally {
        log.end();
        await finished(log);
      }
    };
    const finish = async (id, directory) => {
      const summary = await summarizeResults(directory);
      summary.currentSource =
        summary.currentSource &&
        summary.validatedInputDigest ===
          (await releaseInputs(root)).releaseInputDigest;
      if (summary.task === 'package' && summary.status === 'passed') {
        try {
          await promotePackage(directory, root);
          summary.deliveryStatus = 'delivered';
        } catch (error) {
          summary.deliveryStatus = 'failed';
          summary.deliveryError = error.message;
        }
      }
      await fs.mkdir(path.join(root, '.quality/remote'), { recursive: true });
      await fs.writeFile(
        path.join(root, '.quality/remote', id + '.json'),
        JSON.stringify(summary, null, 2) + '\n',
      );
      return summary;
    };
    if (args[0] === 'summary') {
      const summary = await fs
        .readFile(path.join(root, '.quality/remote', args[1] + '.json'), 'utf8')
        .then(JSON.parse)
        .catch(() => summarizeResults(path.join(resultsRoot, args[1])));
      summary.currentSource =
        summary.validatedInputDigest ===
        (await releaseInputs(root)).releaseInputDigest;
      console.log(JSON.stringify(summary, null, 2));
      return summaryExitCode(summary);
    }
    const action = args[0];
    const passthrough = ['doctor', 'status', 'logs', 'cancel', 'artifacts'];
    if (passthrough.includes(action)) {
      const result = await command(forwarded, { stream: true });
      return typeof result === 'number' ? result : result.code;
    }
    const report = (summary) => console.log(JSON.stringify(summary, null, 2));
    const paused = (taskId, response) => ({
      taskId,
      status: response.state,
      confirmedBytes: response.confirmedBytes,
      totalBytes: response.totalBytes,
      error: response.error,
      recover:
        response.state === 'upload-paused'
          ? 'pnpm test:remote resume ' + taskId
          : undefined,
    });
    const submitting =
      forwarded[forwarded[0] === '--project' ? 2 : 0] === 'submit';
    let taskId = args[1];
    if (submitting || action === 'resume') {
      let uploadArgs;
      if (submitting) {
        taskId =
          new Date().toISOString().replace(/[-:.TZ]/g, '') +
          '-' +
          randomUUID().slice(0, 8);
        console.log('Task: ' + taskId);
        uploadArgs = [...forwarded];
        uploadArgs.splice(uploadArgs.indexOf('--'), 0, '--id', taskId);
      } else uploadArgs = ['resume', taskId, '--json'];
      try {
        const result = await command(uploadArgs, { capture: true });
        const receipt = JSON.parse(result.output);
        if (receipt.id === taskId && receipt.state === 'upload-paused') {
          report(paused(taskId, receipt));
          return result.code || 75;
        }
        if (result.code || receipt.id !== taskId || receipt.accepted !== true)
          throw new Error(receipt.error || 'Invalid submission receipt');
      } catch (error) {
        report({
          taskId,
          status: 'submission-failed',
          error: error.message,
          log: processLog,
        });
        return 1;
      }
    }

    let execution,
      failureStage = 'observation';
    const fetch = async (id) => {
      failureStage = 'retrieval';
      const argv = [
        'fetch',
        id,
        '--json',
        ...(args.includes('--raw') ? ['--raw'] : []),
      ];
      const result = await command(argv, { capture: true });
      const receipt = JSON.parse(result.output);
      if (
        receipt.id !== id ||
        receipt.download?.state !== 'complete' ||
        !path.isAbsolute(receipt.download.directory ?? '')
      )
        throw new Error(
          receipt.download?.error ||
            receipt.error ||
            'Invalid result retrieval receipt',
        );
      execution = receipt.execution;
      return receipt.download.directory;
    };
    try {
      let summary;
      if (action === 'fetch') {
        summary = await finish(taskId, await fetch(taskId));
      } else {
        const timeoutIndex = args.indexOf('--timeout');
        summary = await waitForTask(taskId, {
          timeout: submitting
            ? null
            : timeoutIndex >= 0
              ? Number(args[timeoutIndex + 1])
              : 600,
          status: async (id) => {
            const result = await command(['status', id, '--json'], {
              capture: true,
            });
            execution = JSON.parse(result.output);
            if (execution.id !== id || !execution.state)
              throw new Error(execution.error || 'Could not query task ' + id);
            return execution;
          },
          fetch,
          summarize: finish,
        });
      }
      if (['upload-paused', 'upload-expired'].includes(summary.status)) {
        report(paused(taskId, { ...summary, state: summary.status }));
        return summary.status === 'upload-paused' ? 75 : 1;
      }
      report(summary);
      return summary.timedOut ? 0 : summaryExitCode(summary);
    } catch (error) {
      report({
        taskId,
        status:
          failureStage === 'retrieval'
            ? 'retrieval-failed'
            : 'observation-failed',
        execution,
        error: error.message,
        log: processLog,
        recover: 'pnpm test:remote wait ' + taskId,
      });
      return 1;
    }
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
