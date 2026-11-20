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
for (const name of ['verd-board-app', 'verd-board-ui']) {
  await assert.rejects(
    fs.access(path.join(resourceRoot, 'app/node_modules/@sue', name)),
    { code: 'ENOENT' },
  );
}
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
const customSkill = path.join(
  project,
  '.agents/skills/acceptance-writing/SKILL.md',
);
await fs.mkdir(path.dirname(customSkill), { recursive: true });
await fs.writeFile(
  customSkill,
  '---\nname: acceptance-writing\ndescription: Acceptance writing instructions\n---\nUse the acceptance vocabulary.\n',
);
assert.ok(
  run(['context', '--json']).workspaceSkills.some(
    (entry) => entry.scope === 'custom' && entry.name === 'acceptance-writing',
  ),
);
const identity = context.identity;
// Follow the same installed guide path an external agent receives.
const skill = await fs.readFile(
  path.join(deployed, 'skills/verd-authoring/SKILL.md'),
  'utf8',
);
assert.equal(
  skill,
  await fs.readFile(
    path.join(deployed, 'patterns/skills/verd-authoring/SKILL.md'),
    'utf8',
  ),
);
assert.equal(skill, await fs.readFile(run(['skill', '--json']).path, 'utf8'));
for (const pattern of run(['patterns', '--json'])) {
  assert.equal(pattern.skillPath, `skills/verd-${pattern.id}/SKILL.md`);
  const entrance = await fs.readFile(
    path.join(deployed, 'patterns', pattern.skillPath),
    'utf8',
  );
  assert.ok(entrance.includes(`name: verd-${pattern.id}`));
  assert.ok(
    entrance.includes(
      path.posix.relative(
        path.posix.dirname(pattern.skillPath),
        pattern.guidePath,
      ),
    ),
  );
  assert.match(
    await fs.readFile(
      path.join(deployed, 'patterns', pattern.guidePath),
      'utf8',
    ),
    /^# /,
  );
}
const patternRoot = run(['describe', '--json']).patternWorkspace;
const { loadPatternGuides } = await import(
  pathToFileURL(
    path.join(
      deployed,
      'app/node_modules/@sue/verd-board-agent-patterns/dist/agent.js',
    ),
  ).href
);
const guides = await loadPatternGuides();
assert.deepEqual(
  guides.map((guide) => guide.title),
  ['内容编写规范', '汇报与讲解场景', '图表编写规范'],
);
for (const guide of guides) {
  assert.equal(
    guide.source,
    await fs.readFile(path.join(patternRoot, guide.path), 'utf8'),
  );
  assert.equal(
    guide.source,
    await fs.readFile(path.join(deployed, 'patterns', guide.path), 'utf8'),
  );
}
const commonRoot = path.join(deployed, 'skills/verd-authoring');
const { createDocumentHeadingSlugger } = await import(
  pathToFileURL(
    path.join(
      resourceRoot,
      'app/node_modules/@sue/board-react-text/dist/schema.js',
    ),
  )
);
const visited = new Set();
async function checkCommonReferences(relative) {
  if (visited.has(relative)) return;
  visited.add(relative);
  const source = await fs.readFile(path.join(commonRoot, relative), 'utf8');
  for (const [, bracketed, bare] of source.matchAll(
    /\]\((?:<([^>]+)>|([^\s)]+))\)/g,
  )) {
    const target = bracketed ?? bare;
    if (/^https?:/.test(target)) continue;
    const link = new URL(
      target,
      pathToFileURL(path.join(commonRoot, relative)),
    );
    const fragment = decodeURIComponent(link.hash.slice(1));
    link.hash = '';
    const resolved = fileURLToPath(link);
    const nested = path.relative(commonRoot, resolved);
    assert.ok(
      !nested.startsWith('..'),
      'Common Skill reference must be self-contained',
    );
    assert.ok((await fs.stat(resolved)).isFile());
    if (fragment) {
      const slug = createDocumentHeadingSlugger();
      const contents = await fs.readFile(resolved, 'utf8');
      const headings = new Set(
        [...contents.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)].map(
          ([, heading]) => slug(heading),
        ),
      );
      assert.ok(
        headings.has(fragment),
        'Missing linked Skill heading: ' + target,
      );
    }
    if (resolved.endsWith('.md')) await checkCommonReferences(nested);
  }
}
await checkCommonReferences('SKILL.md');
assert.ok(visited.has(path.join('references', 'writing.md')));
assert.ok(visited.has(path.join('references', 'reports.md')));
assert.ok(visited.has(path.join('references', 'diagram-quality.md')));
assert.ok(
  (
    await fs.readFile(
      path.join(commonRoot, 'references/plain-report-skills.LICENSE.txt'),
      'utf8',
    )
  ).includes('Copyright (c) 2026 45degreeYouthLee'),
);
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
  // Exercise the independent bundled renderer for every supported canvas domain.
  const canvasPatterns = new Set([
    'whiteboard',
    'mind-map',
    'workflow-dag',
    'workflow-process',
    'architecture',
    'uml-class',
    'uml-sequence',
  ]);
  const installedPatterns = run(['patterns', '--json']).filter((pattern) =>
    canvasPatterns.has(pattern.id),
  );
  assert.equal(installedPatterns.length, canvasPatterns.size);
  for (const pattern of installedPatterns) {
    for (const format of ['png', 'svg']) {
      const rendered = path.join(dir, `pattern-${pattern.id}.${format}`);
      run([
        'preview',
        pattern.rootFileId,
        '--workspace',
        path.join(deployed, 'patterns'),
        '--out',
        rendered,
      ]);
      assert.ok(
        (await fs.stat(rendered)).size > 1000,
        pattern.id + ' ' + format,
      );
    }
  }
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
  create.push(
    {
      type: 'file.create',
      kind: 'architecture',
      id: 'preview-architecture',
      title: 'SDK layer titles',
      path: 'preview-architecture.verd.json',
    },
    ...['Agent', 'React 适配'].flatMap((label, index) => [
      {
        type: 'node.upsert',
        fileId: 'preview-architecture',
        id: 'preview-layer-' + index,
        kind: 'architecture-layer',
        label,
        geometry: { x: 0, y: index * 240, width: 500, height: 170 },
        data: { fontSize: 16 },
      },
      {
        type: 'node.upsert',
        fileId: 'preview-architecture',
        id: 'preview-module-' + index,
        kind: 'architecture-module',
        parentId: 'preview-layer-' + index,
        label: 'Shared SDK',
        geometry: { x: 20, y: index * 240 + 44, width: 372, height: 98 },
      },
    ]),
  );
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
    assert.deepEqual(
      textWarnings(preview('preview-architecture', 'layer-titles', format)),
      [],
    );
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
