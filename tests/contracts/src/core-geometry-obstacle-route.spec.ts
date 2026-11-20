import { describe, expect, it } from 'vitest';
import { createTestCellRegistry as createFixtureRegistry } from '../../fixtures/plugins/registry';
import {
  createCellStore,
  createFrameCell,
  type EdgeCell,
  type NodeCell,
} from '../../../packages/engine/core/src/cell/types';
import type { Point } from '../../../packages/engine/core/src/interfaces/point';
import {
  createEdgeRoutingContext,
  edgePolyline,
} from '../../../packages/engine/core/src/geometry/edge';
import { type RoutingObstacle } from '../../../packages/engine/core/src/geometry/obstacle-route';
const testCellRegistry = createFixtureRegistry();
const assertClear = (points: Point[], boxes: RoutingObstacle[]) => {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    expect(a[0] === b[0] || a[1] === b[1]).toBe(true);
    expect(b.every(Number.isFinite)).toBe(true);
    for (const r of boxes) {
      const crosses =
        a[1] === b[1]
          ? a[1] > r.y &&
            a[1] < r.y + r.height &&
            Math.min(a[0], b[0]) < r.x + r.width &&
            Math.max(a[0], b[0]) > r.x
          : a[0] > r.x &&
            a[0] < r.x + r.width &&
            Math.min(a[1], b[1]) < r.y + r.height &&
            Math.max(a[1], b[1]) > r.y;
      expect(crosses, `segment ${i} crosses ${r.id}`).toBe(false);
    }
  }
};
const node = (
  id: string,
  x: number,
  y: number,
  width = 100,
  height = 50,
): NodeCell => ({
  id,
  kind: 'geometry',
  cellType: 'node',
  geometry: { x, y, width, height },
});
const fixture = () => {
  const frame = createFrameCell('frame');
  const store = createCellStore(frame);
  const nodes = [
    node('source', 0, 0),
    node('middle', 0, 150),
    node('target', 0, 300),
  ];
  const edge: EdgeCell = {
    id: 'edge',
    kind: 'arrow',
    cellType: 'edge',
    source: { cellId: 'source' },
    target: { cellId: 'target' },
    route: { mode: 'auto' },
  };
  for (const cell of [...nodes, edge]) {
    store.cells[cell.id] = cell;
    frame.children.push(cell.id);
  }
  return { store, frame, edge, nodes };
};
describe('obstacle-avoiding orthogonal routing', () => {
  it('uses preview geometry, skips hidden nodes and transparent layers, and stops at nested Frame shells', () => {
    const { store, frame, edge } = fixture();
    const layer = {
      ...node('layer', -80, 100, 260, 150),
      kind: 'architecture-layer',
    };
    const nested = createFrameCell('nested', {
      x: 0,
      y: 150,
      width: 100,
      height: 50,
    });
    store.cells.layer = layer;
    frame.children.push('layer');
    (store.cells.middle as NodeCell).hidden = true;
    const clear = createEdgeRoutingContext(
      store,
      frame.id,
      undefined,
      undefined,
      testCellRegistry,
    );
    expect(clear.obstacles.map((b) => b.id)).toEqual(['source', 'target']);
    expect(edgePolyline(store, edge, undefined, clear)).toEqual([
      [50, 50],
      [50, 300],
    ]);
    store.cells.nested = nested;
    frame.children.push('nested');
    const blocked = createEdgeRoutingContext(
      store,
      frame.id,
      undefined,
      undefined,
      testCellRegistry,
    );
    assertClear(
      edgePolyline(store, edge, undefined, blocked),
      blocked.obstacles.filter((b) => b.id === 'nested'),
    );
    const geometry = new Map([['nested', { ...nested.geometry, x: 300 }]]);
    const preview = createEdgeRoutingContext(
      store,
      frame.id,
      geometry,
      undefined,
      testCellRegistry,
    );
    expect(edgePolyline(store, edge, geometry, preview)).toEqual([
      [50, 50],
      [50, 300],
    ]);
  });
});
