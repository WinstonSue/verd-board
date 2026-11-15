import { publicPackages } from './pack-public.mjs';
import {
  agentWorkspaceDependencyProblems,
  productSourceImportProblems,
} from './package-boundaries.mjs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve(import.meta.dirname, '..');
const domains = ['draw', 'mind', 'workflow', 'architecture', 'uml'];
const allowedCore = new Set([
  '@sue/board-common',
  '@sue/board-core',
  '@sue/board-react-text',
  '@sue/board-react-actions',
  '@sue/schema-settings-react',
]);
const errors = [];
for (const layer of ['engine', 'react']) {
  for (const directory of await readdir(path.join(root, 'packages', layer))) {
    const folder = path.join(root, 'packages', layer, directory);
    let manifest;
    try {
      manifest = JSON.parse(
        await readFile(path.join(folder, 'package.json'), 'utf8'),
      );
    } catch {
      continue;
    }
    if (!domains.includes(directory) && !['core', 'board'].includes(directory))
      continue;
    for (const dependency of Object.keys({
      ...manifest.dependencies,
      ...manifest.peerDependencies,
    })) {
      if (layer === 'engine' && dependency.startsWith('@sue/schema-'))
        errors.push(`${manifest.name} depends on settings UI ${dependency}`);
      if (layer === 'engine' && /^(react(?:-dom)?$|@tiptap\/)/.test(dependency))
        errors.push(`${manifest.name} depends on UI runtime ${dependency}`);
      if (!dependency.startsWith('@sue/')) continue;
      const valid =
        layer === 'engine'
          ? [
              '@sue/board-core',
              '@sue/board-common',
              '@sue/board-layouts',
            ].includes(dependency)
          : directory === 'board'
            ? allowedCore.has(dependency)
            : allowedCore.has(dependency) ||
              dependency === '@sue/board-react' ||
              dependency === '@sue/board-layouts' ||
              dependency === `@sue/board-${directory}`;
      if (!valid)
        errors.push(
          `${manifest.name} depends on forbidden package ${dependency}`,
        );
    }
    async function scan(directoryPath) {
      for (const entry of await readdir(directoryPath, {
        withFileTypes: true,
      })) {
        const file = path.join(directoryPath, entry.name);
        if (entry.isDirectory()) {
          await scan(file);
          continue;
        }
        if (
          !/\.(?:ts|tsx|scss|css)$/.test(file) ||
          /\.(?:spec|test)\./.test(file)
        )
          continue;
        const source = await readFile(file, 'utf8');
        if (
          layer === 'engine' &&
          /(?:from\s*|import\s*\(\s*)['"](?:react(?:-dom)?(?:\/[^'"]*)?|@tiptap\/[^'"]+)['"]/.test(
            source,
          )
        )
          errors.push(`${path.relative(root, file)} imports a UI runtime`);
        if (
          ['core', 'board'].includes(directory) &&
          /['"`](?:mind-|workflow-|architecture-|uml-)/.test(source)
        )
          errors.push(`${path.relative(root, file)} branches on a domain kind`);
        if (
          /from\s*['"][^'"]*packages\/(?:product|converters)\//.test(source) ||
          /@(?:use|import)\s*['"][^'"]*\.\.\/.*\/src\//.test(source)
        )
          errors.push(
            `${path.relative(root, file)} imports a forbidden source path`,
          );
      }
    }
    await scan(path.join(folder, 'src'));
  }
}
errors.push(...agentWorkspaceDependencyProblems(publicPackages));
for (const { directory } of publicPackages) {
  if (!/packages\/(?:agent|workspace)\//.test(directory.replaceAll('\\', '/')))
    continue;
  const scan = async (folder) => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) await scan(file);
      else if (
        /\.[cm]?[jt]sx?$/.test(file) &&
        !/\.(?:spec|test|contract)\./.test(file)
      )
        errors.push(
          ...productSourceImportProblems(
            await readFile(file, 'utf8'),
            file,
            root,
          ),
        );
    }
  };
  await scan(path.join(directory, 'src'));
}
assert.equal(
  errors.length,
  0,
  `Plugin dependency boundaries failed:\n${errors.join('\n')}`,
);
console.log(
  'Plugin dependency boundaries passed for core, all five domains, Agent and workspace.',
);
