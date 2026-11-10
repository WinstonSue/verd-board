import {
  createCellStore,
  createFrameCell,
  type EdgeCell,
  type Point,
} from '@sue/board-core';
import { describe, expect, it } from 'vitest';
import { createTestCellRegistry } from '../../../../tests/fixtures/plugins/registry';
import { planWaypointRemoval } from './frame-edge-waypoints';

const registry = createTestCellRegistry();

const store = createCellStore(createFrameCell('root'));
const edge = (
  mode: 'fixed' | 'straight' | 'curve' | 'orthogonal' | 'auto',
  points: Point[],
): EdgeCell => ({
  id: 'edge',
  kind: 'arrow',
  cellType: 'edge',
  source: { point: points[0] },
  target: { point: points.at(-1)! },
  route: mode === 'auto' ? { mode } : { mode, points },
  labels: [{ text: 'Keep label' }],
});
describe('local waypoint removal', () => {
  it.each(['fixed', 'straight', 'curve'] as const)(
    'removes only the requested %s interior point',
    (mode) => {
      const points: Point[] = [
        [0, 0],
        [20, 30],
        [70, 20],
        [100, 100],
      ];
      const original = edge(mode, points);
      const before = structuredClone(original);
      const result = planWaypointRemoval(store, original, points, 1, registry)!;
      expect(result.route).toEqual({
        mode,
        origin: 'manual',
        points: [
          [0, 0],
          [70, 20],
          [100, 100],
        ],
      });
      expect(result.source).toBe(original.source);
      expect(result.target).toBe(original.target);
      expect(result.labels).toBe(original.labels);
      expect(original).toEqual(before);
      expect(
        planWaypointRemoval(store, original, points, 0, registry),
      ).toBeNull();
      expect(
        planWaypointRemoval(
          store,
          original,
          points,
          points.length - 1,
          registry,
        ),
      ).toBeNull();
    },
  );
  it('keeps a two-point curve valid after its last intermediate point is removed', () => {
    const points: Point[] = [
      [0, 0],
      [50, 80],
      [100, 0],
    ];
    expect(
      planWaypointRemoval(store, edge('curve', points), points, 1, registry)
        ?.route,
    ).toEqual({
      mode: 'curve',
      origin: 'manual',
      points: [
        [0, 0],
        [100, 0],
      ],
    });
  });
  it('collapses a local orthogonal detour without changing distant corners', () => {
    const points: Point[] = [
      [0, 0],
      [20, 0],
      [20, 40],
      [40, 40],
      [40, 0],
      [60, 0],
      [60, 60],
      [80, 60],
      [80, 80],
      [100, 80],
    ];
    const original = edge('orthogonal', points);
    expect(
      planWaypointRemoval(store, original, points, 3, registry)?.route,
    ).toEqual({
      mode: 'orthogonal',
      origin: 'manual',
      points: [
        [0, 0],
        [60, 0],
        [60, 60],
        [80, 60],
        [80, 80],
        [100, 80],
      ],
    });
  });
  it('keeps a necessary L-shaped corner when the endpoints are not aligned', () => {
    const points: Point[] = [
      [0, 0],
      [100, 0],
      [100, 100],
    ];
    expect(
      planWaypointRemoval(
        store,
        edge('orthogonal', points),
        points,
        1,
        registry,
      ),
    ).toBeNull();
  });
  it.each(['U', 'shouldered U'] as const)(
    'flattens any corner of a %s in every orientation',
    (shape) => {
      const base: Point[] =
        shape === 'U'
          ? [
              [0, 100],
              [0, 0],
              [100, 0],
              [100, 100],
            ]
          : [
              [0, 100],
              [20, 100],
              [20, 0],
              [80, 0],
              [80, 100],
              [100, 100],
            ];
      for (let rotation = 0; rotation < 4; rotation++) {
        for (const reverse of [false, true]) {
          const points = base.map(([x, y]): Point => {
            for (let turn = 0; turn < rotation; turn++) [x, y] = [-y, x];
            return [x + 200, y + 200];
          });
          if (reverse) points.reverse();
          for (let index = 1; index < points.length - 1; index++) {
            const original = edge('orthogonal', points);
            const result = planWaypointRemoval(
              store,
              original,
              points,
              index,
              registry,
            );
            expect(result?.route).toEqual({
              mode: 'orthogonal',
              origin: 'manual',
              points: [points[0], points.at(-1)],
            });
            expect(original.route).toEqual({ mode: 'orthogonal', points });
          }
        }
      }
    },
  );
  it('reduces a step to an L without moving its endpoints', () => {
    const points: Point[] = [
      [0, 0],
      [50, 0],
      [50, 100],
      [100, 100],
    ];
    for (const index of [1, 2]) {
      const result = planWaypointRemoval(
        store,
        edge('orthogonal', points),
        points,
        index,
        registry,
      )!;
      expect(result.route.mode).toBe('orthogonal');
      const next = 'points' in result.route ? result.route.points! : [];
      expect(next).toHaveLength(3);
      expect(next[0]).toEqual(points[0]);
      expect(next.at(-1)).toEqual(points.at(-1));
      expect(next).not.toContainEqual(points[index]);
      expect(
        next.every(
          (point, at) =>
            at === 0 ||
            point[0] === next[at - 1][0] ||
            point[1] === next[at - 1][1],
        ),
      ).toBe(true);
    }
  });
  it.each(['workflow-edge', 'architecture-edge', 'uml-relation'])(
    'uses the registered orthogonal constraint for %s',
    (kind) => {
      const points: Point[] = [
        [0, 100],
        [0, 0],
        [100, 0],
        [100, 100],
      ];
      expect(registry.get(kind)?.orthogonalRoute).toBe(true);
      for (const mode of ['fixed', 'straight', 'curve', 'auto'] as const) {
        const original = { ...edge(mode, points), kind };
        const result = planWaypointRemoval(
          store,
          original,
          points,
          1,
          registry,
        )!;
        expect(result.route).toEqual({
          mode: 'orthogonal',
          origin: 'manual',
          points: [points[0], points.at(-1)],
        });
        expect(result.kind).toBe(kind);
        expect(result.source).toBe(original.source);
        expect(result.target).toBe(original.target);
      }
    },
  );
  it.each(['port', 'anchor', 'mixed'] as const)(
    'preserves %s bindings, labels and routing strategy while flattening a U',
    (binding) => {
      const points: Point[] = [
        [100, 150],
        [100, 50],
        [200, 50],
        [200, 150],
      ];
      const original: EdgeCell = {
        ...edge('orthogonal', points),
        source:
          binding === 'port'
            ? { cellId: 'a', portId: 'right' }
            : { cellId: 'a', anchor: [1, 0.5] },
        target:
          binding === 'mixed'
            ? { point: points.at(-1)! }
            : { cellId: 'b', portId: 'left' },
        route: { mode: 'orthogonal', points, strategy: 'optimized' },
      };
      const before = structuredClone(original);
      const result = planWaypointRemoval(store, original, points, 1, registry)!;
      expect(result.source).toBe(original.source);
      expect(result.target).toBe(original.target);
      expect(result.labels).toBe(original.labels);
      expect(result.route).toEqual({
        mode: 'orthogonal',
        origin: 'manual',
        points: [points[0], points.at(-1)],
        strategy: 'optimized',
      });
      expect(original).toEqual(before);
    },
  );
  it('materializes an automatic route while preserving its displayed terminal positions', () => {
    const value = structuredClone(store);
    value.cells.a = {
      id: 'a',
      cellType: 'node',
      kind: 'geometry',
      geometry: { x: 0, y: 0, width: 100, height: 100 },
    };
    value.cells.b = {
      id: 'b',
      cellType: 'node',
      kind: 'geometry',
      geometry: { x: 200, y: 0, width: 100, height: 100 },
    };
    const points: Point[] = [
      [100, 60],
      [120, 60],
      [120, 100],
      [180, 100],
      [180, 60],
      [200, 60],
    ];
    const original = {
      ...edge('auto', points),
      source: { cellId: 'a' },
      target: { cellId: 'b' },
    };
    const result = planWaypointRemoval(value, original, points, 2, registry)!;
    expect(result.source).toEqual({ cellId: 'a', anchor: [1, 0.6] });
    expect(result.target).toEqual({ cellId: 'b', anchor: [0, 0.6] });
    expect(result.route).toEqual({
      mode: 'orthogonal',
      origin: 'manual',
      points: [
        [100, 60],
        [200, 60],
      ],
    });
  });
});
