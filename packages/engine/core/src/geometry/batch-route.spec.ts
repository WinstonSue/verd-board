import { describe, expect, it } from 'vitest';
import { createTestCellRegistry as createFixtureRegistry } from '../../../../../tests/fixtures/core/registry';
import { frameContentBounds } from '../cell/frame';
import { applyCellOperations } from '../cell/index';
import {
  createCellStore,
  createFrameCell,
  isEdgeCell,
  type CellStore,
  type EdgeCell,
  type NodeCell,
} from '../cell/types';
import type { Point } from '../interfaces/point';
import { createEdgeRoutingContext, edgePolyline } from './edge';
import { edgeLabelLayout } from './edge-label';
import { isClearOrthogonalRoute } from './obstacle-route';
const testCellRegistry = createFixtureRegistry();
const edgesOf = (store: CellStore) =>
  Object.values(store.cells).filter(isEdgeCell);
it('reoptimizes around a moved obstacle instead of freezing saved route points', () => {
  const frame = createFrameCell('root');
  const store = createCellStore(frame);
  const node = (id: string, x: number, y: number): NodeCell => ({
    id,
    kind: 'geometry',
    cellType: 'node',
    geometry: { x, y, width: 100, height: 100 },
  });
  const edge: EdgeCell = {
    id: 'edge',
    kind: 'arrow',
    cellType: 'edge',
    source: { cellId: 'source', anchor: [1, 0.5] },
    target: { cellId: 'target', anchor: [0, 0.5] },
    route: { mode: 'auto', strategy: 'optimized' },
  };
  for (const cell of [
    node('source', 0, 0),
    node('target', 600, 0),
    node('obstacle', 300, 300),
    edge,
  ]) {
    store.cells[cell.id] = cell;
    frame.children.push(cell.id);
  }
  const before = createEdgeRoutingContext(
    store,
    'root',
    undefined,
    undefined,
    testCellRegistry,
  );
  const oldPath = edgePolyline(store, edge, undefined, before);
  const moved = applyCellOperations(
    store,
    [{ type: 'replace_cell', cell: node('obstacle', 300, 0) }],
    testCellRegistry,
  );
  const after = createEdgeRoutingContext(
    moved,
    'root',
    undefined,
    before,
    testCellRegistry,
  );
  const path = edgePolyline(moved, edge, undefined, after);
  expect(path).not.toEqual(oldPath);
  const planned = after.routes.get(edge.id)!;
  expect(
    isClearOrthogonalRoute(
      path,
      planned.source.side,
      planned.target.side,
      after.obstacles,
      { sourceId: 'source', targetId: 'target', clearance: after.clearance },
    ),
  ).toBe(true);
  expect((moved.cells.edge as EdgeCell).route).toEqual({
    mode: 'auto',
    strategy: 'optimized',
  });
});
describe('frame-wide connector planning', () => {
  it('plans one hundred edges among one hundred nodes once per context', () => {
    const frame = createFrameCell('frame'),
      store = createCellStore(frame);
    for (let at = 0; at < 100; at++) {
      const node: NodeCell = {
        id: `node-${at}`,
        cellType: 'node',
        kind: 'geometry',
        geometry: {
          x: (at % 10) * 180,
          y: Math.floor(at / 10) * 100,
          width: 100,
          height: 40,
        },
      };
      const edge: EdgeCell = {
        id: `edge-${at}`,
        cellType: 'edge',
        kind: 'arrow',
        source: { cellId: node.id },
        target: { cellId: `node-${(at + 17) % 100}` },
        route: { mode: 'auto' },
      };
      for (const cell of [node, edge]) {
        store.cells[cell.id] = cell;
        frame.children.push(cell.id);
      }
    }
    const context = createEdgeRoutingContext(
      store,
      frame.id,
      undefined,
      undefined,
      testCellRegistry,
    );
    const edges = edgesOf(store);
    for (const edge of edges)
      expect(
        edgePolyline(store, edge, undefined, context)
          .flat()
          .every(Number.isFinite),
      ).toBe(true);
    expect(context.routes.size).toBe(100);
    for (const edge of edges)
      expect(edgePolyline(store, edge, undefined, context)).toBe(
        context.routes.get(edge.id)!.result.points,
      );
  });
  it('never compacts authored orthogonal points even when they contain a short stair', () => {
    const frame = createFrameCell('root'),
      store = createCellStore(frame);
    const points: Point[] = [
      [100, 50],
      [140, 50],
      [140, 62],
      [260, 62],
      [260, 150],
      [300, 150],
    ];
    const nodes: NodeCell[] = [
      {
        id: 'a',
        cellType: 'node',
        kind: 'geometry',
        geometry: { x: 0, y: 0, width: 100, height: 100 },
      },
      {
        id: 'b',
        cellType: 'node',
        kind: 'geometry',
        geometry: { x: 300, y: 100, width: 100, height: 100 },
      },
    ];
    const edge: EdgeCell = {
      id: 'manual',
      cellType: 'edge',
      kind: 'arrow',
      source: { cellId: 'a' },
      target: { cellId: 'b' },
      route: { mode: 'orthogonal', points },
    };
    for (const cell of [...nodes, edge]) {
      store.cells[cell.id] = cell;
      frame.children.push(cell.id);
    }
    const before = structuredClone(store);
    const context = createEdgeRoutingContext(
      store,
      frame.id,
      undefined,
      undefined,
      testCellRegistry,
    );
    expect(edgePolyline(store, edge, undefined, context)).toEqual(points);
    expect(context.routes.has(edge.id)).toBe(false);
    expect(store).toEqual(before);
  });
  it('includes offset labels in embedded fit and image export bounds', () => {
    const frame = createFrameCell('frame'),
      store = createCellStore(frame);
    for (const [id, y] of [
      ['source', 0],
      ['target', 200],
    ] as const) {
      const node: NodeCell = {
        id,
        cellType: 'node',
        kind: 'geometry',
        geometry: { x: 0, y, width: 40, height: 40 },
      };
      store.cells[id] = node;
      frame.children.push(id);
    }
    const edge: EdgeCell = {
      id: 'edge',
      cellType: 'edge',
      kind: 'arrow',
      source: { cellId: 'source' },
      target: { cellId: 'target' },
      route: { mode: 'auto' },
      labels: [{ text: 'A longer label' }],
    };
    store.cells.edge = edge;
    frame.children.push(edge.id);
    const routing = createEdgeRoutingContext(
      store,
      frame.id,
      undefined,
      undefined,
      testCellRegistry,
    );
    const layout = edgeLabelLayout(
      edge,
      0,
      edgePolyline(store, edge, undefined, routing),
      routing,
    );
    const bounds = frameContentBounds(store, frame.id, routing);
    expect(layout.bounds.x + layout.bounds.width).toBeGreaterThan(40);
    expect(bounds.x + bounds.width).toBeGreaterThanOrEqual(
      layout.bounds.x + layout.bounds.width,
    );
  });
});
