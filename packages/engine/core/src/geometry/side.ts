import type { Point } from '../interfaces/point';
import type { RectangleClient } from '../interfaces/rectangle-client';

export type GeometrySide = 'top' | 'right' | 'bottom' | 'left';

export const rectangleCenter = (rectangle: RectangleClient): Point => [
  rectangle.x + rectangle.width / 2,
  rectangle.y + rectangle.height / 2,
];

/** 按两个矩形中心的主方向，选出相向的边。 */
export const facingSides = (
  source: RectangleClient,
  target: RectangleClient,
): { sourceSide: GeometrySide; targetSide: GeometrySide } => {
  const [sourceX, sourceY] = rectangleCenter(source);
  const [targetX, targetY] = rectangleCenter(target);
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  if (Math.abs(dy) >= Math.abs(dx)) {
    return dy >= 0
      ? { sourceSide: 'bottom', targetSide: 'top' }
      : { sourceSide: 'top', targetSide: 'bottom' };
  }
  return dx >= 0
    ? { sourceSide: 'right', targetSide: 'left' }
    : { sourceSide: 'left', targetSide: 'right' };
};

export const sideAnchor = (
  rectangle: RectangleClient,
  side: GeometrySide,
  offset = 0.5,
): Point => {
  const t = offset;
  switch (side) {
    case 'top':
      return [rectangle.x + rectangle.width * t, rectangle.y];
    case 'right':
      return [
        rectangle.x + rectangle.width,
        rectangle.y + rectangle.height * t,
      ];
    case 'bottom':
      return [
        rectangle.x + rectangle.width * t,
        rectangle.y + rectangle.height,
      ];
    case 'left':
    default:
      return [rectangle.x, rectangle.y + rectangle.height * t];
  }
};

export const sideToConnection = (
  side: GeometrySide,
  offset = 0.5,
): [number, number] => {
  switch (side) {
    case 'top':
      return [offset, 0];
    case 'right':
      return [1, offset];
    case 'bottom':
      return [offset, 1];
    case 'left':
    default:
      return [0, offset];
  }
};
