import { describe, expect, it } from 'vitest';
import { roundNodePosition } from '@sue/board-core';
import { snapArrangementDelta } from './frame-alignment';

const bounds = { x: 0, y: 0, width: 40, height: 20 };
describe('screen-independent alignment snapping', () => {
  it('snaps edges and centers on both axes and reports the reference segments', () => {
    const result = snapArrangementDelta(
      bounds,
      [197, 98],
      [{ x: 200, y: 100, width: 40, height: 20 }],
      6,
    );
    expect(result.delta).toEqual([200, 100]);
    expect(result.guides.map((g) => g.axis)).toEqual(['x', 'y']);
    expect(result.guides[0].position).toBe(200);
  });
  it('uses the closest candidate, keeps stable ties, and stays outside the threshold', () => {
    const targets = [
      { x: 203, y: 300, width: 40, height: 20 },
      { x: 200, y: 500, width: 40, height: 20 },
    ];
    expect(snapArrangementDelta(bounds, [198, 90], targets, 6).delta).toEqual([
      200, 90,
    ]);
    expect(snapArrangementDelta(bounds, [170, 90], targets, 6).guides).toEqual(
      [],
    );
  });
  it('maintains the same six screen pixel radius at different Frame scales', () => {
    const targets = [{ x: 200, y: 100, width: 40, height: 20 }];
    expect(
      snapArrangementDelta(bounds, [196, 98], targets, 6 / 2).guides.map(
        (g) => g.axis,
      ),
    ).toEqual(['y']);
    expect(
      snapArrangementDelta(bounds, [192, 98], targets, 6 / 0.5).delta,
    ).toEqual([200, 100]);
  });
});

it('rounds a fractional legacy origin only once when no reference matches', () => {
  const delta = snapArrangementDelta(
    { ...bounds, x: 0.4 },
    [5.2, 0],
    [],
    6,
  ).delta;
  expect(roundNodePosition({ ...bounds, x: 0.4 + delta[0] }).x).toBe(6);
});
