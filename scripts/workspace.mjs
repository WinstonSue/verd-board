import {
  readFile,
  readdir,
  writeFile,
  rename,
  rm,
  access,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import { createRequire } from 'node:module';

export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
export const PROJECT_WORKSPACE = path.join(REPO_ROOT, 'workspace');
export const PACKAGE_FRAME_ID = 'board/20:architecture-layered';
const PREFIX = 'demo:packages/';
const clone = (value) => JSON.parse(JSON.stringify(value));

/** Always validate against source, including before public packages are built. */
export async function withWorkspaceRuntime(task) {
  const { createServer } = await import('vite');
  const hmr = createHttpServer();
  const server = await createServer({
    root: REPO_ROOT,
    configFile: false,
    appType: 'custom',
    server: { middlewareMode: true, watch: null, hmr: { server: hmr } },
    resolve: { conditions: ['development', 'module', 'node'] },
    ssr: { noExternal: [/^@sue\//] },
    optimizeDeps: { noDiscovery: true },
  });
  try {
    const load = (entry) => server.ssrLoadModule('/' + entry);
    const [
      core,
      draw,
      mind,
      workflow,
      architecture,
      uml,
      frames,
      documents,
      common,
      links,
      headings,
      documentExtensions,
      references,
    ] = await Promise.all([
      load('packages/engine/core/src/public-api.ts'),
      load('packages/engine/draw/src/public-api.ts'),
      load('packages/engine/mind/src/public-api.ts'),
      load('packages/engine/workflow/src/public-api.ts'),
      load('packages/engine/architecture/src/public-api.ts'),
      load('packages/engine/uml/src/public-api.ts'),
      load('packages/product/app/src/frames/frame-files.ts'),
      load('packages/product/app/src/documents/document-files.ts'),
      load('packages/engine/common/src/public-api.ts'),
      load('packages/product/app/src/documents/document-links.ts'),
      load('packages/react/text/src/utils/heading-slug.ts'),
      load('packages/react/text/src/constants/editor-config.ts'),
      load('packages/product/app/src/documents/workspace-references.ts'),
    ]);
    const textRequire = createRequire(
      path.join(REPO_ROOT, 'packages/react/text/package.json'),
    );
    const { getSchema } = await import(
      pathToFileURL(textRequire.resolve('@tiptap/core')).href
    );
    const documentSchema = getSchema(
      documentExtensions.createDocumentExtensions(),
    );
    const registry = core.createCellRegistry();
    [
      draw.registerDrawCells,
      mind.registerMindCells,
      workflow.registerWorkflowCells,
      architecture.registerArchitectureCells,
      uml.registerUmlCells,
    ].forEach((register) => register(registry));
    return await task({
      core,
      mind,
      uml,
      registry,
      frames,
      documents,
      common,
      links,
      headings,
      documentSchema,
      references,
    });
  } finally {
    await server.close();
    hmr.close();
  }
}

export async function readWorkspace(root = PROJECT_WORKSPACE) {
  const files = [];
  async function walk(dir) {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      if (entry.name === '.verdboard' || entry.name.startsWith('.')) continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isSymbolicLink())
        throw new Error(
          'Workspace symlink is not a project content file: ' + absolute,
        );
      if (entry.isDirectory()) await walk(absolute);
      else if (/\.verd(?:-doc)?\.json$/.test(entry.name)) {
        const source = await readFile(absolute, 'utf8');
        files.push({
          path: path.relative(root, absolute).split(path.sep).join('/'),
          absolute,
          source,
          file: JSON.parse(source),
        });
      } else throw new Error('Unexpected project workspace asset: ' + absolute);
    }
  }
  await walk(root);
  return files;
}

export async function readPackageModel() {
  const groups = [
    ['应用入口', 'apps'],
    ['产品层', 'packages/product'],
    ['React 适配', 'packages/react'],
    ['基础引擎', 'packages/engine'],
    ['领域引擎', null],
    ['导入导出边界', 'packages/converters'],
  ].map(([label, directory]) => ({ label, directory, nodes: [] }));
  for (const parent of [
    'apps',
    'packages/product',
    'packages/react',
    'packages/engine',
    'packages/converters',
  ]) {
    for (const entry of (
      await readdir(path.join(REPO_ROOT, parent), { withFileTypes: true })
    ).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) continue;
      const directory = parent + '/' + entry.name;
      let manifest;
      try {
        manifest = JSON.parse(
          await readFile(
            path.join(REPO_ROOT, directory, 'package.json'),
            'utf8',
          ),
        );
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw error;
      }
      if (!manifest.name) throw new Error('Missing package name: ' + directory);
      const group =
        parent === 'packages/engine' &&
        ['draw', 'mind', 'workflow', 'architecture'].includes(entry.name)
          ? groups[4]
          : groups.find((g) => g.directory === parent);
      group.nodes.push({
        id: manifest.name,
        label: manifest.name + '\n' + directory,
        directory,
        manifest,
      });
    }
  }
  const nodes = groups.flatMap((g) => g.nodes);
  if (new Set(nodes.map((n) => n.id)).size !== nodes.length)
    throw new Error('Duplicate workspace package names');
  const known = new Set(nodes.map((n) => n.id));
  const direct = nodes.flatMap((n) =>
    Object.keys(n.manifest.dependencies ?? {})
      .filter((id) => known.has(id))
      .sort()
      .map((id) => [n.id, id]),
  );
  function hasPath(from, to, excluded, seen = new Set()) {
    if (from === to) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return direct.some(
      (e) =>
        e !== excluded && e[0] === from && hasPath(e[1], to, excluded, seen),
    );
  }
  for (const edge of direct)
    if (hasPath(edge[1], edge[0], edge))
      throw new Error('Cyclic package dependency: ' + edge.join(' -> '));
  return {
    layers: groups,
    edges: direct.filter((e) => !hasPath(e[0], e[1], e)),
    direct,
  };
}

function setLabel(cell, label) {
  if (cell.content?.label === label && cell.content?.text?.plainText === label)
    return;
  const previous = cell.content?.text;
  const marks = previous?.content?.content?.[0]?.content?.[0]?.marks;
  cell.content = {
    ...cell.content,
    label,
    text: {
      schemaVersion: 1,
      id: previous?.id ?? cell.id + '/text',
      kind: 'inline',
      plainText: label,
      content: {
        type: 'doc',
        content: label.split('\n').map((text) => ({
          type: 'paragraph',
          content: [{ type: 'text', text, ...(marks ? { marks } : {}) }],
        })),
      },
    },
  };
}

/** Own only package cells. Annotations, styles, positions and extra members survive. */
export function refreshPackageFile(input, model) {
  const result = clone(input),
    old = result.cells,
    next = {};
  const managed = (id) => id.startsWith(PREFIX);
  const desired = new Set();
  for (const [index, layer] of model.layers.entries()) {
    const layerId = PREFIX + 'layer/' + index;
    desired.add(layerId);
    const existing = old[layerId];
    const members = [];
    for (const [column, node] of layer.nodes.entries()) {
      const id = PREFIX + 'module/' + node.id;
      desired.add(id);
      members.push(id);
      const cell = old[id]
        ? clone(old[id])
        : {
            id,
            kind: 'architecture-module',
            cellType: 'node',
            geometry: {
              x: 20 + column * 396,
              y: index * 220 + 54,
              width: 372,
              height: 98,
              derived: false,
              outline: { kind: 'roundRectangle', radius: 8 },
            },
            data: { shape: 'box', placed: true },
            appearance: {
              fill: '#f0fdfa',
              strokeColor: '#94a3b8',
              strokeWidth: 1.5,
            },
            ports: ['top', 'right', 'bottom', 'left'].map((side) => ({
              id: side,
              side,
              offset: 0.5,
              direction: 'both',
            })),
          };
      if (!old[id]) {
        const occupied = (existing?.data?.memberIds ?? [])
          .map((key) => old[key])
          .filter((c) => c?.geometry);
        if (occupied.length)
          cell.geometry.x =
            Math.max(...occupied.map((c) => c.geometry.x + c.geometry.width)) +
            24 +
            column * 396;
      }
      setLabel(cell, node.label);
      next[id] = cell;
    }
    const cell = existing
      ? clone(existing)
      : {
          id: layerId,
          kind: 'architecture-layer',
          cellType: 'node',
          geometry: {
            x: 0,
            y: index * 220,
            width: 1980,
            height: 170,
            derived: true,
          },
          appearance: {
            fill: '#f8fafc',
            strokeColor: '#e2e8f0',
            strokeWidth: 1,
          },
          data: { order: String(index).padStart(8, '0'), fontSize: 24 },
        };
    cell.data.memberIds = [
      ...members,
      ...(existing?.data?.memberIds ?? []).filter((id) => !managed(id)),
    ];
    setLabel(cell, layer.label);
    next[layerId] = cell;
  }
  const edges = new Map(
    Object.values(old)
      .filter((c) => managed(c.id) && c.kind === 'architecture-edge')
      .map((c) => [JSON.stringify([c.source.cellId, c.target.cellId]), c]),
  );
  for (const [from, to] of model.edges) {
    const source = PREFIX + 'module/' + from,
      target = PREFIX + 'module/' + to;
    const existing = edges.get(JSON.stringify([source, target]));
    const cell = existing
      ? clone(existing)
      : {
          id:
            PREFIX +
            'edge/' +
            encodeURIComponent(from) +
            '>' +
            encodeURIComponent(to),
          kind: 'architecture-edge',
          cellType: 'edge',
          source: { cellId: source },
          target: { cellId: target },
          route: { mode: 'orthogonal' },
          appearance: { strokeColor: '#64748b', strokeWidth: 1.5 },
        };
    desired.add(cell.id);
    next[cell.id] = cell;
  }
  const removed = Object.keys(old).filter(
    (id) => managed(id) && !desired.has(id),
  );
  for (const cell of Object.values(old).filter((c) => !managed(c.id))) {
    for (const id of removed)
      if (
        cell.source?.cellId === id ||
        cell.target?.cellId === id ||
        cell.members?.includes(id) ||
        cell.data?.memberIds?.includes(id)
      )
        throw new Error(
          'Cannot remove package cell referenced by annotation ' +
            cell.id +
            ': ' +
            id,
        );
    next[cell.id] = cell;
  }
  result.cells = {};
  // Keep insertion order and existing user placements to avoid noisy JSON diffs.
  for (const id of Object.keys(old)) if (next[id]) result.cells[id] = next[id];
  for (const [id, cell] of Object.entries(next))
    if (!result.cells[id]) result.cells[id] = cell;
  result.frame.children = [
    ...result.frame.children.filter((id) => result.cells[id]),
    ...Object.keys(next).filter(
      (id) =>
        !result.frame.children.includes(id) && next[id].cellType !== 'group',
    ),
  ];
  return result;
}

export function packageDrift(file, model) {
  const expected = refreshPackageFile(file, model);
  return JSON.stringify(expected) !== JSON.stringify(file);
}

export async function validateWorkspace(entries, runtime) {
  const { frames, documents, registry } = runtime;
  const errors = [],
    identities = new Map(),
    filesById = new Map(),
    sourceChecks = [];
  const report = (p, message) => errors.push(p + ': ' + message);
  for (const entry of entries) {
    const file = entry.file;
    if (!frames.isFrameFileV2(file) && !documents.isDocumentFileV1(file)) {
      report(entry.path, 'Invalid native workspace file');
      continue;
    }
    const id = documents.workspaceFileId(file);
    filesById.set(id, file);
    for (const identity of [
      id,
      ...(file.format === 'verd-frame' ? Object.keys(file.cells) : []),
    ]) {
      if (identities.has(identity))
        report(
          entry.path,
          'Duplicate identity ' +
            identity +
            ' (also ' +
            identities.get(identity) +
            ')',
        );
      identities.set(identity, entry.path);
    }
    if (file.format === 'verd-document' && file.text.id !== id)
      report(entry.path, 'Document identity differs from body identity');
    if (file.format === 'verd-document') {
      try {
        runtime.documentSchema.nodeFromJSON(file.text.content).check();
      } catch (error) {
        report(entry.path, 'Document editor schema: ' + error.message);
      }
    }
  }
  const canvasFiles = entries
    .filter((e) => frames.isFrameFileV2(e.file))
    .map((e) => e.file);
  for (const diagnostic of runtime.references.validateWorkspaceReferences(
    [...filesById.values()],
    true,
  ))
    report(diagnostic.frameId ?? 'references', diagnostic.message);
  for (const diagnostic of frames.validateFrameFiles(canvasFiles, registry))
    report(diagnostic.frameId ?? 'frames', diagnostic.message);
  for (const diagnostic of frames.buildOrganizationIndex(canvasFiles)
    .diagnostics)
    report(diagnostic.frameId ?? 'organization', diagnostic.message);
  const anchors = new Map();
  function walk(node, visit) {
    visit(node);
    for (const child of node.content ?? []) walk(child, visit);
  }
  for (const [id, file] of filesById)
    if (file.format === 'verd-document') {
      const slug = runtime.headings.createDocumentHeadingSlugger();
      const found = new Set();
      walk(file.text.content, (node) => {
        if (node.type === 'heading')
          found.add(slug(runtime.common.deriveBoardTextPlainText(node)));
      });
      anchors.set(id, found);
    }
  for (const entry of entries)
    if (entry.file.format === 'verd-document')
      walk(entry.file.text.content, (node) => {
        for (const mark of node.marks ?? [])
          if (mark.type === 'link') {
            const href = mark.attrs?.href;
            const parsed =
              typeof href === 'string'
                ? runtime.links.parseDocumentLink(href, entry.file.id)
                : null;
            if (!parsed) {
              report(entry.path, 'Unsupported or invalid link ' + href);
              continue;
            }
            if (parsed.kind === 'file') {
              if (!filesById.has(parsed.fileId))
                report(entry.path, 'Missing linked file ' + parsed.fileId);
              else if (
                parsed.anchor &&
                !anchors.get(parsed.fileId)?.has(parsed.anchor)
              )
                report(
                  entry.path,
                  'Missing linked heading ' +
                    parsed.anchor +
                    ' in ' +
                    parsed.fileId,
                );
            } else {
              const url = new URL(parsed.url),
                prefix = '/WinstonSue/verd-board/blob/master/';
              if (
                url.hostname === 'github.com' &&
                url.pathname.startsWith(prefix)
              ) {
                const local = decodeURIComponent(
                  url.pathname.slice(prefix.length),
                );
                // Files may be moved during migration; report the concrete missing source.
                if (local.startsWith('doc/'))
                  report(entry.path, 'Old root documentation link ' + href);
                else
                  sourceChecks.push(
                    access(path.resolve(REPO_ROOT, local)).catch(() =>
                      report(entry.path, 'Missing repository source ' + local),
                    ),
                  );
              }
            }
          }
      });
  await Promise.all(sourceChecks);
  return errors;
}

export async function atomicWrite(file, text, expected) {
  const temporary = file + '.workspace-' + randomUUID() + '.tmp';
  try {
    await writeFile(temporary, text, { flag: 'wx' });
    if ((await readFile(file, 'utf8')) !== expected)
      throw new Error('Workspace changed during refresh; no replacement made');
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function runWorkspace(
  command = 'check',
  root = PROJECT_WORKSPACE,
) {
  if (!['check', 'validate', 'refresh'].includes(command))
    throw new Error(
      'Usage: node scripts/workspace.mjs [check|validate|refresh] [workspace-directory]',
    );
  const entries = await readWorkspace(root),
    model = await readPackageModel();
  const entry = entries.find((e) => e.file.frame?.id === PACKAGE_FRAME_ID);
  if (!entry) throw new Error('Missing package dependency canvas');
  if (command === 'refresh') {
    const next = refreshPackageFile(entry.file, model);
    if (JSON.stringify(next) !== JSON.stringify(entry.file)) {
      const candidate = entries.map((e) =>
        e === entry ? { ...e, file: next } : e,
      );
      const errors = await withWorkspaceRuntime((r) =>
        validateWorkspace(candidate, r),
      );
      if (errors.length) throw new Error(errors.join('\n'));
      await atomicWrite(
        entry.absolute,
        JSON.stringify(next, null, 2) + '\n',
        entry.source,
      );
      entry.file = next;
    }
  }
  const errors = await withWorkspaceRuntime((r) =>
    validateWorkspace(entries, r),
  );
  if (command !== 'validate' && packageDrift(entry.file, model))
    errors.push('Package dependencies changed; run pnpm workspace:refresh');
  if (errors.length) throw new Error(errors.join('\n'));
  return {
    files: entries.length,
    packages: model.layers.flatMap((l) => l.nodes).length,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  runWorkspace(
    process.argv[2] ?? 'check',
    process.argv[3] ? path.resolve(process.argv[3]) : PROJECT_WORKSPACE,
  )
    .then((result) =>
      console.log(
        `Workspace valid: ${result.files} native files, ${result.packages} applications/packages.`,
      ),
    )
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
