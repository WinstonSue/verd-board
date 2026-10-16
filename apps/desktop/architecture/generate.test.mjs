import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  atomicWrite,
  buildDemoStorage,
  DEFAULT_FILE,
  parseArguments,
  readManifests,
  runGenerator,
  validateStorage,
  withSourceRuntime,
} from './generate.mjs';
import { packageArchitecture, TOPICS } from './documents.mjs';

const clone = (v) => JSON.parse(JSON.stringify(v));
test('native demo generation validates current source and protects workspace data', async (t) => {
  await withSourceRuntime(async (runtime) => {
    const input = JSON.parse(await readFile(DEFAULT_FILE, 'utf8'));
    const manifests = await readManifests();
    const generated = await buildDemoStorage(input, manifests, runtime, 1000);
    const again = await buildDemoStorage(
      generated.storage,
      manifests,
      runtime,
      2000,
    );
    assert.equal(again.changed, false);
    assert.deepEqual(again.storage, generated.storage);
    assert.deepEqual(again.references, generated.references);
    const snapshot = await validateStorage(generated.storage, runtime);
    const root = snapshot.store.cells[snapshot.store.rootId];
    assert.deepEqual(
      root.children.filter((id) => TOPICS.some((topic) => topic.id === id)),
      TOPICS.map((topic) => topic.id),
    );
    assert.equal(snapshot.detachedFrameIds.includes(TOPICS[7].id), false);
    assert.equal(TOPICS.length, 8);
    assert.equal(
      Object.values(snapshot.store.cells).filter(
        (c) => c.kind === 'workflow-start',
      ).length,
      6,
    );
    const model = packageArchitecture(manifests);
    assert.equal(model.layers.flatMap((l) => l.nodes).length, 19);
    assert.equal(
      model.edges.some(
        ([from, to]) =>
          from === '@sue/board-react-text' && to === '@sue/board-text',
      ),
      false,
    );
    assert.equal(
      model.edges.some(
        ([from, to]) =>
          from === '@sue/board-core' && to === '@sue/board-common',
      ),
      false,
    );
    for (const edge of model.edges) assert.ok(model.direct.includes(edge));

    await t.test(
      'retains annotations, groups, independent Frames, settings and unused records',
      async () => {
        const data = clone(generated.storage);
        const manifest = data.main_board_content;
        const rootRecord = data[manifest.frames[manifest.rootId]];
        const note = {
          id: 'user-note',
          kind: 'geometry',
          cellType: 'node',
          geometry: { x: 10, y: 10, width: 60, height: 40 },
          content: { label: '用户标注' },
        };
        const note2 = { ...clone(note), id: 'user-note-2' };
        const group = {
          id: 'user-group',
          kind: 'group',
          cellType: 'group',
          members: [note.id, note2.id],
        };
        rootRecord.cells[note.id] = note;
        rootRecord.cells[note2.id] = note2;
        rootRecord.cells[group.id] = group;
        rootRecord.frame.children.push(note.id, note2.id);
        rootRecord.frame.groups.push(group.id);
        const detached = {
          format: 'verd-frame',
          version: 1,
          frame: {
            id: 'user-frame',
            kind: 'frame',
            cellType: 'frame',
            geometry: { x: 0, y: 0, width: 960, height: 640 },
            children: [],
            groups: [],
          },
          cells: {},
        };
        manifest.frames['user-frame'] = 'frames/user-frame/user-revision';
        manifest.detachedFrameIds.push('user-frame');
        data[manifest.frames['user-frame']] = detached;
        data['frames/unreferenced/user-revision'] = {
          user: 'keep this old record',
        };
        data['user-settings'] = { language: 'zh', arbitrary: [1, 2, 3] };
        // User-created domain nodes inside a managed topic must survive a refresh.
        const edited = data[manifest.frames[TOPICS[0].id]];
        const layer = Object.values(edited.cells).find(
          (cell) => cell.kind === 'architecture-layer',
        );
        const domainNote = clone(
          Object.values(edited.cells).find(
            (cell) => cell.kind === 'architecture-module',
          ),
        );
        domainNote.id = 'user-module';
        domainNote.content = { label: '用户补充模块' };
        edited.cells[domainNote.id] = domainNote;
        edited.frame.children.push(domainNote.id);
        layer.data.memberIds.push(domainNote.id);
        const refreshed = await buildDemoStorage(
          data,
          manifests,
          runtime,
          3000,
        );
        const after = refreshed.storage;
        const afterRoot =
          after[after.main_board_content.frames[manifest.rootId]];
        assert.deepEqual(afterRoot.cells[note.id], note);
        assert.deepEqual(afterRoot.cells[group.id], group);
        assert.deepEqual(after[manifest.frames['user-frame']], detached);
        assert.deepEqual(
          after['frames/unreferenced/user-revision'],
          data['frames/unreferenced/user-revision'],
        );
        assert.deepEqual(after['user-settings'], data['user-settings']);
        const afterTopic = after[after.main_board_content.frames[TOPICS[0].id]];
        assert.deepEqual(afterTopic.cells[domainNote.id], domainNote);
        assert.ok(
          afterTopic.cells[layer.id].data.memberIds.includes(domainNote.id),
        );
      },
    );

    await t.test(
      'rejects corrupt partitions, missing records, ID collisions and unmanaged new Frames',
      async () => {
        const missing = clone(input);
        delete missing[
          missing.main_board_content.frames[missing.main_board_content.rootId]
        ];
        await assert.rejects(
          buildDemoStorage(missing, manifests, runtime),
          /Missing or invalid/,
        );
        const partition = clone(input);
        partition[
          partition.main_board_content.frames[
            partition.main_board_content.rootId
          ]
        ].cells.stray = { id: 'stray' };
        await assert.rejects(
          buildDemoStorage(partition, manifests, runtime),
          /partition/,
        );
        await assert.rejects(
          buildDemoStorage({ main_board_content: {} }, manifests, runtime),
          /valid verd-workspace/,
        );
        const collision = clone(generated.storage);
        const original =
          collision[collision.main_board_content.frames[TOPICS[3].id]];
        delete original.frame.data;
        await assert.rejects(
          buildDemoStorage(collision, manifests, runtime),
          /Unmanaged Frame ID collision/,
        );
        const cellCollision = clone(generated.storage);
        const rootRecord =
          cellCollision[
            cellCollision.main_board_content.frames[
              cellCollision.main_board_content.rootId
            ]
          ];
        const copied = clone(Object.values(rootRecord.cells)[0]);
        const edited =
          cellCollision[cellCollision.main_board_content.frames[TOPICS[4].id]];
        const originalTask = Object.values(edited.cells).find(
          (cell) => cell.kind === 'workflow-task',
        );
        // A canonical ID, relocated to another Frame, must never be overwritten.
        const id = originalTask.id;
        delete edited.cells[id];
        edited.frame.children = edited.frame.children.filter(
          (child) => child !== id,
        );
        const start = Object.values(edited.cells).find(
          (cell) => cell.kind === 'workflow-start',
        );
        start.data.memberIds = start.data.memberIds.filter(
          (child) => child !== id,
        );
        for (const [key, value] of Object.entries(edited.cells)) {
          if (
            value.cellType === 'edge' &&
            (value.source.cellId === id || value.target.cellId === id)
          ) {
            delete edited.cells[key];
            edited.frame.children = edited.frame.children.filter(
              (child) => child !== key,
            );
          }
        }
        copied.id = id;
        rootRecord.cells[id] = clone(copied);
        rootRecord.frame.children.push(id);
        await assert.rejects(
          buildDemoStorage(cellCollision, manifests, runtime),
          /collision outside/,
        );
      },
    );
  });
});

test('CLI check/output modes never modify their input and generation is byte-idempotent', async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'verd-demo-generator-'),
  );
  try {
    const inputFile = path.join(directory, 'workspace.json');
    const referenceDirectory = path.join(directory, 'references');
    await mkdir(referenceDirectory);
    await writeFile(inputFile, await readFile(DEFAULT_FILE, 'utf8'));
    const paths = { inputFile, referenceDirectory };
    await runGenerator({}, paths);
    const original = await readFile(inputFile, 'utf8');
    const refs = await Promise.all(
      ['layered.mmd', 'data-flow.mmd'].map((name) =>
        readFile(path.join(referenceDirectory, name), 'utf8'),
      ),
    );
    await runGenerator({ check: true }, paths);
    await runGenerator({}, paths);
    assert.equal(await readFile(inputFile, 'utf8'), original);
    await writeFile(path.join(referenceDirectory, 'layered.mmd'), 'drift');
    await assert.rejects(runGenerator({ check: true }, paths), /drift/);
    assert.equal(await readFile(inputFile, 'utf8'), original);
    assert.equal(
      await readFile(path.join(referenceDirectory, 'layered.mmd'), 'utf8'),
      'drift',
    );
    const output = path.join(directory, 'preview.json');
    await runGenerator({ output }, paths);
    assert.equal(await readFile(output, 'utf8'), original);
    assert.equal(await readFile(inputFile, 'utf8'), original);
    assert.equal(
      await readFile(path.join(referenceDirectory, 'layered.mmd'), 'utf8'),
      'drift',
    );
    assert.equal(
      await readFile(path.join(referenceDirectory, 'data-flow.mmd'), 'utf8'),
      refs[1],
    );
    await assert.rejects(
      runGenerator({ output: inputFile }, paths),
      /separate preview/,
    );
    await writeFile(inputFile, '{broken');
    await assert.rejects(runGenerator({}, paths), SyntaxError);
    assert.equal(await readFile(inputFile, 'utf8'), '{broken');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('atomic replacement refuses concurrent changes and argument errors', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'verd-demo-atomic-'));
  try {
    const file = path.join(directory, 'data.json');
    await writeFile(file, 'newer autosave');
    await assert.rejects(
      atomicWrite(file, 'generated', 'earlier input'),
      /Input changed/,
    );
    assert.equal(await readFile(file, 'utf8'), 'newer autosave');
    assert.throws(
      () => parseArguments(['--check', '--output', 'file']),
      /mutually exclusive/,
    );
    assert.throws(() => parseArguments(['--output']), /Usage/);
    assert.throws(() => parseArguments(['--unknown']), /Usage/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
