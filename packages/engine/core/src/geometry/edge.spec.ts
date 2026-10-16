import { describe, expect, it } from 'vitest';
import {
  arrowMarkerGeometry,
  edgeRoutePoints,
  portAnchor,
  relativeAnchor,
  curvePath,
  terminalCurvePath,
} from './edge';
import { polylinePointAt } from './polyline';
import type { EdgeCell } from '../cell/types';
describe('shared edge geometry', () => {
  it('fans nine siblings out in order without reversing along the growth axis', () => {
    for (const [sourceSide, targetSide, vertical, sign] of [
      ['right', 'left', false, 1],
      ['left', 'right', false, -1],
      ['bottom', 'top', true, 1],
      ['top', 'bottom', true, -1],
    ] as const)
      for (const gap of [8, 124]) {
        const curves = [-446, -349, -252, -156, -24, 145, 278, 375, 471].map(
          (offset) => {
            const target: [number, number] = vertical
              ? [offset, gap * sign]
              : [gap * sign, offset];
            const path = terminalCurvePath(
              { point: [0, 0], side: sourceSide },
              { point: target, side: targetSide },
            );
            const values = path.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
            return Array.from({ length: 101 }, (_, at) => {
              const t = at / 100,
                u = 1 - t;
              return [0, 1].map(
                (axis) =>
                  u ** 3 * values[axis] +
                  3 * u ** 2 * t * values[axis + 2] +
                  3 * u * t ** 2 * values[axis + 4] +
                  t ** 3 * values[axis + 6],
              );
            });
          },
        );
        curves.forEach((points, curve) =>
          points.forEach((point, at) => {
            const growth = point[vertical ? 1 : 0] * sign;
            expect(growth).toBeGreaterThanOrEqual(0);
            expect(growth).toBeLessThanOrEqual(gap);
            if (at)
              expect(growth).toBeGreaterThanOrEqual(
                points[at - 1][vertical ? 1 : 0] * sign,
              );
            if (curve && at)
              expect(point[vertical ? 0 : 1]).toBeGreaterThan(
                curves[curve - 1][at][vertical ? 0 : 1],
              );
          }),
        );
      }
  });
  it('retains existing tangents for indented, non-facing and coincident endpoints', () => {
    expect(
      terminalCurvePath(
        { point: [100, 0], side: 'right' },
        { point: [0, 0], side: 'left' },
      ),
    ).toBe('M100 0 C150 0 -50 0 0 0');
    expect(
      terminalCurvePath(
        { point: [0, 0], side: 'right' },
        { point: [0, 0], side: 'left' },
      ),
    ).toBe('M0 0 C24 0 -24 0 0 0');
  });
  it('retains port tangents for a two-terminal curve in either direction', () => {
    expect(
      terminalCurvePath(
        { point: [0, 0], side: 'right' },
        { point: [100, 0], side: 'left' },
      ),
    ).toBe('M0 0 C50 0 50 0 100 0');
    expect(
      terminalCurvePath(
        { point: [0, 0], side: 'bottom' },
        { point: [0, 100], side: 'top' },
      ),
    ).toBe('M0 0 C0 50 0 50 0 100');
    expect(
      terminalCurvePath(
        { point: [0, 0], side: 'top' },
        { point: [0, -100], side: 'bottom' },
      ),
    ).toBe('M0 0 C0 -50 0 -50 0 -100');
  });
  it('keeps authored orthogonal legs aligned when bound endpoints move', () => {
    const edge: EdgeCell = {
      id: 'e',
      kind: 'arrow',
      cellType: 'edge',
      source: { cellId: 'a' },
      target: { cellId: 'b' },
      route: {
        mode: 'orthogonal',
        points: [
          [0, 0],
          [50, 0],
          [50, 100],
          [100, 100],
        ],
      },
    };
    const result = edgeRoutePoints(
      edge,
      { point: [10, 20], side: 'right' },
      { point: [120, 140], side: 'left' },
    );
    expect(result).toEqual([
      [10, 20],
      [50, 20],
      [50, 140],
      [120, 140],
    ]);
    expect(edge.route).toEqual({
      mode: 'orthogonal',
      points: [
        [0, 0],
        [50, 0],
        [50, 100],
        [100, 100],
      ],
    });
    for (const mode of ['fixed', 'curve', 'straight'] as const)
      expect(
        edgeRoutePoints(
          { ...edge, route: { ...edge.route, mode } },
          { point: [10, 20], side: 'right' },
          { point: [120, 140], side: 'left' },
        ).slice(1, -1),
      ).toEqual([
        [50, 0],
        [50, 100],
      ]);
  });

  it('handles direct, single-corner and collapsed manual orthogonal routes after endpoints move', () => {
    for (const points of [
      [
        [0, 0],
        [100, 0],
      ],
      [
        [0, 0],
        [100, 0],
        [100, 100],
      ],
      [
        [0, 0],
        [0, 0],
        [0, 0],
      ],
      [
        [0, 0],
        [50, 0],
        [50, 100],
        [100, 100],
      ],
    ] as Point[][]) {
      const edge: EdgeCell = {
        id: 'edge',
        kind: 'arrow',
        cellType: 'edge',
        source: { cellId: 'source' },
        target: { cellId: 'target' },
        route: { mode: 'orthogonal', points },
      };
      const result = edgeRoutePoints(
        edge,
        { point: [50, 100], side: 'right' },
        { point: [50, 140], side: 'left' },
      );
      expect(result[0]).toEqual([50, 100]);
      expect(result.at(-1)).toEqual([50, 140]);
      expect(result.flat().every(Number.isFinite)).toBe(true);
      result
        .slice(1)
        .forEach((point, at) =>
          expect(point[0] === result[at][0] || point[1] === result[at][1]).toBe(
            true,
          ),
        );
    }
  });
  it('uses rotated port positions and exact relative bindings', () => {
    const geometry = {
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      rotation: Math.PI / 2,
    };
    const port = portAnchor(geometry, { side: 'right', offset: 0.5 });
    expect(port.side).toBe('bottom');
    expect(port.point[0]).toBeCloseTo(50);
    expect(port.point[1]).toBeCloseTo(75);
    const anchor = relativeAnchor(geometry, [0.25, 0]);
    expect(anchor[0]).toBeCloseTo(75);
    expect(anchor[1]).toBeCloseTo(0);
  });
  it('places multiple labels by distance along the route and clamps positions', () => {
    const points: [number, number][] = [
      [0, 0],
      [100, 0],
      [100, 100],
    ];
    expect(polylinePointAt(points, 0.25)).toEqual([50, 0]);
    expect(polylinePointAt(points, 0.75)).toEqual([100, 50]);
    expect(polylinePointAt(points, 2)).toEqual([100, 100]);
  });
  it('distinguishes open, solid and hollow markers on either endpoint', () => {
    const points: [number, number][] = [
      [0, 0],
      [100, 0],
    ];
    expect(arrowMarkerGeometry(points, 'none')).toBeUndefined();
    expect(arrowMarkerGeometry(points, 'arrow')?.fill).toBe('none');
    expect(arrowMarkerGeometry(points, 'solid-triangle')?.fill).toBe('stroke');
    expect(arrowMarkerGeometry(points, 'triangle_outline')?.fill).toBe(
      'background',
    );
    expect(arrowMarkerGeometry(points, 'diamond')?.fill).toBe('stroke');
    expect(arrowMarkerGeometry(points, 'arrow', true)?.path).toContain('L0 0');
    expect(
      curvePath([
        [0, 0],
        [100, 100],
        [200, 0],
      ]),
    ).toContain(' C');
  });
});
