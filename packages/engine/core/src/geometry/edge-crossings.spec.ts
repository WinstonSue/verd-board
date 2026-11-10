import { describe, expect, it } from 'vitest';
import {
  decoratedPolylinePath,
  edgeCrossingJumps,
  type CrossingRoute,
} from './edge-crossings';
import { edgeDisplayGeometry } from './edge-display';

describe('connector crossing display', () => {
  const routes: CrossingRoute[] = [
    {
      id: 'horizontal',
      points: [
        [0, 50],
        [100, 50],
      ],
    },
    {
      id: 'vertical',
      points: [
        [50, 0],
        [50, 100],
      ],
    },
  ];
  it('adds one arc to a strict crossing with stable ownership and unchanged terminals', () => {
    const jumps = edgeCrossingJumps(routes);
    expect(jumps.size).toBe(1);
    expect(jumps.get('horizontal')).toEqual([{ point: [50, 50], radius: 6 }]);
    expect(edgeCrossingJumps([...routes].reverse())).toEqual(jumps);
    const original = structuredClone(routes);
    const display = edgeDisplayGeometry(routes[0].points, false, 0, 0, {
      jumps: jumps.get('horizontal'),
    });
    expect(display.path).toContain('A6 6');
    expect(display.markerPoints[0]).toEqual([0, 50]);
    expect(display.markerPoints.at(-1)).toEqual([100, 50]);
    expect(routes).toEqual(original);
  });
  it('ignores shared endpoints, collinear overlaps and crossings too close to an arrowhead', () => {
    for (const route of [
      {
        id: 'shared',
        points: [
          [100, 50],
          [100, 150],
        ],
      },
      {
        id: 'collinear',
        points: [
          [30, 50],
          [200, 50],
        ],
      },
      {
        id: 'near',
        points: [
          [5, 0],
          [5, 100],
        ],
      },
    ] as CrossingRoute[])
      expect(edgeCrossingJumps([routes[0], route]).size).toBe(0);
  });
  it('supports diagonal straight lines and limits adjacent bridge radii', () => {
    const jumps = edgeCrossingJumps([
      ...routes,
      {
        id: 'nearby',
        points: [
          [56, 0],
          [56, 100],
        ],
      },
    ]);
    const path = decoratedPolylinePath(
      routes[0].points,
      jumps.get('horizontal'),
    );
    const radii = [...path.matchAll(/A([\d.]+) /g)].map((match) =>
      Number(match[1]),
    );
    expect(radii).toHaveLength(2);
    radii.forEach((radius) => expect(radius).toBeCloseTo(3));
    expect(
      edgeCrossingJumps([
        {
          id: 'a',
          points: [
            [0, 0],
            [100, 100],
          ],
        },
        {
          id: 'b',
          points: [
            [0, 100],
            [100, 0],
          ],
        },
      ]).size,
    ).toBe(1);
  });
  it('rounds corners without changing curved connector geometry or clipped marker tangents', () => {
    const points: [number, number][] = [
      [0, 0],
      [100, 0],
      [100, 100],
    ];
    expect(decoratedPolylinePath(points, [], 6)).toContain('Q100 0 100 6');
    expect(
      edgeDisplayGeometry(points, true, 5, 5, {
        jumps: [{ point: [50, 0], radius: 6 }],
        cornerRadius: 6,
      }),
    ).toEqual(edgeDisplayGeometry(points, true, 5, 5));
  });
  it('reduces only a corner whose visible envelope reaches a safety obstacle', () => {
    const points: [number, number][] = [
      [0, 0],
      [100, 0],
      [100, 100],
      [200, 100],
    ];
    const path = decoratedPolylinePath(points, [], 6, [
      { x: 102, y: -10, width: 20, height: 20 },
    ]);
    expect(path).toContain('Q100 0 100 2');
    expect(path).toContain('Q100 100 106 100');
    expect(points).toEqual([
      [0, 0],
      [100, 0],
      [100, 100],
      [200, 100],
    ]);
  });
});
