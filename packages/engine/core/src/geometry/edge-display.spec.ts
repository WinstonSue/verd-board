import { describe, expect, it } from 'vitest';
import { edgeDisplayGeometry } from './edge-display';
import { arrowMarkerGeometry, curvePath } from './edge';

describe('display-only port clipping', () => {
  it('clips both circles with stroke clearance without changing the route', () => {
    const points: [number, number][] = [
      [0, 0],
      [30, 0],
      [30, 100],
      [90, 100],
    ];
    const before = structuredClone(points);
    const result = edgeDisplayGeometry(points, false, 10, 12);
    expect(result.markerPoints[0][0]).toBeCloseTo(10, 6);
    expect(result.markerPoints.at(-1)![0]).toBeCloseTo(78, 6);
    expect(result.path).toContain('L30 0 L30 100');
    expect(points).toEqual(before);
    expect(
      arrowMarkerGeometry(result.markerPoints, 'arrow', true)?.path,
    ).toContain(`${result.markerPoints[0][0]} 0`);
    expect(arrowMarkerGeometry(result.markerPoints, 'arrow')?.path).toContain(
      `${result.markerPoints.at(-1)![0]} 100`,
    );
  });
  it('retains exact cubics, tangent markers, and canonical export endpoints', () => {
    const points: [number, number][] = [
      [0, 0],
      [60, 40],
      [120, 0],
    ];
    const plain = edgeDisplayGeometry(points, true);
    expect(plain.path).toBe(curvePath(points));
    const trimmed = edgeDisplayGeometry(points, true, 8, 11);
    const [start, a, b, end] = trimmed.markerPoints;
    expect(Math.hypot(...start)).toBeCloseTo(8, 6);
    expect(Math.hypot(end[0] - 120, end[1])).toBeCloseTo(11, 6);
    expect(a[0]).toBeGreaterThan(start[0]);
    expect(b[0]).toBeLessThan(end[0]);
    expect(trimmed.path.match(/ C/g)).toHaveLength(2);
  });
  it.each([0, 1e-12, 1, 10])(
    'suppresses overlapping clipped endpoints on a %s long line',
    (length) => {
      const result = edgeDisplayGeometry(
        [
          [0, 0],
          [length, 0],
        ],
        true,
        7,
        7,
      );
      expect(result).toEqual({ path: '', markerPoints: [] });
    },
  );
});
