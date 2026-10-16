import { describe, expect, it } from 'vitest';
import {
  hitVectorLine,
  isClosedPath,
  moveVectorLinePoint,
  pathNodePoints,
  removeVectorLinePoint,
  replaceVectorLinePoints,
  vectorLinePath,
  vectorLineMidpoints,
  setVectorLineShape,
  type VectorLineData,
} from './path-node';
import type { NodeCell } from '../cell/types';
import type { Point } from '../interfaces/point';
import { flattenCurve } from './edge';
const line = (points: Point[], shape: VectorLineData['shape'] = 'straight') =>
  replaceVectorLinePoints(
    {
      id: 'line',
      kind: 'vector-line',
      cellType: 'node',
      geometry: { x: 0, y: 0, width: 1, height: 1 },
      data: { points: [], shape },
      appearance: { strokeWidth: 2, fill: 'none' },
    },
    points,
  );
const world = (cell: NodeCell<VectorLineData>) =>
  pathNodePoints(cell).map(([x, y]) => {
    const { geometry: g } = cell,
      cx = g.x + g.width / 2,
      cy = g.y + g.height / 2,
      a = g.rotation ?? 0;
    return [
      cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a),
      cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a),
    ];
  });
describe('vector line geometry and edits', () => {
  it('retains authored points and emits straight, smooth and closed paths', () => {
    const points: Point[] = [
      [10, 20],
      [80, 20],
      [80, 90],
      [10, 20],
    ];
    const cell = line(points);
    expect(pathNodePoints(cell)).toEqual(points);
    expect(vectorLinePath(points, 'straight')).toContain(' Z');
    expect(vectorLinePath(points, 'curve')).toContain(' C');
    expect(isClosedPath(points)).toBe(true);
  });
  it('hits the actual curve and ignores the straight chord and unfilled interior', () => {
    const cell = line(
      [
        [0, 0],
        [100, 100],
        [200, 0],
      ],
      'curve',
    );
    const point = flattenCurve(pathNodePoints(cell))[12];
    expect(hitVectorLine(cell, point, 0)).toBe(true);
    expect(hitVectorLine(cell, [50, 50], 0)).toBe(false);
    const triangle = line([
      [0, 0],
      [100, 0],
      [50, 100],
      [0, 0],
    ]);
    expect(hitVectorLine(triangle, [50, 40], 0)).toBe(false);
    expect(
      hitVectorLine(
        { ...triangle, appearance: { ...triangle.appearance, fill: '#fff' } },
        [50, 40],
        0,
      ),
    ).toBe(true);
  });
  it('moves a closed endpoint together with its duplicate and supports segment insertion', () => {
    const cell = line([
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 0],
    ]);
    const moved = moveVectorLinePoint(cell, 0, [-20, 30]);
    const points = pathNodePoints(moved);
    expect(points[0]).toEqual([-20, 30]);
    expect(points.at(-1)).toEqual(points[0]);
    const inserted = moveVectorLinePoint(moved, 1, [120, 50], true);
    expect(pathNodePoints(inserted)).toHaveLength(5);
    expect(isClosedPath(pathNodePoints(inserted))).toBe(true);
    expect(pathNodePoints(removeVectorLinePoint(inserted, 2))).toEqual(points);
    expect(cell.data!.points[0]).toEqual([0, 0]);
  });
  it('closes an open endpoint only inside the snap radius', () => {
    const cell = line([
      [0, 0],
      [100, 100],
      [100, 0],
    ]);
    expect(
      isClosedPath(
        pathNodePoints(moveVectorLinePoint(cell, 2, [3, 2], false, 8)),
      ),
    ).toBe(true);
    expect(
      isClosedPath(
        pathNodePoints(moveVectorLinePoint(cell, 2, [30, 20], false, 8)),
      ),
    ).toBe(false);
  });
  it('keeps untouched world vertices fixed when rotated edits change the bounding box', () => {
    const cell = {
      ...line([
        [20, 30],
        [120, 30],
        [120, 130],
      ]),
      geometry: {
        x: 20,
        y: 30,
        width: 100,
        height: 100,
        rotation: Math.PI / 3,
      },
    };
    const before = world(cell),
      moved = moveVectorLinePoint(cell, 0, [-20, -30]),
      after = world(moved);
    expect(moved.geometry.rotation).toBe(cell.geometry.rotation);
    for (let i = 1; i < before.length; i++) {
      expect(after[i][0]).toBeCloseTo(before[i][0]);
      expect(after[i][1]).toBeCloseTo(before[i][1]);
    }
  });
  it('puts curve insertion handles on the actual path and refreshes the curve bounds', () => {
    const points: Point[] = [
      [0, 0],
      [100, 100],
      [200, 0],
    ];
    expect(vectorLineMidpoints(points, 'curve')).toEqual([
      flattenCurve(points)[12],
      flattenCurve(points)[36],
    ]);
    expect(vectorLineMidpoints(points, 'curve')[0][1]).not.toBe(50);
    const curved = setVectorLineShape(line(points), 'curve');
    expect(pathNodePoints(curved)).toEqual(points);
    expect(curved.data!.shape).toBe('curve');
  });
  it('refuses invalid coordinates, missing vertices and removal below two vertices', () => {
    expect(() =>
      line([
        [0, 0],
        [NaN, 1],
      ]),
    ).toThrow(/finite/);
    const cell = line([
      [0, 0],
      [100, 100],
    ]);
    expect(() => moveVectorLinePoint(cell, 2, [20, 30])).toThrow(/Missing/);
    expect(() => removeVectorLinePoint(cell, 0)).toThrow(/two/);
  });
});
