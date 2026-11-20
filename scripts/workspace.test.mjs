import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  atomicWrite,
  readWorkspace,
  readPackageModel,
  refreshPackageFile,
  packageDrift,
  PACKAGE_FRAME_ID,
  validateWorkspace,
  withWorkspaceRuntime,
} from './workspace.mjs';

test('workspace checks do not turn authoring warnings into errors', async () => {
  const warning = {
    code: 'workflow.port-direction',
    severity: 'warning',
    message: 'Loop output uses left port',
  };
  const error = {
    code: 'frame.invalid',
    severity: 'error',
    message: 'Invalid port',
  };
  assert.deepEqual(
    await validateWorkspace([], {
      validation: { validateNativeWorkspace: () => [warning] },
    }),
    [],
  );
  assert.deepEqual(
    await validateWorkspace([], {
      validation: { validateNativeWorkspace: () => [warning, error] },
    }),
    ['workspace: Invalid port'],
  );
});

test('project content validates, package facts are current, refresh is idempotent', async () => {
  const projectConfig = JSON.parse(
    await readFile(new URL('../.verd.config.json', import.meta.url), 'utf8'),
  );
  assert.equal(projectConfig.workspace, 'workspace');
  const entries = await readWorkspace(),
    model = await readPackageModel();
  assert.equal(
    entries.filter((e) => e.file.format === 'verd-document').length,
    21,
  );
  assert.ok(
    entries.some((e) => e.file.id === 'project-doc:packages/release-2'),
  );
  assert.equal(
    entries.filter((e) => e.file.format === 'verd-frame').length,
    31,
  );
  const home = entries.find((e) => e.file.frame?.id === 'board-root').file;
  // Native writes omit ownership metadata; untouched legacy sources can keep
  // their inert standalone marker. The reference-closure test below owns the
  // actual navigation hierarchy.
  assert.equal(
    entries
      .filter(
        (e) =>
          e.file.format === 'verd-frame' && e.file.frame.id !== 'board-root',
      )
      .every(
        (e) =>
          e.file.organization === undefined ||
          e.file.organization.kind === 'standalone',
      ),
    true,
  );
  assert.equal(
    entries.find((e) => e.file.id === 'project-doc:README').path,
    '文档导航.verd-doc.json',
  );
  assert.equal(
    entries.find((e) => e.file.id === 'project-doc:README_en').path,
    'Documentation.verd-doc.json',
  );
  assert.equal(
    entries.find((e) => e.file.frame?.id === 'board-root').path,
    '架构图/项目导览.verd',
  );
  for (const entry of entries.filter((e) => e.file.format === 'verd-frame')) {
    assert.equal(
      Object.values(entry.file.cells).some((c) =>
        ['document-frame', 'document-reference'].includes(c.kind),
      ),
      false,
      entry.path,
    );
    if (entry.file.frame.id !== 'board-root') {
      const note = Object.values(entry.file.cells).find((c) =>
        c.content?.text?.plainText?.startsWith('相关文档：'),
      );
      assert.equal(note.kind, 'geometry');
      assert.ok(note.content.text.plainText.includes('相关文档：'), entry.path);
      assert.ok(note.geometry.height < 400, entry.path);
    }
  }
  const embeddedTargets = new Set();
  for (const entry of entries.filter(
    (e) => e.file.format === 'verd-document',
  )) {
    const visit = (node) => {
      if (node.type === 'frameReference')
        embeddedTargets.add(node.attrs.targetFrameId);
      node.content?.forEach(visit);
    };
    visit(entry.file.text.content);
  }
  assert.equal(embeddedTargets.size, 9);
  const algorithms = entries.find(
    (e) => e.file.frame?.id === 'demo:layout-routing',
  );
  assert.ok(algorithms);
  assert.ok(
    Object.values(home.cells).some(
      (cell) =>
        cell.kind === 'frame-reference' &&
        cell.data.targetFrameId === algorithms.file.frame.id,
    ),
  );
  assert.ok(
    model.layers
      .find((layer) => layer.label === '领域引擎')
      .nodes.some((node) => node.id === '@sue/board-uml'),
  );
  const file = entries.find((e) => e.file.frame?.id === PACKAGE_FRAME_ID).file;
  assert.equal(packageDrift(file, model), false);
  assert.deepEqual(refreshPackageFile(file, model), file);
  assert.ok(
    model.layers
      .flatMap((l) => l.nodes)
      .some((n) => n.id === '@sue/board-markdown-to-text'),
  );
  await withWorkspaceRuntime(async (runtime) => {
    assert.deepEqual(await validateWorkspace(entries, runtime), []);
    const closure = runtime.references.workspaceFileClosure(
      entries.map((e) => e.file),
      'board-root',
    );
    assert.equal(closure.length, 31);
    assert.ok(
      closure.every((file) => file.format === 'verd-frame'),
      'ordinary documentation links must not export document bodies',
    );
    const duplicate = structuredClone(entries[0]);
    duplicate.path = 'duplicate.verd';
    assert.ok(
      (await validateWorkspace([...entries, duplicate], runtime)).some((e) =>
        e.includes('Duplicate identity'),
      ),
    );
    const document = entries.find((e) => e.file.format === 'verd-document');
    if (document) {
      const broken = structuredClone(document);
      broken.file.text.id = 'wrong-body';
      broken.file.text.content.content.push({
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'missing',
            marks: [{ type: 'link', attrs: { href: 'verd://file/missing' } }],
          },
        ],
      });
      const errors = await validateWorkspace(
        entries.map((e) => (e === document ? broken : e)),
        runtime,
      );
      assert.ok(errors.some((e) => e.includes('Document identity differs')));
      assert.ok(errors.some((e) => e.includes('Missing linked file missing')));
      assert.ok(errors.some((e) => e.includes('plainText cache differs')));
      const targetFile = entries.find(
        (e) => e.file.format === 'verd-frame',
      ).file;
      const targetId = Object.keys(targetFile.cells)[0];
      const withCellLink = structuredClone(document);
      const cellLink = runtime.links.createWorkspaceLink({
        kind: 'cell',
        fileId: 'old-file-hint',
        cellId: targetId,
      });
      withCellLink.file.text.content.content.push({
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'target',
            marks: [{ type: 'link', attrs: { href: cellLink } }],
          },
        ],
      });
      withCellLink.file.text.plainText =
        runtime.common.deriveBoardTextPlainText(withCellLink.file.text.content);
      assert.deepEqual(
        await validateWorkspace(
          entries.map((e) => (e === document ? withCellLink : e)),
          runtime,
        ),
        [],
      );
      const missingCell = structuredClone(withCellLink);
      missingCell.file.text.content.content.at(
        -1,
      ).content[0].marks[0].attrs.href = runtime.links.createWorkspaceLink({
        kind: 'cell',
        fileId: targetFile.frame.id,
        cellId: 'missing-cell',
      });
      assert.ok(
        (
          await validateWorkspace(
            entries.map((e) => (e === document ? missingCell : e)),
            runtime,
          )
        ).some(
          (e) =>
            e.includes('Missing linked cell') && e.includes('missing-cell'),
        ),
      );
      const invalidMarks = structuredClone(document);
      invalidMarks.file.text.content.content.push({
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'code',
            marks: [{ type: 'bold' }, { type: 'code' }],
          },
        ],
      });
      assert.ok(
        (
          await validateWorkspace(
            entries.map((e) => (e === document ? invalidMarks : e)),
            runtime,
          )
        ).some(
          (e) =>
            e.includes('Document editor schema') ||
            e.includes('Invalid collection of marks'),
        ),
      );
    }
  });
});

test('nine overviews reach exactly twenty-one standalone details without changing the overview during package refresh', async () => {
  const entries = await readWorkspace();
  const byId = new Map(
    entries
      .filter((e) => e.file.format === 'verd-frame')
      .map((e) => [e.file.frame.id, e]),
  );
  const home = byId.get('board-root').file;
  const topics = Object.values(home.cells).filter(
    (c) => c.kind === 'frame-reference',
  );
  assert.equal(topics.length, 9);
  const expectedCounts = [2, 2, 3, 2, 3, 2, 2, 2, 3];
  const reached = new Set();
  for (const [index, ref] of topics.entries()) {
    const overview = byId.get(ref.data.targetFrameId);
    assert.ok(overview);
    const refs = Object.values(overview.file.cells).filter(
      (c) => c.kind === 'frame-reference',
    );
    assert.equal(refs.length, expectedCounts[index], overview.path);
    for (const detailRef of refs) {
      const detail = byId.get(detailRef.data.targetFrameId);
      assert.ok(detail, overview.path);
      assert.match(
        detail.path,
        /^架构图\/细节\/[^/]+\/[^/]+\.verd(?:\.json)?$/,
      );
      assert.equal(
        detail.file.organization?.kind ?? 'standalone',
        'standalone',
        'independent sources may retain the legacy standalone marker, but not owner-canvas metadata',
      );
      assert.equal(reached.has(detail.file.frame.id), false, detail.path);
      reached.add(detail.file.frame.id);
      for (const layer of Object.values(detail.file.cells).filter(
        (c) => c.kind === 'architecture-layer',
      )) {
        const paintOrder = detail.file.frame.children;
        for (const id of layer.data.memberIds)
          assert.ok(
            paintOrder.indexOf(layer.id) < paintOrder.indexOf(id),
            `${detail.path}: layer must paint behind ${id}`,
          );
      }
      assert.equal(
        Object.values(detail.file.cells).some(
          (c) => c.kind === 'frame-reference',
        ),
        false,
      );
      const card = Object.values(detail.file.cells).find((c) =>
        c.content?.text?.plainText?.startsWith('相关文档：'),
      );
      assert.match(card.content.text.plainText, /源码入口：/);
      assert.match(card.content.text.plainText, /返回专题总览/);
    }
  }
  assert.equal(reached.size, 21);
  assert.deepEqual(
    [...reached].sort(),
    [...byId.keys()].filter((id) => id.startsWith('project:detail/')).sort(),
  );
  const overview = byId.get('board/20:architecture-layered').file;
  const before = structuredClone(overview);
  assert.equal(
    Object.keys(overview.cells).some((id) => id.startsWith('demo:packages/')),
    false,
  );
  const packageFile = byId.get(PACKAGE_FRAME_ID).file;
  const refreshed = refreshPackageFile(packageFile, await readPackageModel());
  assert.deepEqual(refreshed, packageFile);
  assert.deepEqual(
    refreshPackageFile(refreshed, await readPackageModel()),
    refreshed,
  );
  assert.deepEqual(overview, before);
});

test('dependency refresh preserves annotations and rejects deleting their targets', async () => {
  const entries = await readWorkspace(),
    model = await readPackageModel();
  const file = structuredClone(
    entries.find((e) => e.file.frame?.id === PACKAGE_FRAME_ID).file,
  );
  const layer = Object.values(file.cells).find(
    (c) => c.kind === 'architecture-layer',
  );
  const target = layer.data.memberIds[0];
  file.cells['user:module'] = {
    ...structuredClone(file.cells[target]),
    id: 'user:module',
  };
  layer.data.memberIds.push('user:module');
  file.frame.children.push('user:module');
  file.cells['user:edge'] = {
    id: 'user:edge',
    kind: 'architecture-edge',
    cellType: 'edge',
    source: { cellId: 'user:module' },
    target: { cellId: target },
    route: { mode: 'orthogonal' },
  };
  file.frame.children.push('user:edge');
  const before = structuredClone(file);
  assert.deepEqual(refreshPackageFile(file, model), file);
  assert.deepEqual(file, before);
  const reduced = structuredClone(model);
  const packageName = target.slice('demo:packages/module/'.length);
  reduced.layers.forEach((l) => {
    l.nodes = l.nodes.filter((n) => n.id !== packageName);
  });
  reduced.edges = reduced.edges.filter((e) => !e.includes(packageName));
  assert.throws(
    () => refreshPackageFile(file, reduced),
    /referenced by annotation/,
  );
});

test('atomic refresh refuses concurrent edits without leaving temporary files', async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'verd-project-content-'),
  );
  try {
    const file = path.join(directory, 'canvas.verd');
    await writeFile(file, 'latest user edit');
    await assert.rejects(
      atomicWrite(file, 'generated', 'stale content'),
      /changed during refresh/,
    );
    assert.equal(await readFile(file, 'utf8'), 'latest user edit');
    assert.deepEqual(await readdir(directory), ['canvas.verd']);
    await atomicWrite(file, 'updated', 'latest user edit');
    assert.equal(await readFile(file, 'utf8'), 'updated');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('new packages append contiguously without moving existing modules', async () => {
  const entries = await readWorkspace(),
    model = await readPackageModel();
  const file = structuredClone(
    entries.find((e) => e.file.frame?.id === PACKAGE_FRAME_ID).file,
  );
  const layer = model.layers[2],
    changed = structuredClone(model);
  changed.layers[2].nodes.push(
    { id: 'test:one', label: 'First new package' },
    { id: 'test:two', label: 'Second new package' },
  );
  const before = structuredClone(file);
  const next = refreshPackageFile(file, changed);
  const a = next.cells['demo:packages/module/test:one'],
    b = next.cells['demo:packages/module/test:two'];
  const maxRight = Math.max(
    ...layer.nodes
      .map((node) => file.cells['demo:packages/module/' + node.id].geometry)
      .map((g) => g.x + g.width),
  );
  assert.equal(a.geometry.x, maxRight + 96);
  assert.equal(b.geometry.x, a.geometry.x + a.geometry.width + 96);
  for (const node of layer.nodes)
    assert.deepEqual(
      next.cells['demo:packages/module/' + node.id],
      before.cells['demo:packages/module/' + node.id],
    );
  assert.deepEqual(refreshPackageFile(next, changed), next);
  assert.deepEqual(file, before);
});

test('a package changing layers keeps its identity and style while leaving its old layer', async () => {
  const entries = await readWorkspace();
  const file = entries.find(
    (entry) => entry.file.frame?.id === PACKAGE_FRAME_ID,
  ).file;
  const model = await readPackageModel();
  const changed = structuredClone(model);
  const source = changed.layers.find(
    (layer) => layer.directory === 'packages/react',
  );
  const destination = changed.layers.find(
    (layer) => layer.directory === 'packages/agent',
  );
  const moved = source.nodes.pop();
  destination.nodes.push(moved);
  const moduleId = 'demo:packages/module/' + moved.id;
  const old = file.cells[moduleId];
  const next = refreshPackageFile(file, changed);
  assert.equal(next.cells[moduleId].id, old.id);
  assert.deepEqual(next.cells[moduleId].appearance, old.appearance);
  assert.notDeepEqual(next.cells[moduleId].geometry, old.geometry);
  for (const layer of Object.values(next.cells).filter(
    (cell) => cell.kind === 'architecture-layer',
  )) {
    for (const id of layer.data.memberIds)
      assert.ok(
        next.frame.children.indexOf(layer.id) < next.frame.children.indexOf(id),
      );
  }
  for (const layer of model.layers)
    for (const node of layer.nodes)
      if (node.id !== moved.id)
        assert.deepEqual(
          next.cells['demo:packages/module/' + node.id],
          file.cells['demo:packages/module/' + node.id],
        );
  assert.deepEqual(refreshPackageFile(next, changed), next);
});

test('new dependency hit paths stay behind authored navigation notes', async () => {
  const entries = await readWorkspace();
  const file = entries.find(
    (entry) => entry.file.frame?.id === PACKAGE_FRAME_ID,
  ).file;
  const model = await readPackageModel();
  const changed = structuredClone(model);
  changed.layers
    .find((layer) => layer.directory === 'packages/agent')
    .nodes.push({ id: 'test:external-agent', label: 'External Agent' });
  changed.edges.push(['test:external-agent', '@sue/verd-board-workspace']);
  const next = refreshPackageFile(file, changed);
  const annotations = file.frame.children.filter(
    (id) => !id.startsWith('demo:packages/'),
  );
  assert.ok(annotations.length);
  for (const id of annotations) {
    assert.deepEqual(next.cells[id], file.cells[id]);
    for (const generated of next.frame.children.filter((id) =>
      id.startsWith('demo:packages/'),
    ))
      assert.ok(
        next.frame.children.indexOf(id) >
          next.frame.children.indexOf(generated),
        'generated hits must not intercept authored links',
      );
  }
  assert.deepEqual(refreshPackageFile(next, changed), next);
});
