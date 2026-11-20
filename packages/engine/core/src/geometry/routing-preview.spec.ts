import { describe, expect, it, vi } from 'vitest';
import {
  createCellStore,
  createFrameCell,
  type EdgeCell,
  type NodeCell,
} from '../cell/types';
import { createTestCellRegistry } from '../../../../../tests/fixtures/core/registry';
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
