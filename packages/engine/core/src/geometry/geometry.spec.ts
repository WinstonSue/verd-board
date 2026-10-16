import { describe, expect, it } from 'vitest';
import { nodeShapeSpec } from './shape';
import { facingSides, sideAnchor } from './side';
import { routeOrthogonal, routeOrthogonalLanes } from './route';
import { arrowHeadPoints, polylinePath, shortenPolyline } from './polyline';

describe('shared node geometry', () => {
  const box = { x: 0, y: 0, width: 100, height: 40 };

  it('draws a diamond from the rectangle edge centers', () => {
    expect(nodeShapeSpec('diamond', box)).toEqual({
      kind: 'polygon',
      points: '50,0 100,20 50,40 0,20',
    });
  });

  it('uses a capsule radius for terminals and a tenth for rounded rectangles', () => {
    expect(nodeShapeSpec('terminal', box).kind).toBe('rect');
    expect(nodeShapeSpec('terminal', box)).toMatchObject({ rx: 20, ry: 20 });
    expect(nodeShapeSpec('roundRectangle', box)).toMatchObject({
      rx: 4,
      ry: 4,
    });
  });

  it('places a port on the requested side', () => {
    expect(sideAnchor(box, 'right')).toEqual([100, 20]);
    expect(sideAnchor(box, 'top', 0.25)).toEqual([25, 0]);
  });

  it('picks facing sides from the longer center delta', () => {
    expect(facingSides(box, { x: 0, y: 80, width: 100, height: 40 })).toEqual({
      sourceSide: 'bottom',
      targetSide: 'top',
    });
  });

  it('routes workflow stubs and architecture lanes with the same side rules', () => {
    const routed = routeOrthogonal([100, 20], 'right', [200, 20], 'left', 24);
    expect(routed[0]).toEqual([100, 20]);
    expect(routed[routed.length - 1]).toEqual([200, 20]);
    const lanes = routeOrthogonalLanes(
      box,
      { x: 0, y: 120, width: 100, height: 40 },
      0,
      1,
    );
    expect(lanes[0][0]).toBe(50);
    expect(polylinePath(lanes, { commandGap: true }).startsWith('M ')).toBe(
      true,
    );
  });

  it('keeps a short workflow segment and clamps an architecture arrow', () => {
    const short: [number, number][] = [
      [0, 0],
      [4, 0],
    ];
    expect(shortenPolyline(short, 8, 'keep')).toEqual(short);
    expect(shortenPolyline(short, 8, 'clamp')[1][0]).toBe(0);
    expect(arrowHeadPoints(short, { size: 8, wing: 4 })).toContain('4,0');
  });
});
