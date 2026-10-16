import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  createEdgeRoutingContext,
  edgePolyline,
  edgeTerminalPosition,
} from './edge';
import { routeOrthogonalAvoiding } from './obstacle-route';
import { edgeLabelLayout } from './edge-label';
import {
  createCellStore,
  createFrameCell,
  isEdgeCell,
  type CellStore,
  type EdgeCell,
  type FrameCell,
  type NodeCell,
} from '../cell/types';
import type { Point } from '../interfaces/point';
import { arrangeCells } from '../cell/arrangement';
import { applyCellOperations } from '../cell/index';
import { frameContentBounds } from '../cell/frame';

const fixture = (name: string): CellStore =>
  JSON.parse(
    readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        '../../../../../tests/fixtures/diagrams',
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
    const context = createEdgeRoutingContext(store, frame.id);
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

  it.each(['architecture-layered', 'architecture-data-flow'])(
    'reduces clutter in %s without changing document data',
    (name) => {
      const store = fixture(name),
        before = structuredClone(store);
      const context = createEdgeRoutingContext(store, store.rootId);
      const edges = edgesOf(store);
      const baseline = edges.map((edge) => {
        const source = edgeTerminalPosition(store, edge.source, edge.target);
        const target = edgeTerminalPosition(store, edge.target, edge.source);
        return routeOrthogonalAvoiding(
          source.point,
          source.side,
          target.point,
          target.side,
          context.obstacles,
          {
            sourceId: 'cellId' in edge.source ? edge.source.cellId : undefined,
            targetId: 'cellId' in edge.target ? edge.target.cellId : undefined,
          },
        ).points;
      });
      const routes = edges.map((edge) =>
        edgePolyline(store, edge, undefined, context),
      );
      const old = clutter(baseline),
        next = clutter(routes);
      expect(next.overlap).toBeLessThan(old.overlap / 4);
      expect(next.crossings).toBeLessThan(old.crossings);
      expect(store).toEqual(before);
      expect(
        [...context.routes.values()].every(
          (route) => route.result.status !== 'blocked',
        ),
      ).toBe(true);
      const reversed = structuredClone(store);
      (reversed.cells[store.rootId] as FrameCell).children.reverse();
      const other = createEdgeRoutingContext(reversed, reversed.rootId);
      for (const edge of [...edges].reverse())
        expect(
          edgePolyline(
            reversed,
            reversed.cells[edge.id] as EdgeCell,
            undefined,
            other,
          ),
        ).toEqual(context.routes.get(edge.id)!.result.points);
      const arranged = applyCellOperations(
        store,
        arrangeCells(store, store.rootId, [], 'layers'),
      );
      const arrangedContext = createEdgeRoutingContext(
        arranged,
        arranged.rootId,
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

  it('distributes automatic exits in destination order while preserving authored ports and points', () => {
    const store = fixture('architecture-data-flow');
    const edges = edgesOf(store);
    const source = edges.find((edge) => edge.labels?.[0]?.text === '白板')!;
    const sibling = edges.find((edge) => edge.labels?.[0]?.text === '工作流')!;
    const context = createEdgeRoutingContext(store, store.rootId);
    const first = edgePolyline(store, source, undefined, context);
    const second = edgePolyline(store, sibling, undefined, context);
    expect(first[0][0]).toBeLessThan(second[0][0]);
    source.source = { ...source.source, portId: 'bottom', anchor: [0.5, 1] };
    const fixed = createEdgeRoutingContext(store, store.rootId);
    expect(edgePolyline(store, source, undefined, fixed)[0]).toEqual(
      edgeTerminalPosition(store, source.source, source.target).point,
    );
    const manual = {
      ...sibling,
      route: {
        mode: 'orthogonal' as const,
        points: [
          edgeTerminalPosition(store, sibling.source, sibling.target).point,
          [100, 800],
          [1, 800],
          [1, 1320],
          edgeTerminalPosition(store, sibling.target, sibling.source).point,
        ] as Point[],
      },
    };
    expect(edgePolyline(store, manual, undefined, fixed)).toEqual(
      manual.route.points,
    );
  });

  it('keeps derived labels away from nodes and one another, and honors explicit positions', () => {
    const store = fixture('architecture-data-flow');
    const context = createEdgeRoutingContext(store, store.rootId);
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
    const routing = createEdgeRoutingContext(store, frame.id);
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
