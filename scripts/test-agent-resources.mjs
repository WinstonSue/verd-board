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
// Follow the same installed guide path an external agent receives.
const skill = await fs.readFile(
  path.join(deployed, 'skills/verd-authoring/SKILL.md'),
  'utf8',
);
const qualityGuidePath = skill.match(
  /shared\/patterns\/([^`]+\.verd-doc\.json)/,
)?.[1];
assert.ok(
  qualityGuidePath,
  'Installed skill must point to the native quality guide',
);
const qualityGuide = JSON.parse(
  await fs.readFile(path.join(deployed, 'patterns', qualityGuidePath), 'utf8'),
);
assert.equal(qualityGuide.id, 'pattern-guide:diagram-quality');
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
  const previewOperations = path.join(dir, 'preview-operations.json');
  const previewPlan = path.join(dir, 'preview-plan.json');
  const create = [
    {
      type: 'file.create',
      kind: 'workflow',
      id: 'preview-flow',
      title: '文字适配回归',
      path: 'preview-flow.verd.json',
    },
    {
      type: 'node.upsert',
      fileId: 'preview-flow',
      id: 'preview-decision',
      kind: 'workflow-decision',
      label: '交付前再次核对任务输入版本一致？',
      geometry: { x: 300, y: 100, width: 360, height: 140 },
      data: { fontSize: 24 },
    },
    {
      type: 'file.create',
      kind: 'document',
      id: 'preview-document',
      title: '滚动正文',
      path: 'preview-document.verd-doc.json',
    },
    {
      type: 'document.set',
      fileId: 'preview-document',
      markdown:
        '# 滚动正文\n\n' +
        Array.from(
          { length: 40 },
          (_, i) => `第 ${i + 1} 段：文档预览允许滚动，不应作为节点文字溢出。`,
        ).join('\n\n'),
    },
    {
      type: 'file.create',
      kind: 'whiteboard',
      id: 'preview-board',
      title: '引用预览',
      path: 'preview-board.verd.json',
    },
    {
      type: 'reference.upsert',
      fileId: 'preview-board',
      id: 'preview-card',
      targetId: 'preview-document',
      targetKind: 'document',
      geometry: { x: 0, y: 0, width: 400, height: 200 },
    },
    {
      type: 'file.create',
      kind: 'whiteboard',
      id: 'preview-parent',
      title: '缩放引用',
      path: 'preview-parent.verd.json',
    },
    {
      type: 'reference.upsert',
      fileId: 'preview-parent',
      id: 'preview-nested',
      targetId: 'preview-flow',
      targetKind: 'frame',
      geometry: { x: 0, y: 0, width: 220, height: 140 },
    },
  ];
  const makePreviewPlan = async (edit = []) => {
    await fs.writeFile(previewOperations, JSON.stringify([...create, ...edit]));
    run(['plan', '--input', previewOperations, '--out', previewPlan]);
    assert.equal(run(['validate', '--plan', previewPlan]).valid, true);
  };
  const preview = (id, name, format) =>
    run([
      'preview',
      id,
      '--plan',
      previewPlan,
      '--out',
      path.join(dir, `${name}.${format}`),
    ]);
  const textWarnings = (result) =>
    result.warnings.filter(
      (warning) => warning.code === 'visual.text-overflow',
    );
  await makePreviewPlan();
  for (const format of ['png', 'svg']) {
    const warnings = textWarnings(preview('preview-flow', 'clipped', format));
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].cellId, 'preview-decision');
    assert.match(warnings[0].message, /top/);
    assert.match(warnings[0].message, /bottom/);
    assert.deepEqual(
      textWarnings(preview('preview-board', 'scrollable', format)),
      [],
    );
  }
  await makePreviewPlan([
    {
      type: 'node.upsert',
      fileId: 'preview-flow',
      id: 'preview-decision',
      kind: 'workflow-decision',
      geometry: { rotation: Math.PI / 4 },
    },
  ]);
  for (const format of ['png', 'svg']) {
    assert.equal(
      textWarnings(preview('preview-flow', 'rotated', format))[0]?.cellId,
      'preview-decision',
    );
    // A scaled reference reports the source node, not the reference shell.
    assert.deepEqual(
      textWarnings(preview('preview-parent', 'scaled', format)).map(
        (warning) => warning.cellId,
      ),
      ['preview-decision'],
    );
  }
  await makePreviewPlan([
    {
      type: 'node.upsert',
      fileId: 'preview-flow',
      id: 'preview-decision',
      kind: 'workflow-decision',
      geometry: { width: 600, height: 320 },
    },
  ]);
  for (const format of ['png', 'svg'])
    assert.deepEqual(
      textWarnings(preview('preview-flow', 'fitted', format)),
      [],
    );
  await makePreviewPlan([
    {
      type: 'node.upsert',
      fileId: 'preview-flow',
      id: 'preview-decision',
      kind: 'workflow-decision',
      label: '一致？',
    },
  ]);
  for (const format of ['png', 'svg'])
    assert.deepEqual(
      textWarnings(preview('preview-flow', 'short', format)),
      [],
    );
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
