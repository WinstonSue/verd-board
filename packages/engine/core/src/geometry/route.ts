import type { Point } from '../interfaces/point';
import type { RectangleClient } from '../interfaces/rectangle-client';
import { facingSides, sideAnchor, type GeometrySide } from './side';

const outward = (side: GeometrySide, point: Point, margin: number): Point => {
  switch (side) {
    case 'top':
      return [point[0], point[1] - margin];
    case 'bottom':
      return [point[0], point[1] + margin];
    case 'left':
      return [point[0] - margin, point[1]];
    case 'right':
    default:
      return [point[0] + margin, point[1]];
  }
};

const horizontal = (side: GeometrySide) => side === 'left' || side === 'right';

const facingGap = (
  source: Point,
  sourceSide: GeometrySide,
  target: Point,
  targetSide: GeometrySide,
) => {
  if (sourceSide === 'bottom' && targetSide === 'top') {
    return target[1] - source[1];
  }
  if (sourceSide === 'top' && targetSide === 'bottom') {
    return source[1] - target[1];
  }
  if (sourceSide === 'right' && targetSide === 'left') {
    return target[0] - source[0];
  }
  if (sourceSide === 'left' && targetSide === 'right') {
    return source[0] - target[0];
  }
  return undefined;
};

export const simplifyOrthogonal = (points: readonly Point[]): Point[] => {
  const unique: Point[] = [];
  points.forEach((point) => {
    const previous = unique[unique.length - 1];
    if (previous && previous[0] === point[0] && previous[1] === point[1]) {
      return;
    }
    unique.push(point);
  });
  let index = 1;
  while (index < unique.length - 1) {
    const previous = unique[index - 1];
    const current = unique[index];
    const next = unique[index + 1];
    const collinear =
      (previous[0] === current[0] && current[0] === next[0]) ||
      (previous[1] === current[1] && current[1] === next[1]);
    if (collinear) {
      unique.splice(index, 1);
    } else {
      index += 1;
    }
  }
  return unique;
};

/** 从端口伸出短桩后再走正交折线。流程连线用这一套。 */
export const routeOrthogonal = (
  source: Point,
  sourceSide: GeometrySide,
  target: Point,
  targetSide: GeometrySide,
  margin = 24,
): Point[] => {
  const gap = facingGap(source, sourceSide, target, targetSide);
  const stub =
    gap !== undefined && gap > 0 ? Math.min(margin, gap / 2) : margin;
  const sourceStub = outward(sourceSide, source, stub);
  const targetStub = outward(targetSide, target, stub);
  const points: Point[] = [source, sourceStub];
  if (horizontal(sourceSide) === horizontal(targetSide)) {
    if (horizontal(sourceSide)) {
      const midX = (sourceStub[0] + targetStub[0]) / 2;
      points.push([midX, sourceStub[1]], [midX, targetStub[1]]);
    } else {
      const midY = (sourceStub[1] + targetStub[1]) / 2;
      points.push([sourceStub[0], midY], [targetStub[0], midY]);
    }
  } else if (horizontal(sourceSide)) {
    points.push([targetStub[0], sourceStub[1]]);
  } else {
    points.push([sourceStub[0], targetStub[1]]);
  }
  points.push(targetStub, target);
  return simplifyOrthogonal(points);
};

/**
 * 从矩形边中点直接走到对侧，同一出口的多条边按 lane 错开。
 * 架构依赖用这一套。
 */
export const routeOrthogonalLanes = (
  source: RectangleClient,
  target: RectangleClient,
  lane = 0,
  laneCount = 1,
  laneGap = 12,
): Point[] => {
  const { sourceSide, targetSide } = facingSides(source, target);
  const start = sideAnchor(source, sourceSide);
  const end = sideAnchor(target, targetSide);
  const offset = (lane - (laneCount - 1) / 2) * laneGap;
  const vertical = sourceSide === 'top' || sourceSide === 'bottom';
  if (vertical) {
    if (Math.abs(start[0] - end[0]) < 0.5) {
      return [start, end];
    }
    const midY = (start[1] + end[1]) / 2 + offset;
    return [start, [start[0], midY], [end[0], midY], end];
  }
  if (Math.abs(start[1] - end[1]) < 0.5) {
    return [start, end];
  }
  const midX = (start[0] + end[0]) / 2 + offset;
  return [start, [midX, start[1]], [midX, end[1]], end];
};
