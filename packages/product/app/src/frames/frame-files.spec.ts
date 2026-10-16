import { describe, expect, it } from 'vitest';
import {
  applyCellOperations,
  createCellRegistry,
  createCellRuntime,
  createCellStore,
  createFrameCell,
  createFrameReferenceCell,
  deleteCells,
  FrameReferenceUtil,
  isFrameCell,
  isFrameReferenceCell,
  validateCellStore,
  type Cell,
  type CellStore,
  type EdgeCell,
  type FrameCell,
  type GroupCell,
  type MindRootData,
  type NodeCell,
  type PortSpec,
} from '@sue/board-core';
import {
  assembleFrameFiles,
  assembleWorkspaceStore,
  buildFrameReferenceGraph,
  duplicateFrameClosure,
  externalizeOwnedFrames,
  findFrameReferenceCycles,
  frameClosure,
  frameExportBundle,
  frameFileFor,
  isFrameFileV2,
  parseFrameExport,
  partitionCellStore,
  remapImportedFiles,
  validateFrameFiles,
  WORKSPACE_ROOT_ID,
  MIGRATION_REFERENCE_PREFIX,
  type FrameFileV2,
} from './frame-files';

const node = (id: string, kind = 'geometry'): NodeCell => ({
  id,
  kind,
  cellType: 'node',
  geometry: { x: 0, y: 0, width: 40, height: 30 },
});

/** A legacy-shaped store: nested frames owned through children. */
const legacyStore = (): CellStore => {
  const mindFrame: FrameCell = {
    ...createFrameCell('mind-frame'),
    name: '调研脑图',
    aspectRatio: '16:9',
    locked: true,
    hidden: true,
    ports: [{ id: 'p1', direction: 'both', side: 'right' } as PortSpec],
    geometry: { x: 100, y: 50, width: 400, height: 300 },
  };
  const wfFrame = createFrameCell('wf-frame', {
    x: 600,
    y: 80,
    width: 300,
    height: 200,
  });
  const mindRoot: NodeCell<MindRootData> = {
    id: 'mr1',
    kind: 'mind-root',
    cellType: 'node',
    geometry: { x: 0, y: 0, width: 120, height: 40 },
    data: { embeddedOffset: [40, 30] },
  };
  const mindChild = { ...node('mc1', 'mind-child') };
  const branch: EdgeCell = {
    id: 'b1',
    kind: 'mind-branch',
    cellType: 'edge',
    source: { cellId: 'mr1' },
    target: { cellId: 'mc1' },
    route: { mode: 'auto' },
    data: { order: 'a' },
  };
  const start: NodeCell = {
    id: 'ws1',
    kind: 'workflow-start',
    cellType: 'node',
    geometry: { x: 0, y: 0, width: 80, height: 40 },
    data: { graphMode: 'dag', origin: [0, 0], memberIds: ['t1'] },
  };
  const task = node('t1', 'workflow-task');
  const rect = node('r1');
  const arrow: EdgeCell = {
    id: 'e1',
    kind: 'arrow',
    cellType: 'edge',
    source: { cellId: 'r1' },
    target: { cellId: 'mind-frame', portId: 'p1' },
    route: { mode: 'auto' },
  };
  const group: GroupCell = {
    id: 'g1',
    kind: 'group',
    cellType: 'group',
    members: ['mind-frame', 'wf-frame'],
  };
  return applyCellOperations(createCellStore(createFrameCell('board')), [
    { type: 'insert_cell', cell: mindFrame, parentId: 'board' },
    { type: 'insert_cell', cell: wfFrame, parentId: 'board' },
    { type: 'insert_cell', cell: rect, parentId: 'board' },
    { type: 'insert_cell', cell: arrow, parentId: 'board' },
    { type: 'insert_cell', cell: group, parentId: 'board' },
    { type: 'insert_cell', cell: mindRoot, parentId: 'mind-frame' },
    { type: 'insert_cell', cell: mindChild, parentId: 'mind-frame' },
    { type: 'insert_cell', cell: branch, parentId: 'mind-frame' },
    { type: 'insert_cell', cell: start, parentId: 'wf-frame' },
    { type: 'insert_cell', cell: task, parentId: 'wf-frame' },
  ]);
};

const refIdsOf = (store: CellStore) =>
  Object.values(store.cells)
    .filter(isFrameReferenceCell)
    .map((cell) => cell.id);

const fileOf = (
  rootId: string,
  cells: Record<string, Cell>,
  children?: string[],
): FrameFileV2 => {
  const frame = createFrameCell(rootId);
  frame.children = children ?? Object.keys(cells);
  frame.groups = Object.values(cells)
    .filter((cell) => cell.cellType === 'group')
    .map((cell) => cell.id);
  return { format: 'verd-frame', version: 2, frame, cells };
};

describe('externalizeOwnedFrames', () => {
  it('ignores obsolete presentation data when externalizing frames', () => {
    const store = legacyStore();
    const obsolete = { pages: [{ anchor: { memberIds: ['mind-frame'] } }] };
    Object.assign(store.cells[store.rootId], { presentation: obsolete });
    const { store: next, references } = externalizeOwnedFrames(store);
    expect(references.get('mind-frame')).toBeTruthy();
    expect(next.cells[store.rootId]).toHaveProperty('presentation', obsolete);
    expect(store.cells[store.rootId]).toHaveProperty('presentation', obsolete);
  });

  it('splits owned frames into roots plus reference instances', () => {
    const { store, references } = externalizeOwnedFrames(legacyStore());
    expect(references.get('mind-frame')).toBe(
      `${MIGRATION_REFERENCE_PREFIX}mind-frame`,
    );
    expect(references.get('wf-frame')).toBe(
      `${MIGRATION_REFERENCE_PREFIX}wf-frame`,
    );
    const ref = store.cells[`${MIGRATION_REFERENCE_PREFIX}mind-frame`];
    expect(isFrameReferenceCell(ref)).toBe(true);
    if (!isFrameReferenceCell(ref)) throw new Error('unreachable');
    expect(ref.data.targetFrameId).toBe('mind-frame');
    expect(ref.geometry).toEqual({ x: 100, y: 50, width: 400, height: 300 });
    expect(ref.name).toBe('调研脑图');
    expect(ref.aspectRatio).toBe('16:9');
    expect(ref.locked).toBe(true);
    expect(ref.hidden).toBe(true);
    expect(ref.ports).toEqual([{ id: 'p1', direction: 'both', side: 'right' }]);
    expect(ref.data.mindOffsets).toEqual({ mr1: [40, 30] });
  });

  it('rewrites parent children, group members and edge endpoints', () => {
    const { store } = externalizeOwnedFrames(legacyStore());
    const board = store.cells['board'] as FrameCell;
    expect(board.children).toEqual([
      `${MIGRATION_REFERENCE_PREFIX}mind-frame`,
      `${MIGRATION_REFERENCE_PREFIX}wf-frame`,
      'r1',
      'e1',
    ]);
    const arrow = store.cells['e1'] as EdgeCell;
    expect(arrow.target).toEqual({
      cellId: `${MIGRATION_REFERENCE_PREFIX}mind-frame`,
      portId: 'p1',
    });
    const group = store.cells['g1'] as GroupCell;
    expect(group.members).toEqual([
      `${MIGRATION_REFERENCE_PREFIX}mind-frame`,
      `${MIGRATION_REFERENCE_PREFIX}wf-frame`,
    ]);
  });

  it('promotes roots without shell flags and strips embedded mind offsets', () => {
    const { store } = externalizeOwnedFrames(legacyStore());
    const mind = store.cells['mind-frame'] as FrameCell;
    expect(isFrameCell(mind)).toBe(true);
    expect(mind.locked).toBeUndefined();
    expect(mind.hidden).toBeUndefined();
    expect(mind.ports).toBeUndefined();
    expect(mind.name).toBe('调研脑图');
    expect(mind.children).toEqual(['mr1', 'mc1', 'b1']);
    const root = store.cells['mr1'] as NodeCell<MindRootData>;
    expect(root.data?.embeddedOffset).toBeUndefined();
    expect(root.data).toBeUndefined();
  });

  it('leaves every frame parentless and the store valid', () => {
    const { store } = externalizeOwnedFrames(legacyStore());
    Object.values(store.cells)
      .filter(isFrameCell)
      .forEach((frame) => {
        const owned = Object.values(store.cells).some(
          (parent) =>
            isFrameCell(parent) &&
            [...parent.children, ...parent.groups].includes(frame.id),
        );
        expect(owned).toBe(false);
      });
    expect(validateCellStore(store)).toEqual([]);
  });

  it('is deterministic and idempotent', () => {
    const first = externalizeOwnedFrames(legacyStore());
    const second = externalizeOwnedFrames(legacyStore());
    expect([...second.references.entries()]).toEqual([
      ...first.references.entries(),
    ]);
    expect(second.store).toEqual(first.store);
    const again = externalizeOwnedFrames(first.store);
    expect(again.references.size).toBe(0);
    expect(again.store).toBe(first.store);
  });
});

describe('partitionCellStore', () => {
  it('emits one valid v2 file per frame', () => {
    const { files } = partitionCellStore(legacyStore());
    expect(files.map((file) => file.frame.id).sort()).toEqual([
      'board',
      'mind-frame',
      'wf-frame',
    ]);
    files.forEach((file) => expect(isFrameFileV2(file)).toBe(true));
    const board = files.find((file) => file.frame.id === 'board')!;
    expect(board.frame.children).toEqual([
      `${MIGRATION_REFERENCE_PREFIX}mind-frame`,
      `${MIGRATION_REFERENCE_PREFIX}wf-frame`,
      'r1',
      'e1',
    ]);
    expect(Object.keys(board.cells).sort()).toEqual([
      'e1',
      `${MIGRATION_REFERENCE_PREFIX}mind-frame`,
      `${MIGRATION_REFERENCE_PREFIX}wf-frame`,
      'g1',
      'r1',
    ]);
    const mind = files.find((file) => file.frame.id === 'mind-frame')!;
    expect(Object.keys(mind.cells).sort()).toEqual(['b1', 'mc1', 'mr1']);
    expect(validateFrameFiles(files)).toEqual([]);
  });
});

describe('assembleWorkspaceStore', () => {
  it('rebuilds the canonical store under a dedicated empty root', () => {
    const { files } = partitionCellStore(legacyStore());
    const { store, diagnostics } = assembleWorkspaceStore(files);
    expect(diagnostics).toEqual([]);
    expect(store.rootId).toBe(WORKSPACE_ROOT_ID);
    const root = store.cells[WORKSPACE_ROOT_ID] as FrameCell;
    expect(root.children.sort()).toEqual(
      files.map((file) => file.frame.id).sort(),
    );
    Object.entries(store.cells).forEach(([id, cell]) => {
      if (id === WORKSPACE_ROOT_ID) return;
      expect(cell.id).toBe(id);
    });
    expect(validateCellStore(store)).toEqual([]);
  });

  it('round-trips file contents losslessly', () => {
    const flat = externalizeOwnedFrames(legacyStore()).store;
    const { files } = partitionCellStore(legacyStore());
    const { store } = assembleWorkspaceStore(files);
    Object.entries(flat.cells).forEach(([id, cell]) => {
      expect(store.cells[id]).toEqual(cell);
    });
  });
});

describe('frame reference graph and validation', () => {
  const ref = (id: string, target: string) =>
    createFrameReferenceCell(id, target, {
      x: 0,
      y: 0,
      width: 100,
      height: 80,
    });

  it('tracks repeated and cross-file references to one target', () => {
    const files = [
      fileOf('a', {
        ra1: ref('ra1', 'x'),
        ra2: ref('ra2', 'x'),
      }),
      fileOf('b', { rb1: ref('rb1', 'x') }),
      fileOf('x', { xn: node('xn') }),
    ];
    const graph = buildFrameReferenceGraph(files);
    expect(graph.targetsOf.get('a')).toHaveLength(2);
    expect(graph.targetsOf.get('b')).toHaveLength(1);
    expect(graph.referencedBy.get('x')).toHaveLength(3);
    expect(findFrameReferenceCycles(graph)).toEqual([]);
    expect(validateFrameFiles(files)).toEqual([]);
  });

  it('deleting one instance keeps the target file and other instances', () => {
    const files = [
      fileOf('a', {
        ra1: ref('ra1', 'x'),
        ra2: ref('ra2', 'x'),
      }),
      fileOf('x', { xn: node('xn') }),
    ];
    const { store, diagnostics } = assembleWorkspaceStore(files);
    expect(diagnostics).toEqual([]);
    const next = applyCellOperations(store, deleteCells(store, ['ra2']));
    const a = next.cells['a'] as FrameCell;
    expect(a.children).toEqual(['ra1']);
    expect(next.cells['x']).toBeDefined();
    expect(next.cells['xn']).toBeDefined();
    expect(next.cells['ra1']).toBeDefined();
    expect(validateCellStore(next)).toEqual([]);
  });

  it('reports file-level reference cycles including self references', () => {
    const files = [
      fileOf('ca', { r1: ref('r1', 'cb') }),
      fileOf('cb', { r2: ref('r2', 'ca') }),
      fileOf('sc', { r3: ref('r3', 'sc') }),
    ];
    const cycles = findFrameReferenceCycles(buildFrameReferenceGraph(files));
    expect(cycles).toContainEqual(['ca', 'cb', 'ca']);
    expect(cycles).toContainEqual(['sc', 'sc']);
    const messages = validateFrameFiles(files).map((d) => d.message);
    expect(messages.some((m) => m.includes('cycle'))).toBe(true);
  });

  it('allows unresolved targets but rejects targets that are not file roots', () => {
    const files = [
      fileOf('m', { rm: ref('rm', 'ghost') }),
      fileOf('n', { rn: ref('rn', 'leaf'), leaf: node('leaf') }),
    ];
    const diagnostics = validateFrameFiles(files);
    expect(diagnostics.filter((d) => d.message.includes('ghost'))).toEqual([]);
    expect(diagnostics.some((d) => d.message.includes('not a file root'))).toBe(
      true,
    );
  });

  it('reports duplicate identities and invalid files as diagnostics', () => {
    const files = [
      fileOf('a', { shared: node('shared') }),
      fileOf('b', { shared: node('shared') }),
      fileOf('a', {}),
      { format: 'verd-frame', version: 1 } as unknown as FrameFileV2,
    ];
    const messages = validateFrameFiles(files).map((d) => d.message);
    expect(messages.some((m) => m.includes('Duplicate cell id'))).toBe(true);
    expect(messages.some((m) => m.includes('Duplicate frame root'))).toBe(true);
    expect(messages.some((m) => m.includes('Invalid frame file'))).toBe(true);
    const { diagnostics } = assembleFrameFiles(files);
    expect(diagnostics.length).toBeGreaterThanOrEqual(3);
  });
});

describe('frame-reference cells', () => {
  it('validates data shape without requiring the target to exist', () => {
    const base = createCellStore(createFrameCell('root'));
    const valid = createFrameReferenceCell('ok', 'missing-target', {
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });
    const store = applyCellOperations(base, [
      { type: 'insert_cell', cell: valid, parentId: 'root' },
    ]);
    expect(validateCellStore(store)).toEqual([]);
    const bad: Cell = {
      ...valid,
      id: 'bad',
      geometry: { ...valid.geometry, rotation: 0.5 },
      data: {
        targetFrameId: '',
        mindOffsets: { m: [Number.NaN, 0] } as never,
      },
    };
    const issues = validateCellStore({
      rootId: 'root',
      cells: { ...store.cells, bad },
    });
    const messages = issues.map((issue) => issue.message);
    expect(messages).toContain('Frame reference requires a target');
    expect(messages).toContain('Invalid mind offsets');
    expect(messages).toContain('Frame references cannot rotate');
  });

  it('grants frame-like shell capabilities and registers by default', () => {
    const util = new FrameReferenceUtil();
    const store = createCellStore(createFrameCell('root'));
    const cell = createFrameReferenceCell('ref', 'target', {
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });
    expect(util.capabilities(store, cell, 'root')).toEqual({
      move: true,
      resize: true,
      rotate: false,
      delete: true,
      edit: true,
      connect: false,
    });
    const runtime = createCellRuntime({ store }, createCellRegistry());
    expect(runtime.registry.get('frame-reference')).toBeDefined();
  });

  it('is a node for grouping and deletion but keeps shell identity', () => {
    const ref = createFrameReferenceCell('ref', 'target', {
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });
    expect(isFrameReferenceCell(ref)).toBe(true);
    expect(isFrameCell(ref)).toBe(false);
    expect(ref.cellType).toBe('node');
  });
});

describe('frameFileFor', () => {
  it('rejects non-frame roots', () => {
    const store = applyCellOperations(
      createCellStore(createFrameCell('root')),
      [{ type: 'insert_cell', cell: node('n'), parentId: 'root' }],
    );
    expect(() => frameFileFor(store, 'n')).toThrow('must be a frame');
  });
});

const refFile = (id: string, refs: Record<string, string>): FrameFileV2 => ({
  format: 'verd-frame',
  version: 2,
  frame: {
    ...createFrameCell(id),
    children: Object.keys(refs),
  },
  cells: Object.fromEntries(
    Object.entries(refs).map(([id, targetFrameId]) => [
      id,
      createFrameReferenceCell(id, targetFrameId, {
        x: 0,
        y: 0,
        width: 10,
        height: 10,
      }),
    ]),
  ),
});

describe('frameClosure / duplicateFrameClosure', () => {
  const files = [
    refFile('a', { r1: 'b' }),
    refFile('b', { r2: 'c' }),
    refFile('c', {}),
    refFile('x', {}),
  ];
  let seq = 0;
  const createId = () => `new-${++seq}`;

  it('walks transitive reference targets in order', () => {
    expect(frameClosure(files, 'a')).toEqual(['a', 'b', 'c']);
    expect(frameClosure(files, 'b')).toEqual(['b', 'c']);
    expect(frameClosure(files, 'x')).toEqual(['x']);
  });

  it('duplicates the closure with fresh ids and repointed internal refs', () => {
    seq = 0;
    const { files: clones, rootId } = duplicateFrameClosure(
      files,
      'a',
      createId,
    );
    expect(clones).toHaveLength(3);
    expect(rootId).not.toBe('a');
    const cloneA = clones.find((file) => file.frame.id === rootId)!;
    const cloneARef = Object.values(cloneA.cells)[0];
    expect(isFrameReferenceCell(cloneARef)).toBe(true);
    const cloneBId = (cloneARef as { data: { targetFrameId: string } }).data
      .targetFrameId;
    expect(cloneBId).not.toBe('b');
    const cloneB = clones.find((file) => file.frame.id === cloneBId)!;
    const cloneBRef = Object.values(cloneB.cells)[0];
    const cloneCId = (cloneBRef as { data: { targetFrameId: string } }).data
      .targetFrameId;
    expect(cloneCId).not.toBe('c');
    expect(clones.some((file) => file.frame.id === cloneCId)).toBe(true);
    // Original files untouched.
    expect(files[0].cells['r1']).toMatchObject({
      data: { targetFrameId: 'b' },
    });
  });

  it('keeps references to unresolved targets dangling identically', () => {
    seq = 0;
    // A reference whose target file is absent has nothing to clone — the
    // clone keeps the same target id and stays an unresolved placeholder.
    const withGhost = [...files.slice(0, 1)];
    withGhost[0] = refFile('a', { r1: 'b', r3: 'ghost' });
    const source = [...withGhost, ...files.slice(1)];
    const { files: clones, rootId } = duplicateFrameClosure(
      source,
      'a',
      createId,
    );
    const cloneA = clones.find((file) => file.frame.id === rootId)!;
    const targets = Object.values(cloneA.cells).map(
      (cell) =>
        (cell as { data: { targetFrameId: string } }).data.targetFrameId,
    );
    expect(targets).toContain('ghost');
  });
});

describe('remapImportedFiles / frameExportBundle', () => {
  it('remaps only colliding ids', () => {
    const imported = refFile('a', { r1: 'external' });
    const remapped = remapImportedFiles(
      [imported],
      (id) => id === 'a',
      () => 'fresh',
    );
    expect(remapped[0].frame.id).toBe('fresh');
    const ref = Object.values(remapped[0].cells)[0] as {
      data: { targetFrameId: string };
    };
    expect(ref.data.targetFrameId).toBe('external');
  });

  it('accepts obsolete presentation data without interpreting or remapping it', () => {
    const obsolete = { pages: [{ anchor: { memberIds: ['box'] } }] };
    const frame = Object.assign(createFrameCell('root'), {
      children: ['box'],
      presentation: obsolete,
    });
    const file: FrameFileV2 = {
      format: 'verd-frame',
      version: 2,
      frame,
      cells: { box: node('box') },
    };
    const parsed = parseFrameExport(JSON.parse(JSON.stringify(file)));
    expect(parsed).toHaveLength(1);
    expect(parsed?.[0].frame).toHaveProperty('presentation', obsolete);
    let n = 0;
    const remapped = remapImportedFiles(
      parsed!,
      (id) => id === 'box' || id === 'root',
      () => `new-${n++}`,
    );
    expect(remapped[0].frame.children).toEqual(['new-1']);
    expect(remapped[0].frame).toHaveProperty('presentation', obsolete);
    const duplicated = duplicateFrameClosure(
      parsed!,
      'root',
      () => `dup-${n++}`,
    );
    expect(duplicated.files[0].frame.children).not.toContain('box');
    expect(duplicated.files[0].frame).toHaveProperty('presentation', obsolete);
    expect(frame.presentation).toEqual(obsolete);
  });

  it('round-trips a bundle and accepts a bare file', () => {
    const file = refFile('a', { r1: 'b' });
    const bundle = frameExportBundle([file]);
    const parsed = parseFrameExport(JSON.parse(JSON.stringify(bundle)));
    expect(parsed).toHaveLength(1);
    expect(parsed?.[0].frame.id).toBe('a');
    expect(parseFrameExport(file)?.[0].frame.id).toBe('a');
    expect(parseFrameExport({ format: 'other' })).toBeNull();
  });
});
