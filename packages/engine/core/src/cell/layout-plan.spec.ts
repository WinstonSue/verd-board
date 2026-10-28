import { describe, expect, it } from 'vitest';
import { createTestCellRegistry } from '../../../../../tests/fixtures/plugins/registry';
import { arrangeCells } from './arrangement';
import { applyCellOperations, createCellRuntime, groupCells } from './index';
import {
  arrangementEdgeIds,
  optimizeEdges,
  planCellLayout,
  rerouteEdges,
  resolveCellArrangementScope,
} from './layout-plan';
import { createCellRegistry } from './registry';
import {
  createCellStore,
  createFrameCell,
  createFrameReferenceCell,
  type Cell,
  type CellStore,
  type EdgeCell,
  type NodeCell,
} from './types';

const registry = createTestCellRegistry();

it('persists one-shot editable paths and keeps repeat optimization idempotent', () => {
  const original = make(
    node('a', 0, 0),
    node('b', 500, 500),
    edge('e', 'a', 'b', { mode: 'auto' }),
  );
  const operations = optimizeEdges(original, ['e', 'e'], registry);
  expect(operations).toHaveLength(1);
  const optimized = applyCellOperations(original, operations, registry);
  expect((optimized.cells.e as EdgeCell).route).toMatchObject({
    mode: 'orthogonal',
    points: expect.any(Array),
  });
  expect((optimized.cells.e as EdgeCell).source).toEqual(
    (original.cells.e as EdgeCell).source,
  );
  expect(JSON.parse(JSON.stringify(optimized))).toEqual(optimized);
  expect(optimizeEdges(optimized, ['e'], registry)).toEqual([]);
  expect(optimized.cells.a).toEqual(original.cells.a);
  const authored = structuredClone(optimized);
  (authored.cells.e as EdgeCell).route = {
    mode: 'orthogonal',
    strategy: 'optimized',
    points: [
      [40, 10],
      [500, 10],
      [500, 510],
    ],
  };
  const reset = applyCellOperations(
    authored,
    rerouteEdges(authored, ['e'], registry),
    registry,
  );
  expect((reset.cells.e as EdgeCell).route).toEqual({
    mode: 'orthogonal',
    strategy: 'optimized',
  });
  expect(optimizeEdges(authored, ['e'], registry)).toHaveLength(1);
  (authored.cells.e as EdgeCell).locked = true;
  expect(optimizeEdges(authored, ['e'], registry)).toEqual([]);
});
const node = (id: string, x: number, y: number): NodeCell => ({
  id,
  cellType: 'node',
  kind: 'geometry',
  geometry: { x, y, width: 40, height: 20 },
});
const edge = (
  id: string,
  source: string,
  target: string,
  route: EdgeCell['route'] = {
    mode: 'orthogonal',
    points: [
      [40, 10],
      [90, 10],
      [90, 510],
      [500, 510],
    ],
  },
): EdgeCell => ({
  id,
  cellType: 'edge',
  kind: 'arrow',
  source: { cellId: source },
  target: { cellId: target },
  route,
});
const make = (...cells: Cell[]) =>
  applyCellOperations(
    createCellStore(createFrameCell('root')),
    cells.map((cell) => ({
      type: 'insert_cell' as const,
      parentId: 'root',
      cell,
    })),
    registry,
  );
const geometry = (store: CellStore, id: string) =>
  (store.cells[id] as NodeCell).geometry;
const grouped = () => {
  const store = make(
    node('a', 0, 0),
    node('b', 500, 500),
    node('outside', 4000, 3000),
    edge('inside', 'a', 'b'),
    edge('boundary', 'b', 'outside'),
  );
  return applyCellOperations(
    store,
    groupCells(store, 'root', ['a', 'b'], 'g', registry),
    registry,
  );
};

describe('scoped layout planning', () => {
  it('resolves a focused Frame reference to its target without arranging the parent canvas', () => {
    let store = make(
      createFrameCell('target'),
      createFrameReferenceCell('reference', 'target', {
        x: 500,
        y: 500,
        width: 400,
        height: 300,
      }),
      node('outside', 2000, 2000),
    );
    store = applyCellOperations(
      store,
      [node('a', 0, 0), node('b', 400, 400)].map((cell) => ({
        type: 'insert_cell' as const,
        parentId: 'target',
        cell,
      })),
      registry,
    );
    const selection = { focus: ['root', 'reference'], ids: [] };
    expect(resolveCellArrangementScope(store, selection).frameId).toBe(
      'target',
    );
    const next = applyCellOperations(
      store,
      planCellLayout(store, selection, 'horizontal', registry),
      registry,
    );
    expect(geometry(next, 'b')).toMatchObject({ x: 72, y: 0 });
    for (const id of ['target', 'reference', 'outside'])
      expect(next.cells[id]).toEqual(store.cells[id]);
  });

  it('does not expand a hidden group into layout or routing targets', () => {
    const original = grouped();
    const store = applyCellOperations(
      original,
      [{ type: 'replace_cell', cell: { ...original.cells.g, hidden: true } }],
      registry,
    );
    const selection = { focus: ['root'], ids: ['g'] };
    expect(planCellLayout(store, selection, 'horizontal', registry)).toEqual(
      [],
    );
    expect(arrangementEdgeIds(store, selection)).toEqual([]);
  });

  it.each([
    { focus: ['root'], ids: ['g'] },
    { focus: ['root', 'g'], ids: [] },
  ])(
    'lays out only group contents with selection %j, keeping manual edges and one-step history',
    (selection) => {
      const store = grouped();
      const runtime = createCellRuntime({ store }, registry);
      const operations = planCellLayout(
        store,
        selection,
        'horizontal',
        registry,
      );
      expect(operations.length).toBeGreaterThan(0);
      runtime.transact({ id: 'layout', operations });
      expect(geometry(runtime.store, 'a')).toMatchObject({ x: 0, y: 0 });
      expect(geometry(runtime.store, 'b')).toMatchObject({ x: 136, y: 0 });
      expect(runtime.store.cells.outside).toEqual(store.cells.outside);
      expect(runtime.store.cells.inside).toEqual(store.cells.inside);
      expect(runtime.store.cells.boundary).toEqual(store.cells.boundary);
      expect(
        planCellLayout(runtime.store, selection, 'horizontal', registry),
      ).toEqual([]);
      expect(runtime.history.undos).toHaveLength(1);
      runtime.undo();
      expect(runtime.store).toEqual(store);
      runtime.redo();
      expect(geometry(runtime.store, 'b')).toMatchObject({ x: 136, y: 0 });
    },
  );

  it('keeps nested groups rigid, expands only the selected level and never opens a nested Frame', () => {
    let store = make(
      node('a', 0, 0),
      node('b', 200, 160),
      node('c', 800, 600),
      node('outside', 5000, 5000),
      createFrameCell('shell', { x: 1200, y: 1200, width: 100, height: 80 }),
    );
    store = applyCellOperations(
      store,
      [{ type: 'insert_cell', parentId: 'shell', cell: node('child', 10, 15) }],
      registry,
    );
    store = applyCellOperations(
      store,
      groupCells(store, 'root', ['a', 'b'], 'inner', registry),
      registry,
    );
    store = applyCellOperations(
      store,
      groupCells(store, 'root', ['inner', 'c', 'shell'], 'outer', registry),
      registry,
    );
    const selection = { focus: ['root'], ids: ['outer'] };
    const next = applyCellOperations(
      store,
      planCellLayout(store, selection, 'vertical', registry),
      registry,
    );
    expect(geometry(next, 'b').x - geometry(next, 'a').x).toBe(200);
    expect(geometry(next, 'b').y - geometry(next, 'a').y).toBe(160);
    expect(next.cells.child).toEqual(store.cells.child);
    expect(next.cells.outside).toEqual(store.cells.outside);
    expect(
      resolveCellArrangementScope(store, {
        focus: ['root', 'outer'],
        ids: ['inner', 'c'],
      }).ids,
    ).toEqual(['inner', 'c']);
    expect(
      resolveCellArrangementScope(store, {
        focus: ['root', 'outer'],
        ids: ['inner'],
      }).ids,
    ).toEqual(['a', 'b']);
    expect(
      resolveCellArrangementScope(store, { focus: ['root'], ids: [] }).ids,
    ).toContain('outer');
  });

  it('treats multiple selected groups as separate rigid blocks', () => {
    let store = make(
      node('a', 0, 0),
      node('b', 200, 100),
      node('c', 1000, 1000),
      node('d', 1100, 1200),
    );
    store = applyCellOperations(
      store,
      groupCells(store, 'root', ['a', 'b'], 'g1', registry),
      registry,
    );
    store = applyCellOperations(
      store,
      groupCells(store, 'root', ['c', 'd'], 'g2', registry),
      registry,
    );
    const next = applyCellOperations(
      store,
      planCellLayout(
        store,
        { focus: ['root'], ids: ['g1', 'g2'] },
        'horizontal',
        registry,
      ),
      registry,
    );
    expect(geometry(next, 'd').x - geometry(next, 'c').x).toBe(100);
    expect(geometry(next, 'd').y - geometry(next, 'c').y).toBe(200);
    expect(geometry(next, 'c')).toMatchObject({ x: 272, y: 0 });
  });

  it('keeps nested groups with derived internal routes stable after layout', () => {
    let store = make(
      node('a', 0, 0),
      node('b', 0, 240),
      {
        ...node('obstacle', -20, 100),
        geometry: { x: -20, y: 100, width: 80, height: 60 },
      },
      edge('inside', 'a', 'b', { mode: 'auto' }),
    );
    store = applyCellOperations(
      store,
      groupCells(store, 'root', ['a', 'b', 'inside'], 'inner', registry),
      registry,
    );
    const selection = { focus: ['root'], ids: ['inner', 'obstacle'] };
    const next = applyCellOperations(
      store,
      planCellLayout(store, selection, 'horizontal', registry),
      registry,
    );
    expect(next.cells.inside).toEqual(store.cells.inside);
    expect(planCellLayout(next, selection, 'horizontal', registry)).toEqual([]);
  });

  it('rejects overlaps with outside or locked nodes without mutating the store', () => {
    let store = make(
      node('a', 0, 0),
      node('b', 500, 500),
      node('obstacle', 80, 0),
    );
    store = applyCellOperations(
      store,
      groupCells(store, 'root', ['a', 'b'], 'g', registry),
      registry,
    );
    const before = JSON.stringify(store);
    expect(() =>
      planCellLayout(
        store,
        { focus: ['root'], ids: ['g'] },
        'horizontal',
        registry,
      ),
    ).toThrow('layout-overlap');
    expect(JSON.stringify(store)).toBe(before);
    store = applyCellOperations(
      store,
      [
        {
          type: 'replace_cell',
          cell: { ...store.cells.obstacle, locked: true },
        },
      ],
      registry,
    );
    expect(() =>
      planCellLayout(
        store,
        { focus: ['root'], ids: ['g'] },
        'horizontal',
        registry,
      ),
    ).toThrow('layout-overlap');
  });

  it('keeps locked members fixed and does not expand an empty or edge-only scope to the Frame', () => {
    const store = make(node('a', 0, 0), node('b', 500, 500), {
      ...node('pinned', 0, 800),
      locked: true,
    });
    const next = applyCellOperations(
      store,
      planCellLayout(
        store,
        { focus: ['root'], ids: [] },
        'horizontal',
        registry,
      ),
      registry,
    );
    expect(next.cells.pinned).toEqual(store.cells.pinned);
    const withEdges = grouped();
    expect(
      planCellLayout(
        withEdges,
        { focus: ['root'], ids: ['inside'] },
        'horizontal',
        registry,
      ),
    ).toEqual([]);
    expect(() =>
      planCellLayout(
        withEdges,
        { focus: ['root', 'g'], ids: ['outside'] },
        'grid',
        registry,
      ),
    ).toThrow('crosses scope');
    const empty = createCellStore(createFrameCell('root'));
    expect(
      planCellLayout(empty, { focus: ['root'], ids: [] }, 'grid', registry),
    ).toEqual([]);
  });
});

describe('relationship layout', () => {
  it('handles cycles, branching, duplicate/self/outside edges, disconnected nodes and stable input order', () => {
    const cells: Cell[] = ['a', 'b', 'c', 'd', 'e', 'z'].map((id, i) =>
      node(id, i * 500, i * 400),
    );
    cells.push(
      edge('ab', 'a', 'b'),
      edge('ba', 'b', 'a'),
      edge('bc', 'b', 'c'),
      edge('bd', 'b', 'd'),
      edge('cd', 'c', 'd'),
      edge('duplicate', 'a', 'b'),
      edge('self', 'a', 'a'),
    );
    const first = make(...cells),
      reverse = make(
        ...[...cells].reverse().filter((cell) => cell.cellType === 'node'),
        ...cells.filter((cell) => cell.cellType === 'edge').reverse(),
      );
    const next = applyCellOperations(
      first,
      arrangeCells(first, 'root', [], 'relationships', 32, registry),
      registry,
    );
    const other = applyCellOperations(
      reverse,
      arrangeCells(reverse, 'root', [], 'relationships', 32, registry),
      registry,
    );
    for (const id of ['a', 'b', 'c', 'd', 'e', 'z'])
      expect(geometry(next, id)).toEqual(geometry(other, id));
    expect(geometry(next, 'a').y).toBe(geometry(next, 'b').y);
    expect(
      geometry(next, 'c').y - geometry(next, 'b').y,
    ).toBeGreaterThanOrEqual(180);
    expect(
      geometry(next, 'd').y - geometry(next, 'c').y,
    ).toBeGreaterThanOrEqual(180);
    expect(
      arrangeCells(next, 'root', [], 'relationships', 32, registry),
    ).toEqual([]);
    expect(Object.keys(next.cells).sort()).toEqual(
      Object.keys(first.cells).sort(),
    );
  });

  it('packs disconnected nodes as a grid and ignores edges leaving a local scope', () => {
    const store = make(
      node('a', 0, 0),
      node('b', 900, 800),
      node('c', 2000, 2000),
      edge('outside', 'a', 'c', { mode: 'auto' }),
    );
    const next = applyCellOperations(
      store,
      planCellLayout(
        store,
        { focus: ['root'], ids: ['a', 'b'] },
        'relationships',
        registry,
      ),
      registry,
    );
    expect(geometry(next, 'a')).toMatchObject({ x: 0, y: 0 });
    expect(geometry(next, 'b')).toMatchObject({ x: 136, y: 0 });
    expect(next.cells.c).toEqual(store.cells.c);
  });
});

describe('scoped edge rerouting', () => {
  it('collects incident boundary edges and explicitly selected edges without moving nodes', () => {
    const store = grouped();
    expect(arrangementEdgeIds(store, { focus: ['root'], ids: ['g'] })).toEqual([
      'boundary',
      'inside',
    ]);
    expect(
      arrangementEdgeIds(store, { focus: ['root', 'g'], ids: [] }),
    ).toEqual(['boundary', 'inside']);
    expect(
      arrangementEdgeIds(store, { focus: ['root'], ids: ['inside'] }),
    ).toEqual(['inside']);
    expect(
      arrangementEdgeIds(store, { focus: ['root'], ids: ['g', 'boundary'] }),
    ).toEqual(['boundary', 'inside']);
    const runtime = createCellRuntime({ store }, registry);
    runtime.transact({
      id: 'reroute',
      operations: rerouteEdges(store, ['boundary', 'inside'], registry),
    });
    for (const id of ['a', 'b', 'outside'])
      expect(runtime.store.cells[id]).toEqual(store.cells[id]);
    expect((runtime.store.cells.inside as EdgeCell).route).toEqual({
      mode: 'orthogonal',
    });
    expect(
      rerouteEdges(runtime.store, ['boundary', 'inside'], registry),
    ).toEqual([]);
    runtime.undo();
    expect(runtime.store).toEqual(store);
  });

  it('preserves ports, anchors, free endpoints, labels and appearance while converting fixed paths', () => {
    const a = {
      ...node('a', 0, 0),
      ports: [{ id: 'p', side: 'right' as const }],
    };
    const e = {
      ...edge('e', 'a', 'b', {
        mode: 'fixed',
        points: [
          [40, 10],
          [200, 10],
          [200, 510],
          [500, 510],
        ],
      }),
      source: { cellId: 'a', portId: 'p' },
      target: { cellId: 'b', anchor: [0, 0.5] as [number, number] },
      labels: [{ text: 'label', position: 0.3 }],
      appearance: { strokeWidth: 3, stroke: '#123456' },
    };
    const free = {
      ...edge('free', 'a', 'b'),
      source: { point: [-30, 10] as [number, number] },
    };
    const store = make(a, node('b', 500, 500), e, free);
    const next = applyCellOperations(
      store,
      rerouteEdges(store, ['e', 'free'], registry),
      registry,
    );
    expect(next.cells.e).toEqual({ ...e, route: { mode: 'auto' } });
    expect(next.cells.free).toEqual({ ...free, route: { mode: 'orthogonal' } });
  });

  it('skips straight, curved, automatic, hidden, locked and plugin-owned paths including ancestor locks', () => {
    const paths: EdgeCell[] = [
      edge('straight', 'a', 'b', {
        mode: 'straight',
        points: [
          [40, 10],
          [100, 30],
          [500, 510],
        ],
      }),
      edge('curve', 'a', 'b', {
        mode: 'curve',
        points: [
          [40, 10],
          [100, 30],
          [500, 510],
        ],
      }),
      edge('auto', 'a', 'b', { mode: 'auto' }),
      { ...edge('hidden', 'a', 'b'), hidden: true },
      { ...edge('locked', 'a', 'b'), locked: true },
      edge('grouped', 'a', 'b'),
    ];
    let store = make(node('a', 0, 0), node('b', 500, 500), ...paths);
    store = applyCellOperations(
      store,
      groupCells(store, 'root', ['grouped', 'a'], 'g', registry),
      registry,
    );
    store = applyCellOperations(
      store,
      [{ type: 'replace_cell', cell: { ...store.cells.g, locked: true } }],
      registry,
    );
    expect(
      rerouteEdges(
        store,
        paths.map((e) => e.id),
        registry,
      ),
    ).toEqual([]);
    const restricted = createCellRegistry();
    restricted.register({ kind: 'arrow', routable: false });
    expect(rerouteEdges(grouped(), ['inside'], restricted)).toEqual([]);
  });
});
