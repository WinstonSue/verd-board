import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, hash } from './release-review.mjs';
import { testConcurrency } from './test-concurrency.mjs';
import { webE2EOptions } from './web-e2e-runtime.mjs';
import { digest, loadCatalog, verificationIdentity } from './test-catalog.mjs';
import { validVerification } from './verification-cache.mjs';

export const releaseStageIds = [
  'lint',
  'ui-styles',
  'format',
  'typecheck',
  'plugins',
  'workspace',
  'public-build',
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
];

export const fullStageIds = [
  'lint',
  'ui-styles',
  'format',
  'typecheck',
  'plugins',
  'workspace',
  'public-build',
  'builtin-workspaces',
  'agent-resources',
  'agent-resources-check',
  'application-build',
  'unit-packages',
  'unit-scripts',
  'pack',
  'consumer',
  'plugin-consumers',
  'agent-consumer',
  'web-dev',
  'desktop-dev',
  'web-build',
  'web-production-clean',
  'web-e2e-build',
  'web-prod',
  'desktop-build',
  'desktop-prod',
];

/** Unlike the business review digest, this includes versions and packaged prose. */
export async function releaseInputs(root = ROOT) {
  const names = [
    ...new Set(
      execFileSync(
        'git',
        ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
        { cwd: root, encoding: 'utf8' },
      ).split('\0'),
    ),
  ].sort();
  const files = {};
  const versions = {};
  for (const name of names) {
    if (!name || name.startsWith('.quality/') || name.startsWith('.release/'))
      continue;
    const file = path.join(root, name);
    const stat = await fs.lstat(file).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (stat?.isSymbolicLink()) files[name] = { link: await fs.readlink(file) };
    else if (stat?.isFile()) {
      const bytes = await fs.readFile(file);
      files[name] = {
        hash: hash(bytes.toString('base64')),
        executable: stat.mode & 0o111,
      };
      if (path.basename(name) === 'package.json') {
        const pkg = JSON.parse(bytes.toString());
        if (pkg.name && pkg.version) versions[pkg.name] = pkg.version;
      }
    }
  }
  return { releaseInputDigest: hash(files), versions };
}

export async function releaseIdentity(root = ROOT, env = process.env) {
  const inputs = await releaseInputs(root);
  const current = await fs
    .readFile(path.join(root, '.release/current.json'), 'utf8')
    .then(JSON.parse, () => null);
  const review = current
    ? await fs.readFile(
        path.join(root, '.release/reviews', current.record),
        'utf8',
      )
    : '';
  const desktop = JSON.parse(
    await fs.readFile(path.join(root, 'apps/desktop/package.json'), 'utf8'),
  );
  const remote = env.REMOTE_TEST_MANIFEST
    ? JSON.parse(await fs.readFile(env.REMOTE_TEST_MANIFEST, 'utf8'))
    : null;
  const pnpm = execFileSync('pnpm', ['--version'], {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  }).trim();
  if (remote?.runtime?.node && process.version !== 'v' + remote.runtime.node)
    throw new Error('Remote Node runtime does not match its manifest');
  if (remote?.runtime?.pnpm && pnpm !== remote.runtime.pnpm)
    throw new Error('Remote pnpm runtime does not match its manifest');
  return {
    ...inputs,
    reviewDigest: hash(review),
    platform: process.platform,
    arch: process.arch,
    toolchain: {
      node: process.version,
      pnpm,
      electron: JSON.parse(
        await fs.readFile(path.join(root, 'package.json'), 'utf8'),
      ).devDependencies.electron,
    },
    concurrency: {
      ...testConcurrency(env),
      web: webE2EOptions(env).workers,
    },
    environmentDigest: hash(
      Object.fromEntries(
        [
          'NODE_OPTIONS',
          'NODE_ENV',
          'NODE_PATH',
          'VERD_SCHEMA_ARTIFACTS',
          'VERD_TEST_EXECUTION',
          'BASE_URL',
          'VERDBOARD_WEB_PORT',
          'VERDBOARD_SERVICE_PORT',
        ].map((name) => [name, env[name] ?? null]),
      ),
    ),
    productVersion: desktop.version,
    remote: remote
      ? {
          id: remote.id,
          transportDigest: remote.transportDigest,
          profileDigest: remote.profileDigest,
          toolVersion: remote.toolVersion,
        }
      : null,
  };
}

export async function artifactFiles(directory) {
  const files = {};
  async function visit(folder, prefix = '') {
    for (const entry of (
      await fs.readdir(folder, { withFileTypes: true })
    ).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix + entry.name;
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) await visit(file, relative + '/');
      else if (entry.isFile()) {
        const stat = await fs.stat(file);
        files[relative] = {
          hash: hash((await fs.readFile(file)).toString('base64')),
          executable: stat.mode & 0o111,
        };
      } else throw new Error('Unsupported release artifact: ' + file);
    }
  }
  await visit(directory);
  if (!Object.keys(files).length)
    throw new Error('Empty release artifact: ' + directory);
  return files;
}

export async function captureArtifacts(directories) {
  return Object.fromEntries(
    await Promise.all(
      Object.entries(directories).map(async ([name, directory]) => [
        name,
        { path: directory, files: await artifactFiles(directory) },
      ]),
    ),
  );
}

export function assertFullRelease(record) {
  const plan = record?.verification;
  if (
    record.format !== 'verd-quality' ||
    record.version !== 3 ||
    record.mode !== 'release' ||
    record.status !== 'passed' ||
    record.selection !== null ||
    !record.runId ||
    !record.identity?.releaseInputDigest ||
    !record.identity?.versions ||
    !record.identity.reviewDigest ||
    !record.identity.platform ||
    !record.identity.arch ||
    !record.identity.toolchain?.node ||
    !record.identity.toolchain?.pnpm ||
    !record.identity.toolchain?.electron ||
    !record.identity.concurrency?.budget ||
    !record.identity.environmentDigest ||
    !plan ||
    plan.mode !== 'release' ||
    record.planDigest !== plan.digest ||
    plan.digest !== digest({ ...plan, digest: undefined }) ||
    !plan.units?.length ||
    new Set(plan.units.map((unit) => unit.id)).size !== plan.units.length ||
    plan.units.some(
      (unit) =>
        !['run', 'reuse'].includes(unit.action) ||
        (unit.action === 'reuse' && !validVerification(unit.evidence, unit)) ||
        (unit.action === 'run' &&
          !record.steps?.some(
            (stage) =>
              record.stageUnits?.[stage.id]?.includes(unit.id) &&
              stage.status === 'passed' &&
              stage.units?.includes(unit.id) &&
              unit.tests.every((file) =>
                stage.args?.includes(
                  unit.directory
                    ? path.posix.relative(unit.directory, file)
                    : unit.host === 'web'
                      ? file.replace('tests/web-e2e/', '')
                      : file,
                ),
              ),
          )),
    ) ||
    !record.requiredStages?.length ||
    record.steps?.length !== record.requiredStages.length ||
    releaseStageIds.some((id) => !record.requiredStages.includes(id)) ||
    record.requiredStages.some(
      (id) =>
        record.steps?.filter(
          (step) => step.id === id && step.status === 'passed',
        ).length !== 1,
    ) ||
    record.steps?.some((step) => step.status !== 'passed')
  )
    throw new Error('Packaging requires one complete, passed release plan');
}

export async function verifyReleaseUnits(
  record,
  root = ROOT,
  env = process.env,
) {
  assertFullRelease(record);
  const catalog = await loadCatalog(root);
  const expected = catalog.units.filter(
    (unit) => !['manual', 'packaged'].includes(unit.runtime),
  );
  if (
    record.verification.catalogDigest !== digest(catalog.units) ||
    digest(expected.map((unit) => unit.id)) !==
      digest(record.verification.units.map((unit) => unit.id))
  )
    throw new Error('Release verification catalog is incomplete or changed');
  for (const unit of expected) {
    const entry = record.verification.units.find(
      (entry) => entry.id === unit.id,
    );
    if (unit.currentBuild && entry.action !== 'run')
      throw new Error(
        'Current-build contract cannot reuse an earlier run: ' + unit.id,
      );
    const identity = await verificationIdentity(unit, catalog, root, env);
    if (
      entry.fingerprint !== identity.digest ||
      digest(entry.tests) !== digest(unit.tests)
    )
      throw new Error('Release unit inputs changed: ' + unit.id);
  }
}

export async function assertReleaseContext(
  context,
  {
    root = ROOT,
    runId = process.env.VERD_RELEASE_RUN_ID,
    identity = releaseIdentity,
    artifacts = true,
    verifyUnits = verifyReleaseUnits,
  } = {},
) {
  assertFullRelease(context.proof);
  if (
    context.format !== 'verd-release-context' ||
    context.version !== 1 ||
    !runId ||
    context.proof.runId !== runId ||
    context.digest !==
      hash({ proof: context.proof, artifacts: context.artifacts })
  )
    throw new Error('Release context is incomplete or belongs to another run');
  if (hash(await identity(root)) !== hash(context.proof.identity))
    throw new Error(
      'Release inputs, review, runtime or concurrency changed after validation',
    );
  await verifyUnits(context.proof, root);
  for (const name of ['agent', 'builtin', 'desktop', 'electron'])
    if (!context.artifacts?.[name])
      throw new Error('Missing validated artifact: ' + name);
  if (artifacts)
    for (const [name, entry] of Object.entries(context.artifacts)) {
      if (hash(await artifactFiles(entry.path)) !== hash(entry.files))
        throw new Error('Validated artifact changed: ' + name);
    }
}
