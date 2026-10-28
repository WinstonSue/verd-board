import { describe, expect, it } from 'vitest';
import type { Point } from '../interfaces/point';
import {
  compactOrthogonalRoute,
  type CompactionRoute,
} from './route-compaction';
import { isClearOrthogonalRoute } from './obstacle-route';

const step: CompactionRoute = {
  id: 'step',
  bridgeable: true,
  points: [
    [0, 200],
    [0, 80],
    [100, 80],
    [100, 92],
    [300, 92],
    [300, 0],
  ],
};
const rails: CompactionRoute[] = [
  {
    id: 'upper',
    bridgeable: true,
    points: [
      [100, 80],
      [300, 80],
    ],
  },
  {
    id: 'lower',
    bridgeable: true,
    points: [
      [0, 92],
      [100, 92],
    ],
  },
];
const crossing: CompactionRoute = {
  id: 'crossing',
  bridgeable: true,
  points: [
    [150, 93],
    [150, 200],
  ],
};

describe('bounded orthogonal step compaction', () => {
  it('trades two needless bends for one visible bridge and prefers the corridor midpoint', () => {
    const before = structuredClone(step);
    const result = compactOrthogonalRoute(
      step,
      'top',
      'bottom',
      [],
      [...rails, crossing],
      {},
      1,
    )!;
    expect(result.points).toEqual([
      [0, 200],
      [0, 100],
      [300, 100],
      [300, 0],
    ]);
    expect(result.crossingDelta).toBe(1);
    expect(step).toEqual(before);
    expect(
      compactOrthogonalRoute(
        step,
        'top',
        'bottom',
        [],
        [...rails, crossing],
        {},
        0,
      ),
    ).toBeUndefined();
  });
  it('retains a necessary step when both straightening choices and the midpoint meet obstacles', () => {
    const obstacles = [
      { id: 'lower-obstacle', x: 40, y: 83, width: 20, height: 27 },
      { id: 'upper-obstacle', x: 150, y: 70, width: 20, height: 13 },
    ];
    expect(
      isClearOrthogonalRoute(step.points, 'top', 'bottom', obstacles, {
        clearance: 2,
      }),
    ).toBe(true);
    expect(
      compactOrthogonalRoute(
        step,
        'top',
        'bottom',
        obstacles,
        [],
        { clearance: 2 },
        1,
      ),
    ).toBeUndefined();
  });
  it('rejects shortcuts that add collinear overlap even when they reduce bends', () => {
    const obstacles = [
      { id: 'midpoint-blocker', x: 150, y: 95, width: 20, height: 10 },
    ];
    expect(
      compactOrthogonalRoute(
        step,
        'top',
        'bottom',
        obstacles,
        rails,
        { clearance: 2 },
        1,
      ),
    ).toBeUndefined();
  });
  it('rejects added crossings on curves or too close to a rounded corner', () => {
    expect(
      compactOrthogonalRoute(
        step,
        'top',
        'bottom',
        [],
        [...rails, { ...crossing, bridgeable: false }],
        {},
        1,
      ),
    ).toBeUndefined();
    expect(
      compactOrthogonalRoute(
        step,
        'top',
        'bottom',
        [],
        [
          ...rails,
          {
            ...crossing,
            points: [
              [5, 93],
              [5, 200],
            ],
          },
        ],
        {},
        1,
      ),
    ).toBeUndefined();
  });
  it('keeps endpoint exit directions and skips already simple paths', () => {
    const points: Point[] = [
      [0, 200],
      [0, 100],
      [300, 100],
      [300, 0],
    ];
    expect(
      compactOrthogonalRoute(
        { ...step, points },
        'top',
        'bottom',
        [],
        [],
        {},
        1,
      ),
    ).toBeUndefined();
    expect(isClearOrthogonalRoute(points, 'bottom', 'bottom', [], {})).toBe(
      false,
    );
    expect(isClearOrthogonalRoute(points, 'top', 'top', [], {})).toBe(false);
  });
});
