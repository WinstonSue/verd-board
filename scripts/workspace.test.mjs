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

test('project content validates, package facts are current, refresh is idempotent', async () => {
  const entries = await readWorkspace(),
    model = await readPackageModel();
  assert.equal(
    entries.filter((e) => e.file.format === 'verd-document').length,
    21,
  );
  assert.ok(
    entries.some((e) => e.file.id === 'project-doc:packages/release-2'),
  );
  assert.equal(entries.filter((e) => e.file.format === 'verd-frame').length, 9);
  const home = entries.find((e) => e.file.frame?.id === 'board-root').file;
  assert.equal(
    entries
      .filter(
        (e) =>
          e.file.format === 'verd-frame' && e.file.frame.id !== 'board-root',
      )
      .every(
        (e) =>
          e.file.organization?.kind === 'subgraph' &&
          e.file.organization.ownerFrameId === 'board-root',
      ),
    true,
  );
  assert.deepEqual(
    Object.values(home.cells)
      .filter((cell) => cell.kind === 'document-frame')
      .map((cell) => cell.data.targetDocumentId)
      .sort(),
    [
      'project-doc:README',
      'project-doc:architecture/ARCHITECTURE',
      'project-doc:development/README',
    ].sort(),
  );
  for (const entry of entries.filter(
    (e) => e.file.format === 'verd-frame' && e.file.frame.id !== 'board-root',
  )) {
    const cards = Object.values(entry.file.cells).filter(
      (cell) => cell.kind === 'document-reference',
    );
    assert.equal(cards.length, 1, entry.path);
    assert.ok(cards[0].content.text.plainText.length > 0, entry.path);
    assert.equal(
      Object.values(entry.file.cells).some(
        (cell) => cell.kind === 'document-frame',
      ),
      false,
    );
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
  assert.equal(embeddedTargets.size, 8);
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
    const duplicate = structuredClone(entries[0]);
    duplicate.path = 'duplicate.verd.json';
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
        ).some((e) => e.includes('Document editor schema')),
      );
    }
  });
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
    const file = path.join(directory, 'canvas.verd.json');
    await writeFile(file, 'latest user edit');
    await assert.rejects(
      atomicWrite(file, 'generated', 'stale content'),
      /changed during refresh/,
    );
    assert.equal(await readFile(file, 'utf8'), 'latest user edit');
    assert.deepEqual(await readdir(directory), ['canvas.verd.json']);
    await atomicWrite(file, 'updated', 'latest user edit');
    assert.equal(await readFile(file, 'utf8'), 'updated');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
