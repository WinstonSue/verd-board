import { describe, it, expect } from 'vitest';
import { createTestCellRegistry } from '../../fixtures/plugins/registry';
import layered from '../../fixtures/diagrams/architecture-layered.json';
import {
  createWorkflowFrameSnapshot,
  createWorkflowTaskCell,
  addWorkflowTask,
  autoLayoutWorkflow,
  canAutoLayoutWorkflow,
} from '../../../packages/engine/workflow/src/public-api';
import { applyCellOperations } from '../../../packages/engine/core/src/cell/index';
import { planGeometryLayout } from '../../../packages/engine/core/src/cell/layout-plan';
import {
  isEdgeCell,
  type CellStore,
  type NodeCell,
  type EdgeCell,
} from '../../../packages/engine/core/src/cell/types';
import {
  createMindFrameSnapshot,
  layoutMindCells,
} from '../../../packages/engine/mind/src/public-api';
import {
  addUmlCell,
  createUmlClassFrameSnapshot,
  createUmlClassCell,
  createUmlRelationCell,
  createUmlSequenceFrameSnapshot,
  createUmlParticipantCell,
  createUmlMessageCell,
  layoutUmlSequence,
} from '../../../packages/engine/uml/src/public-api';
import { optimizableEdgeIds } from '../../../packages/engine/core/src/cell/layout-plan';
import { createSwimlaneCell } from '../../../packages/engine/draw/src/cell-table';
import {
  frameLanes,
  laneContains,
} from '../../../packages/engine/core/src/cell/lanes';
const registry = createTestCellRegistry();
const edge = (id: string, a: string, b: string): EdgeCell => ({
  id,
  kind: 'arrow',
  cellType: 'edge',
  source: { cellId: a, portId: 'out' },
  target: { cellId: b, portId: 'in' },
  route: { mode: 'auto' },
});
describe('joint domain geometry planning', () => {
  it('keeps a locked architecture layer and all of its members fixed during joint layout', () => {
    const initial = structuredClone(layered.store) as CellStore;
    let store = applyCellOperations(
      initial,
      planGeometryLayout(
        initial,
        { focus: [initial.rootId, 'diagram'], ids: [] },
        'layers',
        registry,
      ).operations,
      registry,
    );
    const layer = Object.values(store.cells).find(
      (cell) => cell.kind === 'architecture-layer',
    ) as NodeCell<{ memberIds: string[] }>;
    store = applyCellOperations(
      store,
      [{ type: 'replace_cell', cell: { ...layer, locked: true } }],
      registry,
    );
    const plan = planGeometryLayout(
      store,
      { focus: [store.rootId, 'diagram'], ids: [] },
      'layers',
      registry,
    );
    expect(plan.diagnostics).toEqual([]);
    const next = applyCellOperations(store, plan.operations, registry);
    for (const id of [layer.id, ...layer.data!.memberIds])
      expect(next.cells[id]).toEqual(store.cells[id]);
  });
  it('grows unlocked in-scope swimlanes and reports a locked container without moving it', () => {
    let store = createWorkflowFrameSnapshot('root', 'start').store;
    for (const id of ['a', 'b'])
      store = applyCellOperations(
        store,
        addWorkflowTask(store, 'start', createWorkflowTaskCell(id)),
        registry,
      );
    const lane = createSwimlaneCell(
      'lane',
      [
        [0, 0],
        [300, 150],
      ],
      'horizontal',
      false,
      1,
    );
    lane.data = { ...lane.data!, laneMembers: { 'lane-lane0': ['a', 'b'] } };
    const moves = ['a', 'b'].map((id) => ({
      type: 'replace_cell' as const,
      cell: {
        ...store.cells[id],
        geometry: { ...(store.cells[id] as NodeCell).geometry, x: 50, y: 10 },
      } as NodeCell,
    }));
    store = applyCellOperations(
      store,
      [...moves, { type: 'insert_cell', parentId: 'root', cell: lane }],
      registry,
    );
    const plan = planGeometryLayout(
      store,
      { focus: ['root'], ids: [] },
      'domain',
      registry,
    );
    expect(plan.diagnostics).toEqual([]);
    const next = applyCellOperations(store, plan.operations, registry);
    expect((next.cells.lane as NodeCell).geometry.width).toBeGreaterThan(
      lane.geometry.width,
    );
    for (const track of frameLanes(next, 'root', registry))
      for (const id of track.members)
        expect(
          laneContains(track.bounds, (next.cells[id] as NodeCell).geometry),
        ).toBe(true);
    const locked = applyCellOperations(
      store,
      [{ type: 'replace_cell', cell: { ...lane, locked: true } }],
      registry,
    );
    const blocked = planGeometryLayout(
      locked,
      { focus: ['root'], ids: [] },
      'domain',
      registry,
    );
    expect(blocked.status).toBe('blocked');
    expect(blocked.operations).toEqual([]);
    expect(blocked.diagnostics[0].message).toContain(
      'Fixed or out-of-scope swimlane',
    );
  });
  it('keeps Mind and sequence projections under domain ownership, including core routing exclusion', () => {
    const mind = createMindFrameSnapshot('root', 'm').store;
    const before = layoutMindCells(mind, 'root');
    expect(
      planGeometryLayout(mind, { focus: ['root'], ids: [] }, 'domain', registry)
        .operations,
    ).toEqual([]);
    expect(layoutMindCells(mind, 'root')).toEqual(before);
    expect(
      planGeometryLayout(mind, { focus: ['root'], ids: [] }, 'grid', registry)
        .diagnostics[0]?.code,
    ).toBe('geometry.domain-managed');
    let sequence = createUmlSequenceFrameSnapshot('root', 's').store;
    for (const cell of [
      createUmlParticipantCell('a'),
      createUmlParticipantCell('b'),
      createUmlMessageCell('call', 'a', 'b'),
    ])
      sequence = applyCellOperations(
        sequence,
        addUmlCell(sequence, 'root', cell),
        registry,
      );
    const layout = layoutUmlSequence(sequence, 'root');
    expect(optimizableEdgeIds(sequence, ['call'], registry)).toEqual([]);
    expect(
      planGeometryLayout(
        sequence,
        { focus: ['root'], ids: [] },
        'grid',
        registry,
      ).diagnostics[0].code,
    ).toBe('geometry.domain-managed');
    expect(
      planGeometryLayout(
        sequence,
        { focus: ['root'], ids: [] },
        'domain',
        registry,
      ).operations,
    ).toEqual([]);
    expect(layoutUmlSequence(sequence, 'root')).toBe(layout);
  });
  it('preserves UML relation markers, multiplicity and legal association cycles while ranking inheritance', () => {
    let store = createUmlClassFrameSnapshot('root', 'classes').store;
    for (const cell of [
      createUmlClassCell('base'),
      createUmlClassCell('child'),
      createUmlClassCell('peer'),
      createUmlRelationCell('inherits', 'child', 'base', 'generalization'),
      {
        ...createUmlRelationCell('association', 'child', 'peer'),
        data: {
          relation: 'association',
          sourceMultiplicity: '1',
          targetMultiplicity: '*',
        },
      },
      createUmlRelationCell('return', 'peer', 'child'),
    ])
      store = applyCellOperations(
        store,
        addUmlCell(store, 'root', cell),
        registry,
      );
    const plan = planGeometryLayout(
      store,
      { focus: ['root'], ids: [] },
      'domain',
      registry,
    );
    expect(plan.diagnostics).toEqual([]);
    const next = applyCellOperations(store, plan.operations, registry);
    expect((next.cells.base as NodeCell).geometry.y).toBeLessThan(
      (next.cells.child as NodeCell).geometry.y,
    );
    for (const id of ['inherits', 'association', 'return'])
      expect((next.cells[id] as EdgeCell).data).toEqual(
        (store.cells[id] as EdgeCell).data,
      );
  });
  it('packs independent workflows as separate units without mixing their nodes', () => {
    let store = createWorkflowFrameSnapshot('root', 'first').store;
    const second = createWorkflowFrameSnapshot('other', 'second').store.cells
      .second;
    store = applyCellOperations(
      store,
      [{ type: 'insert_cell', parentId: 'root', cell: second }],
      registry,
    );
    for (const [owner, id] of [
      ['first', 'a'],
      ['second', 'b'],
    ])
      store = applyCellOperations(
        store,
        addWorkflowTask(store, owner, createWorkflowTaskCell(id)),
        registry,
      );
    const plan = planGeometryLayout(
      store,
      { focus: ['root'], ids: [] },
      'domain',
      registry,
    );
    expect(plan.diagnostics).toEqual([]);
    const next = applyCellOperations(store, plan.operations, registry);
    expect((next.cells.first as NodeCell).geometry.y).not.toBe(
      (next.cells.second as NodeCell).geometry.y,
    );
    expect(next.cells.first.data).toEqual(store.cells.first.data);
    expect((next.cells.second as NodeCell).data).toMatchObject({
      memberIds: ['second', 'b'],
    });
  });
  it('lays out cyclic process graphs without losing any edges', () => {
    let store = createWorkflowFrameSnapshot('root', 'start').store;
    store = applyCellOperations(
      store,
      addWorkflowTask(store, 'start', createWorkflowTaskCell('a')),
      registry,
    );
    store = applyCellOperations(
      store,
      addWorkflowTask(store, 'start', createWorkflowTaskCell('b')),
      registry,
    );
    const start = store.cells.start as NodeCell;
    store = applyCellOperations(
      store,
      [
        {
          type: 'replace_cell',
          cell: {
            ...start,
            data: { ...(start.data as object), graphMode: 'process' },
          },
        },
        ...[
          ['sa', 'start', 'a'],
          ['ab', 'a', 'b'],
          ['ba', 'b', 'a'],
        ].map(([id, a, b]) => ({
          type: 'insert_cell' as const,
          parentId: 'root',
          cell: {
            ...edge(id, a, b),
            kind: 'workflow-edge',
            source: { cellId: a, portId: 'right' },
            target: { cellId: b, portId: 'left' },
          },
        })),
      ],
      registry,
    );
    expect(canAutoLayoutWorkflow(store, 'start')).toBe(true);
    const next = applyCellOperations(
      store,
      autoLayoutWorkflow(store, 'start', registry),
      registry,
    );
    expect(['sa', 'ab', 'ba'].every((id) => isEdgeCell(next.cells[id]))).toBe(
      true,
    );
    expect((next.cells.ab as EdgeCell).route.origin).toBe('generated');
  });
});

it('retries an architecture layout with its layer headers and keeps semantic data', () => {
  const store = structuredClone(layered.store) as CellStore;
  const plan = planGeometryLayout(
    store,
    { focus: [store.rootId, 'diagram'], ids: [] },
    'layers',
    registry,
  );
  expect(plan.diagnostics).toEqual([]);
  expect(plan.status).toBe('success');
  const next = applyCellOperations(store, plan.operations, registry);
  for (const cell of Object.values(store.cells).filter(isEdgeCell)) {
    expect((next.cells[cell.id] as EdgeCell).source).toMatchObject(cell.source);
    expect((next.cells[cell.id] as EdgeCell).target).toMatchObject(cell.target);
  }
});
