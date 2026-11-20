import { describe, it, expect } from 'vitest';
import { createTestCellRegistry } from '../../../../../tests/fixtures/core/registry';
import { applyCellOperations, createCellRuntime } from './index';
import { planGeometryLayout, planOptimizeEdges } from './layout-plan';
import {
  createCellStore,
  createFrameCell,
  type Cell,
  type CellStore,
  type NodeCell,
  type EdgeCell,
} from './types';
import { createEdgeRoutingContext, edgePolyline } from '../geometry/edge';
import { isClearOrthogonalRoute } from '../geometry/obstacle-route';
const registry = createTestCellRegistry();
const node = (id: string, x: number, y: number): NodeCell => ({
  id,
  kind: 'geometry',
  cellType: 'node',
  geometry: { x, y, width: 80, height: 40 },
  ports: [
    { id: 'out', side: 'right', direction: 'both' },
    { id: 'in', side: 'left', direction: 'both' },
  ],
});
const edge = (id: string, a: string, b: string): EdgeCell => ({
  id,
  kind: 'arrow',
  cellType: 'edge',
  source: { cellId: a, portId: 'out' },
  target: { cellId: b, portId: 'in' },
  route: { mode: 'auto' },
});
const make = (...cells: Cell[]) =>
  applyCellOperations(
    createCellStore(createFrameCell('root')),
    cells.map((cell) => ({ type: 'insert_cell', parentId: 'root', cell })),
    registry,
  );
const assertSafe = (store: CellStore, ids: string[]) => {
  const context = createEdgeRoutingContext(
    store,
    store.rootId,
    undefined,
    undefined,
    registry,
  );
  for (const id of ids) {
    const e = store.cells[id] as EdgeCell;
    const source = 'cellId' in e.source ? e.source.cellId : undefined,
      target = 'cellId' in e.target ? e.target.cellId : undefined;
    const points = edgePolyline(store, e, undefined, context);
    const side = (id: string | undefined, end: 'source' | 'target') =>
      id
        ? ((store.cells[id] as NodeCell).ports?.find(
            (p) => p.id === (e[end] as { portId?: string }).portId,
          )?.side ??
          context.routes.get(e.id)?.[end].side ??
          'right')
        : 'right';
    expect(
      isClearOrthogonalRoute(
        points,
        side(source, 'source'),
        side(target, 'target'),
        context.obstacles,
        {
          sourceId: source,
          targetId: target,
          visualGap: 12,
          strokeWidth: e.appearance?.strokeWidth,
        },
      ),
      id,
    ).toBe(true);
  }
};
describe('joint domain geometry planning', () => {
  it('uses a roomy fallback for one movable endpoint beside fixed outside nodes', () => {
    const store = make(
      node('a', 0, 0),
      node('fixed', 80, 0),
      node('b', 500, 0),
      edge('e', 'a', 'b'),
    );
    const plan = planGeometryLayout(
      store,
      { focus: ['root'], ids: ['a'] },
      'horizontal',
      registry,
      { maxAttempts: 2 },
    );
    expect(plan.diagnostics).toEqual([]);
    const next = applyCellOperations(store, plan.operations, registry);
    expect((next.cells.a as NodeCell).geometry.x).toBeGreaterThan(580);
    expect(next.cells.fixed).toEqual(store.cells.fixed);
    expect(next.cells.b).toEqual(store.cells.b);
    assertSafe(next, ['e']);
  });
  it.each([3, 8])(
    'creates safe deterministic channels for %i edges sharing one real port, in one undo step',
    (count) => {
      const nodes = Array.from({ length: count }, (_, i) =>
        node(`n${i}`, 100, 0),
      );
      const edges = nodes.map((n) => edge(`e${n.id}`, n.id, 'sink'));
      const store = make(...nodes, node('sink', 200, 10), ...edges);
      const plan = planGeometryLayout(
        store,
        { focus: ['root'], ids: [] },
        'grid',
        registry,
      );
      expect(plan.diagnostics).toEqual([]);
      expect(plan.status).toBe('success');
      const runtime = createCellRuntime({ store }, registry);
      runtime.transact({ id: 'joint', operations: plan.operations });
      const reversed = structuredClone(store);
      (reversed.cells.root as import('./types').FrameCell).children.reverse();
      const reordered = applyCellOperations(
        reversed,
        planGeometryLayout(
          reversed,
          { focus: ['root'], ids: [] },
          'grid',
          registry,
        ).operations,
        registry,
      );
      for (const n of nodes)
        expect(reordered.cells[n.id]).toEqual(runtime.store.cells[n.id]);
      assertSafe(
        runtime.store,
        edges.map((e) => e.id),
      );
      for (const e of edges)
        expect((runtime.store.cells[e.id] as EdgeCell).target).toEqual(
          e.target,
        );
      const reloaded = JSON.parse(JSON.stringify(runtime.store));
      expect(
        planGeometryLayout(
          reloaded,
          { focus: ['root'], ids: [] },
          'grid',
          registry,
        ).operations,
      ).toEqual([]);
      runtime.undo();
      expect(runtime.store).toEqual(store);
    },
  );
  it('keeps failed edges and fixed nodes while applying successful edge-only results', () => {
    const store = make(
      node('a', 0, 0),
      node('blocker', 80, 0),
      node('b', 400, 0),
      node('c', 0, 400),
      node('d', 400, 400),
      edge('bad', 'a', 'b'),
      edge('good', 'c', 'd'),
    );
    const plan = planOptimizeEdges(store, ['bad', 'good'], registry);
    expect(plan.status).toBe('partial');
    expect(plan.diagnostics[0].cellIds).toEqual(['bad']);
    const next = applyCellOperations(store, plan.operations, registry);
    expect(next.cells.bad).toEqual(store.cells.bad);
    for (const id of ['a', 'b', 'c', 'd', 'blocker'])
      expect(next.cells[id]).toEqual(store.cells[id]);
    assertSafe(next, ['good']);
  });
  it('preserves legacy manual points in background and replaces them only for explicit commands', () => {
    const e = edge('e', 'a', 'b');
    e.route = {
      mode: 'orthogonal',
      points: [
        [80, 20],
        [200, 20],
        [200, 420],
        [400, 420],
      ],
    };
    const store = make(node('a', 0, 0), node('b', 400, 400), e);
    expect(
      planOptimizeEdges(store, ['e'], registry, { automatic: true }).operations,
    ).toEqual([]);
    const next = applyCellOperations(
      store,
      planOptimizeEdges(store, ['e'], registry).operations,
      registry,
    );
    expect((next.cells.e as EdgeCell).route.origin).toBe('generated');
    expect(JSON.parse(JSON.stringify(next))).toEqual(next);
  });
  it('uses painted rotated bounds, independent of UI state and zoom', () => {
    const obstacle = {
      ...node('o', 180, -40),
      appearance: { strokeWidth: 24 },
      geometry: { ...node('o', 180, -40).geometry, rotation: Math.PI / 4 },
    };
    const store = make(
      node('a', 0, 0),
      node('b', 500, 0),
      obstacle,
      edge('e', 'a', 'b'),
    );
    const plan = planOptimizeEdges(store, ['e'], registry);
    expect(plan.status).toBe('success');
    const next = applyCellOperations(store, plan.operations, registry);
    assertSafe(next, ['e']);
    const bounds = createEdgeRoutingContext(
      next,
      'root',
      undefined,
      undefined,
      registry,
    ).obstacles.find((b) => b.id === 'o')!;
    expect(bounds.width).toBeGreaterThan(100);
  });
});
