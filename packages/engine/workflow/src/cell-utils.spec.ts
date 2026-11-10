import {
  copyCellFragment,
  createCellRuntime,
  planCellPaste,
  snapTerminal,
  type EdgeCell,
  type NodeCell,
} from '@sue/board-core';
import { describe, expect, it } from 'vitest';
import {
  createTestCellRegistry as createFixtureRegistry,
  createTestCellRegistry,
} from '../../../../tests/fixtures/plugins/registry';
import {
  addWorkflowTask,
  autoLayoutWorkflow,
  canAutoLayoutWorkflow,
  createWorkflowFrameSnapshot,
  createWorkflowStartCell,
  createWorkflowTaskCell,
  layoutWorkflowCells,
} from './cell-commands';
import { defaultWorkflowPort, type WorkflowStartData } from './public-api';
const testCellRegistry = createFixtureRegistry();
const runtime = () => {
  const registry = createTestCellRegistry();

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
  it('prefers right to left or bottom to top and preserves a directly hit port', () => {
    const r = runtime();
    const source = {
      ...(r.store.cells.a as NodeCell),
      geometry: { x: 0, y: 0, width: 120, height: 80 },
    };
    const target = {
      ...(r.store.cells.b as NodeCell),
      geometry: { x: 300, y: 20, width: 120, height: 80 },
    };
    const store = {
      ...r.store,
      cells: { ...r.store.cells, a: source, b: target },
    };
    expect(defaultWorkflowPort(store, source, target, 'source')).toBe('right');
    expect(defaultWorkflowPort(store, target, source, 'target')).toBe('left');
    expect(
      defaultWorkflowPort(
        store,
        source,
        { ...target, geometry: { ...target.geometry, x: 10, y: 320 } },
        'source',
      ),
    ).toBe('bottom');
    const snap = (point: [number, number]) =>
      snapTerminal(
        store,
        'frame',
        point,
        'target',
        'workflow-edge',
        12,
        r.registry,
        ['b'],
        { terminal: { cellId: 'a' } },
      );
    expect(snap([360, 60])).toEqual({ cellId: 'b', portId: 'left' });
    expect(snap([420, 60])).toEqual({ cellId: 'b', portId: 'right' });
    target.ports = target.ports?.map((port) =>
      port.id === 'left' ? { ...port, maxConnections: 0 } : port,
    );
    expect(defaultWorkflowPort(store, target, source, 'target')).not.toBe(
      'left',
    );
  });

  it('anchors disconnected DAG components to the fixed start regardless of id sorting', () => {
    const registry = createTestCellRegistry();

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
    for (const id of ['a-task', 'b-task']) {
      const g = (r.store.cells[id] as NodeCell).geometry;
      expect(g.derived).toBe(false);
      expect(Number.isFinite(g.x) && Number.isFinite(g.y)).toBe(true);
    }
    r.undo();
    expect(r.store).toEqual(before);
  });
  it('moves only the start, preserving fixed and legacy derived members in one reversible transaction', () => {
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
    expect((r.store.cells.start as NodeCell).geometry).toMatchObject({
      x: 140,
      y: 130,
    });
    expect(r.store.cells.start).toMatchObject({ data: start.data });
    expect(r.store.cells.a).toEqual(before.cells.a);
    expect(r.store.cells.b).toEqual(before.cells.b);
    expect(layoutWorkflowCells(r.store, 'frame').get('b')).toEqual(derived);
    const moved = structuredClone(r.store);
    r.undo();
    expect(r.store).toEqual(before);
    r.redo();
    expect(r.store).toEqual(moved);
    expect(
      createCellRuntime(r.snapshot, createTestCellRegistry()).store,
    ).toEqual(moved);
  });

  it('auto layouts one graph, preserves its start, restores manual positions on undo and supports process cycles', () => {
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
    expect(canAutoLayoutWorkflow(r.store, 'start')).toBe(true);
    expect(autoLayoutWorkflow(r.store, 'start').length).toBeGreaterThan(0);
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
    const registry = createTestCellRegistry();

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
  it('pastes into a sole or selected start and offsets a complete graph together', () => {
    const registry = createTestCellRegistry();

    const runtime = createCellRuntime(
      createWorkflowFrameSnapshot('frame', 'start'),
      registry,
    );
    const task = createWorkflowTaskCell('task');
    const alone = {
      cells: { task },
      ids: ['task'],
    };
    const planned = planCellPaste({
      store: runtime.store,
      frameId: 'frame',
      selectionIds: [],
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
                [3, 2],
              ],
            },
          },
        },
      ],
    });
    const whole = copyCellFragment(runtime.store, ['start'], testCellRegistry);
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
        mode: 'orthogonal',
        points: [
          [31, 12],
          [33, 12],
        ],
      },
    });
    const request = {
      store: runtime.store,
      frameId: 'frame',
      selectionIds: [],
      fragment: alone,
      allocateId: (id: string) => `next-${id}`,
      registry,
      intent: 'paste' as const,
    };
    expect(() => planCellPaste(request)).toThrow('Select a workflow start');
    const intoCopy = planCellPaste({ ...request, selectionIds: ['g-start'] });
    runtime.transact({
      id: 'paste-into-second',
      operations: intoCopy.operations,
    });
    expect(
      (runtime.store.cells['g-start'] as NodeCell<WorkflowStartData>).data
        ?.memberIds,
    ).toContain('next-task');
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
