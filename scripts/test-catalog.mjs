import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { testConcurrency } from './test-concurrency.mjs';
import { webE2EOptions } from './web-e2e-runtime.mjs';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const digest = (value) =>
  createHash('sha256')
    .update(JSON.stringify(value ?? null))
    .digest('hex');
const slash = (value) => value.replaceAll('\\', '/');
export const isTest = (name) => /\.(?:spec|test)\.[cm]?[jt]sx?$/.test(name);
const ignored =
  /(?:^|\/)(?:node_modules|dist[^/]*|build|release|test-results|\.git|\.quality|\.verdscrolls)(?:\/|$)/;

export async function sourceFiles(root = ROOT) {
  const names = [
    ...new Set(
      execFileSync(
        'git',
        ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
        { cwd: root, encoding: 'utf8' },
      ).split('\0'),
    ),
  ]
    .filter((file) => file && !ignored.test(file))
    .sort();
  const existing = await Promise.all(
    names.map(
      async (file) =>
        await fs.lstat(path.join(root, file)).then(
          () => file,
          (error) => {
            if (['ENOENT', 'ENOTDIR'].includes(error.code)) return null;
            throw error;
          },
        ),
    ),
  );
  return existing.filter(Boolean);
}

export async function loadCatalog(root = ROOT) {
  const catalog = JSON.parse(
    await fs.readFile(path.join(root, 'tests/catalog.json'), 'utf8'),
  );
  const files = await sourceFiles(root);
  const actual = files.filter(
    (file) => isTest(file) && /^(?:packages|apps|scripts|tests)\//.test(file),
  );
  const registered = catalog.units.flatMap((unit) => unit.tests);
  const errors = [
    ...actual
      .filter((file) => !registered.includes(file))
      .map((file) => 'Unclassified test: ' + file),
    ...registered
      .filter((file) => !actual.includes(file))
      .map((file) => 'Missing registered test: ' + file),
    ...registered
      .filter((file, index) => registered.indexOf(file) !== index)
      .map((file) => 'Duplicate test ownership: ' + file),
  ];
  if (
    new Set(catalog.units.map((unit) => unit.id)).size !== catalog.units.length
  )
    errors.push('Duplicate verification unit');
  if (errors.length) throw new Error(errors.join('\n'));
  const manifests = new Map();
  for (const file of files.filter((file) =>
    /^(?:packages\/[^/]+\/[^/]+|apps\/[^/]+|tests\/[^/]+)\/package.json$/.test(
      file,
    ),
  )) {
    const manifest = JSON.parse(
      await fs.readFile(path.join(root, file), 'utf8'),
    );
    manifests.set(manifest.name, {
      ...manifest,
      directory: path.posix.dirname(file),
    });
  }
  return { ...catalog, files, manifests };
}

export function packageClosure(names, manifests) {
  const found = new Set();
  const visit = (name) => {
    if (found.has(name) || !manifests.has(name)) return;
    found.add(name);
    const pkg = manifests.get(name);
    for (const dependency of Object.keys({
      ...pkg.dependencies,
      ...pkg.peerDependencies,
      ...pkg.optionalDependencies,
    }))
      visit(dependency);
  };
  names.forEach(visit);
  return [...found].sort();
}

/** Follow test helpers as inputs, without importing the upstream package's tests. */
export async function importedInputs(seeds, catalog, root = ROOT) {
  catalog.importCache ??= new Map();
  const available = new Set(catalog.files),
    found = new Set();
  const references = async (file) => {
    if (catalog.importCache.has(file)) return catalog.importCache.get(file);
    const children = [];
    const stat = await fs.lstat(path.join(root, file));
    if (stat.isSymbolicLink()) {
      const link = await fs.readlink(path.join(root, file));
      if (path.isAbsolute(link))
        throw new Error('Verification symlink leaves source tree: ' + file);
      const target = slash(
        path.normalize(path.join(path.posix.dirname(file), link)),
      );
      if (target.startsWith('../') || path.isAbsolute(target))
        throw new Error('Verification symlink leaves source tree: ' + file);
      children.push(target);
    }
    if (/(?:^|\/)tsconfig[^/]*\.json$/.test(file)) {
      const parsed = ts.parseConfigFileTextToJson(
        file,
        await fs.readFile(path.join(root, file), 'utf8'),
      ).config;
      for (const parent of [parsed?.extends ?? []].flat()) {
        if (parent.startsWith('.')) {
          const resolved = slash(
            path.normalize(path.join(path.posix.dirname(file), parent)),
          );
          children.push(
            resolved.endsWith('.json') ? resolved : resolved + '.json',
          );
        }
      }
    }
    if (/\.[cm]?[jt]sx?$/.test(file)) {
      const source = await fs.readFile(path.join(root, file), 'utf8');
      const imports = ts
        .preProcessFile(source, true, true)
        .importedFiles.map((item) => item.fileName);
      for (const match of source.matchAll(
        /['"`]((?:\.\.\/|\.\/)[^'"`$]+)['"`]/g,
      ))
        if (/\.(?:json|png|svg|txt)$|fixtures\//.test(match[1]))
          imports.push(match[1]);
      // Template paths read a fixture family; root-based paths are not module
      // specifiers, so bind them directly to the snapshot rather than a package.
      for (const match of source.matchAll(
        /`((?:\.\.?\/)+(?:tests\/)?fixtures\/[^`$\n]*)\$\{/g,
      ))
        imports.push(match[1].slice(0, match[1].lastIndexOf('/')));
      for (const match of source.matchAll(
        /['"`](tests\/fixtures(?:\/[^'"`$\n]*)?)(?=['"`]|\$\{)/g,
      )) {
        const target = match[1].replace(/\/$/, '');
        children.push(
          ...(available.has(target)
            ? [target]
            : catalog.files.filter((input) => input.startsWith(target + '/'))),
        );
      }
      catalog.externalImports ??= new Map();
      catalog.externalImports.set(
        file,
        imports
          .filter((name) => !name.startsWith('.'))
          .map((name) =>
            name.startsWith('@')
              ? name.split('/').slice(0, 2).join('/')
              : name.split('/')[0],
          ),
      );
      for (const specifier of imports) {
        if (!specifier.startsWith('.')) {
          const name = [...catalog.manifests.keys()].find(
            (name) => specifier === name || specifier.startsWith(name + '/'),
          );
          if (name)
            children.push(
              ...catalog.files.filter(
                (input) =>
                  input.startsWith(
                    catalog.manifests.get(name).directory + '/src/',
                  ) && !isTest(input),
              ),
            );
          continue;
        }
        const target = slash(
          path.normalize(path.join(path.posix.dirname(file), specifier)),
        );
        const candidates = [
          target,
          ...[
            '.ts',
            '.tsx',
            '.js',
            '.mjs',
            '.json',
            '/index.ts',
            '/index.tsx',
          ].map((suffix) => target + suffix),
        ];
        const resolved = candidates.find((candidate) =>
          available.has(candidate),
        );
        if (resolved) children.push(resolved);
        else {
          const directory = catalog.files.filter((input) =>
            input.startsWith(target + '/'),
          );
          children.push(...(directory.length ? directory : candidates));
        }
      }
    }
    catalog.importCache.set(file, children);
    return children;
  };
  const visit = async (file) => {
    if (found.has(file)) return;
    found.add(file);
    if (!available.has(file)) return;
    for (const child of await references(file)) await visit(child);
  };
  for (const seed of seeds) await visit(seed);
  return [...found].sort();
}

export async function unitInputs(unit, catalog, root = ROOT) {
  const packages = packageClosure(unit.packages ?? [], catalog.manifests);
  const seeds = [...unit.tests, ...(unit.inputs ?? [])];
  for (const name of packages) {
    const pkg = catalog.manifests.get(name);
    seeds.push(
      ...catalog.files.filter(
        (file) =>
          file.startsWith(pkg.directory + '/') &&
          !isTest(file) &&
          !/(?:README|CHANGELOG)\.md$/.test(file),
      ),
    );
  }
  for (const prefix of unit.inputDirectories ?? [])
    seeds.push(
      ...catalog.files.filter((file) => file.startsWith(prefix + '/')),
    );
  seeds.push(
    'vitest.shared.ts',
    'tsconfig.json',
    'scripts/test-concurrency.mjs',
    'scripts/test-profile.json',
  );
  if (unit.runtime)
    seeds.push(
      `tests/${unit.host}-e2e/playwright${unit.runtime === 'production' ? '.prod' : unit.runtime === 'packaged' ? '.packaged' : ''}.config.ts`,
      ...catalog.files.filter((file) =>
        /^scripts\/(?:build-context|prepare-agent-resources)/.test(file),
      ),
      ...(unit.host === 'web'
        ? [
            'tests/web-e2e/global-setup.ts',
            ...catalog.files.filter((file) => /^scripts\/web/.test(file)),
          ]
        : []),
    );
  const inputs = await importedInputs(seeds, catalog, root);
  if (unit.layer === 'foundation') {
    const forbidden = inputs.filter((file) =>
      /packages\/(?:engine\/(?:draw|mind|workflow|architecture|uml|text)|react|product|workspace|agent|converters)\//.test(
        file,
      ),
    );
    if (forbidden.length)
      throw new Error(
        'Foundation test depends on downstream inputs: ' +
          unit.id +
          '\n' +
          forbidden.join('\n'),
      );
  }
  return inputs;
}

/** Read the mapping blocks used by pnpm's lockfile, preserving exact resolution metadata. */
export function lockSections(source) {
  const result = {},
    sections = [...source.matchAll(/^([a-zA-Z]+):[ \t]*$/gm)];
  for (let index = 0; index < sections.length; index++) {
    const text = source.slice(
      sections[index].index + sections[index][0].length,
      sections[index + 1]?.index ?? source.length,
    );
    const blocks = [...text.matchAll(/^ {2}(\S.*?):(?:[ \t]*\{\})?[ \t]*$/gm)];
    result[sections[index][1]] = Object.fromEntries(
      blocks.map((match, i) => [
        match[1].replace(/^['"]|['"]$/g, ''),
        text.slice(match.index, blocks[i + 1]?.index ?? text.length),
      ]),
    );
  }
  return result;
}

export function lockClosure(sections, importers, tools) {
  const selected = {},
    queue = [];
  const enqueue = (name, version) => {
    version = version.replace(/^['"]|['"]$/g, '');
    if (!/^(?:link:|workspace:)/.test(version))
      queue.push(
        /^(?:@[^/()]+\/)?[^@/()]+@/.test(version)
          ? version
          : name + '@' + version,
      );
  };
  for (const importer of importers) {
    const block = sections.importers?.[importer] ?? '';
    const rows = [
      ...block.matchAll(/^ {6}(.+):\s*\n\s+specifier:.*\n\s+version: (.+)$/gm),
    ];
    for (const row of rows) {
      const name = row[1].replace(/^['"]|['"]$/g, '');
      if (importer !== '.' || tools.includes(name)) enqueue(name, row[2]);
    }
  }
  while (queue.length) {
    const key = queue.pop();
    if (key in selected) continue;
    const block = sections.snapshots?.[key];
    if (!block) throw new Error('Unresolved verification dependency: ' + key);
    selected[key] = {
      snapshot: block,
      package: sections.packages?.[key.split('(')[0]] ?? null,
    };
    for (const row of block.matchAll(/^ {6}(.+): (.+)$/gm))
      enqueue(row[1].replace(/^['"]|['"]$/g, ''), row[2]);
  }
  return Object.fromEntries(
    Object.entries(selected).sort(([a], [b]) => a.localeCompare(b)),
  );
}

export async function verificationIdentity(
  unit,
  catalog,
  root = ROOT,
  environment = process.env,
) {
  const inputs = await unitInputs(unit, catalog, root),
    files = {};
  catalog.fileHashes ??= new Map();
  for (const file of inputs) {
    const selector = file === 'tests/catalog.json' && Boolean(unit.runtime);
    const key =
      file +
      ':' +
      Boolean(unit.versionSensitive) +
      (selector ? ':' + unit.host + ':' + unit.runtime : '');
    if (!catalog.fileHashes.has(key)) {
      const stat = await fs.lstat(path.join(root, file)).catch((error) => {
        if (['ENOENT', 'ENOTDIR'].includes(error.code)) return null;
        throw error;
      });
      let entry = null;
      if (stat?.isFile() || stat?.isSymbolicLink()) {
        let content = stat.isSymbolicLink()
          ? await fs.readlink(path.join(root, file))
          : await fs.readFile(path.join(root, file));
        if (file.endsWith('/package.json') && stat.isFile()) {
          const manifest = JSON.parse(content.toString());
          if (!unit.versionSensitive) delete manifest.version;
          content = JSON.stringify(manifest);
        }
        if (selector)
          content = JSON.stringify(
            catalog.units
              .filter(
                (entry) =>
                  entry.host === unit.host && entry.runtime === unit.runtime,
              )
              .flatMap((entry) => entry.tests),
          );
        entry = {
          type: stat.isSymbolicLink() ? 'symlink' : 'file',
          content: digest(
            Buffer.isBuffer(content) ? content.toString('base64') : content,
          ),
          executable: stat.mode & 0o111,
        };
      }
      catalog.fileHashes.set(key, entry);
    }
    files[file] = catalog.fileHashes.get(key);
  }
  const owners = packageClosure(unit.packages ?? [], catalog.manifests).map(
    (name) => catalog.manifests.get(name).directory,
  );
  catalog.lock ??= lockSections(
    await fs.readFile(path.join(root, 'pnpm-lock.yaml'), 'utf8'),
  );
  const lock = catalog.lock;
  const tools = [
    ...new Set(
      inputs.flatMap((file) => catalog.externalImports?.get(file) ?? []),
    ),
    'typescript',
    'vitest',
    'jsdom',
    ...(unit.runner === 'node' ? [] : ['vite']),
    ...(unit.runtime
      ? ['@playwright/test', ...(unit.host === 'desktop' ? ['electron'] : [])]
      : []),
  ];
  catalog.resolutions ??= new Map();
  const resolutionKey = JSON.stringify([owners, tools]);
  if (!catalog.resolutions.has(resolutionKey))
    catalog.resolutions.set(
      resolutionKey,
      lockClosure(lock, [...owners, '.'], tools),
    );
  const dependencies = catalog.resolutions.get(resolutionKey);
  const infrastructure = {};
  for (const file of [
    'scripts/test-catalog.mjs',
    'scripts/test-plan.mjs',
    'scripts/verification-cache.mjs',
    'scripts/gate-runner.mjs',
    'scripts/quality-gate.mjs',
  ])
    infrastructure[file] = digest(
      await fs.readFile(path.join(root, file), 'utf8'),
    );
  const settings = testConcurrency(environment);
  const concurrency =
    unit.runner === 'node'
      ? { files: settings.scripts }
      : unit.runtime
        ? {
            workers:
              unit.host === 'desktop' ? 1 : webE2EOptions(environment).workers,
          }
        : {
            packages: settings.packages,
            maxWorkers: settings.workers,
            minWorkers: 1,
          };
  const identity = {
    version: 1,
    concurrency,
    unit: { ...unit },
    files,
    dependencies,
    infrastructure,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    pnpm: JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
      .packageManager,
    environment: Object.fromEntries(
      [
        'NODE_OPTIONS',
        'NODE_ENV',
        'NODE_PATH',
        'VERD_SCHEMA_ARTIFACTS',
        ...(unit.runtime
          ? ['BASE_URL', 'VERDBOARD_WEB_PORT', 'VERDBOARD_SERVICE_PORT']
          : []),
      ].map((key) => [key, environment[key] ?? null]),
    ),
  };
  return {
    digest: digest(identity),
    identity,
    inputs: [...new Set([...inputs, ...Object.keys(infrastructure)])].sort(),
    dependencyKeys: Object.keys(dependencies),
    tools,
  };
}

export async function changedFiles(base, root = ROOT) {
  if (!base || base.startsWith('-'))
    throw new Error('An explicit Git baseline is required');
  const commit = execFileSync(
    'git',
    ['rev-parse', '--verify', base + '^{commit}'],
    { cwd: root, encoding: 'utf8' },
  ).trim();
  const changed = execFileSync(
    'git',
    ['diff', '--name-only', '--no-renames', '-z', commit, '--'],
    { cwd: root, encoding: 'utf8' },
  ).split('\0');
  const added = execFileSync(
    'git',
    ['ls-files', '--others', '--exclude-standard', '-z'],
    { cwd: root, encoding: 'utf8' },
  ).split('\0');
  const files = [...new Set([...changed, ...added].filter(Boolean))].sort();
  const result = { base: commit, files };
  result.versionOnlyFiles = [];
  for (const file of files.filter((file) =>
    /(?:^|\/)package\.json$/.test(file),
  )) {
    try {
      const previous = JSON.parse(
        execFileSync('git', ['show', commit + ':' + file], {
          cwd: root,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }),
      );
      const current = JSON.parse(
        await fs.readFile(path.join(root, file), 'utf8'),
      );
      delete previous.version;
      delete current.version;
      if (digest(previous) === digest(current))
        result.versionOnlyFiles.push(file);
    } catch {
      /* Added or deleted manifests are real dependency changes. */
    }
  }
  if (files.includes('pnpm-lock.yaml')) {
    const previous = lockSections(
      execFileSync('git', ['show', commit + ':pnpm-lock.yaml'], {
        cwd: root,
        encoding: 'utf8',
      }),
    );
    const current = lockSections(
      await fs.readFile(path.join(root, 'pnpm-lock.yaml'), 'utf8'),
    );
    result.resolutionChanges = [
      ...new Set(
        ['packages', 'snapshots'].flatMap((section) =>
          [
            ...new Set([
              ...Object.keys(previous[section] ?? {}),
              ...Object.keys(current[section] ?? {}),
            ]),
          ].filter(
            (key) => previous[section]?.[key] !== current[section]?.[key],
          ),
        ),
      ),
    ];
  }
  if (files.includes('package.json')) {
    const before = JSON.parse(
      execFileSync('git', ['show', commit + ':package.json'], {
        cwd: root,
        encoding: 'utf8',
      }),
    );
    const after = JSON.parse(
      await fs.readFile(path.join(root, 'package.json'), 'utf8'),
    );
    const left = { ...before.dependencies, ...before.devDependencies },
      right = { ...after.dependencies, ...after.devDependencies };
    result.toolChanges = [
      ...new Set([...Object.keys(left), ...Object.keys(right)]),
    ].filter((name) => left[name] !== right[name]);
    result.toolchainChanged = before.packageManager !== after.packageManager;
  }
  if (files.includes('tests/catalog.json')) {
    let previous = { units: [] };
    try {
      previous = JSON.parse(
        execFileSync('git', ['show', commit + ':tests/catalog.json'], {
          cwd: root,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }),
      );
    } catch {
      /* First catalog establishes the architecture baseline. */
    }
    const current = JSON.parse(
      await fs.readFile(path.join(root, 'tests/catalog.json'), 'utf8'),
    );
    result.catalogChanges = current.units
      .filter(
        (unit) =>
          digest(unit) !==
          digest(previous.units.find((old) => old.id === unit.id)),
      )
      .map((unit) => unit.id);
    const runtimes = new Set(
      [...previous.units, ...current.units]
        .filter((unit) => unit.runtime)
        .map((unit) => unit.host + ':' + unit.runtime),
    );
    const selection = (units, runtime) =>
      units
        .filter((unit) => unit.host + ':' + unit.runtime === runtime)
        .flatMap((unit) => unit.tests);
    result.catalogRuntimeChanges = [...runtimes].filter(
      (runtime) =>
        digest(selection(previous.units, runtime)) !==
        digest(selection(current.units, runtime)),
    );
  }
  return result;
}
