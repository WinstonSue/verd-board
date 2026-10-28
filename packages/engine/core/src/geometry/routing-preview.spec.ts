import { describe, expect, it, vi } from 'vitest';
import {
  createCellStore,
  createFrameCell,
  type EdgeCell,
  type NodeCell,
} from '../cell/types';
import { createTestCellRegistry } from '../../../../../tests/fixtures/plugins/registry';
import { createEdgeRoutingContext, edgePolyline } from './edge';
import * as obstacles from './obstacle-route';
import * as optimization from './route-optimization';
import { optimizeEdges } from '../cell/layout-plan';
import { applyCellOperations } from '../cell';
import { edgeLabelLayout } from './edge-label';
const registry = createTestCellRegistry();
function fixture() {
  const frame = createFrameCell('root'),
    store = createCellStore(frame);
  const nodes: NodeCell[] = ['a', 'b', 'c'].map((id, i) => ({
    id,
    kind: 'geometry',
    cellType: 'node',
    geometry: { x: i * 300, y: i * 80, width: 80, height: 40 },
  }));
  const edges: EdgeCell[] = ['ab', 'bc'].map((id, i) => ({
    id,
    kind: 'arrow',
    cellType: 'edge',
    source: { cellId: nodes[i].id, anchor: [1, 0.5] },
    target: { cellId: nodes[i + 1].id, anchor: [0, 0.5] },
    route: { mode: 'auto', strategy: 'optimized' },
    labels: [{ text: 'edge label' }],
  }));
  for (const cell of [...nodes, ...edges]) {
    store.cells[cell.id] = cell;
    frame.children.push(cell.id);
  }
  return { store, edges };
}
describe('lightweight interaction routing', () => {
  it('reuses stationary paths and moves connected ends without routing or optimization work', () => {
    const { store, edges } = fixture();
    const base = createEdgeRoutingContext(
      store,
      'root',
      undefined,
      undefined,
      registry,
    );
    const paths = edges.map((edge) =>
      edgePolyline(store, edge, undefined, base),
    );
    const oldLabel = edgeLabelLayout(edges[0], 0, paths[0], base);
    const avoid = vi.spyOn(obstacles, 'routeOrthogonalAvoiding');
    const optimize = vi.spyOn(optimization, 'optimizeFrameRoutes');
    try {
      const node = store.cells.a as NodeCell;
      const moved = {
        ...store,
        cells: {
          ...store.cells,
          a: { ...node, geometry: { ...node.geometry, x: 35, y: 20 } },
        },
      };
      const preview = createEdgeRoutingContext(
        moved,
        'root',
        undefined,
        base,
        registry,
        { preview: true },
      );
      const path = edgePolyline(moved, edges[0], undefined, preview);
      expect(path[0]).toEqual([115, 40]);
      expect(edgePolyline(moved, edges[1], undefined, preview)).toBe(paths[1]);
      expect(edgeLabelLayout(edges[0], 0, path, preview).bounds.width).toBe(
        oldLabel.bounds.width,
      );
      expect(avoid).not.toHaveBeenCalled();
      expect(optimize).not.toHaveBeenCalled();
      expect(store.cells.a).toBe(node);
    } finally {
      vi.restoreAllMocks();
    }
  });
  it('ignores legacy continuous flags, and only explicitly runs the optimizer once per frame', () => {
    const { store, edges } = fixture();
    const optimize = vi.spyOn(optimization, 'optimizeFrameRoutes');
    try {
      const routing = createEdgeRoutingContext(
        store,
        'root',
        undefined,
        undefined,
        registry,
      );
      for (const edge of edges) edgePolyline(store, edge, undefined, routing);
      expect(optimize).not.toHaveBeenCalled();
      const planned = optimizeEdges(
        store,
        edges.map((e) => e.id),
        registry,
      );
      expect(optimize).toHaveBeenCalledTimes(1);
      const saved = applyCellOperations(store, planned, registry);
      const reloaded = JSON.parse(JSON.stringify(saved));
      for (const edge of edges) edgePolyline(reloaded, reloaded.cells[edge.id]);
      expect(optimize).toHaveBeenCalledTimes(1);
      expect(
        optimizeEdges(
          saved,
          edges.map((e) => e.id),
          registry,
        ),
      ).toEqual([]);
    } finally {
      vi.restoreAllMocks();
    }
  });
});

it('records settled versus lightweight preview workloads for package and dense diagrams', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { resolve, dirname } = await import('node:path');
  const architecture = JSON.parse(
    readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        '../../../../../tests/fixtures/diagrams/architecture-packages.json',
      ),
      'utf8',
    ),
  ).store;
  const frame = createFrameCell('root'),
    dense = createCellStore(frame);
  for (let i = 0; i < 60; i++) {
    const id = `n${i}`;
    dense.cells[id] = {
      id,
      cellType: 'node',
      kind: 'geometry',
      geometry: {
        x: (i % 10) * 300,
        y: Math.floor(i / 10) * 180,
        width: 80,
        height: 40,
      },
    };
    frame.children.push(id);
  }
  for (let i = 0; i < 120; i++) {
    const id = `e${i}`;
    dense.cells[id] = {
      id,
      cellType: 'edge',
      kind: 'arrow',
      source: { cellId: `n${i % 60}` },
      target: { cellId: `n${(i + 11 + Math.floor(i / 60)) % 60}` },
      route: { mode: 'auto' },
    };
    frame.children.push(id);
  }
  const { frameEdgeCrossingJumps } = await import('./edge-crossings');
  for (const [name, store] of [
    ['packages', architecture],
    ['dense', dense],
  ] as const) {
    const edges = Object.values(store.cells).filter(
      (cell): cell is EdgeCell => (cell as EdgeCell).cellType === 'edge',
    );
    const movedNode = Object.values(store.cells).find(
      (cell): cell is NodeCell =>
        (cell as NodeCell).cellType === 'node' &&
        registry.get((cell as NodeCell).kind)?.routingObstacle !== false,
    )!;
    const base = createEdgeRoutingContext(
      store,
      store.rootId,
      undefined,
      undefined,
      registry,
    );
    edges.forEach((edge) => edgePolyline(store, edge, undefined, base));
    const times: number[] = [];
    const avoid = vi.spyOn(obstacles, 'routeOrthogonalAvoiding');
    for (const preview of [false, true]) {
      avoid.mockClear();
      const started = performance.now();
      for (let i = 0; i < 3; i++) {
        const moved = {
          ...store,
          cells: {
            ...store.cells,
            [movedNode.id]: {
              ...movedNode,
              geometry: {
                ...movedNode.geometry,
                x: movedNode.geometry.x + 10 * (i + 1),
              },
            },
          },
        };
        const routing = createEdgeRoutingContext(
          moved,
          store.rootId,
          undefined,
          base,
          registry,
          { preview },
        );
        edges.forEach((edge) => edgePolyline(moved, edge, undefined, routing));
        if (!preview) frameEdgeCrossingJumps(moved, store.rootId, routing);
      }
      times.push((performance.now() - started) / 3);
      expect(avoid.mock.calls.length > 0).toBe(!preview);
    }
    avoid.mockRestore();
    console.info(
      `[routing-preview] ${name}: ${edges.length} edges; full=${times[0].toFixed(2)}ms/frame, lightweight=${times[1].toFixed(2)}ms/frame`,
    );
    expect(times.every(Number.isFinite)).toBe(true);
  }
}, 20000);

it('translates a free automatic group connector as a whole during preview', () => {
  const { store } = fixture();
  const edge: EdgeCell = {
    id: 'free',
    cellType: 'edge',
    kind: 'arrow',
    source: { point: [20, 300] },
    target: { point: [400, 450] },
    route: { mode: 'auto' },
  };
  store.cells.free = edge;
  const frame = store.cells.root;
  if (frame.cellType !== 'frame') throw new Error('frame');
  frame.children.push('free');
  const base = createEdgeRoutingContext(
    store,
    'root',
    undefined,
    undefined,
    registry,
  );
  const before = edgePolyline(store, edge, undefined, base);
  const moved: EdgeCell = {
    ...edge,
    source: { point: [45, 320] },
    target: { point: [425, 470] },
  };
  const next = { ...store, cells: { ...store.cells, free: moved } };
  const preview = createEdgeRoutingContext(
    next,
    'root',
    undefined,
    base,
    registry,
    { preview: true },
  );
  expect(edgePolyline(next, moved, undefined, preview)).toEqual(
    before.map(([x, y]) => [x + 25, y + 20]),
  );
});
