import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readSchemaArtifacts } from './schema-artifacts.mjs';

const root = path.resolve(import.meta.dirname, '..');
const artifacts = readSchemaArtifacts();
if (!Object.keys(artifacts).length)
  throw new Error('Pass --schema-artifacts /absolute/path/manifest.json');
const target = fs.mkdtempSync(
  path.join(os.tmpdir(), 'verd-schema-integration-'),
);
fs.cpSync(root, target, {
  recursive: true,
  verbatimSymlinks: true,
  filter(source) {
    return !path
      .relative(root, source)
      .split(path.sep)
      .some((part) =>
        [
          'node_modules',
          '.git',
          'dist',
          '.turbo',
          'test-results',
          'playwright-report',
          'release',
          'coverage',
          '.cache',
        ].includes(part),
      );
  },
});
const workspace = path.join(target, 'pnpm-workspace.yaml');
const overrides = Object.entries(artifacts)
  .map(
    ([name, archive]) =>
      `  ${JSON.stringify(name)}: ${JSON.stringify(archive)}`,
  )
  .join('\n');
const source = fs.readFileSync(workspace, 'utf8');
fs.writeFileSync(
  workspace,
  /^overrides:/m.test(source)
    ? source.replace(/^overrides:\s*$/m, `overrides:\n${overrides}`)
    : `${source}\noverrides:\n${overrides}\n`,
);
console.log(target);
