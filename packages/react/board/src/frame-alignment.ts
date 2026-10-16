import type { Point, RectangleClient } from '@sue/board-core';

export interface AlignmentGuide {
  axis: 'x' | 'y';
  position: number;
  start: number;
  end: number;
}

/** All distances use Frame coordinates; the caller converts the 6 screen pixels. */
export function snapArrangementDelta(
  bounds: RectangleClient,
  delta: Point,
  targets: readonly RectangleClient[],
  threshold: number,
): { delta: Point; guides: AlignmentGuide[] } {
  const moved = { ...bounds, x: bounds.x + delta[0], y: bounds.y + delta[1] };
  const anchors = (b: RectangleClient, axis: 'x' | 'y') => {
    const size = axis === 'x' ? b.width : b.height;
    return [b[axis], b[axis] + size / 2, b[axis] + size];
  };
  const result: Point = [...delta];
  const guides: AlignmentGuide[] = [];
  for (const [at, axis] of (['x', 'y'] as const).entries()) {
    let best:
      | {
          distance: number;
          adjustment: number;
          position: number;
          target: RectangleClient;
        }
      | undefined;
    for (const target of targets)
      for (const position of anchors(target, axis))
        for (const own of anchors(moved, axis)) {
          const adjustment = position - own,
            distance = Math.abs(adjustment);
          if (
            distance <= threshold &&
            (!best || distance < best.distance - 1e-8)
          )
            best = { distance, adjustment, position, target };
        }
    if (!best) continue;
    // Round the final node position in the caller, not the delta: old origins may be fractional.
    result[at] = delta[at] + best.adjustment;
    const other = axis === 'x' ? 'y' : 'x';
    const size = axis === 'x' ? 'height' : 'width';
    guides.push({
      axis,
      position: best.position,
      start: Math.min(moved[other], best.target[other]) - 8,
      end:
        Math.max(
          moved[other] + moved[size],
          best.target[other] + best.target[size],
        ) + 8,
    });
  }
  return { delta: result, guides };
}
