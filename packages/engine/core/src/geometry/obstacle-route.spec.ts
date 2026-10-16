import { describe, expect, it } from 'vitest';
import {
  createCellStore,
  createFrameCell,
  type EdgeCell,
  type NodeCell,
} from '../cell/types';
import { frameContentBounds } from '../cell/frame';
import {
  createEdgeRoutingContext,
  edgePolyline,
  edgeRoutePoints,
} from './edge';
import {
  routeOrthogonalAvoiding,
  type RoutingObstacle,
} from './obstacle-route';
import type { Point } from '../interfaces/point';

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
  it('routes a vertical long edge around siblings without changing stored geometry or routes', () => {
    const { store, edge } = fixture(),
      before = structuredClone(store);
    const context = createEdgeRoutingContext(store, 'frame');
    const points = edgePolyline(store, edge, undefined, context);
    assertClear(
      points,
      context.obstacles.filter((b) => b.id === 'middle'),
    );
    expect(context.routes.get('edge')?.result.status).toBe('routed');
    expect(points[0]).toEqual([50, 50]);
    expect(points.at(-1)).toEqual([50, 300]);
    expect(edgePolyline(store, edge, undefined, context)).toBe(points);
    expect(store).toEqual(before);
    expect(edgePolyline(store, edge)).toEqual(points);
    const bounds = frameContentBounds(store, 'frame', context);
    expect(bounds.x < 0 || bounds.x + bounds.width > 100).toBe(true);
    for (const [x, y] of points) {
      expect(x).toBeGreaterThanOrEqual(bounds.x);
      expect(x).toBeLessThanOrEqual(bounds.x + bounds.width);
      expect(y).toBeGreaterThanOrEqual(bounds.y);
      expect(y).toBeLessThanOrEqual(bounds.y + bounds.height);
    }
  });

  it('keeps fixed ports in a vertical workflow and handles backward-facing terminals', () => {
    const { store, edge } = fixture();
    for (const id of ['source', 'target'])
      (store.cells[id] as NodeCell).ports = [
        {
          id: 'fixed',
          side: id === 'source' ? 'right' : 'left',
          direction: 'both',
        },
      ];
    edge.source = { cellId: 'source', portId: 'fixed' };
    edge.target = { cellId: 'target', portId: 'fixed' };
    const context = createEdgeRoutingContext(store, 'frame');
    const points = edgePolyline(store, edge, undefined, context);
    assertClear(
      points,
      context.obstacles.filter((b) => b.id === 'middle'),
    );
    expect(points[0]).toEqual([100, 25]);
    expect(points[1][0]).toBeGreaterThan(100);
    expect(points.at(-1)).toEqual([0, 325]);
    expect(points.at(-2)![0]).toBeLessThan(0);
    const reverse = {
      ...edge,
      id: 'reverse',
      source: edge.target,
      target: edge.source,
    };
    const backwards = edgePolyline(store, reverse, undefined, context);
    assertClear(
      backwards,
      context.obstacles.filter((b) => b.id === 'middle'),
    );
    expect(context.routes.get('reverse')?.result.status).not.toBe('blocked');
  });

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
    const clear = createEdgeRoutingContext(store, frame.id);
    expect(clear.obstacles.map((b) => b.id)).toEqual(['source', 'target']);
    expect(edgePolyline(store, edge, undefined, clear)).toEqual([
      [50, 50],
      [50, 300],
    ]);
    store.cells.nested = nested;
    frame.children.push('nested');
    const blocked = createEdgeRoutingContext(store, frame.id);
    assertClear(
      edgePolyline(store, edge, undefined, blocked),
      blocked.obstacles.filter((b) => b.id === 'nested'),
    );
    const geometry = new Map([['nested', { ...nested.geometry, x: 300 }]]);
    const preview = createEdgeRoutingContext(store, frame.id, geometry);
    expect(edgePolyline(store, edge, geometry, preview)).toEqual([
      [50, 50],
      [50, 300],
    ]);
  });

  it('uses rotated AABBs while retaining a diamond port and relative anchor', () => {
    const { store, edge } = fixture();
    const middle = store.cells.middle as NodeCell;
    middle.geometry.rotation = Math.PI / 4;
    const source = store.cells.source as NodeCell;
    source.geometry.outline = 'diamond';
    source.ports = [{ id: 'bottom', side: 'bottom', direction: 'output' }];
    edge.source = { cellId: 'source', portId: 'bottom', anchor: [0.5, 1] };
    const context = createEdgeRoutingContext(store, 'frame');
    const box = context.obstacles.find((b) => b.id === 'middle')!;
    expect(box.width).toBeGreaterThan(middle.geometry.width);
    assertClear(edgePolyline(store, edge, undefined, context), [box]);
    expect(context.routes.get('edge')!.result.points[0]).toEqual([50, 50]);
  });

  it('reuses routes outside changed regions but removes obsolete detours as a blocker moves away', () => {
    const { store, frame, edge } = fixture();
    const distant = node('distant', 400, 150);
    store.cells.distant = distant;
    frame.children.push(distant.id);
    const base = createEdgeRoutingContext(store, frame.id);
    const points = edgePolyline(store, edge, undefined, base);
    const farGeometry = new Map([['distant', { ...distant.geometry, x: 500 }]]);
    const far = createEdgeRoutingContext(store, frame.id, farGeometry, base);
    expect(edgePolyline(store, edge, farGeometry, far)).toBe(points);
    const movedGeometry = new Map([
      ['middle', { ...(store.cells.middle as NodeCell).geometry, x: 300 }],
    ]);
    const moved = createEdgeRoutingContext(
      store,
      frame.id,
      movedGeometry,
      base,
    );
    expect(edgePolyline(store, edge, movedGeometry, moved)).toEqual([
      [50, 50],
      [50, 300],
    ]);
    expect(moved.routes.get(edge.id)!.result.points).not.toBe(points);
  });

  it('leaves explicit bends, straight and curve modes under manual control', () => {
    const { store, edge } = fixture(),
      context = createEdgeRoutingContext(store, 'frame');
    for (const mode of ['fixed', 'orthogonal', 'straight', 'curve'] as const) {
      const manual = {
        ...edge,
        route: {
          mode,
          points: [
            [50, 50],
            [50, 175],
            [50, 300],
          ] as Point[],
        },
      };
      expect(edgePolyline(store, manual, undefined, context)).toEqual(
        manual.route.points,
      );
      expect(context.routes.size).toBe(0);
    }
    for (const mode of ['straight', 'curve'] as const)
      expect(
        edgePolyline(store, { ...edge, route: { mode } }, undefined, context),
      ).toEqual([
        [50, 50],
        [50, 300],
      ]);
    const start = { point: [50, 50] as Point, side: 'bottom' as const },
      end = { point: [50, 300] as Point, side: 'top' as const };
    expect(edgeRoutePoints(edge, start, end)).toEqual([
      [50, 50],
      [50, 300],
    ]);
  });

  it('retries a narrow terminal corridor with stroke-safe clearance', () => {
    const boxes = [
      { id: 'source', x: 0, y: 40, width: 40, height: 20 },
      { id: 'upper', x: 70, y: 0, width: 100, height: 40 },
      { id: 'lower', x: 70, y: 60, width: 100, height: 40 },
      { id: 'wall', x: 180, y: 40, width: 20, height: 20 },
    ];
    const result = routeOrthogonalAvoiding(
      [40, 50],
      'right',
      [230, 50],
      'left',
      boxes,
      { sourceId: 'source' },
    );
    expect(result.status).toBe('routed');
    assertClear(
      result.points,
      boxes.filter((b) => b.id !== 'source'),
    );
  });

  it('returns a finite editable fallback for overlapping endpoints blocked by another node', () => {
    const result = routeOrthogonalAvoiding(
      [0, 0],
      'right',
      [100, 100],
      'left',
      [{ id: 'sealed', x: -10, y: -10, width: 60, height: 60 }],
    );
    expect(result.status).toBe('blocked');
    expect(result.points.flat().every(Number.isFinite)).toBe(true);
  });

  it('shortens terminal jetties when a nearby node leaves less than 24px to turn', () => {
    const boxes = [
      { id: 'source', x: 0, y: 0, width: 100, height: 50 },
      { id: 'nearby', x: 110, y: 0, width: 40, height: 50 },
      { id: 'target', x: 400, y: 0, width: 100, height: 50 },
    ];
    const result = routeOrthogonalAvoiding(
      [100, 25],
      'right',
      [400, 25],
      'left',
      boxes,
      { sourceId: 'source', targetId: 'target' },
    );
    expect(result.status).toBe('routed');
    expect(result.points[1][0]).toBeGreaterThan(100);
    expect(result.points[1][0]).toBeLessThan(110);
    assertClear(result.points, [boxes[1]]);
    const free = routeOrthogonalAvoiding(
      [100, 25],
      'right',
      [400, 25],
      'left',
      [boxes[1]],
    );
    expect(free.status).toBe('routed');
    assertClear(free.points, [boxes[1]]);
  });

  it('finds deterministic paths through multiple staggered obstacles independently of input order', () => {
    const boxes = Array.from({ length: 8 }, (_, i) => ({
      id: `n${i}`,
      x: 70 + i * 80,
      y: i % 2 ? 20 : -60,
      width: 40,
      height: 100,
    }));
    const forward = routeOrthogonalAvoiding(
      [0, 0],
      'right',
      [800, 0],
      'left',
      boxes,
    );
    expect(forward.status).toBe('routed');
    assertClear(forward.points, boxes);
    expect(
      routeOrthogonalAvoiding(
        [0, 0],
        'right',
        [800, 0],
        'left',
        [...boxes].reverse(),
      ),
    ).toEqual(forward);
  });

  it('routes one hundred edges among one hundred nodes', () => {
    const boxes = Array.from({ length: 100 }, (_, i) => ({
      id: `n${i}`,
      x: 100 + (i % 10) * 180,
      y: Math.floor(i / 10) * 80,
      width: 100,
      height: 40,
    }));
    for (let i = 0; i < 100; i++) {
      const y = Math.floor(i / 10) * 80 + 10 + (i % 10);
      const result = routeOrthogonalAvoiding(
        [-50, y],
        'right',
        [2000, y],
        'left',
        boxes,
      );
      expect(result.status).toBe('routed');
      assertClear(result.points, boxes);
    }
  });
});
