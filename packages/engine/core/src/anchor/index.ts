import type { NodeGeometry } from '../cell/types';
import { nodeShapeGeometry, unrotateNodePoint } from '../geometry/node';
import { rotateGeometrySide, type GeometrySide } from '../geometry/side';
import type { Point } from '../interfaces/point';

/** A position relative to a node's unrotated bounds. Serialized as [x, y]. */
export type Anchor = [number, number];

/** A resolved attachment in the owning Frame's coordinate system. */
export interface ResolvedAnchor {
  point: Point;
  side: GeometrySide;
}

export const isValidAnchor = (value: unknown): value is Anchor =>
  Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);

export const resolveAnchor = (
  geometry: NodeGeometry,
  anchor: Anchor,
): ResolvedAnchor => {
  const point: Point = [
    geometry.x + geometry.width * anchor[0],
    geometry.y + geometry.height * anchor[1],
  ];
  const rotation = geometry.rotation ?? 0,
    cx = geometry.x + geometry.width / 2,
    cy = geometry.y + geometry.height / 2;
  const dx = point[0] - cx,
    dy = point[1] - cy;
  return {
    point: [
      cx + dx * Math.cos(rotation) - dy * Math.sin(rotation),
      cy + dx * Math.sin(rotation) + dy * Math.cos(rotation),
    ],
    side: rotateGeometrySide(anchorSide(anchor), rotation),
  };
};

/** Capture a Frame-space point, optionally snapping it to the node outline. */
export const anchorFromPoint = (
  geometry: NodeGeometry,
  point: Point,
  options?: { snapToOutline?: boolean },
): Anchor => {
  const local = unrotateNodePoint(geometry, point);
  const position = options?.snapToOutline
    ? (nodeShapeGeometry(geometry.outline)?.nearest?.(geometry, local) ?? local)
    : local;
  const width = options?.snapToOutline ? geometry.width || 1 : geometry.width;
  const height = options?.snapToOutline
    ? geometry.height || 1
    : geometry.height;
  return [
    (position[0] - geometry.x) / width,
    (position[1] - geometry.y) / height,
  ];
};

export const anchorSide = (anchor: Anchor): GeometrySide => {
  const [x, y] = anchor;
  const nearest: [GeometrySide, number][] = [
    ['left', Math.abs(x)],
    ['right', Math.abs(1 - x)],
    ['top', Math.abs(y)],
    ['bottom', Math.abs(1 - y)],
  ];
  nearest.sort((a, b) => a[1] - b[1]);
  return nearest[0][0];
};
