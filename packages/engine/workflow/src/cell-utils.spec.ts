import { describe, expect, it } from 'vitest';
import {
  copyCellFragment,
  createCellRuntime,
  createCellRegistry,
  planCellPaste,
  type EdgeCell,
  type NodeCell,
  type WorkflowStartData,
} from '@sue/board-core';
import { registerWorkflowCells } from './cell-utils';
import {
  createWorkflowFrameSnapshot,
  createWorkflowTaskCell,
  addWorkflowTask,
  createWorkflowStartCell,
  autoLayoutWorkflow,
  canAutoLayoutWorkflow,
  layoutWorkflowCells,
} from './cell-commands';
const runtime = () => {
  const registry = createCellRegistry();
  registerWorkflowCells(registry);
  const result = createCellRuntime(
    createWorkflowFrameSnapshot('frame', 'start'),
    registry,
  );
  for (const id of ['a', 'b'])
    result.transact({
      id,
      operations: addWorkflowTask(
        result.store,
        'start',
        createWorkflowTaskCell(id),
      ),
    });
  return result;
};
const edge = (id: string, source: string, target: string): EdgeCell => ({
  id,
  kind: 'workflow-edge',
  cellType: 'edge',
  source: { cellId: source, portId: 'right' },
  target: { cellId: target, portId: 'left' },
  route: { mode: 'auto' },
});
describe('native workflow rules', () => {
  it('anchors disconnected DAG components to the fixed start regardless of id sorting', () => {
    const registry = createCellRegistry();
    registerWorkflowCells(registry);
    const r = createCellRuntime(
      createWorkflowFrameSnapshot('frame', 'z-start'),
      registry,
    );
    for (const id of ['a-task', 'b-task'])
      r.transact({
        id,
        operations: addWorkflowTask(
          r.store,
          'z-start',
          createWorkflowTaskCell(id),
        ),
      });
    r.transact({
      id: 'legacy-derived',
      operations: ['a-task', 'b-task'].map((id) => {
        const cell = r.store.cells[id] as NodeCell;
        return {
          type: 'replace_cell' as const,
          cell: { ...cell, geometry: { ...cell.geometry, derived: true } },
        };
      }),
    });
    r.transact({
      id: 'connect',
      operations: [
        {
          type: 'insert_cell',
          parentId: 'frame',
          cell: edge('ab', 'a-task', 'b-task'),
        },
      ],
    });
    const start = r.store.cells['z-start'] as NodeCell;
    const layout = layoutWorkflowCells(r.store, 'frame');
    for (const id of ['a-task', 'b-task']) {
      const bounds = layout.get(id)!;
      expect(
        bounds.x + bounds.width <= start.geometry.x ||
          bounds.x >= start.geometry.x + start.geometry.width ||
          bounds.y + bounds.height <= start.geometry.y ||
          bounds.y >= start.geometry.y + start.geometry.height,
      ).toBe(true);
    }
    const before = structuredClone(r.store);
    r.transact({
      id: 'auto',
      operations: autoLayoutWorkflow(r.store, 'z-start'),
    });
    for (const id of ['a-task', 'b-task'])
      expect((r.store.cells[id] as NodeCell).geometry).toMatchObject({
        ...layout.get(id),
        derived: false,
      });
    r.undo();
    expect(r.store).toEqual(before);
  });
  it('moves the graph origin and fixed members with its start in one reversible transaction', () => {
    const r = runtime();
    const a = r.store.cells.a as NodeCell;
    r.transact({
      id: 'position',
      operations: [
        {
          type: 'replace_cell',
          cell: {
            ...a,
            geometry: { ...a.geometry, x: 400, y: 200, derived: false },
          },
        },
      ],
    });
    const b = r.store.cells.b as NodeCell;
    r.transact({
      id: 'legacy-derived',
      operations: [
        {
          type: 'replace_cell',
          cell: { ...b, geometry: { ...b.geometry, derived: true } },
        },
      ],
    });
    const before = structuredClone(r.store);
    const start = r.store.cells.start as NodeCell;
    const derived = layoutWorkflowCells(r.store, 'frame').get('b')!;
    r.transact({
      id: 'move',
      operations: r.registry.get('workflow-start')!.move!(r.store, start, {
        ...start.geometry,
        x: 140,
        y: 130,
      }),
    });
    expect(
      (r.store.cells.start as NodeCell<WorkflowStartData>).data!.origin,
    ).toEqual([140, 130]);
    expect((r.store.cells.a as NodeCell).geometry).toMatchObject({
      x: 500,
      y: 250,
    });
    expect(layoutWorkflowCells(r.store, 'frame').get('b')).toMatchObject({
      x: derived.x + 100,
      y: derived.y + 50,
    });
    r.undo();
    expect(r.store).toEqual(before);
    r.redo();
    expect((r.store.cells.a as NodeCell).geometry).toMatchObject({
      x: 500,
      y: 250,
    });
  });

  it('auto layouts one graph, preserves its start, restores manual positions on undo and rejects process cycles', () => {
    const r = runtime();
    r.transact({
      id: 'other',
      operations: [
        {
          type: 'insert_cell',
          parentId: 'frame',
          cell: createWorkflowStartCell('other', [800, 400]),
        },
      ],
    });
    r.transact({
      id: 'other-task',
      operations: addWorkflowTask(
        r.store,
        'other',
        createWorkflowTaskCell('c'),
      ),
    });
    const a = r.store.cells.a as NodeCell;
    r.transact({
      id: 'manual',
      operations: [
        {
          type: 'replace_cell',
          cell: {
            ...a,
            geometry: { ...a.geometry, x: 999, y: 999, derived: false },
          },
        },
        { type: 'insert_cell', parentId: 'frame', cell: edge('ab', 'a', 'b') },
      ],
    });
    const before = structuredClone(r.store);
    r.transact({
      id: 'layout',
      operations: autoLayoutWorkflow(r.store, 'start'),
    });
    expect((r.store.cells.a as NodeCell).geometry).not.toMatchObject({
      x: 999,
      y: 999,
    });
    expect(r.store.cells.other).toEqual(before.cells.other);
    expect(r.store.cells.c).toEqual(before.cells.c);
    expect((r.store.cells.start as NodeCell).geometry).toMatchObject({
      x: 40,
      y: 80,
    });
    r.undo();
    expect(r.store).toEqual(before);
    const start = r.store.cells.start as NodeCell<WorkflowStartData>;
    r.transact({
      id: 'cycle',
      operations: [
        {
          type: 'replace_cell',
          cell: { ...start, data: { ...start.data!, graphMode: 'process' } },
        },
        { type: 'insert_cell', parentId: 'frame', cell: edge('ba', 'b', 'a') },
      ],
    });
    expect(canAutoLayoutWorkflow(r.store, 'start')).toBe(false);
    expect(() => autoLayoutWorkflow(r.store, 'start')).toThrow('cyclic');
  });
  it('protects starts and rejects incoming start edges', () => {
    const r = runtime();
    expect(() =>
      r.transact({
        id: 'delete',
        operations: [{ type: 'remove_cell', cellId: 'start' }],
      }),
    ).toThrow('start');
    expect(() =>
      r.transact({
        id: 'connect',
        operations: [
          {
            type: 'insert_cell',
            parentId: 'frame',
            cell: edge('bad', 'a', 'start'),
          },
        ],
      }),
    ).toThrow('start');
  });
  it('rejects DAG cycles atomically and accepts process cycles', () => {
    const r = runtime();
    r.transact({
      id: 'ab',
      operations: [
        { type: 'insert_cell', parentId: 'frame', cell: edge('ab', 'a', 'b') },
      ],
    });
    expect(() =>
      r.transact({
        id: 'ba',
        operations: [
          {
            type: 'insert_cell',
            parentId: 'frame',
            cell: edge('ba', 'b', 'a'),
          },
        ],
      }),
    ).toThrow('Cycle');
    expect(r.store.cells.ba).toBeUndefined();
    const start = r.store.cells.start as NodeCell<WorkflowStartData>;
    r.transact({
      id: 'process',
      operations: [
        {
          type: 'replace_cell',
          cell: { ...start, data: { ...start.data!, graphMode: 'process' } },
        },
        { type: 'insert_cell', parentId: 'frame', cell: edge('ba', 'b', 'a') },
      ],
    });
    expect(r.store.cells.ba).toBeTruthy();
  });
  it('reports malformed workflow data without throwing', () => {
    const registry = createCellRegistry();
    registerWorkflowCells(registry);
    const base = createWorkflowFrameSnapshot('frame', 'start');
    const start = base.store.cells.start as NodeCell<WorkflowStartData>;
    const cases: unknown[] = [
      { ...start.data, origin: [1] },
      { ...start.data, origin: ['0', '1'] },
      { ...start.data, origin: [Number.NaN, 0] },
      { ...start.data, origin: [Number.POSITIVE_INFINITY, 0] },
      { ...start.data, memberIds: 'start' },
      { ...start.data, memberIds: ['start', 'start'] },
      { graphMode: 'dag', origin: [0, -1.5] },
    ];
    for (const data of cases) {
      const store = {
        ...base.store,
        cells: {
          ...base.store.cells,
          start: { ...start, data },
        },
      };
      expect(() => registry.validate(store, store.cells.start)).not.toThrow();
      expect(registry.validate(store, store.cells.start)).toEqual(
        expect.any(String),
      );
    }
    const zero = {
      ...base.store,
      cells: {
        ...base.store.cells,
        start: { ...start, data: { ...start.data, origin: [0, -2.5] } },
      },
    };
    expect(registry.validate(zero, zero.cells.start)).toBeUndefined();
  });
  it('pastes a standalone task only into an explicit start and offsets a complete graph together', () => {
    const registry = createCellRegistry();
    registerWorkflowCells(registry);
    const runtime = createCellRuntime(
      createWorkflowFrameSnapshot('frame', 'start'),
      registry,
    );
    const task = createWorkflowTaskCell('task');
    const alone = {
      cells: { task },
      ids: ['task'],
    };
    expect(() =>
      planCellPaste({
        store: runtime.store,
        frameId: 'frame',
        selectionIds: [],
        fragment: alone,
        allocateId: (id) => `n-${id}`,
        registry,
        intent: 'paste',
      }),
    ).toThrow('Select a target first');
    expect(runtime.store.cells.task).toBeUndefined();
    const planned = planCellPaste({
      store: runtime.store,
      frameId: 'frame',
      selectionIds: ['start'],
      fragment: alone,
      allocateId: (id) => `n-${id}`,
      offset: [12, 4],
      geometry: new Map([['task', { ...task.geometry, x: 80, y: 90 }]]),
      registry,
      intent: 'paste',
    });
    runtime.transact({ id: 'paste-task', operations: planned.operations });
    expect(
      (runtime.store.cells.start as NodeCell<WorkflowStartData>).data!
        .memberIds,
    ).toContain('n-task');
    expect(runtime.store.cells['n-task']).toMatchObject({
      geometry: { x: 92, y: 94, derived: false },
    });
    runtime.transact({
      id: 'route',
      operations: [
        {
          type: 'insert_cell',
          parentId: 'frame',
          cell: {
            ...edge('link', 'start', 'n-task'),
            route: {
              mode: 'fixed',
              points: [
                [1, 2],
                [3, 4],
              ],
            },
          },
        },
      ],
    });
    const whole = copyCellFragment(runtime.store, ['start']);
    const graph = planCellPaste({
      store: runtime.store,
      frameId: 'frame',
      selectionIds: [],
      fragment: whole,
      allocateId: (id) => `g-${id}`,
      offset: [30, 10],
      registry,
      intent: 'paste',
    });
    const before = runtime.store;
    runtime.transact({ id: 'paste-graph', operations: graph.operations });
    const copied = runtime.store.cells[
      'g-start'
    ] as NodeCell<WorkflowStartData>;
    const source = before.cells.start as NodeCell<WorkflowStartData>;
    expect(copied.geometry.x).toBe(source.geometry.x + 30);
    expect(copied.data!.origin).toEqual([
      source.data!.origin[0] + 30,
      source.data!.origin[1] + 10,
    ]);
    expect(runtime.store.cells['g-link']).toMatchObject({
      route: {
        mode: 'fixed',
        points: [
          [31, 12],
          [33, 14],
        ],
      },
    });
    const snapshot = runtime.store;
    expect(() =>
      planCellPaste({
        store: runtime.store,
        frameId: 'frame',
        selectionIds: ['start'],
        fragment: {
          cells: {
            a: createWorkflowTaskCell('a'),
            b: createWorkflowTaskCell('b'),
            ab: edge('ab', 'a', 'b'),
            ba: edge('ba', 'b', 'a'),
          },
          ids: ['a', 'b', 'ab', 'ba'],
        },
        allocateId: (id) => `c-${id}`,
        registry,
        intent: 'paste',
      }),
    ).toThrow('Cycle');
    expect(runtime.store).toBe(snapshot);
    expect(runtime.store.cells['c-a']).toBeUndefined();
  });
});
