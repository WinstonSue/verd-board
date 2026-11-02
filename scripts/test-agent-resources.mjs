import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const resourceRoot = path.resolve(process.argv[2] ?? '');
if (!process.argv[2])
  throw new Error(
    'Usage: node scripts/test-agent-resources.mjs RESOURCE_DIRECTORY [--skip-preview]',
  );
const { deployAgentResources } = await import(
  pathToFileURL(
    path.join(
      resourceRoot,
      'app/node_modules/@sue/verd-board-agent/dist/node.js',
    ),
  )
);
const dir = await fs.mkdtemp(
  path.join(os.tmpdir(), 'verd-built-in acceptance-'),
);
const builderRequire = createRequire(
  createRequire(import.meta.url).resolve('electron-builder'),
);
const { getFileMatchers, copyFiles } = builderRequire(
  'app-builder-lib/out/fileMatcher.js',
);
const desktop = fileURLToPath(new URL('../apps/desktop/', import.meta.url));
const config = JSON.parse(
  await fs.readFile(path.join(desktop, 'package.json')),
);
const entry = config.build.extraResources.find((e) => e.to === 'agent-tools');
const packaged = path.join(dir, 'packaged-resources');
const matchers = getFileMatchers(
  { ...config.build, extraResources: [{ ...entry, from: resourceRoot }] },
  'extraResources',
  packaged,
  {
    defaultSrc: desktop,
    macroExpander: (value) => value,
    customBuildOptions: {},
    globalOutDir: path.join(dir, 'output'),
  },
);
await copyFiles(matchers, null, false);
const hub = path.join(dir, 'user data/agent-resources');
const deployed = await deployAgentResources(
  path.join(packaged, 'agent-tools'),
  hub,
);
let project = path.join(dir, 'Project with spaces');
await fs.mkdir(project);
await fs.writeFile(
  path.join(project, 'AGENTS.md'),
  '# User rules\nKeep this text.\n',
);
// Launcher must select its own Node even if PATH has no node/npm and NODE_OPTIONS is hostile.
const env = {
  ...process.env,
  PATH:
    process.platform === 'win32'
      ? process.env.SystemRoot + '\\System32'
      : '/usr/bin:/bin',
  NODE_OPTIONS: '--this-is-not-a-valid-node-option',
  NODE_PATH: '/nonexistent',
};
function run(
  args,
  cwd = project,
  launcher = path.join(
    project,
    '.verdscrolls/shared/bin',
    process.platform === 'win32' ? 'verd.cmd' : 'verd',
  ),
) {
  const r = spawnSync(launcher, args, {
    cwd,
    env,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  assert.equal(r.status, 0, `${r.error ?? ''}\n${r.stderr}\n${r.stdout}`);
  return JSON.parse(r.stdout);
}
let context = run(
  ['init', '--workspace', project, '--name', 'Acceptance', '--json'],
  project,
  path.join(
    deployed,
    'bin',
    process.platform === 'win32' ? 'verd.cmd' : 'verd',
  ),
);
assert.equal(context.agent.ready, true);
assert.equal(context.name, 'Acceptance');
const identity = context.identity;
assert.ok(
  (await fs.readFile(path.join(project, 'AGENTS.md'), 'utf8')).startsWith(
    '# User rules\nKeep this text.\n',
  ),
);
await fs.mkdir(path.join(project, 'nested/path'), { recursive: true });
assert.equal(
  run(['context', '--json'], path.join(project, 'nested/path')).identity,
  identity,
);
const operations = path.join(dir, 'operations.json'),
  plan = path.join(dir, 'plan.json');
await fs.writeFile(
  operations,
  JSON.stringify([
    {
      type: 'file.create',
      kind: 'document',
      id: 'acceptance-doc',
      title: 'Built-in tools',
      path: 'Built-in tools.verd-doc.json',
    },
    {
      type: 'document.set',
      fileId: 'acceptance-doc',
      markdown:
        '# Standalone tools\nCreated, validated and rendered with bundled Node.',
    },
  ]),
);
run(['plan', '--input', operations, '--out', plan, '--json']);
assert.equal(run(['validate', '--plan', plan, '--json']).valid, true);
if (!process.argv.includes('--skip-preview')) {
  const output = path.join(dir, 'preview.png');
  run(['preview', 'acceptance-doc', '--plan', plan, '--out', output]);
  assert.ok((await fs.stat(output)).size > 1000);
}
assert.equal(run(['apply', '--plan', plan]).outcome, 'applied');
const original = await fs.readFile(
  path.join(project, 'Built-in tools.verd-doc.json'),
);
const moved = project + ' moved';
await fs.rename(project, moved);
project = moved;
assert.equal(run(['context']).identity, identity);
await fs.unlink(path.join(project, '.verdscrolls/shared'));
run(
  ['doctor', '--repair', '--workspace', project, '--shared', deployed],
  project,
  path.join(
    deployed,
    'bin',
    process.platform === 'win32' ? 'verd.cmd' : 'verd',
  ),
);
assert.equal(run(['doctor']).ready, true);
await fs.rename(
  path.join(project, '.verdscrolls'),
  path.join(project, '.verdboard'),
);
context = run(
  ['init', '--workspace', project, '--shared', deployed],
  project,
  path.join(
    deployed,
    'bin',
    process.platform === 'win32' ? 'verd.cmd' : 'verd',
  ),
);
assert.equal(context.identity, identity);
assert.deepEqual(
  await fs.readFile(path.join(project, 'Built-in tools.verd-doc.json')),
  original,
);
assert.equal(run(['apply', '--plan', plan]).outcome, 'applied');
console.log(
  JSON.stringify({
    resourceRoot,
    deployed,
    project,
    identity,
    preview: !process.argv.includes('--skip-preview'),
    independentNode: true,
    packagedResourcesVerified: true,
    migratedReceiptConfirmed: true,
  }),
);
