import { describe, expect, it } from 'vitest';
import {
  applyCellOperations,
  arrangeCells,
  arrangementAvailability,
  copyCellFragment,
  createCellRegistry,
  createCellRuntime,
  deleteCells,
  groupCells,
  planCellPaste,
  translateCellSelection,
  type NodeCell,
  type EdgeCell,
  type WorkflowStartData,
} from '@sue/board-core';
import {
  addWorkflowTask,
  createWorkflowFrameSnapshot,
  createWorkflowStartCell,
  createWorkflowTaskCell,
  layoutWorkflowCells,
  materializeWorkflowPositions,
} from './cell-commands';
import { registerWorkflowCells } from './cell-utils';

const fixture = () => {
  const registry = createCellRegistry();
  registerWorkflowCells(registry);
  const runtime = createCellRuntime(
    createWorkflowFrameSnapshot('frame', 'start'),
    registry,
  );
  for (const id of ['a', 'b', 'c'])
    runtime.transact({
      id,
      operations: addWorkflowTask(
        runtime.store,
        'start',
        createWorkflowTaskCell(id),
      ),
    });
  return runtime;
};
const edge = (id: string, source: string, target: string): EdgeCell => ({
  id,
  kind: 'workflow-edge',
  cellType: 'edge',
  source: { cellId: source, portId: 'right' },
  target: { cellId: target, portId: 'left' },
  route: { mode: 'auto' },
});

describe('workflow arrangement and domain groups', () => {
  it('creates authored nodes without moving existing nodes, and converts old positions exactly once', () => {
    const runtime = fixture();
    expect((runtime.store.cells.a as NodeCell).geometry.derived).toBe(false);
    expect(materializeWorkflowPositions(runtime.store)).toBe(runtime.store);
    const before = runtime.store.cells.a;
    runtime.transact({
      id: 'new',
      operations: addWorkflowTask(
        runtime.store,
        'start',
        createWorkflowTaskCell('new'),
      ),
    });
    expect(runtime.store.cells.a).toEqual(before);
    const legacy = { ...runtime.store, cells: { ...runtime.store.cells } };
    for (const id of ['a', 'b']) {
      const cell = legacy.cells[id] as NodeCell;
      legacy.cells[id] = {
        ...cell,
        geometry: { ...cell.geometry, x: 0, y: 0, derived: true },
      };
    }
    const layout = layoutWorkflowCells(legacy, 'frame');
    const converted = materializeWorkflowPositions(legacy);
    expect((converted.cells.a as NodeCell).geometry).toEqual({
      ...layout.get('a'),
      derived: false,
    });
    expect(converted.cells.new).toEqual(runtime.store.cells.new);
    expect(materializeWorkflowPositions(converted)).toBe(converted);
  });

  it('keeps Group and domain owners independent and rejects a contracted layout cycle', () => {
    const runtime = fixture();
    runtime.transact({
      id: 'edges',
      operations: [edge('ab', 'a', 'b'), edge('bc', 'b', 'c')].map((cell) => ({
        type: 'insert_cell',
        parentId: 'frame',
        cell,
      })),
    });
    runtime.transact({
      id: 'group',
      operations: groupCells(runtime.store, 'frame', ['a', 'c'], 'group'),
    });
    expect(runtime.index.groupOf.get('a')).toBe('group');
    expect(runtime.index.domainOwnerOf.get('a')).toBe('start');
    const state = arrangementAvailability(runtime.store, 'frame', [], {
      type: 'layout',
      style: 'flow',
    });
    expect(state).toMatchObject({ enabled: false });
    expect(state.reason).toContain('cyclic');
    const before = runtime.store.cells.b;
    const dx =
      (runtime.store.cells.c as NodeCell).geometry.x -
      (runtime.store.cells.a as NodeCell).geometry.x;
    runtime.transact({
      id: 'layout',
      operations: arrangeCells(
        runtime.store,
        'frame',
        ['group', 'b'],
        'horizontal',
      ),
    });
    expect(
      (runtime.store.cells.c as NodeCell).geometry.x -
        (runtime.store.cells.a as NodeCell).geometry.x,
    ).toBe(dx);
    expect(runtime.index.domainOwnerOf.get('c')).toBe('start');
    runtime.undo();
    expect(runtime.store.cells.b).toEqual(before);
  });

  it('copies and cuts a cross-flow group without guessing a single owner or losing membership', () => {
    const runtime = fixture();
    runtime.transact({
      id: 'other',
      operations: [
        {
          type: 'insert_cell',
          parentId: 'frame',
          cell: createWorkflowStartCell('other', [700, 400]),
        },
      ],
    });
    runtime.transact({
      id: 'other-task',
      operations: addWorkflowTask(
        runtime.store,
        'other',
        createWorkflowTaskCell('foreign'),
      ),
    });
    runtime.transact({
      id: 'group',
      operations: groupCells(runtime.store, 'frame', ['a', 'foreign'], 'group'),
    });
    const fragment = copyCellFragment(runtime.store, ['group']);
    expect(fragment.source?.ownerById).toEqual({
      a: 'start',
      foreign: 'other',
    });
    const start = runtime.store.cells.start as NodeCell;
    expect(() =>
      runtime.registry.get('workflow-start')!.move!(runtime.store, start, {
        ...start.geometry,
        x: 500,
      }),
    ).toThrow('Ungroup first');
    runtime.transact({
      id: 'cut',
      operations: deleteCells(runtime.store, ['group']),
    });
    const plan = planCellPaste({
      store: runtime.store,
      frameId: 'frame',
      selectionIds: [],
      fragment,
      registry: runtime.registry,
      allocateId: (id) => `copy-${id}`,
    });
    runtime.transact({ id: 'paste', operations: plan.operations });
    expect(runtime.index.domainOwnerOf.get('copy-a')).toBe('start');
    expect(runtime.index.domainOwnerOf.get('copy-foreign')).toBe('other');
    expect(
      (runtime.store.cells.start as NodeCell<WorkflowStartData>).data!
        .memberIds,
    ).toContain('copy-a');
    expect(
      (runtime.store.cells.other as NodeCell<WorkflowStartData>).data!
        .memberIds,
    ).toContain('copy-foreign');
    expect(runtime.index.groupOf.get('copy-a')).toBe('copy-group');
  });

  it('arranges only a selected start without moving other members', () => {
    const runtime = fixture();
    const before = runtime.store.cells.b;
    const start = runtime.store.cells.start as NodeCell;
    const next = applyCellOperations(
      runtime.store,
      translateCellSelection(runtime.store, ['start'], [30, 40]),
      runtime.registry,
    );
    expect(next.cells.b).toEqual(before);
    expect(
      (next.cells.start as NodeCell<WorkflowStartData>).data!.origin,
    ).toEqual([start.geometry.x + 30, start.geometry.y + 40]);
  });
});
