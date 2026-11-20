import { resolveTerminal } from '../../../packages/engine/core/src/terminal/resolve';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createTestCellRegistry as createFixtureRegistry } from '../../fixtures/plugins/registry';
import { arrangeCells } from '../../../packages/engine/core/src/cell/arrangement';
import {
  planOptimizeEdges,
  planGeometryLayout,
  optimizeEdges,
} from '../../../packages/engine/core/src/cell/layout-plan';
import { applyCellOperations } from '../../../packages/engine/core/src/cell/index';
import {
  isEdgeCell,
  type CellStore,
  type EdgeCell,
  type FrameCell,
} from '../../../packages/engine/core/src/cell/types';
import type { Point } from '../../../packages/engine/core/src/interfaces/point';
import {
  createEdgeRoutingContext,
  edgePolyline,
} from '../../../packages/engine/core/src/geometry/edge';
import { edgeLabelLayout } from '../../../packages/engine/core/src/geometry/edge-label';
import { routeOrthogonalAvoiding } from '../../../packages/engine/core/src/geometry/obstacle-route';
import { edgeCrossingJumps } from '../../../packages/engine/core/src/geometry/edge-crossings';
const testCellRegistry = createFixtureRegistry();
const fixture = (name: string): CellStore =>
  JSON.parse(
    readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        '../../fixtures/diagrams',
        `${name}.json`,
      ),
      'utf8',
    ),
  ).store;
const edgesOf = (store: CellStore) =>
  Object.values(store.cells).filter(isEdgeCell);
const segments = (points: readonly Point[]) =>
  points.slice(1).map((end, at) => [points[at], end]);
const clutter = (routes: Point[][]) => {
  let crossings = 0,
    overlap = 0;
  for (let i = 0; i < routes.length; i++)
    for (let j = i + 1; j < routes.length; j++)
      for (const [a, b] of segments(routes[i]))
        for (const [c, d] of segments(routes[j])) {
          const horizontal = a[1] === b[1],
            otherHorizontal = c[1] === d[1];
          const axis = horizontal ? 0 : 1,
            other = 1 - axis;
          if (
            horizontal === otherHorizontal &&
            Math.abs(a[other] - c[other]) < 1e-6
          )
            overlap += Math.max(
              0,
              Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis])) -
                Math.max(
                  Math.min(a[axis], b[axis]),
                  Math.min(c[axis], d[axis]),
                ),
            );
          if (horizontal !== otherHorizontal) {
            const [h1, h2] = horizontal ? [a, b] : [c, d],
              [v1, v2] = horizontal ? [c, d] : [a, b];
            if (
              v1[0] > Math.min(h1[0], h2[0]) &&
              v1[0] < Math.max(h1[0], h2[0]) &&
              h1[1] > Math.min(v1[1], v2[1]) &&
              h1[1] < Math.max(v1[1], v2[1])
            )
              crossings++;
          }
        }
  return { crossings, overlap };
};
it('improves existing automatic diagrams with stable, persistent, bounded routing', () => {
  let improvements = 0;
  for (const name of [
    'architecture-layered',
    'architecture-data-flow',
    'architecture-packages',
  ]) {
    const store = fixture(name);
    const edges = edgesOf(store);
    const baseline = createEdgeRoutingContext(
      store,
      store.rootId,
      undefined,
      undefined,
      testCellRegistry,
      undefined,
    );
    const before = edges.map((edge) =>
      edgePolyline(store, edge, undefined, baseline),
    );
    const plan = planOptimizeEdges(
      store,
      edges.map((e) => e.id),
      testCellRegistry,
    );
    const next = applyCellOperations(store, plan.operations, testCellRegistry);
    const context = createEdgeRoutingContext(
      next,
      next.rootId,
      undefined,
      baseline,
      testCellRegistry,
    );
    const after = edges.map((edge) =>
      edgePolyline(next, next.cells[edge.id] as EdgeCell, undefined, context),
    );
    const old = clutter(before),
      quality = clutter(after);
    const bends = (paths: Point[][]) =>
      paths.reduce((sum, points) => sum + Math.max(0, points.length - 2), 0);
    if (
      quality.crossings < old.crossings ||
      quality.overlap < old.overlap ||
      bends(after) < bends(before)
    )
      improvements++;
    const distance = (points: Point[]) =>
      points
        .slice(1)
        .reduce(
          (sum, p, at) =>
            sum +
            Math.abs(p[0] - points[at][0]) +
            Math.abs(p[1] - points[at][1]),
          0,
        );
    const safeBaseline = [...baseline.routes.values()].every(
      (e) => e.result.status !== 'blocked',
    );
    if (safeBaseline)
      expect(
        after.reduce((sum, path) => sum + distance(path), 0),
      ).toBeLessThanOrEqual(
        before.reduce((sum, path) => sum + distance(path), 0) * 1.1 + 1e-6,
      );
    for (let at = 0; at < edges.length; at++) {
      if (safeBaseline)
        expect(distance(after[at])).toBeLessThanOrEqual(
          distance(before[at]) * 1.2 + 48 + 1e-6,
        );
      expect(after[at][0]).toEqual(before[at][0]);
      expect(after[at].at(-1)).toEqual(before[at].at(-1));
      if (plan.diagnostics.some((d) => d.cellIds.includes(edges[at].id)))
        expect(next.cells[edges[at].id]).toEqual(store.cells[edges[at].id]);
      else
        expect((next.cells[edges[at].id] as EdgeCell).route).toMatchObject({
          mode: 'orthogonal',
          origin: 'generated',
          points: expect.any(Array),
        });
    }
    const reloaded = JSON.parse(JSON.stringify(next)) as CellStore;
    (reloaded.cells[next.rootId] as FrameCell).children.reverse();
    const fresh = createEdgeRoutingContext(
      reloaded,
      next.rootId,
      undefined,
      undefined,
      testCellRegistry,
    );
    for (let at = 0; at < edges.length; at++)
      expect(
        edgePolyline(
          reloaded,
          reloaded.cells[edges[at].id] as EdgeCell,
          undefined,
          fresh,
        ),
      ).toEqual(after[at]);
    expect(
      optimizeEdges(
        next,
        edges.map((edge) => edge.id),
        testCellRegistry,
      ),
    ).toEqual([]);
  }
  expect(improvements).toBeGreaterThan(0);
});
describe('frame-wide connector planning', () => {
  it.each(['architecture-layered', 'architecture-data-flow'])(
    'reduces clutter in %s without changing document data',
    (name) => {
      const store = fixture(name),
        before = structuredClone(store);
      const context = createEdgeRoutingContext(
        store,
        store.rootId,
        undefined,
        undefined,
        testCellRegistry,
      );
      const edges = edgesOf(store);
      const baseline = edges.map((edge) => {
        const source = resolveTerminal(store, edge.source, edge.target)!;
        const target = resolveTerminal(store, edge.target, edge.source)!;
        return routeOrthogonalAvoiding(
          source.point,
          source.side,
          target.point,
          target.side,
          context.obstacles,
          {
            sourceId: 'cellId' in edge.source ? edge.source.cellId : undefined,
            targetId: 'cellId' in edge.target ? edge.target.cellId : undefined,
            visualGap: context.visualGap,
            strokeWidth: edge.appearance?.strokeWidth,
          },
        ).points;
      });
      const routes = edges.map((edge) =>
        edgePolyline(store, edge, undefined, context),
      );
      const old = clutter(baseline),
        next = clutter(routes);
      expect(next.overlap).toBeLessThan(old.overlap / 4);
      expect(next.crossings).toBeLessThanOrEqual(old.crossings);
      expect(store).toEqual(before);
      expect(
        [...context.routes.values()].every((route) =>
          route.result.points.every((p) => p.every(Number.isFinite)),
        ),
      ).toBe(true);
      const reversed = structuredClone(store);
      (reversed.cells[store.rootId] as FrameCell).children.reverse();
      const other = createEdgeRoutingContext(
        reversed,
        reversed.rootId,
        undefined,
        undefined,
        testCellRegistry,
      );
      for (const edge of [...edges].reverse())
        expect(
          edgePolyline(
            reversed,
            reversed.cells[edge.id] as EdgeCell,
            undefined,
            other,
          ),
        ).toEqual(routes[edges.findIndex((e) => e.id === edge.id)]);
      const arranged = applyCellOperations(
        store,
        arrangeCells(store, store.rootId, [], 'layers', 32, testCellRegistry),
        testCellRegistry,
      );
      const arrangedContext = createEdgeRoutingContext(
        arranged,
        arranged.rootId,
        undefined,
        undefined,
        testCellRegistry,
      );
      const arrangedClutter = clutter(
        edgesOf(arranged).map((edge) =>
          edgePolyline(arranged, edge, undefined, arrangedContext),
        ),
      );
      expect(arrangedClutter.crossings).toBeLessThanOrEqual(next.crossings);
      expect(arrangedClutter.overlap).toBeLessThan(old.overlap / 4);
    },
  );
  it('keeps the real 24-module package graph legible and deterministic after layout', () => {
    const before = fixture('architecture-packages');
    const plan = planGeometryLayout(
      before,
      { focus: [before.rootId], ids: [] },
      'layers',
      testCellRegistry,
    );
    expect(plan.diagnostics).toEqual([]);
    const store = applyCellOperations(
      before,
      plan.operations,
      testCellRegistry,
    );
    const original = structuredClone(store);
    const context = createEdgeRoutingContext(
      store,
      store.rootId,
      undefined,
      undefined,
      testCellRegistry,
    );
    const edges = edgesOf(store);
    const paths = edges.map((edge) =>
      edgePolyline(store, edge, undefined, context),
    );
    const mindToLayouts = edges.findIndex(
      (edge) => edge.id === 'demo:packages/edge/23',
    );
    expect(paths[mindToLayouts].length).toBeGreaterThanOrEqual(2);
    const jumps = edgeCrossingJumps(
      edges.map((edge, at) => ({ id: edge.id, points: paths[at] })),
    );
    expect(jumps.get(edges[mindToLayouts].id)?.length).toBeGreaterThanOrEqual(
      1,
    );
    expect(edges).toHaveLength(41);
    expect(
      Object.values(store.cells).filter(
        (cell) => cell.kind === 'architecture-module',
      ),
    ).toHaveLength(24);
    const quality = clutter(paths);
    expect(quality.crossings).toBeLessThanOrEqual(26);
    expect(quality.overlap).toBeLessThanOrEqual(16);
    const total = paths.reduce(
      (sum, path) =>
        sum +
        segments(path).reduce(
          (length, [a, b]) =>
            length + Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]),
          0,
        ),
      0,
    );
    expect(total).toBeLessThanOrEqual(45000);
    expect(
      [...context.routes.values()].every(
        (route) => route.result.status !== 'blocked',
      ),
    ).toBe(true);
    for (let at = 0; at < edges.length; at++)
      for (const [a, b] of segments(paths[at]))
        for (const obstacle of context.obstacles) {
          if (
            [edges[at].source, edges[at].target].some(
              (end) => 'cellId' in end && end.cellId === obstacle.id,
            )
          )
            continue;
          const horizontal = a[1] === b[1];
          const cuts = horizontal
            ? a[1] > obstacle.y &&
              a[1] < obstacle.y + obstacle.height &&
              Math.max(a[0], b[0]) > obstacle.x &&
              Math.min(a[0], b[0]) < obstacle.x + obstacle.width
            : a[0] > obstacle.x &&
              a[0] < obstacle.x + obstacle.width &&
              Math.max(a[1], b[1]) > obstacle.y &&
              Math.min(a[1], b[1]) < obstacle.y + obstacle.height;
          expect(cuts, `${edges[at].id} crosses ${obstacle.id}`).toBe(false);
        }
    expect(store).toEqual(original);
    expect(
      arrangeCells(store, store.rootId, [], 'layers', 32, testCellRegistry),
    ).toEqual([]);
    const reversed = structuredClone(store);
    (reversed.cells[store.rootId] as FrameCell).children.reverse();
    const other = createEdgeRoutingContext(
      reversed,
      reversed.rootId,
      undefined,
      undefined,
      testCellRegistry,
    );
    for (const edge of [...edges].reverse())
      expect(
        edgePolyline(
          reversed,
          reversed.cells[edge.id] as EdgeCell,
          undefined,
          other,
        ),
      ).toEqual(paths[edges.findIndex((e) => e.id === edge.id)]);
  });
  it('distributes automatic exits in destination order while preserving authored ports and points', () => {
    const store = fixture('architecture-data-flow');
    const edges = edgesOf(store);
    const source = edges.find((edge) => edge.labels?.[0]?.text === '白板')!;
    const sibling = edges.find((edge) => edge.labels?.[0]?.text === '工作流')!;
    const context = createEdgeRoutingContext(
      store,
      store.rootId,
      undefined,
      undefined,
      testCellRegistry,
    );
    const first = edgePolyline(store, source, undefined, context);
    const second = edgePolyline(store, sibling, undefined, context);
    expect(first[0][0]).toBeLessThan(second[0][0]);
    source.source = { ...source.source, portId: 'bottom', anchor: [0.5, 1] };
    const fixed = createEdgeRoutingContext(
      store,
      store.rootId,
      undefined,
      undefined,
      testCellRegistry,
    );
    expect(edgePolyline(store, source, undefined, fixed)[0]).toEqual(
      resolveTerminal(store, source.source, source.target)!.point,
    );
    const manual = {
      ...sibling,
      route: {
        mode: 'orthogonal' as const,
        points: [
          resolveTerminal(store, sibling.source, sibling.target)!.point,
          [100, 800],
          [1, 800],
          [1, 1320],
          resolveTerminal(store, sibling.target, sibling.source)!.point,
        ] as Point[],
      },
    };
    expect(edgePolyline(store, manual, undefined, fixed)).toEqual(
      manual.route.points,
    );
  });
  it('keeps derived labels away from nodes and one another, and honors explicit positions', () => {
    const store = fixture('architecture-data-flow');
    const context = createEdgeRoutingContext(
      store,
      store.rootId,
      undefined,
      undefined,
      testCellRegistry,
    );
    const labels = edgesOf(store)
      .filter((edge) => edge.labels?.length)
      .map((edge) => {
        const points = edgePolyline(store, edge, undefined, context);
        return edgeLabelLayout(edge, 0, points, context).bounds;
      });
    const overlaps = (a: (typeof labels)[number], b: (typeof labels)[number]) =>
      a.x < b.x + b.width &&
      a.x + a.width > b.x &&
      a.y < b.y + b.height &&
      a.y + a.height > b.y;
    labels.forEach((bounds, at) => {
      expect(context.obstacles.some((box) => overlaps(bounds, box))).toBe(
        false,
      );
      expect(labels.slice(at + 1).some((box) => overlaps(bounds, box))).toBe(
        false,
      );
    });
    const edge = edgesOf(store)[0];
    const authored = { ...edge, labels: [{ text: 'Pinned', position: 0.25 }] };
    expect(
      edgeLabelLayout(
        authored,
        0,
        [
          [0, 0],
          [400, 0],
        ],
        context,
      ),
    ).toEqual({
      point: [100, 0],
      bounds: { x: 0, y: -26, width: 200, height: 36 },
    });
  });
});
