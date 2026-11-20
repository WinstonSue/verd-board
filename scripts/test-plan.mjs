import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  loadCatalog,
  changedFiles,
  verificationIdentity,
  digest,
  packageClosure,
  isTest,
} from './test-catalog.mjs';
import { readVerification, verificationCache } from './verification-cache.mjs';

export function parseGateOptions(args) {
  const options = { full: false, base: null, changes: null, selectors: [] };
  for (let index = 0; index < args.length; index++) {
    const value = args[index];
    if (value === '--full') options.full = true;
    else if (['--base', '--changes'].includes(value)) {
      const next = args[++index];
      if (!next || next.startsWith('-'))
        throw new Error('Missing value for ' + value);
      if (value === '--base') options.base = next;
      else
        options.changes = JSON.parse(Buffer.from(next, 'base64url').toString());
    } else if (['--unit', '--web-e2e', '--desktop-e2e'].includes(value)) {
      const next = args[++index];
      if (!next || next.startsWith('-')) throw new Error('Missing test file');
      options.selectors.push(value, next);
    } else throw new Error('Unknown gate option: ' + value);
  }
  if (options.base && options.changes)
    throw new Error('Use one change baseline');
  if (
    options.full &&
    (options.base || options.changes || options.selectors.length)
  )
    throw new Error('--full cannot be combined with filters');
  return options;
}

function classified(file, catalog) {
  return (
    catalog.files.includes(file) &&
    (/^(?:packages|apps|tests|scripts|workspace|\.github|\.changeset|\.release|\.agents|\.cursor)\//.test(
      file,
    ) ||
      /^(?:AGENTS\.md|README(?:\.[\w-]+)?\.md|package\.json|pnpm-(?:lock|workspace)\.yaml|turbo\.json|vitest\.shared\.ts|tsconfig[^/]*\.json|eslint\.config\.[cm]?js|\.\w[^/]*)$/.test(
        file,
      ))
  );
}

function impactPath(unit, file, catalog) {
  const owner = [...catalog.manifests.values()].find((pkg) =>
    file.startsWith(pkg.directory + '/'),
  );
  const queue = (unit.packages ?? []).map((name) => [name]);
  const seen = new Set();
  while (owner && queue.length) {
    const chain = queue.shift();
    const name = chain.at(-1);
    if (name === owner.name) return [file, ...chain.reverse(), unit.id];
    if (seen.has(name)) continue;
    seen.add(name);
    const pkg = catalog.manifests.get(name);
    for (const dependency of Object.keys({
      ...pkg?.dependencies,
      ...pkg?.peerDependencies,
      ...pkg?.optionalDependencies,
    }))
      if (catalog.manifests.has(dependency)) queue.push([...chain, dependency]);
  }
  return [file, unit.id];
}

export async function createTestPlan({
  root = path.resolve(import.meta.dirname, '..'),
  mode = 'dev',
  options = {},
  env = process.env,
  cache,
} = {}) {
  const catalog = await loadCatalog(root);
  const change =
    options.changes ??
    (options.base ? await changedFiles(options.base, root) : null);
  if (change?.sourceDigest) {
    const { releaseInputs } = await import('./release-proof.mjs');
    if ((await releaseInputs(root)).releaseInputDigest !== change.sourceDigest)
      throw new Error('Selection snapshot changed before execution');
  }
  for (const file of change?.files ?? []) {
    // Deleted paths still have an owner through their old directory.
    if (
      !classified(file, catalog) &&
      !/^(?:packages|apps|tests|scripts|workspace)\//.test(file)
    )
      throw new Error('Unmapped changed input: ' + file);
  }
  const selectedFiles =
    options.selectors?.filter((_, index) => index % 2 === 1) ?? [];
  const registered = catalog.units.flatMap((unit) => unit.tests);
  for (const file of selectedFiles)
    if (!registered.includes(file))
      throw new Error('Unclassified selected test: ' + file);
  const directory = cache ?? verificationCache(root, env),
    units = [];
  for (const unit of catalog.units) {
    if (unit.runtime === 'packaged' || unit.runtime === 'manual') continue;
    const {
      digest: fingerprint,
      inputs,
      dependencyKeys,
      tools,
    } = await verificationIdentity(unit, catalog, root, env);
    const entry = {
      ...unit,
      fingerprint,
      inputCount: inputs.length,
      inputDigest: digest(inputs),
      action: 'run',
      reason: 'missing-valid-verification',
    };
    const explicitlySelected = unit.tests.some((test) =>
      selectedFiles.includes(test),
    );
    const directories = packageClosure(
      unit.packages ?? [],
      catalog.manifests,
    ).map((name) => catalog.manifests.get(name).directory);
    const direct =
      change?.files.filter(
        (file) =>
          (unit.versionSensitive || !change.versionOnlyFiles?.includes(file)) &&
          (file !== 'tests/catalog.json' ||
            !unit.runtime ||
            !Array.isArray(change.catalogRuntimeChanges) ||
            change.catalogRuntimeChanges.includes(
              unit.host + ':' + unit.runtime,
            )) &&
          (inputs.includes(file) ||
            (unit.directory && file.startsWith(unit.directory + '/')) ||
            (!isTest(file) &&
              directories.some((directory) =>
                file.startsWith(directory + '/'),
              ))),
      ) ?? [];
    if (
      change?.resolutionChanges?.some(
        (key) =>
          dependencyKeys.includes(key) ||
          dependencyKeys.some((dependency) => dependency.split('(')[0] === key),
      )
    )
      direct.push('pnpm-lock.yaml');
    if (
      change?.toolchainChanged ||
      change?.toolChanges?.some((tool) => tools.includes(tool))
    )
      direct.push('package.json');
    if (change?.catalogChanges?.includes(unit.id))
      direct.push('tests/catalog.json');
    const proof = await readVerification(directory, entry);
    if (mode === 'dev' && (change || selectedFiles.length)) {
      if (!direct.length && !explicitlySelected) {
        entry.action = 'outside';
        entry.reason = 'outside-task-impact';
      } else
        entry.reason = explicitlySelected
          ? 'explicit-selection'
          : 'changed-input';
    } else if (mode !== 'dev' && unit.currentBuild) {
      entry.reason = 'current-build-contract';
    } else if (!options.full && proof) {
      entry.action = 'reuse';
      entry.reason = 'unchanged-verified-inputs';
      entry.evidence = proof;
    } else if (options.full) entry.reason = 'explicit-full-baseline';
    entry.changedInputs = [...new Set(direct)];
    entry.impactPaths = entry.changedInputs.map((file) =>
      impactPath(unit, file, catalog),
    );
    units.push(entry);
  }
  const unowned = (change?.files ?? []).filter(
    (file) =>
      (/^(?:packages|apps|tests|scripts)\//.test(file) ||
        /\.(?:[cm]?[jt]sx?|s?css|json|ya?ml)$/.test(file)) &&
      !units.some((unit) => unit.changedInputs.includes(file)) &&
      !change.versionOnlyFiles?.includes(file) &&
      !/^(?:workspace\/|\.github\/|\.changeset\/|\.release\/|tests\/(?:core-migration|catalog)\.json$|(?:pnpm-workspace\.yaml|pnpm-lock\.yaml|package\.json|turbo\.json|tsconfig[^/]*\.json|eslint\.config\.[cm]?js)$)/.test(
        file,
      ),
  );
  if (unowned.length)
    throw new Error(
      'Unmapped changed inputs; register consumers in tests/catalog.json: ' +
        unowned.join(', '),
    );
  const plan = {
    format: 'verd-test-plan',
    version: 1,
    mode,
    full: Boolean(options.full),
    baseline: change?.base ?? null,
    changes: change?.files ?? [],
    catalogDigest: digest(catalog.units),
    units,
  };
  plan.digest = digest(plan);
  return plan;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2),
    json = args.includes('--json');
  const options = parseGateOptions(args.filter((arg) => arg !== '--json'));
  const plan = await createTestPlan({ options });
  if (json) console.log(JSON.stringify(plan, null, 2));
  else {
    console.log(
      'Baseline: ' + (plan.baseline ?? 'matching unit verification records'),
    );
    for (const unit of plan.units)
      console.log(`${unit.action}: ${unit.id} (${unit.reason})`);
  }
}
